"""
Services de paiement manuel Seer.

Toutes les actions d'admin sont atomiques et journalisées via le ledger :
- approve_deposit  : crédite le wallet du joueur
- reject_deposit   : passe en REJECTED (pas de mouvement de solde)
- mark_withdraw_paid   : débit définitif (montant était bloqué)
- reject_withdraw  : déblocage du montant
"""
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from ledger.services import (
    InsufficientFunds, post_entry, settle_locked_withdraw, unlock_amount,
)

from .models import DepositRequest, WithdrawRequest


class PaymentError(Exception):
    pass


# --------------------------------------------------------------------------
# Dépôts
# --------------------------------------------------------------------------

@transaction.atomic
def approve_deposit(*, deposit: DepositRequest, admin_user, note: str = "") -> DepositRequest:
    if deposit.status != DepositRequest.Status.PENDING:
        raise PaymentError("Cette demande a déjà été traitée.")
    wallet, entry = post_entry(
        wallet=deposit.user.wallet,
        entry_type="DEPOSIT",
        amount=Decimal(deposit.amount),
        related_type="deposit",
        related_id=deposit.id,
        reference=deposit.code,
        note=note or f"Dépôt {deposit.get_operator_display()} {deposit.sender_phone}",
        created_by=admin_user,
    )
    deposit.ledger_entry = entry
    deposit.status = DepositRequest.Status.APPROVED
    deposit.processed_by = admin_user
    deposit.processed_at = timezone.now()
    deposit.admin_note = note
    deposit.save()
    return deposit


@transaction.atomic
def reject_deposit(*, deposit: DepositRequest, admin_user, note: str = "") -> DepositRequest:
    if deposit.status != DepositRequest.Status.PENDING:
        raise PaymentError("Cette demande a déjà été traitée.")
    deposit.status = DepositRequest.Status.REJECTED
    deposit.processed_by = admin_user
    deposit.processed_at = timezone.now()
    deposit.admin_note = note
    deposit.save()
    return deposit


# --------------------------------------------------------------------------
# Retraits
# --------------------------------------------------------------------------

@transaction.atomic
def request_withdraw(*, user, amount, operator, recipient_phone) -> WithdrawRequest:
    """Crée une demande de retrait et bloque immédiatement le montant."""
    wallet = user.wallet
    try:
        # lock=True : le montant sort du solde disponible mais reste en 'balance',
        # transféré vers 'locked_balance' jusqu'à exécution/rejet.
        post_entry(
            wallet=wallet,
            entry_type="WITHDRAW",
            amount=-Decimal(amount),
            lock=True,
            related_type="withdraw",
            reference=f"#WDR-LOCK",
            note=f"Blocage retrait {operator} vers {recipient_phone}",
            created_by=user,
        )
    except InsufficientFunds as e:
        raise PaymentError(str(e))

    w = WithdrawRequest.objects.create(
        user=user,
        amount=amount,
        operator=operator,
        recipient_phone=recipient_phone,
        status=WithdrawRequest.Status.PENDING,
    )
    return w


@transaction.atomic
def mark_withdraw_paid(*, withdraw: WithdrawRequest, admin_user,
                       operator_ref: str = "", note: str = "") -> WithdrawRequest:
    if withdraw.status != WithdrawRequest.Status.PENDING:
        raise PaymentError("Ce retrait a déjà été traité.")
    entry = settle_locked_withdraw(
        withdraw.user.wallet,
        Decimal(withdraw.amount),
        created_by=admin_user,
        reference=withdraw.code,
    )
    withdraw.ledger_entry = entry
    withdraw.status = WithdrawRequest.Status.PAID
    withdraw.processed_by = admin_user
    withdraw.processed_at = timezone.now()
    withdraw.operator_ref = operator_ref
    withdraw.admin_note = note
    withdraw.save()
    return withdraw


@transaction.atomic
def reject_withdraw(*, withdraw: WithdrawRequest, admin_user,
                    note: str = "") -> WithdrawRequest:
    if withdraw.status != WithdrawRequest.Status.PENDING:
        raise PaymentError("Ce retrait a déjà été traité.")
    unlock_amount(withdraw.user.wallet, Decimal(withdraw.amount))
    withdraw.status = WithdrawRequest.Status.REJECTED
    withdraw.processed_by = admin_user
    withdraw.processed_at = timezone.now()
    withdraw.admin_note = note
    withdraw.save()
    return withdraw
