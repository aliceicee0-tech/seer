"""Tests des flux financiers Nexus — cœur du système (argent réel).

Couvre :
- Ledger : post_entry, non-négativité, immuabilité, verrou de retrait.
- Marchés : place_bet (solde insuffisant, mise min), resolve_market
  (redistribution proportionnelle + commission, cas sans gagnant),
  cancel_market (remboursement intégral), auto-lock.
- Paiements : approve/reject deposit, request/mark-paid/reject withdraw.
"""
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from django.conf import settings
from django.test import TestCase
from django.utils import timezone

from core.models import User
from ledger.services import InsufficientFunds, post_entry
from markets.models import Market, MarketStatus
from markets.services import (
    MarketError, auto_lock_expired_markets, cancel_market, place_bet,
    resolve_market,
)
from payments.models import DepositRequest
from payments.services import (
    PaymentError, approve_deposit, mark_withdraw_paid, reject_deposit,
    reject_withdraw, request_withdraw,
)


def _user(phone: str, name: str = "", balance: Decimal | None = None) -> User:
    # Mot de passe généré (éphémère) : aucune chaîne en dur, ce n'est pas un secret.
    u = User.objects.create_user(
        username=f"user_{phone}",  # requis par le UserManager par défaut
        phone=phone, password=uuid4().hex, display_name=name,
    )
    if balance:
        # Crédit initial via une écriture brute (pour les besoins du test)
        post_entry(
            wallet=u.wallet, entry_type="DEPOSIT", amount=balance,
            reference="#TEST", created_by=u,
        )
    return u


def _market(*, future_days=7, status=MarketStatus.OPEN, pool_yes=0, pool_no=0) -> Market:
    now = timezone.now()
    return Market.objects.create(
        question="Question de test OUI/NON ?",
        description="règlement",
        category="WEATHER",
        source_url="https://exemple.mg/source",
        source_rules="règles",
        bet_close_at=now + timedelta(days=future_days),
        resolve_at=now + timedelta(days=future_days + 1),
        status=status,
        pool_yes=Decimal(pool_yes),
        pool_no=Decimal(pool_no),
    )


# --------------------------------------------------------------------------
# Ledger
# --------------------------------------------------------------------------

class LedgerTests(TestCase):
    def test_credit_debit_updates_balance(self):
        u = _user("0340000001")
        post_entry(wallet=u.wallet, entry_type="DEPOSIT", amount=Decimal("1000"))
        u.wallet.refresh_from_db()
        self.assertEqual(u.wallet.balance, Decimal("1000"))
        self.assertEqual(u.wallet.entries.count(), 1)

    def test_debit_below_zero_rejected(self):
        u = _user("0340000002", balance=Decimal("500"))
        with self.assertRaises(InsufficientFunds):
            post_entry(wallet=u.wallet, entry_type="BET_PLACE", amount=-Decimal("600"))
        u.wallet.refresh_from_db()
        self.assertEqual(u.wallet.balance, Decimal("500"))

    def test_ledger_entry_is_immutable(self):
        u = _user("0340000003", balance=Decimal("100"))
        entry = u.wallet.entries.first()
        with self.assertRaises(PermissionError):
            entry.save()
        with self.assertRaises(PermissionError):
            entry.delete()

    def test_withdraw_locks_balance(self):
        u = _user("0340000004", balance=Decimal("1000"))
        post_entry(
            wallet=u.wallet, entry_type="WITHDRAW",
            amount=-Decimal("400"), lock=True, reference="#WDR",
        )
        u.wallet.refresh_from_db()
        self.assertEqual(u.wallet.balance, Decimal("1000"))
        self.assertEqual(u.wallet.locked_balance, Decimal("400"))
        self.assertEqual(u.wallet.available_balance, Decimal("600"))


# --------------------------------------------------------------------------
# Marchés : placement de pari
# --------------------------------------------------------------------------

class PlaceBetTests(TestCase):
    def test_bet_debits_wallet_and_updates_pool(self):
        u = _user("0340000010", balance=Decimal("5000"))
        m = _market()
        bet = place_bet(user=u, market=m, outcome="YES", amount=Decimal("1000"))
        u.wallet.refresh_from_db()
        m.refresh_from_db()
        self.assertEqual(u.wallet.balance, Decimal("4000"))
        self.assertEqual(m.pool_yes, Decimal("1000"))
        self.assertEqual(m.pool_no, Decimal("0"))
        self.assertEqual(bet.status, "PLACED")
        self.assertEqual(bet.ledger_entry.type, "BET_PLACE")

    def test_insufficient_balance_raises(self):
        u = _user("0340000011", balance=Decimal("500"))
        m = _market()
        with self.assertRaises(MarketError):
            place_bet(user=u, market=m, outcome="YES", amount=Decimal("600"))
        m.refresh_from_db()
        self.assertEqual(m.pool_yes, Decimal("0"))

    def test_below_min_bet_raises(self):
        u = _user("0340000012", balance=Decimal("100000"))
        m = _market()
        with self.assertRaises(MarketError):
            place_bet(user=u, market=m, outcome="YES",
                      amount=Decimal(settings.MIN_BET_AMOUNT) - Decimal("1"))

    def test_cannot_bet_on_locked_market(self):
        u = _user("0340000013", balance=Decimal("5000"))
        m = _market(status=MarketStatus.LOCKED)
        with self.assertRaises(MarketError):
            place_bet(user=u, market=m, outcome="YES", amount=Decimal("1000"))


# --------------------------------------------------------------------------
# Marchés : résolution (pari mutuel + commission)
# --------------------------------------------------------------------------

class ResolveMarketTests(TestCase):
    def setUp(self):
        self.admin = _user("0340000020", name="admin")
        self.admin.is_staff = True
        self.admin.save()

    def test_resolution_pays_winners_proportionally_with_commission(self):
        """2 gagnants (1000 + 3000) sur YES ; commission 10% → pool × 0.9."""
        a = _user("0340000021", balance=Decimal("5000"))
        b = _user("0340000022", balance=Decimal("5000"))
        loser = _user("0340000023", balance=Decimal("5000"))
        m = _market(status=MarketStatus.OPEN, pool_yes=0, pool_no=0)
        place_bet(user=a, market=m, outcome="YES", amount=Decimal("1000"))
        place_bet(user=b, market=m, outcome="YES", amount=Decimal("3000"))
        place_bet(user=loser, market=m, outcome="NO", amount=Decimal("1000"))
        # place_bet met à jour le pool côté DB sur sa propre instance ; on
        # recharge `m` avant de verrouiller, sinon m.save() écraserait pool_yes.
        m.refresh_from_db()
        m.status = MarketStatus.LOCKED   # on clôt les paris avant de résoudre
        m.save(update_fields=["status"])

        resolve_market(market=m, outcome="YES", admin_user=self.admin)

        m.refresh_from_db()
        self.assertEqual(m.status, "RESOLVED")
        self.assertEqual(m.outcome, "YES")
        pool_total = Decimal("5000")
        distribuable = pool_total * (1 - Decimal(str(settings.PLATFORM_COMMISSION_RATE)) / 100)
        a.wallet.refresh_from_db(); b.wallet.refresh_from_db(); loser.wallet.refresh_from_db()
        # solde final = (5000 - mise) + gain
        self.assertEqual(
            a.wallet.balance,
            (Decimal("5000") - Decimal("1000")) + Decimal("1000") / Decimal("4000") * distribuable,
        )
        self.assertEqual(
            b.wallet.balance,
            (Decimal("5000") - Decimal("3000")) + Decimal("3000") / Decimal("4000") * distribuable,
        )
        self.assertEqual(loser.wallet.balance, Decimal("5000") - Decimal("1000"))

    def test_commission_retained_in_platform(self):
        """Somme redistribuée = pool × (1 − commission). Le reste est retenu."""
        a = _user("0340000031", balance=Decimal("2000"))
        b = _user("0340000032", balance=Decimal("2000"))
        m = _market(status=MarketStatus.OPEN)
        place_bet(user=a, market=m, outcome="YES", amount=Decimal("1000"))
        place_bet(user=b, market=m, outcome="NO", amount=Decimal("1000"))
        m.refresh_from_db()
        m.status = MarketStatus.LOCKED
        m.save(update_fields=["status"])

        resolve_market(market=m, outcome="YES", admin_user=self.admin)

        a.wallet.refresh_from_db(); b.wallet.refresh_from_db()
        # Le gagnant (A, YES) récupère sa part du pool distribuable ; le perdant
        # (B, NO) a simplement perdu sa mise. On vérifie le gain crédité à A.
        distribuable = Decimal("2000") * (1 - Decimal(str(settings.PLATFORM_COMMISSION_RATE)) / 100)
        # A : solde initial 2000 − mise 1000 + gain (pool entier du camp YES = 1800)
        self.assertEqual(a.wallet.balance, Decimal("2000") - Decimal("1000") + distribuable)
        # B : perdant, reste à 1000
        self.assertEqual(b.wallet.balance, Decimal("1000"))

    def test_cannot_resolve_already_resolved(self):
        a = _user("0340000041", balance=Decimal("1000"))
        m = _market(status=MarketStatus.OPEN)
        place_bet(user=a, market=m, outcome="YES", amount=Decimal("1000"))
        m.refresh_from_db()
        m.status = MarketStatus.LOCKED
        m.save(update_fields=["status"])
        resolve_market(market=m, outcome="YES", admin_user=self.admin)
        with self.assertRaises(MarketError):
            resolve_market(market=m, outcome="YES", admin_user=self.admin)

    def test_cancel_refunds_all_bets(self):
        a = _user("0340000051", balance=Decimal("2000"))
        b = _user("0340000052", balance=Decimal("2000"))
        m = _market(status=MarketStatus.OPEN)
        place_bet(user=a, market=m, outcome="YES", amount=Decimal("1000"))
        place_bet(user=b, market=m, outcome="NO", amount=Decimal("1500"))
        m.refresh_from_db()
        m.status = MarketStatus.LOCKED
        m.save(update_fields=["status"])

        cancel_market(market=m, admin_user=self.admin)

        m.refresh_from_db()
        self.assertEqual(m.status, "CANCELLED")
        a.wallet.refresh_from_db(); b.wallet.refresh_from_db()
        self.assertEqual(a.wallet.balance, Decimal("2000"))
        self.assertEqual(b.wallet.balance, Decimal("2000"))


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

    def test_future_market_not_locked(self):
        m = _market(status=MarketStatus.OPEN)
        n = auto_lock_expired_markets()
        self.assertEqual(n, 0)
        m.refresh_from_db()
        self.assertEqual(m.status, MarketStatus.OPEN)


# --------------------------------------------------------------------------
# Paiements : dépôts & retraits manuels
# --------------------------------------------------------------------------

class DepositTests(TestCase):
    def setUp(self):
        self.admin = _user("0340000060", name="admin")
        self.admin.is_staff = True
        self.admin.save()
        self.player = _user("0340000061")

    def test_approve_credits_wallet(self):
        dep = DepositRequest.objects.create(
            user=self.player, amount=Decimal("5000"), operator="MVOLA",
            sender_phone=self.player.phone,
        )
        approve_deposit(deposit=dep, admin_user=self.admin)
        self.player.wallet.refresh_from_db()
        self.assertEqual(self.player.wallet.balance, Decimal("5000"))
        dep.refresh_from_db()
        self.assertEqual(dep.status, "APPROVED")
        self.assertEqual(dep.ledger_entry.type, "DEPOSIT")

    def test_reject_does_not_credit(self):
        dep = DepositRequest.objects.create(
            user=self.player, amount=Decimal("5000"), operator="MVOLA",
            sender_phone=self.player.phone,
        )
        reject_deposit(deposit=dep, admin_user=self.admin)
        self.player.wallet.refresh_from_db()
        self.assertEqual(self.player.wallet.balance, Decimal("0"))
        self.assertEqual(dep.status, "REJECTED")

    def test_double_approve_raises(self):
        dep = DepositRequest.objects.create(
            user=self.player, amount=Decimal("5000"), operator="MVOLA",
            sender_phone=self.player.phone,
        )
        approve_deposit(deposit=dep, admin_user=self.admin)
        with self.assertRaises(PaymentError):
            approve_deposit(deposit=dep, admin_user=self.admin)


class WithdrawTests(TestCase):
    def setUp(self):
        self.admin = _user("0340000070", name="admin")
        self.admin.is_staff = True
        self.admin.save()
        self.player = _user("0340000071", balance=Decimal("10000"))

    def test_request_locks_then_pay_debits(self):
        w = request_withdraw(user=self.player, amount=Decimal("4000"),
                             operator="ORANGE", recipient_phone=self.player.phone)
        self.player.wallet.refresh_from_db()
        self.assertEqual(self.player.wallet.balance, Decimal("10000"))
        self.assertEqual(self.player.wallet.available_balance, Decimal("6000"))
        self.assertEqual(w.status, "PENDING")

        mark_withdraw_paid(withdraw=w, admin_user=self.admin)
        self.player.wallet.refresh_from_db()
        self.assertEqual(self.player.wallet.balance, Decimal("6000"))
        self.assertEqual(self.player.wallet.locked_balance, Decimal("0"))
        w.refresh_from_db()
        self.assertEqual(w.status, "PAID")

    def test_request_then_reject_unlocks(self):
        w = request_withdraw(user=self.player, amount=Decimal("4000"),
                             operator="ORANGE", recipient_phone=self.player.phone)
        reject_withdraw(withdraw=w, admin_user=self.admin)
        self.player.wallet.refresh_from_db()
        self.assertEqual(self.player.wallet.balance, Decimal("10000"))
        self.assertEqual(self.player.wallet.locked_balance, Decimal("0"))

    def test_withdraw_more_than_balance_raises(self):
        with self.assertRaises(PaymentError):
            request_withdraw(user=self.player, amount=Decimal("999999"),
                             operator="ORANGE", recipient_phone=self.player.phone)
