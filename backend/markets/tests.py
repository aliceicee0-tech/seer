"""Tests du moteur Polymarket Nexus — cœur financier (collatéralisation).

Valide les invariants du cahier des charges :
- §3.1 Mint & Lock : SHARE_VALUE Ar → escrow, 1 YES + 1 NO.
- §3.2 CLOB : trade P2P sans toucher à l'escrow marché.
- §3.3 Settlement : gagnant = SHARE_VALUE Ar/part, perdant détruit, escrow → 0.
- §5  Invariance : escrow == paires en circulation × SHARE_VALUE == YES == NO.
- §5  Cron : gel auto sur anomalie.

Unité : 1 part vaut SHARE_VALUE Ar (5000 par défaut) à la résolution.
Le prix d'une part sur le carnet fluctue entre 1 Ar et SHARE_VALUE − 1 Ar.
"""
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from django.conf import settings
from django.test import TestCase
from django.utils import timezone

from core.models import User
from ledger.services import post_entry
from markets.models import (
    Market, MarketOutcome, MarketPool, MarketStatus, Order, Position, Trade,
)
from markets.services import (
    MarketError, auto_lock_expired_markets, cancel_market, cancel_order,
    merge_pair, mint_pair, place_order, resolve_market, share_value,
    verify_invariants,
)
from payments.models import DepositRequest, Operator
from payments.services import approve_deposit

SV = Decimal(settings.SHARE_VALUE)   # 5000 par défaut — valeur d'une part


# --------------------------------------------------------------------------
# Fixtures helpers
# --------------------------------------------------------------------------

def _user(phone: str, name: str = "", balance: Decimal | None = None) -> User:
    u = User.objects.create_user(
        username=f"user_{phone}", phone=phone,
        password=uuid4().hex, display_name=name,
    )
    if balance:
        post_entry(
            wallet=u.wallet, entry_type="DEPOSIT", amount=balance,
            reference="#TEST", created_by=u,
        )
    return u


def _user_with_real_deposit(phone: str, amount: Decimal) -> User:
    """Crée un joueur crédité via le VRAI flux de dépôt (DepositRequest approuvé).

    Nécessaire pour les tests d'invariant global : `verify_invariants` mesure
    l'argent entrant via les DepositRequest, pas via une écriture brute.
    """
    u = User.objects.create_user(
        username=f"user_{phone}", phone=phone,
        password=uuid4().hex, display_name="",
    )
    dep = DepositRequest.objects.create(
        user=u, amount=amount, operator=Operator.MVOLA,
        sender_phone=u.phone, operator_ref=f"OP-{phone}",
    )
    approve_deposit(deposit=dep, admin_user=u, note="seed test")
    return u


def _market(*, future_days=7, status=MarketStatus.OPEN) -> Market:
    now = timezone.now()
    return Market.objects.create(
        question="Question de test OUI/NON ?",
        description="règlement", category="WEATHER",
        source_url="https://exemple.mg/source", source_rules="règles",
        bet_close_at=now + timedelta(days=future_days),
        resolve_at=now + timedelta(days=future_days + 1),
        status=status,
    )


# ==========================================================================
# §3.1 — Émission / fusion (Mint & Lock / Split / Merge)
# ==========================================================================

class MintMergeTests(TestCase):
    def test_mint_locks_share_value_per_pair_and_mints_both_sides(self):
        u = _user("0340000001", balance=Decimal("100000"))
        m = _market()
        mint_pair(user=u, market=m, count=10)
        u.wallet.refresh_from_db()
        m.pool.refresh_from_db()

        cost = SV * 10   # 50000
        self.assertEqual(u.wallet.balance, Decimal("100000") - cost)
        self.assertEqual(u.wallet.locked_balance, Decimal("0"))
        # Invariant de séquestre
        self.assertEqual(m.pool.escrow_balance, cost)
        self.assertEqual(m.pool.pairs_created, 10)
        self.assertEqual(m.pool.pairs_in_circulation, 10)
        self.assertTrue(m.pool.invariant_ok())
        # Parts YES et NO créditées
        self.assertEqual(Position.objects.get(user=u, market=m, outcome="YES").quantity, 10)
        self.assertEqual(Position.objects.get(user=u, market=m, outcome="NO").quantity, 10)

    def test_mint_insufficient_balance_raises_and_no_side_effect(self):
        u = _user("0340000002", balance=Decimal("1000"))
        m = _market()
        with self.assertRaises(MarketError):
            mint_pair(user=u, market=m, count=10)   # coûte 50000, n'a que 1000
        m.pool.refresh_from_db()
        self.assertEqual(m.pool.escrow_balance, Decimal("0"))
        self.assertFalse(Position.objects.filter(user=u, market=m).exists())

    def test_merge_destroys_pair_and_releases_share_value(self):
        u = _user("0340000003", balance=Decimal("200000"))
        m = _market()
        mint_pair(user=u, market=m, count=20)
        merge_pair(user=u, market=m, count=5)
        u.wallet.refresh_from_db()
        m.pool.refresh_from_db()

        # solde = 200000 − (20×5000) + (5×5000) = 200000 − 100000 + 25000 = 125000
        self.assertEqual(u.wallet.balance, Decimal("125000"))
        self.assertEqual(m.pool.escrow_balance, SV * 15)
        self.assertEqual(m.pool.pairs_destroyed, 5)
        yes = Position.objects.get(user=u, market=m, outcome="YES")
        self.assertEqual(yes.quantity, 15)
        self.assertTrue(m.pool.invariant_ok())

    def test_merge_requires_both_sides(self):
        u = _user("0340000004", balance=Decimal("100000"))
        m = _market()
        mint_pair(user=u, market=m, count=10)
        # Détruit tout le YES pour simuler une asymétrie (cas défensif).
        Position.objects.filter(user=u, market=m, outcome="YES").update(quantity=0)
        with self.assertRaises(MarketError):
            merge_pair(user=u, market=m, count=1)

    def test_invariant_global_yes_equals_no_equals_escrow(self):
        u = _user("0340000005", balance=Decimal("500000"))
        m = _market()
        mint_pair(user=u, market=m, count=42)
        m.pool.refresh_from_db()
        yes_total = Position.total_quantity(m, "YES")
        no_total = Position.total_quantity(m, "NO")
        self.assertEqual(yes_total, no_total)
        self.assertEqual(yes_total, 42)
        self.assertEqual(Decimal(m.pool.escrow_balance), Decimal(yes_total) * SV)


# ==========================================================================
# §3.2 — Carnet d'ordres (CLOB) & règle d'or (P2P)
# ==========================================================================

class OrderMatchingTests(TestCase):
    def setUp(self):
        # Soldes larges pour couvrir mint + séquestre d'ordres
        self.buyer = _user("0340000010", balance=Decimal("1000000"))
        self.seller = _user("0340000011", balance=Decimal("1000000"))
        self.market = _market()
        # Le vendeur minte des paires pour avoir des parts à vendre.
        mint_pair(user=self.seller, market=self.market, count=100)

    def test_limit_buy_matches_limit_sell_at_passive_price(self):
        # Vendeur pose une vente YES @ 2000 (40% de 5000)
        place_order(user=self.seller, market=self.market,
                    side="SELL", outcome="YES", order_type="LIMIT",
                    quantity=50, price=Decimal("2000"))
        # Acheteur pose un achat YES @ 2500 → se croise à 2000 (prix passif)
        order = place_order(user=self.buyer, market=self.market,
                            side="BUY", outcome="YES", order_type="LIMIT",
                            quantity=50, price=Decimal("2500"))

        self.assertEqual(order.status, "FILLED")
        self.buyer.wallet.refresh_from_db()
        self.seller.wallet.refresh_from_db()
        # Acheteur paie 50 × 2000 = 100000 Ar
        self.assertEqual(self.buyer.wallet.balance, Decimal("900000"))
        # Vendeur : départ 1000000 − 100×5000 (mint) + 100000 (vente) = 600000
        self.assertEqual(self.seller.wallet.balance, Decimal("600000"))
        # Parts transférées
        self.assertEqual(
            Position.objects.get(user=self.buyer, market=self.market, outcome="YES").quantity, 50
        )
        self.assertEqual(
            Position.objects.get(user=self.seller, market=self.market, outcome="YES").quantity, 50
        )
        # Trade enregistré au prix passif
        trade = Trade.objects.get()
        self.assertEqual(trade.price, Decimal("2000"))
        self.assertEqual(trade.quantity, 50)

    def test_golden_rule_escrow_unchanged_by_trade(self):
        """Règle d'or §3.2 : un trade ne modifie pas l'escrow marché."""
        self.market.pool.refresh_from_db()
        escrow_before = self.market.pool.escrow_balance
        place_order(user=self.seller, market=self.market, side="SELL",
                    outcome="YES", order_type="LIMIT", quantity=30, price=Decimal("2000"))
        place_order(user=self.buyer, market=self.market, side="BUY",
                    outcome="YES", order_type="LIMIT", quantity=30, price=Decimal("2000"))
        self.market.pool.refresh_from_db()
        self.assertEqual(self.market.pool.escrow_balance, escrow_before)

    def test_partial_fill_leaves_order_open(self):
        place_order(user=self.seller, market=self.market, side="SELL",
                    outcome="YES", order_type="LIMIT", quantity=20, price=Decimal("2000"))
        order = place_order(user=self.buyer, market=self.market, side="BUY",
                            outcome="YES", order_type="LIMIT", quantity=50, price=Decimal("2000"))
        order.refresh_from_db()
        self.assertEqual(order.status, "PARTIAL")
        self.assertEqual(order.filled_quantity, 20)
        self.assertEqual(order.remaining_quantity, 30)

    def test_price_priority_best_ask_first(self):
        """Le meilleur prix (ask le plus bas) est servi en premier."""
        # Deux ventes : 3000 puis 2000
        place_order(user=self.seller, market=self.market, side="SELL",
                    outcome="YES", order_type="LIMIT", quantity=10, price=Decimal("3000"))
        place_order(user=self.seller, market=self.market, side="SELL",
                    outcome="YES", order_type="LIMIT", quantity=10, price=Decimal("2000"))
        order = place_order(user=self.buyer, market=self.market, side="BUY",
                            outcome="YES", order_type="LIMIT", quantity=10, price=Decimal("4000"))
        self.assertEqual(order.status, "FILLED")
        # Le trade doit être au prix 2000 (meilleur ask)
        self.assertEqual(Trade.objects.first().price, Decimal("2000"))

    def test_fifo_at_same_price(self):
        """À prix égal, le premier ordre posé est servi en premier."""
        other_seller = _user("0340000012", balance=Decimal("1000000"))
        mint_pair(user=other_seller, market=self.market, count=50)
        o1 = place_order(user=self.seller, market=self.market, side="SELL",
                         outcome="YES", order_type="LIMIT", quantity=10, price=Decimal("2000"))
        o2 = place_order(user=other_seller, market=self.market, side="SELL",
                         outcome="YES", order_type="LIMIT", quantity=10, price=Decimal("2000"))
        place_order(user=self.buyer, market=self.market, side="BUY",
                    outcome="YES", order_type="LIMIT", quantity=10, price=Decimal("2000"))
        o1.refresh_from_db(); o2.refresh_from_db()
        self.assertEqual(o1.status, "FILLED")
        self.assertEqual(o2.status, "OPEN")

    def test_market_buy_consumes_book(self):
        place_order(user=self.seller, market=self.market, side="SELL",
                    outcome="YES", order_type="LIMIT", quantity=10, price=Decimal("2000"))
        order = place_order(user=self.buyer, market=self.market, side="BUY",
                            outcome="YES", order_type="MARKET", quantity=10)
        self.assertEqual(order.status, "FILLED")
        self.assertEqual(Trade.objects.first().price, Decimal("2000"))

    def test_self_trade_prevented(self):
        """On ne peut pas trader contre soi-même (pas de lavage)."""
        # L'acheteur détient des parts YES (via mint) et tente de se revendre à lui-même.
        mint_pair(user=self.buyer, market=self.market, count=20)
        place_order(user=self.buyer, market=self.market, side="BUY",
                    outcome="YES", order_type="LIMIT", quantity=10, price=Decimal("3000"))
        # Le même utilisateur tente de vendre au même carnet : ordre posé, pas de match.
        order = place_order(user=self.buyer, market=self.market, side="SELL",
                            outcome="YES", order_type="LIMIT", quantity=10, price=Decimal("2000"))
        order.refresh_from_db()
        self.assertEqual(order.filled_quantity, 0)
        self.assertFalse(Trade.objects.exists())


# ==========================================================================
# Annulation d'ordre
# ==========================================================================

class CancelOrderTests(TestCase):
    def test_cancel_buy_refunds_locked_balance(self):
        u = _user("0340000020", balance=Decimal("500000"))
        m = _market()
        order = place_order(user=u, market=m, side="BUY", outcome="YES",
                            order_type="LIMIT", quantity=100, price=Decimal("2500"))
        u.wallet.refresh_from_db()
        # 250000 Ar séquestrés (100 × 2500), balance intacte
        self.assertEqual(u.wallet.balance, Decimal("500000"))
        self.assertEqual(u.wallet.locked_balance, Decimal("250000"))

        cancel_order(order=order, user=u)
        u.wallet.refresh_from_db()
        self.assertEqual(u.wallet.locked_balance, Decimal("0"))
        order.refresh_from_db()
        self.assertEqual(order.status, "CANCELLED")

    def test_cancel_sell_unlocks_shares(self):
        u = _user("0340000021", balance=Decimal("1000000"))
        m = _market()
        mint_pair(user=u, market=m, count=100)
        order = place_order(user=u, market=m, side="SELL", outcome="YES",
                            order_type="LIMIT", quantity=50, price=Decimal("2500"))
        pos = Position.objects.get(user=u, market=m, outcome="YES")
        self.assertEqual(pos.locked_quantity, 50)
        self.assertEqual(pos.available_quantity, 50)

        cancel_order(order=order, user=u)
        pos.refresh_from_db()
        self.assertEqual(pos.locked_quantity, 0)
        self.assertEqual(pos.available_quantity, 100)


# ==========================================================================
# §3.3 — Résolution (Settlement)
# ==========================================================================

class ResolveMarketTests(TestCase):
    def setUp(self):
        self.admin = _user("0340000030", name="admin", balance=Decimal("100000"))
        self.admin.is_staff = True
        self.admin.save()

    def test_yes_resolution_pays_winners_share_value_per_share(self):
        a = _user("0340000031", balance=Decimal("1000000"))
        b = _user("0340000032", balance=Decimal("1000000"))
        m = _market()
        mint_pair(user=a, market=m, count=30)
        mint_pair(user=b, market=m, count=70)
        m.refresh_from_db()
        resolve_market(market=m, outcome="YES", admin_user=self.admin)
        a.wallet.refresh_from_db(); b.wallet.refresh_from_db()
        m.refresh_from_db()

        self.assertEqual(m.status, "RESOLVED")
        self.assertEqual(m.outcome, "YES")
        # Chaque part YES = 5000 Ar. Net = (balance initiale − mint) + gain.
        # A : 1000000 − 150000 (30×5000) + 150000 (30×5000) = 1000000
        self.assertEqual(a.wallet.balance, Decimal("1000000"))
        # B : 1000000 − 350000 (70×5000) + 350000 (70×5000) = 1000000
        self.assertEqual(b.wallet.balance, Decimal("1000000"))
        # Escrow épuisé
        m.pool.refresh_from_db()
        self.assertEqual(m.pool.escrow_balance, Decimal("0"))
        # Toutes positions détruites
        self.assertFalse(Position.objects.filter(market=m).exists())

    def test_losers_destroyed_unpaid(self):
        """Le côté perdant (NO) est détruit sans crédit."""
        a = _user("0340000041", balance=Decimal("1000000"))
        m = _market()
        mint_pair(user=a, market=m, count=50)
        # A vend tout son YES à un tiers via le carnet pour ne garder que du NO
        buyer = _user("0340000042", balance=Decimal("1000000"))
        place_order(user=buyer, market=m, side="BUY", outcome="YES",
                    order_type="LIMIT", quantity=50, price=Decimal("2500"))
        place_order(user=a, market=m, side="SELL", outcome="YES",
                    order_type="LIMIT", quantity=50, price=Decimal("2500"))
        a.wallet.refresh_from_db()
        balance_before_resolve = a.wallet.balance
        resolve_market(market=m, outcome="YES", admin_user=self.admin)
        a.wallet.refresh_from_db()
        # A ne possédait plus de YES → rien reçu ; NO détruit sans paiement.
        self.assertEqual(a.wallet.balance, balance_before_resolve)

    def test_resolve_succeeds_with_other_players_open_orders(self):
        """Régression C1 : resolve_market ne doit pas planter quand des joueurs
        ont des ordres ouverts sur le carnet. Avant le fix, cancel_order
        refusait d'annuler les ordres d'autrui et faisait rollbacker toute la
        résolution → aucun marché avec ordres ouverts ne pouvait être réglé.
        """
        a = _user("0340000061", balance=Decimal("1000000"))
        b = _user("0340000062", balance=Decimal("1000000"))
        m = _market()
        mint_pair(user=a, market=m, count=50)
        mint_pair(user=b, market=m, count=50)

        # B laisse un ordre d'achat ouvert sur le carnet (non croisé).
        place_order(user=b, market=m, side="BUY", outcome="NO",
                    order_type="LIMIT", quantity=10, price=Decimal("1000"))
        b.wallet.refresh_from_db()
        locked_before = b.wallet.locked_balance
        self.assertGreater(locked_before, Decimal("0"))  # séquestre actif

        # La résolution doit réussir malgré l'ordre ouvert de B.
        resolve_market(market=m, outcome="YES", admin_user=self.admin)
        m.refresh_from_db()
        self.assertEqual(m.status, "RESOLVED")
        self.assertEqual(m.outcome, "YES")

        # L'ordre ouvert de B est annulé → son séquestre est libéré.
        b.wallet.refresh_from_db()
        self.assertEqual(b.wallet.locked_balance, Decimal("0"))
        # L'ordre est marqué CANCELLED (et non FILLED).
        self.assertFalse(
            Order.objects.filter(
                user=b, market=m, status__in=[Order.Status.OPEN, Order.Status.PARTIAL]
            ).exists()
        )

    def test_cancel_market_succeeds_with_other_players_open_orders(self):
        """Régression C1 (côté annulation) : cancel_market aussi doit purger les
        ordres ouverts d'autrui sans planter.
        """
        a = _user("0340000063", balance=Decimal("1000000"))
        b = _user("0340000064", balance=Decimal("1000000"))
        m = _market()
        mint_pair(user=a, market=m, count=50)
        mint_pair(user=b, market=m, count=50)
        # Ordre ouvert de B sur le carnet.
        place_order(user=b, market=m, side="BUY", outcome="YES",
                    order_type="LIMIT", quantity=10, price=Decimal("1000"))

        # L'annulation doit réussir et rembourser tout le monde à SHARE_VALUE/2.
        cancel_market(market=m, admin_user=self.admin)
        m.refresh_from_db()
        self.assertEqual(m.status, "CANCELLED")
        # Le séquestre de B est libéré via la purge du carnet.
        b.wallet.refresh_from_db()
        self.assertEqual(b.wallet.locked_balance, Decimal("0"))

    def test_cannot_resolve_already_resolved(self):
        a = _user("0340000051", balance=Decimal("100000"))
        m = _market()
        mint_pair(user=a, market=m, count=10)
        resolve_market(market=m, outcome="YES", admin_user=self.admin)
        with self.assertRaises(MarketError):
            resolve_market(market=m, outcome="YES", admin_user=self.admin)

    def test_cancel_market_refunds_all_shares_at_half_share_value(self):
        """L'annulation rembourse chaque part à SHARE_VALUE/2 (neutralité, escrow→0).

        L'utilisateur a minté 40 paires (coût 40×5000 = 200000 Ar, 40 YES + 40 NO).
        Remboursement = (40 + 40) × 2500 = 200000 Ar → il récupère sa mise.
        L'escrow retourne à 0.
        """
        a = _user("0340000061", balance=Decimal("1000000"))
        m = _market()
        mint_pair(user=a, market=m, count=40)
        a.wallet.refresh_from_db()
        self.assertEqual(a.wallet.balance, Decimal("800000"))   # −200000
        cancel_market(market=m, admin_user=self.admin)
        a.wallet.refresh_from_db()
        # 40 YES + 40 NO × 2500 = 200000 Ar → remboursement intégral de la mise.
        self.assertEqual(a.wallet.balance, Decimal("1000000"))
        m.refresh_from_db()
        self.assertEqual(m.status, "CANCELLED")
        m.pool.refresh_from_db()
        self.assertEqual(m.pool.escrow_balance, Decimal("0"))

    def test_resolve_rejects_incoherent_book_without_paying(self):
        """Faille B2 : un carnet corrompu est refusé AVANT tout paiement.

        On sabote l'escrow (1 Ar en trop) : l'invariant saute, resolve_market
        doit lever MarketError SANS créditer qui que ce soit.
        """
        a = _user("0340000062", balance=Decimal("1000000"))
        b = _user("0340000063", balance=Decimal("1000000"))
        m = _market()
        mint_pair(user=a, market=m, count=30)
        mint_pair(user=b, market=m, count=70)
        a.wallet.refresh_from_db()
        b.wallet.refresh_from_db()
        balance_a_before = a.wallet.balance
        balance_b_before = b.wallet.balance
        # Sabote l'escrow (simule corruption/bug) : invariant rompu.
        m.pool.escrow_balance += Decimal("1")
        m.pool.save(update_fields=["escrow_balance"])

        with self.assertRaises(MarketError):
            resolve_market(market=m, outcome="YES", admin_user=self.admin)

        # Aucun paiement : soldes intacts.
        a.wallet.refresh_from_db()
        b.wallet.refresh_from_db()
        self.assertEqual(a.wallet.balance, balance_a_before)
        self.assertEqual(b.wallet.balance, balance_b_before)
        # Les positions ne sont pas détruites (rollback).
        self.assertTrue(Position.objects.filter(market=m).exists())

    def test_cancel_rejects_incoherent_book_without_paying(self):
        """Faille B2 : cancel_market refuse aussi un carnet corrompu."""
        a = _user("0340000064", balance=Decimal("1000000"))
        m = _market()
        mint_pair(user=a, market=m, count=40)
        a.wallet.refresh_from_db()
        balance_before = a.wallet.balance
        # Sabote l'escrow.
        m.pool.escrow_balance += Decimal("1")
        m.pool.save(update_fields=["escrow_balance"])

        with self.assertRaises(MarketError):
            cancel_market(market=m, admin_user=self.admin)

        a.wallet.refresh_from_db()
        self.assertEqual(a.wallet.balance, balance_before)
        self.assertTrue(Position.objects.filter(market=m).exists())


# ==========================================================================
# §5 — Vérification d'invariance (cron)
# ==========================================================================

class InvariantTests(TestCase):
    def test_verify_invariants_ok_when_consistent(self):
        u = _user_with_real_deposit("0340000070", Decimal("1000000"))
        m = _market()
        mint_pair(user=u, market=m, count=25)
        report = verify_invariants()
        self.assertEqual(report["frozen_markets"], [])
        self.assertTrue(report["global_invariant_ok"])

    def test_invariant_breach_freezes_market(self):
        u = _user_with_real_deposit("0340000071", Decimal("1000000"))
        m = _market()
        mint_pair(user=u, market=m, count=10)
        # Sabote l'escrow (simule un bug/corruption)
        m.pool.escrow_balance += Decimal("1")
        m.pool.save(update_fields=["escrow_balance"])

        report = verify_invariants()
        self.assertEqual(len(report["frozen_markets"]), 1)
        m.refresh_from_db()
        self.assertEqual(m.status, MarketStatus.FROZEN)


# ==========================================================================
# Auto-lock (inchangé mais re-testé pour non-régression)
# ==========================================================================

class AutoLockTests(TestCase):
    def test_expired_open_markets_get_locked(self):
        past = timezone.now() - timedelta(minutes=5)
        m = Market.objects.create(
            question="expiré", description="d", category="WEATHER",
            source_url="https://x", source_rules="r",
            bet_close_at=past, resolve_at=past + timedelta(days=1),
            status=MarketStatus.OPEN,
        )
        n = auto_lock_expired_markets()
        self.assertEqual(n, 1)
        m.refresh_from_db()
        self.assertEqual(m.status, MarketStatus.LOCKED)
