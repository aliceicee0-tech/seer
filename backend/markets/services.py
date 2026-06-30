"""
Service métier des marchés prédictifs Nexus — moteur Polymarket.

Modèle financier : **collatéralisation stricte** (pas de pari mutuel, pas de
risque de caisse). Invariant fondamental (cahier des charges §1, §2, §4, §5) :

    escrow(market) == YES_en_circulation × 1,00 == NO_en_circulation × 1,00
                   == (pairs_created − pairs_destroyed) × 1,00

Opérations garantissant l'invariant :
- `mint_pair`  : 1,00 MGA wallet → escrow ; crée 1 YES + 1 NO.
- `merge_pair` : détruit 1 YES + 1 NO ; escrow → 1,00 MGA wallet.
- `place_order`/`_match` : échange P2P, l'escrow marché est **inchangé**.
                         (les fonds des ordres d'achat en attente sont
                          séquestrés dans le `locked_balance` du wallet acheteur,
                          pas dans l'escrow du marché).
- `resolve_market` : paie 1,00 MGA / part gagnante (puise dans l'escrow,
                     qui retombe à 0) ; détruit les parts perdantes.
- `cancel_market` : rembourse 1,00 MGA / part (tous côtés confondus).

Toute mutation de solde passe par `ledger.services` (atomic + select_for_update,
non-négativité). Aucun autre code ne touche directement à `wallet.balance`.
"""
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from ledger.services import (
    InsufficientFunds, lock_amount, post_entry, settle_buy_fill, unlock_amount,
)

from .models import (
    Market, MarketOutcome, MarketPool, MarketStatus, Order, Position, Trade,
)


def share_value() -> Decimal:
    """Valeur d'une part à la résolution (5000 Ar par défaut).

    Centralisé ici pour que tout le moteur utilise la même unité.
    1 paire (1 YES + 1 NO) vaut `share_value()` Ar en séquestre.
    Le prix d'une part sur le carnet fluctue entre 1 Ar et share_value − 1 Ar.
    """
    return Decimal(settings.SHARE_VALUE)


class MarketError(Exception):
    """Erreur métier liée à un marché (état, montant, ordre, etc.)."""


# ==========================================================================
# Helpers internes
# ==========================================================================

def _get_pool_locked(market) -> MarketPool:
    """Récupère le pool du marché avec verrou pessimiste."""
    return MarketPool.objects.select_for_update().get(market=market)


def _get_position_locked(user, market, outcome) -> Position:
    """Récupère (ou crée vide) une position avec verrou pessimiste."""
    pos, _ = Position.objects.select_for_update().get_or_create(
        user=user, market=market, outcome=outcome,
    )
    return pos


def _new_avg_buy_price(old_qty: int, old_avg: Decimal, added_qty: int,
                       price: Decimal) -> Decimal:
    """Prix moyen pondéré après un achat de `added_qty` parts à `price`."""
    total_qty = old_qty + added_qty
    if total_qty <= 0:
        return Decimal("0")
    new_avg = (Decimal(old_qty) * Decimal(old_avg) + Decimal(added_qty) * Decimal(price)) / total_qty
    return new_avg.quantize(Decimal("0.01"))


def _order_needs_price(order: Order):
    if order.order_type == Order.OrderType.LIMIT:
        return True
    # Un MARKET SELL doit pouvoir se croiser, pas de prix requis.
    return False


def _matches(order_a: Order, order_b: Order) -> bool:
    """Deux ordres opposés du MÊME côté peuvent-ils se croiser ?

    Un achat à prix limite P achète toute offre (vente) de prix <= P.
    Un achat au marché accepte n'importe quel prix de vente.
    Symétrique pour les ventes. Le prix d'exécution est celui de l'ordre
    passif (au repos) — convention CLOB standard.
    """
    if order_a.side == order_b.side:
        return False
    if order_a.outcome != order_b.outcome:
        return False
    # Au moins un des deux doit avoir un prix défini pour fixer le prix d'exécution.
    if order_a.price is None and order_b.price is None:
        return False
    if order_a.side == Order.Side.BUY:
        buyer, seller = order_a, order_b
    else:
        buyer, seller = order_b, order_a
    buyer_price = buyer.price  # None si MARKET
    seller_price = seller.price
    if buyer_price is None:
        return seller_price is not None          # achat au marché vs vente à prix
    if seller_price is None:
        return buyer_price is not None           # vente au marché vs achat à prix
    return buyer_price >= seller_price           # limit vs limit


# ==========================================================================
# Émission / fusion de paires (Split / Merge) — cahier des charges §3.1
# ==========================================================================

@transaction.atomic
def mint_pair(*, user, market, count: int):
    """Émet `count` paires (1 YES + 1 NO chacune) pour `user` sur `market`.

    Prélève exactement `count × 1,00` MGA du wallet, les séquestre dans le
    pool du marché, et crédite `count` parts YES et NO au demandeur.
    """
    count = int(count)
    if count <= 0:
        raise MarketError("Le nombre de paires doit être positif.")
    if not market.is_tradeable():
        raise MarketError("Ce marché n'accepte plus d'émissions.")

    pool = _get_pool_locked(market)
    sv = share_value()
    cost = sv * count

    # 1) Débit wallet → séquestre marché (écriture MINT)
    try:
        post_entry(
            wallet=user.wallet,
            entry_type="MINT",
            amount=-cost,
            related_type="market_pool",
            related_id=market.id,
            reference=f"#MINT-M{market.id}",
            note=f"Émission de {count} paire(s) YES+NO",
            created_by=user,
        )
    except InsufficientFunds as e:
        raise MarketError(str(e))

    # 2) Escrow += count × valeur_partage, compteur de paires
    pool.escrow_balance += cost
    pool.pairs_created += count
    pool.save(update_fields=["escrow_balance", "pairs_created", "updated_at"])

    # 3) Crédit des parts YES et NO au demandeur (moyen = share_value à l'émission)
    for outcome in (MarketOutcome.YES, MarketOutcome.NO):
        pos = _get_position_locked(user, market, outcome)
        pos.avg_buy_price = _new_avg_buy_price(
            pos.quantity, pos.avg_buy_price, count, sv
        )
        pos.quantity += count
        pos.save(update_fields=["quantity", "avg_buy_price", "updated_at"])

    return pool


@transaction.atomic
def merge_pair(*, user, market, count: int):
    """Fusionne `count` paires : détruit `count` YES ET `count` NO, libère 1,00/paire.

    Permet à un utilisateur qui détient les deux côtés de récupérer exactement
    1,00 MGA par paire détruite, à tout moment (cahier des charges Phase 4).
    """
    count = int(count)
    if count <= 0:
        raise MarketError("Le nombre de paires doit être positif.")
    if not market.is_tradeable():
        raise MarketError("Ce marché n'accepte plus de fusions.")

    pool = _get_pool_locked(market)

    # Vérifie la détention disponible des deux côtés
    pos_yes = _get_position_locked(user, market, MarketOutcome.YES)
    pos_no = _get_position_locked(user, market, MarketOutcome.NO)
    if pos_yes.available_quantity < count or pos_no.available_quantity < count:
        raise MarketError(
            "Fusion impossible : pas assez de parts YES + NO disponibles."
        )

    # Détruit les parts
    pos_yes.quantity -= count
    pos_no.quantity -= count
    pos_yes.save(update_fields=["quantity", "updated_at"])
    pos_no.save(update_fields=["quantity", "updated_at"])

    # Libère l'escrow
    release = share_value() * count
    pool.escrow_balance -= release
    pool.pairs_destroyed += count
    pool.save(update_fields=["escrow_balance", "pairs_destroyed", "updated_at"])

    # Crédit wallet ← escrow (écriture MERGE)
    post_entry(
        wallet=user.wallet,
        entry_type="MERGE",
        amount=release,
        related_type="market_pool",
        related_id=market.id,
        reference=f"#MRGE-M{market.id}",
        note=f"Fusion de {count} paire(s) YES+NO",
        created_by=user,
    )
    return pool


# ==========================================================================
# Carnet d'ordres (CLOB) — cahier des charges §3.2 / Phase 3
# ==========================================================================

@transaction.atomic
def place_order(*, user, market, side: str, outcome: str, order_type: str,
                quantity: int, price=None, expires_at=None) -> Order:
    """Crée un ordre et tente immédiatement de l'exécuter contre le carnet.

    Achats (BUY) : le coût `qty × price` (LIMIT) est séquestré dans le
    `locked_balance` de l'acheteur ; débit réel et libération au fil des fills.
    Ventes (SELL) : les parts `qty` sont verrouillées (`locked_quantity`) tant
    que l'ordre est au carnet.

    Priorité d'appariement (Phase 3) : prix → date → FIFO.
    """
    if side not in Order.Side.values:
        raise MarketError("side invalide (BUY ou SELL).")
    if outcome not in MarketOutcome.values:
        raise MarketError("outcome invalide (YES ou NO).")
    if order_type not in Order.OrderType.values:
        raise MarketError("order_type invalide (LIMIT ou MARKET).")
    quantity = int(quantity)
    if quantity <= 0:
        raise MarketError("La quantité doit être positive.")
    if not market.is_tradeable():
        raise MarketError("Ce carnet d'ordres est fermé.")

    # Validation du prix (bornes en Ar) — défense en profondeur (le validateur
    # du modèle le contrôle aussi côté DB).
    min_p = Decimal(settings.MIN_ORDER_PRICE)
    max_p = Decimal(settings.MAX_ORDER_PRICE)
    if order_type == Order.OrderType.LIMIT:
        if price is None:
            raise MarketError("Un ordre LIMIT requiert un prix.")
        price = Decimal(price)
        if price < min_p or price > max_p:
            raise MarketError(f"Prix hors bornes [{min_p}, {max_p}] Ar.")

    # On verrouille le marché pour éviter toute concurrence sur le carnet.
    market = Market.objects.select_for_update().get(pk=market.pk)
    if not market.is_tradeable():
        raise MarketError("Ce carnet d'ordres est fermé.")

    # Pré-réservation des ressources (fonds ou parts) AVANT toute exécution.
    if side == Order.Side.BUY:
        # Achat LIMIT : on séquestre qty × price (le pire cas) dans locked_balance.
        if order_type == Order.OrderType.LIMIT:
            try:
                lock_amount(user.wallet, Decimal(price) * quantity)
            except InsufficientFunds as e:
                raise MarketError(str(e))
        # Achat MARKET : pas de réservation à l'avance (on paie au fil des fills,
        # avec contrôle de solde à chaque exécution).
    else:  # SELL
        pos = _get_position_locked(user, market, outcome)
        if pos.available_quantity < quantity:
            raise MarketError("Parts disponibles insuffisantes pour la vente.")
        pos.locked_quantity += quantity
        pos.save(update_fields=["locked_quantity", "updated_at"])

    order = Order.objects.create(
        user=user, market=market, side=side, order_type=order_type,
        outcome=outcome, price=price if order_type == Order.OrderType.LIMIT else None,
        quantity=quantity, expires_at=expires_at,
    )

    _match(order, market)

    _refresh_order_status(order)
    return order


def _match(new_order: Order, market: Market):
    """Apparie `new_order` contre les ordres opposés en attente du carnet.

    Règle d'or (§3.2) : l'argent crédité au vendeur provient exclusivement du
    débit de l'acheteur. L'escrow marché n'est JAMAIS touché par un trade.
    Le prix d'exécution = prix de l'ordre passif (au repos).
    """
    new_order = Order.objects.select_for_update().get(pk=new_order.pk)

    opposite_side = (Order.Side.SELL if new_order.side == Order.Side.BUY
                     else Order.Side.BUY)

    # Sélection du meilleur ordre opposé selon la priorité prix → date → FIFO.
    # Pour un acheteur : on cherche les VENTES les moins chères d'abord.
    # Pour un vendeur  : on cherche les ACHATS les plus chers d'abord.
    while new_order.remaining_quantity > 0:
        candidates = (
            Order.objects.select_for_update()
            .filter(
                market=market, outcome=new_order.outcome,
                side=opposite_side,
                status__in=[Order.Status.OPEN, Order.Status.PARTIAL],
                price__isnull=False,   # un prix est requis pour fixer l'exécution
            )
            .exclude(user=new_order.user)   # pas de self-trade
        )
        if new_order.side == Order.Side.BUY:
            candidates = candidates.order_by("price", "created_at", "id")
        else:
            candidates = candidates.order_by("-price", "created_at", "id")
        resting = candidates.first()
        if resting is None:
            break  # carnet vide (ou que des MARKET sans prix)
        if resting.remaining_quantity <= 0:
            # Ordre déjà saturé mais statut pas encore reclassé : on le clôture
            # pour qu'il ne revienne plus dans la sélection (défense en profondeur).
            resting.status = Order.Status.FILLED
            resting.save(update_fields=["status", "updated_at"])
            continue

        if not _matches(new_order, resting):
            break  # plus rien de compatible (ex: prix limite non atteint)

        fill_qty = min(new_order.remaining_quantity, resting.remaining_quantity)
        if fill_qty <= 0:
            # Garde-fou : aucune progression possible → on sort pour éviter une boucle.
            break
        fill_price = resting.price  # prix de l'ordre passif

        _execute_fill(
            market=market, outcome=new_order.outcome,
            aggressor=new_order, resting=resting,
            fill_qty=fill_qty, fill_price=fill_price,
        )

        # Recharge les quantités restantes après exécution.
        new_order.refresh_from_db()


@transaction.atomic
def _execute_fill(*, market, outcome, aggressor: Order, resting: Order,
                  fill_qty: int, fill_price: Decimal):
    """Exécute UNE transaction entre l'ordre agresseur et l'ordre au repos.

    Acheteur / vendeur sont déterminés selon le côté, indépendamment de qui
    est agresseur. Le prix d'exécution est `fill_price` (prix de l'ordre passif).
    """
    if aggressor.side == Order.Side.BUY:
        buyer, seller = aggressor, resting
        buy_order, sell_order = aggressor, resting
    else:
        buyer, seller = resting, aggressor
        buy_order, sell_order = resting, aggressor

    cost = fill_price * fill_qty

    # --- Côté ACHETEUR ---
    if buyer.order_type == Order.OrderType.LIMIT:
        # L'acheteur avait séquestré qty × buyer.price dans locked_balance.
        # On règle : débit réel de `cost`, libération de fill_qty × buyer.price.
        reserve_release = Decimal(buyer.price) * fill_qty
        settle_buy_fill(
            wallet=buyer.user.wallet, cost=cost,
            reserve_release=reserve_release,
            entry_type="TRADE_BUY",
            reference=f"#BUY-M{market.id}",
            note=f"Achat {fill_qty}× {outcome} @ {fill_price}",
            related_id=buy_order.id, created_by=buyer.user,
        )
        # Le différentiel (buyer.price − fill_price) reste bloqué dans
        # locked_balance et sera libéré à la cancellation/fin de l'ordre.
    else:
        # Achat MARKET : débit direct (aucune réserve préalable).
        try:
            post_entry(
                wallet=buyer.user.wallet,
                entry_type="TRADE_BUY",
                amount=-cost,
                related_type="order", related_id=buy_order.id,
                reference=f"#BUY-M{market.id}",
                note=f"Achat {fill_qty}× {outcome} @ {fill_price} (market)",
                created_by=buyer.user,
            )
        except InsufficientFunds:
            # Solde insuffisant en cours de market sweep : on arrête net.
            # On marque l'ordre PARTIAL (ce qui est déjà rempli le reste) et
            # on annule le reste sans fraude (rien n'a été débité pour ce fill).
            raise MarketError("Solde insuffisant pour compléter l'ordre au marché.")

    # --- Côté VENDEUR ---
    post_entry(
        wallet=seller.user.wallet,
        entry_type="TRADE_SELL",
        amount=cost,
        related_type="order", related_id=sell_order.id,
        reference=f"#SELL-M{market.id}",
        note=f"Vente {fill_qty}× {outcome} @ {fill_price}",
        created_by=seller.user,
    )

    # --- Transfert de parts vendeur → acheteur ---
    seller_pos = _get_position_locked(seller.user, market, outcome)
    buyer_pos = _get_position_locked(buyer.user, market, outcome)
    seller_pos.quantity -= fill_qty
    seller_pos.locked_quantity = max(0, seller_pos.locked_quantity - fill_qty)
    # Moyen pondéré acheteur (mise à jour avant d'ajouter la quantité)
    buyer_pos.avg_buy_price = _new_avg_buy_price(
        buyer_pos.quantity, buyer_pos.avg_buy_price, fill_qty, fill_price
    )
    buyer_pos.quantity += fill_qty
    seller_pos.save(update_fields=["quantity", "locked_quantity", "updated_at"])
    buyer_pos.save(
        update_fields=["quantity", "avg_buy_price", "updated_at"]
    )

    # --- Avancement des ordres (quantité + statut) ---
    for o in (buyer, seller):
        o.filled_quantity += fill_qty
        # Transition de statut : un ordre pleinement rempli sort du carnet.
        if o.filled_quantity >= o.quantity:
            o.status = Order.Status.FILLED
        elif o.filled_quantity > 0:
            o.status = Order.Status.PARTIAL
        o.save(update_fields=["filled_quantity", "status", "updated_at"])

    Trade.objects.create(
        market=market, outcome=outcome,
        buyer=buyer.user, seller=seller.user,
        buy_order=buy_order, sell_order=sell_order,
        price=fill_price, quantity=fill_qty,
    )


@transaction.atomic
def cancel_order(*, order: Order, user) -> Order:
    """Annule un ordre ouvert : rembourse le séquestre achat ou débloque les parts.

    Les ordres déjà partiellement exécutés conservent leur `filled_quantity`.
    """
    if order.user_id != user.id:
        raise MarketError("Vous ne pouvez annuler que vos propres ordres.")
    if order.status in (Order.Status.FILLED, Order.Status.CANCELLED, Order.Status.EXPIRED):
        raise MarketError("Cet ordre n'est plus annulable.")

    order = Order.objects.select_for_update().get(pk=order.pk)
    remaining = order.remaining_quantity

    if order.side == Order.Side.BUY and order.order_type == Order.OrderType.LIMIT:
        # Libère le séquestre restant (qty restante × prix limite).
        unlock_amount(order.user.wallet, Decimal(order.price) * remaining)
        post_entry(
            wallet=order.user.wallet,
            entry_type="ORDER_REFUND",
            amount=Decimal("0"),  # écriture de trace (le solde ne change pas)
            reference=f"#RFD-O{order.id}",
            note=f"Annulation ordre achat — libération séquestre {remaining}× {order.price}",
            created_by=user,
        )
    elif order.side == Order.Side.SELL:
        pos = _get_position_locked(order.user, order.market, order.outcome)
        pos.locked_quantity = max(0, pos.locked_quantity - remaining)
        pos.save(update_fields=["locked_quantity", "updated_at"])

    order.status = Order.Status.CANCELLED
    order.save(update_fields=["status", "updated_at"])
    return order


def _refresh_order_status(order: Order):
    """Recalcule le statut d'un ordre après exécution."""
    order.refresh_from_db()
    if order.filled_quantity >= order.quantity:
        order.status = Order.Status.FILLED
    elif order.filled_quantity > 0:
        order.status = Order.Status.PARTIAL
    else:
        order.status = Order.Status.OPEN
    order.save(update_fields=["status", "updated_at"])


def expire_orders() -> int:
    """Marque EXPIRÉS les ordres ouverts dont `expires_at` est dépassé.

    À appeler périodiquement (Phase 3 — expiration). Idempotent.
    """
    now = timezone.now()
    n = 0
    qs = Order.objects.select_for_update().filter(
        status__in=[Order.Status.OPEN, Order.Status.PARTIAL],
        expires_at__lte=now,
    )
    with transaction.atomic():
        for order in qs:
            cancel_order(order=order, user=order.user)
            order.status = Order.Status.EXPIRED
            order.save(update_fields=["status", "updated_at"])
            n += 1
    return n


# ==========================================================================
# Résolution / annulation de marché — cahier des charges §3.3 / Phase 6
# ==========================================================================

@transaction.atomic
def resolve_market(*, market, outcome: str, admin_user) -> Market:
    """Résout un marché : fige le carnet, paie les gagnants (1,00/part), détruit les perdants.

    Étapes :
      1. annule tous les ordres ouverts (remboursements / déblocages) ;
      2. paie 1,00 MGA par part du côté gagnant (puise dans l'escrow) ;
      3. détruit les parts du côté perdant (valeur 0) ;
      4. assert final : l'escrow doit retomber à 0.
    """
    market = Market.objects.select_for_update().get(pk=market.pk)
    pool = _get_pool_locked(market)

    if outcome not in MarketOutcome.values:
        raise MarketError("Résultat invalide (OUI ou NON).")
    if market.status not in (MarketStatus.LOCKED, MarketStatus.RESOLVING,
                             MarketStatus.OPEN, MarketStatus.FROZEN):
        raise MarketError(
            f"Marché non résolvable (statut actuel : {market.get_status_display()})."
        )

    # 1) Gel + annulation du carnet
    market.status = MarketStatus.RESOLVED
    market.outcome = outcome
    market.resolved_by = admin_user
    market.resolved_at = timezone.now()
    market.save(update_fields=[
        "status", "outcome", "resolved_by", "resolved_at", "updated_at"
    ])

    for order in list(market.orders.filter(
        status__in=[Order.Status.OPEN, Order.Status.PARTIAL]
    )):
        cancel_order(order=order, user=admin_user)

    # 2 & 3) Paiement des gagnants + destruction des perdants
    winning_outcome = outcome
    losing_outcome = MarketOutcome.NO if outcome == MarketOutcome.YES else MarketOutcome.YES

    for pos in list(Position.objects.select_for_update().filter(market=market)):
        if pos.outcome == winning_outcome and pos.quantity > 0:
            payout = share_value() * pos.quantity
            post_entry(
                wallet=pos.user.wallet,
                entry_type="SETTLE_WIN",
                amount=payout,
                related_type="market", related_id=market.id,
                reference=f"#WIN-M{market.id}",
                note=f"Résolution « {market.question[:50]} » — {winning_outcome} gagnant",
                created_by=admin_user,
            )
            pool.escrow_balance -= payout
            pool.save(update_fields=["escrow_balance", "updated_at"])
        # Toute position (gagnante ou perdante) est détruite : ses parts n'ont
        # plus de valeur après résolution.
        pos.delete()

    pool.save(update_fields=["escrow_balance", "pairs_destroyed", "updated_at"])
    pool.refresh_from_db()
    if pool.escrow_balance != 0:
        # Anomalie critique : on gèle et on signale (ne pas masquer).
        market.status = MarketStatus.FROZEN
        market.save(update_fields=["status", "updated_at"])
        raise MarketError(
            f"Résolution incohérente : escrow résiduel {pool.escrow_balance} "
            f"(attendu 0). Marché gelé pour audit."
        )
    return market


@transaction.atomic
def cancel_market(*, market, admin_user) -> Market:
    """Annule un marché : rembourse chaque détenteur de parts à 1,00 MGA/part.

    Comme un remboursement universel : tout YES et tout NO vaut 1,00 MGA,
    ce qui épuise exactement l'escrow (puisque YES == NO == paires en circulation).
    """
    market = Market.objects.select_for_update().get(pk=market.pk)
    pool = _get_pool_locked(market)

    if market.status == MarketStatus.CANCELLED:
        return market

    market.status = MarketStatus.CANCELLED
    market.resolved_by = admin_user
    market.resolved_at = timezone.now()
    market.save(update_fields=[
        "status", "resolved_by", "resolved_at", "updated_at"
    ])

    # Annule le carnet
    for order in list(market.orders.filter(
        status__in=[Order.Status.OPEN, Order.Status.PARTIAL]
    )):
        cancel_order(order=order, user=admin_user)

    # Rembourse chaque part à la moitié de sa valeur (neutralité : pas de gagnant).
    # Comme YES_en_circulation == NO_en_circulation == paires en circulation,
    # rembourser chaque côté à share_value/2 épuise exactement l'escrow
    # (1 paire = share_value Ar). NB : un utilisateur ayant pu acquérir un côté
    # « nu » (sans l'autre) via le carnet reçoit aussi share_value/2 par part —
    # l'escrow reste équilibré car total YES == total NO == escrow.
    REFUND_PER_SHARE = (share_value() / 2).quantize(Decimal("0.01"))
    for pos in list(Position.objects.select_for_update().filter(market=market)):
        if pos.quantity > 0:
            payout = (REFUND_PER_SHARE * pos.quantity).quantize(Decimal("0.01"))
            post_entry(
                wallet=pos.user.wallet,
                entry_type="SETTLE_WIN",
                amount=payout,
                related_type="market", related_id=market.id,
                reference=f"#RFD-M{market.id}",
                note=f"Annulation marché « {market.question[:50]} » — remboursement 0,50/part",
                created_by=admin_user,
            )
            pool.escrow_balance -= payout
            pool.save(update_fields=["escrow_balance", "updated_at"])
        pos.delete()

    pool.refresh_from_db()
    if pool.escrow_balance != 0:
        market.status = MarketStatus.FROZEN
        market.save(update_fields=["status", "updated_at"])
        raise MarketError(
            f"Annulation incohérente : escrow résiduel {pool.escrow_balance}. "
            f"Marché gelé pour audit."
        )
    return market


# ==========================================================================
# Transition d'état automatique — Phase 6 (workflow)
# ==========================================================================

def auto_lock_expired_markets() -> int:
    """Passe les marchés OPEN dont la clôture est dépassée en LOCKED.

    Idempotent (filtre sur status + select_for_update).
    """
    now = timezone.now()
    with transaction.atomic():
        qs = (
            Market.objects.select_for_update()
            .filter(status=MarketStatus.OPEN, bet_close_at__lte=now)
        )
        for m in qs:
            m.status = MarketStatus.LOCKED
            m.save(update_fields=["status", "updated_at"])
        return qs.count()


# ==========================================================================
# Vérification d'invariance — cahier des charges §5 / Phase 10
# ==========================================================================

@transaction.atomic
def freeze_market(market) -> Market:
    """Gèle un marché (anomalie d'invariance). Bloque tout échange."""
    market = Market.objects.select_for_update().get(pk=market.pk)
    market.status = MarketStatus.FROZEN
    market.save(update_fields=["status", "updated_at"])
    return market


def verify_invariants() -> dict:
    """Vérifie les invariants financiers et gèle les marchés en anomalie.

    Invariants :
      a) par marché : escrow == pairs_created − pairs_destroyed
                      ET Σ YES == Σ NO == escrow ;
      b) global     : Σ balances + Σ escrow + Σ locked ==
                      Σ dépôts approuvés − Σ retraits payés.

    Une anomalie gèle le (ou les) marché(s) concerné(s). Aucune donnée n'est
    perdue : le gel fige pour audit manuel.
    """
    from django.db.models import Sum
    from ledger.models import LedgerEntry, Wallet

    report = {"frozen_markets": [], "global_invariant_ok": True}

    # --- a) Invariants par marché -----------------------------------------
    for market in Market.objects.exclude(status=MarketStatus.RESOLVED):
        try:
            pool = market.pool
        except MarketPool.DoesNotExist:
            report["frozen_markets"].append(
                {"market": market.id, "reason": "pool manquant"}
            )
            freeze_market(market)
            continue

        yes_total = Position.total_quantity(market, MarketOutcome.YES)
        no_total = Position.total_quantity(market, MarketOutcome.NO)

        ok = (
            pool.invariant_ok()
            and yes_total == no_total == pool.pairs_in_circulation
            and Decimal(pool.escrow_balance) == Decimal(yes_total) * share_value()
        )
        if not ok:
            report["frozen_markets"].append({
                "market": market.id,
                "escrow": str(pool.escrow_balance),
                "yes_total": yes_total,
                "no_total": no_total,
                "pairs": pool.pairs_in_circulation,
            })
            freeze_market(market)

    # --- b) Invariant global (conservation de la masse monétaire) ----------
    # L'argent « réellement détenu » par le système = wallets + escrow.
    # `locked_balance` est un SOUS-ENSEMBLE de `balance` (fonds d'ordres/retraits
    # en attente, toujours comptés dans balance) → on ne l'ajoute pas.
    # Les entrées/sorties réelles se mesurent via les demandes (déjà traitées),
    # pas via les écritures (le retrait à 2 phases y crée 2 lignes).
    from payments.models import DepositRequest, WithdrawRequest

    wallets = Wallet.objects.aggregate(bal=Sum("balance"))
    total_balance = Decimal(wallets["bal"] or 0)
    total_escrow = Decimal(
        MarketPool.objects.aggregate(t=Sum("escrow_balance"))["t"] or 0
    )
    deposits_in = Decimal(
        DepositRequest.objects.filter(
            status=DepositRequest.Status.APPROVED
        ).aggregate(t=Sum("amount"))["t"] or 0
    )
    withdrawals_out = Decimal(
        WithdrawRequest.objects.filter(
            status=WithdrawRequest.Status.PAID
        ).aggregate(t=Sum("amount"))["t"] or 0
    )
    actual = total_balance + total_escrow
    expected = deposits_in - withdrawals_out
    if actual != expected:
        report["global_invariant_ok"] = False
        report["global"] = {
            "actual": str(actual), "expected": str(expected),
            "balance": str(total_balance), "escrow": str(total_escrow),
            "deposits_in": str(deposits_in),
            "withdrawals_out": str(withdrawals_out),
        }

    return report


# ==========================================================================
# Estimation indicative (cahier des charges §3.2 — lecture seule)
# ==========================================================================

def estimate_payout(market: Market, outcome: str, quantity) -> dict:
    """Estimation du gain potentiel pour `quantity` parts du côté `outcome`.

    Modèle collatéralisé : à la résolution, chaque part gagnante vaut exactement
    `share_value()` Ar (5000 par défaut). L'estimation ne dépend donc PAS d'un
    pool (contrairement au pari mutuel) — seulement de la quantité détenue.
    """
    if outcome not in MarketOutcome.values:
        raise MarketError("outcome invalide (YES ou NO).")
    quantity = int(quantity)
    if quantity <= 0:
        raise MarketError("La quantité doit être positive.")

    sv = share_value()
    last_price = market.last_trade_price()
    current_cost = (last_price * quantity) if last_price else None
    payout = sv * quantity
    return {
        "quantity": str(quantity),
        "outcome": outcome,
        "current_price": str(last_price) if last_price else None,
        "current_cost": str(current_cost) if current_cost else None,
        "payout_if_win": str(payout),
        "profit_if_win": str(payout - current_cost) if current_cost else None,
    }
