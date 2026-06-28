"""
Services métier des marchés prédictifs Seer.

- `place_bet`     : place une mise (débit wallet atomique, MAJ du pool).
- `resolve_market`: résout un marché et redistribue les gains (pari mutuel).
- `cancel_market` : annule un marché et rembourse toutes les mises.

Toutes les écritures de solde passent par `ledger.services.post_entry`.
"""
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from ledger.services import post_entry, InsufficientFunds

from .models import Bet, Market, MarketOutcome, MarketStatus


class MarketError(Exception):
    """Erreur métier liée à un marché (état, montant, etc.)."""


# --------------------------------------------------------------------------
# Placement d'un pari
# --------------------------------------------------------------------------

@transaction.atomic
def place_bet(*, user, market, outcome: str, amount) -> Bet:
    """Place une mise sur un marché ouvert.

    - débite immédiatement le wallet de l'utilisateur (via ledger) ;
    - incrémente le pool correspondant (avec verrou sur le marché) ;
    - crée le Bet et son écriture comptable associée.

    Raises:
        MarketError: marché non pariable, montant invalide, outcome inconnu.
        InsufficientFunds: solde insuffisant.
    """
    # Re-verrouille le marché pour éviter une course sur les compteurs de pool
    market = Market.objects.select_for_update().get(pk=market.pk)

    if outcome not in MarketOutcome.values:
        raise MarketError("Issue invalide (OUI ou NON attendu).")
    if not market.is_bettable():
        raise MarketError("Ce marché n'est plus ouvert aux paris.")
    amount = Decimal(amount)
    if amount < Decimal(settings.MIN_BET_AMOUNT):
        raise MarketError(
            f"Mise minimale : {settings.MIN_BET_AMOUNT} MGA."
        )

    wallet = user.wallet

    # 1) Débit wallet (atomique + verrou interne)
    try:
        wallet, entry = post_entry(
            wallet=wallet,
            entry_type="BET_PLACE",
            amount=-amount,
            related_type="market",
            related_id=market.id,
            reference=f"#BET-M{market.id}",
            note=f"Mise {outcome} sur « {market.question[:80]} »",
            created_by=user,
        )
    except InsufficientFunds as e:
        raise MarketError(str(e))

    # 2) Mise à jour du pool + proba indicative
    proba = market.proba()[outcome]
    if outcome == MarketOutcome.YES:
        market.pool_yes += amount
    else:
        market.pool_no += amount
    market.save(update_fields=["pool_yes", "pool_no", "updated_at"])

    # 3) Création du pari
    bet = Bet.objects.create(
        market=market,
        user=user,
        outcome=outcome,
        amount=amount,
        proba_at_place=proba,
        ledger_entry=entry,
    )
    entry.related_id = bet.id  # lie rétroactivement l'écriture au pari
    # (entry.related_type déjà 'market')
    return bet


# --------------------------------------------------------------------------
# Cotes / gain potentiel (lecture seule)
# --------------------------------------------------------------------------

def estimate_payout(market: Market, outcome: str, amount) -> dict:
    """Estimation du gain potentiel — INDICATIF, évolue jusqu'à la clôture.

    Formule pari mutuel :
        gain = (mise / total_mises_camp_gagnant) × pool × (1 − commission%)
    """
    amount = Decimal(amount)
    commission_rate = Decimal(settings.PLATFORM_COMMISSION_RATE) / Decimal("100")
    pool_total = market.pool_total
    pool_camp = Decimal(market.pool_yes) if outcome == MarketOutcome.YES else Decimal(market.pool_no)

    # On ajoute la mise hypothétique au camp pour l'estimation
    future_camp = pool_camp + amount
    future_pool = pool_total + amount
    distribuable = future_pool * (Decimal("1") - commission_rate)

    if future_camp <= 0:
        estimated_gain = amount  # cas dégénéré
    else:
        estimated_gain = (amount / future_camp) * distribuable

    estimated_gain = estimated_gain.quantize(Decimal("0.01"))
    net = (estimated_gain - amount).quantize(Decimal("0.01"))
    return {
        "stake": str(amount),
        "estimated_payout": str(estimated_gain),
        "estimated_net": str(max(net, Decimal("0"))),
        "current_pool_yes": str(market.pool_yes),
        "current_pool_no": str(market.pool_no),
        "current_pool_total": str(future_pool),
        "commission_rate": str(settings.PLATFORM_COMMISSION_RATE),
    }


# --------------------------------------------------------------------------
# Résolution d'un marché
# --------------------------------------------------------------------------

@transaction.atomic
def resolve_market(*, market, outcome: str, admin_user) -> Market:
    """Résout un marché et redistribue proportionnellement les gains.

    Étapes :
      1. verrouille le marché, passe en RESOLVED ;
      2. calcule le pool distribuable (pool × (1 − commission)) ;
      3. pour chaque pari gagnant : credit = (mise / somme_camp_gagnant) × distribuable ;
      4. crédit atomique via ledger + marque le pari WON ; les autres LOST.

    Si le camp gagnant n'a aucune mise, le pool distribuable est reversé
    intégralement aux perdants à parts égales de leurs mises (re-fund intégral).
    """
    market = Market.objects.select_for_update().get(pk=market.pk)

    if outcome not in MarketOutcome.values:
        raise MarketError("Résultat invalide (OUI ou NON).")
    if market.status not in (MarketStatus.LOCKED, MarketStatus.RESOLVING, MarketStatus.OPEN):
        raise MarketError(
            f"Marché non résolvable (statut actuel : {market.get_status_display()})."
        )

    market.status = MarketStatus.RESOLVED
    market.outcome = outcome
    market.resolved_by = admin_user
    market.resolved_at = timezone.now()
    market.save(update_fields=["status", "outcome", "resolved_by", "resolved_at", "updated_at"])

    commission_rate = Decimal(settings.PLATFORM_COMMISSION_RATE) / Decimal("100")
    distribuable = market.pool_total * (Decimal("1") - commission_rate)

    winning_camp = Decimal(
        market.pool_yes if outcome == MarketOutcome.YES else market.pool_no
    )

    winners = market.bets.select_for_update().filter(
        outcome=outcome, status=Bet.Status.PLACED
    )
    losers = market.bets.select_for_update().exclude(
        outcome=outcome
    ).filter(status=Bet.Status.PLACED)

    if winning_camp > 0:
        # Redistribution normale
        for bet in winners:
            payout = (Decimal(bet.amount) / winning_camp) * distribuable
            payout = payout.quantize(Decimal("0.01"))
            bet.payout = payout
            bet.status = Bet.Status.WON
            bet.save(update_fields=["payout", "status"])
            # Crédit net = payout (la mise a déjà été débitée à la pose)
            post_entry(
                wallet=bet.user.wallet,
                entry_type="BET_WIN",
                amount=payout,
                related_type="bet",
                related_id=bet.id,
                reference=f"#WIN-M{market.id}",
                note=f"Gain pari « {market.question[:60]} »",
                created_by=admin_user,
            )
        losers.update(status=Bet.Status.LOST)
    else:
        # Aucun gagnant : on rembourse tous les joueurs à hauteur de leur mise
        distribuable = market.pool_total * (Decimal("1") - commission_rate)
        total_all = market.pool_total
        # On combine par OU (et non .union()) : .union() produit un statement
        # composé interdit avec un ORDER BY de sous-requête (Bet.Meta.ordering).
        for bet in (winners | losers):
            refund = (Decimal(bet.amount) / total_all) * distribuable \
                if total_all > 0 else Decimal("0")
            refund = refund.quantize(Decimal("0.01"))
            bet.payout = refund
            bet.status = Bet.Status.REFUNDED
            bet.save(update_fields=["payout", "status"])
            post_entry(
                wallet=bet.user.wallet,
                entry_type="BET_REFUND",
                amount=refund,
                related_type="bet",
                related_id=bet.id,
                reference=f"#RFD-M{market.id}",
                note=f"Remboursement « {market.question[:60]} »",
                created_by=admin_user,
            )

    return market


@transaction.atomic
def cancel_market(*, market, admin_user) -> Market:
    """Annule un marché et rembourse intégralement toutes les mises."""
    market = Market.objects.select_for_update().get(pk=market.pk)
    if market.status == MarketStatus.CANCELLED:
        return market

    market.status = MarketStatus.CANCELLED
    market.resolved_by = admin_user
    market.resolved_at = timezone.now()
    market.save(update_fields=["status", "resolved_by", "resolved_at", "updated_at"])

    bets = market.bets.select_for_update().filter(status=Bet.Status.PLACED)
    for bet in bets:
        bet.payout = bet.amount
        bet.status = Bet.Status.REFUNDED
        bet.save(update_fields=["payout", "status"])
        post_entry(
            wallet=bet.user.wallet,
            entry_type="BET_REFUND",
            amount=Decimal(bet.amount),
            related_type="bet",
            related_id=bet.id,
            reference=f"#RFD-M{market.id}",
            note=f"Annulation marché « {market.question[:60]} »",
            created_by=admin_user,
        )
    return market


# --------------------------------------------------------------------------
# Tâche de transition d'état (ouverte → verrouillée à la clôture des paris)
# --------------------------------------------------------------------------

def auto_lock_expired_markets():
    """Passe les marchés OPEN dont la clôture est dépassée en LOCKED.

    À appeler périodiquement (cron/celery). Pas de risque de double exécution :
    filtre par statut + select_for_update.
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
