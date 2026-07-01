"""Tests des flux financiers Nexus — ledger double-écriture.

Couvre :
- post_entry : crédit/débit, non-négativité, immuabilité, verrou de retrait.
- lock_amount / unlock_amount : séquestre intra-wallet des ordres d'achat.
- settle_buy_fill : règlement atomique d'une exécution d'achat au carnet.
- settle_locked_withdraw : transformation d'un blocage en débit réel.

Les tests spécifiques au moteur de marchés (mint/merge/CLOB/settlement)
vivent dans markets/tests.py.
"""
from decimal import Decimal
from uuid import uuid4

from django.test import TestCase

from core.models import User
from ledger.services import (
    InsufficientFunds, lock_amount, post_entry, settle_buy_fill,
    settle_locked_withdraw, unlock_amount,
)


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


# --------------------------------------------------------------------------
# Écritures comptables
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
            post_entry(wallet=u.wallet, entry_type="TRADE_BUY", amount=-Decimal("600"))
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
# Séquestre intra-wallet (ordres d'achat au carnet)
# --------------------------------------------------------------------------

class LockTests(TestCase):
    def test_lock_amount_reserves_in_locked_balance(self):
        u = _user("0340000010", balance=Decimal("1000"))
        lock_amount(u.wallet, Decimal("300"))
        u.wallet.refresh_from_db()
        self.assertEqual(u.wallet.balance, Decimal("1000"))      # intact
        self.assertEqual(u.wallet.locked_balance, Decimal("300"))
        self.assertEqual(u.wallet.available_balance, Decimal("700"))

    def test_lock_more_than_available_raises(self):
        u = _user("0340000011", balance=Decimal("1000"))
        with self.assertRaises(InsufficientFunds):
            lock_amount(u.wallet, Decimal("1500"))   # > available (1000)
        u.wallet.refresh_from_db()
        self.assertEqual(u.wallet.locked_balance, Decimal("0"))

    def test_unlock_amount_releases_locked(self):
        u = _user("0340000012", balance=Decimal("1000"))
        lock_amount(u.wallet, Decimal("400"))
        unlock_amount(u.wallet, Decimal("150"))
        u.wallet.refresh_from_db()
        self.assertEqual(u.wallet.locked_balance, Decimal("250"))
        self.assertEqual(u.wallet.balance, Decimal("1000"))


# --------------------------------------------------------------------------
# Règlement d'exécution d'achat au carnet
# --------------------------------------------------------------------------

class SettleBuyFillTests(TestCase):
    def test_settle_debits_cost_and_releases_reserve(self):
        """Achat LIMIT @ 0,50 exécuté @ 0,40 : débit 0,40, libération 0,50."""
        u = _user("0340000020", balance=Decimal("1000"))
        # Séquestre initial d'un ordre achat 100 × 0,50
        lock_amount(u.wallet, Decimal("50"))   # 100 × 0,50
        # Exécution : 100 parts @ 0,40
        settle_buy_fill(
            wallet=u.wallet, cost=Decimal("40"),    # 100 × 0,40
            reserve_release=Decimal("50"),          # libère tout le séquestre
            entry_type="TRADE_BUY",
            reference="#BUY-TEST",
        )
        u.wallet.refresh_from_db()
        self.assertEqual(u.wallet.balance, Decimal("960"))    # 1000 − 40
        self.assertEqual(u.wallet.locked_balance, Decimal("0"))
        # Écriture signée −40 (la plus récente = .first() car ordering décroissant)
        self.assertEqual(u.wallet.entries.first().type, "TRADE_BUY")
        self.assertEqual(u.wallet.entries.first().amount, -Decimal("40"))

    def test_settle_buy_fill_rejects_insufficient_balance(self):
        """Faille B1 : cost > balance → InsufficientFunds, solde inchangé."""
        u = _user("0340000021", balance=Decimal("1000"))
        # Cost supérieur au solde (simule un bug : séquestre libéré ailleurs).
        with self.assertRaises(InsufficientFunds):
            settle_buy_fill(
                wallet=u.wallet, cost=Decimal("1500"),
                reserve_release=Decimal("0"),
                entry_type="TRADE_BUY", reference="#BUY-FAIL",
            )
        u.wallet.refresh_from_db()
        # Aucun débit effectué.
        self.assertEqual(u.wallet.balance, Decimal("1000"))
        self.assertEqual(u.wallet.locked_balance, Decimal("0"))
        # Aucune écriture créée (rollback atomique).
        self.assertFalse(u.wallet.entries.filter(reference="#BUY-FAIL").exists())


# --------------------------------------------------------------------------
# Retrait : transformation blocage → débit
# --------------------------------------------------------------------------

class WithdrawTests(TestCase):
    def test_settle_locked_withdraw_debits_balance(self):
        u = _user("0340000030", balance=Decimal("1000"))
        post_entry(
            wallet=u.wallet, entry_type="WITHDRAW",
            amount=-Decimal("400"), lock=True, reference="#WDR-LOCK",
        )
        entry = settle_locked_withdraw(
            u.wallet, Decimal("400"), reference="#WDR-PAID",
        )
        u.wallet.refresh_from_db()
        self.assertEqual(u.wallet.balance, Decimal("600"))
        self.assertEqual(u.wallet.locked_balance, Decimal("0"))
        self.assertEqual(entry.type, "WITHDRAW")
        self.assertEqual(entry.amount, -Decimal("400"))

    def test_settle_locked_withdraw_rejects_insufficient_balance(self):
        """Faille B1 : amount > balance → InsufficientFunds, solde inchangé."""
        u = _user("0340000031", balance=Decimal("1000"))
        post_entry(
            wallet=u.wallet, entry_type="WITHDRAW",
            amount=-Decimal("400"), lock=True, reference="#WDR-LOCK",
        )
        # Tente de finaliser un retrait supérieur au solde (incohérence d'état).
        with self.assertRaises(InsufficientFunds):
            settle_locked_withdraw(u.wallet, Decimal("1500"), reference="#WDR-FAIL")
        u.wallet.refresh_from_db()
        # État inchangé : balance 1000, locked 400.
        self.assertEqual(u.wallet.balance, Decimal("1000"))
        self.assertEqual(u.wallet.locked_balance, Decimal("400"))
