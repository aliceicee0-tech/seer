"""
Service de comptabilité de Nexus.

Point d'entrée UNIQUE pour tout mouvement de solde. Garantit :
- transaction atomique (rollback complet en cas d'erreur) ;
- verrou pessimiste sur le Wallet (`select_for_update`) → pas de double débit ;
- immuabilité des écritures ;
- non-négativité du solde disponible pour les opérations débitaires.

Aucune autre partie du code ne doit toucher directement à `wallet.balance`.
"""
from decimal import Decimal

from django.db import transaction

from .models import LedgerEntry, Wallet


class InsufficientFunds(Exception):
    """Le solde disponible est insuffisant pour l'opération demandée."""


@transaction.atomic
def post_entry(
    *,
    wallet,
    entry_type,
    amount,
    related_type: str = "",
    related_id=None,
    reference: str = "",
    note: str = "",
    created_by=None,
    lock: bool = False,
) -> tuple[Wallet, LedgerEntry]:
    """Crée une écriture et met à jour le solde du wallet, de façon atomique.

    Args:
        wallet: instance de Wallet (sera re-verrouillée ici).
        entry_type: valeur de LedgerEntry.Type.
        amount: Decimal. Le signe indique crédit (+) ou débit (−).
        related_type / related_id: lien optionnel vers l'objet métier.
        reference: code de référence (ex: #DEP-1024).
        note: texte libre.
        created_by: utilisateur à l'origine (admin ou self).
        lock: si True, le montant est appliqué sur `locked_balance` (retrait).

    Returns:
        (wallet_actualisé, entrée_créée)
    """
    # Verrou pessimiste : aucun autre thread ne peut modifier ce wallet
    # tant que la transaction n'est pas terminée.
    wallet = (
        Wallet.objects.select_for_update()
        .select_related("user")
        .get(pk=wallet.pk)
    )

    amount = Decimal(amount)
    is_debit = amount < 0

    # Vérification de non-négativité sur le solde disponible
    if is_debit:
        if lock:
            # Débit différé : on verrouille le montant sans le sortir du solde
            if wallet.available_balance + amount < 0:
                raise InsufficientFunds(
                    f"Solde disponible insuffisant ({wallet.available_balance})."
                )
        else:
            if wallet.balance + amount < 0:
                raise InsufficientFunds(
                    f"Solde insuffisant ({wallet.balance})."
                )

    # Application des soldes
    if lock:
        # Cas du retrait : on incrémente le solde bloqué, on ne touche pas au solde
        if is_debit:
            wallet.locked_balance -= amount  # amount<0 → locked augmente
            wallet.locked_balance = max(Decimal("0"), wallet.locked_balance)
        else:
            # Annulation d'un retrait : on libère le blocage
            wallet.locked_balance = max(Decimal("0"), wallet.locked_balance - (-amount))
    else:
        wallet.balance += amount

    wallet.save()

    entry = LedgerEntry.objects.create(
        wallet=wallet,
        type=entry_type,
        amount=amount,
        balance_after=wallet.balance,
        related_type=related_type,
        related_id=related_id,
        reference=reference,
        note=note,
        created_by=created_by,
    )
    return wallet, entry


def unlock_amount(wallet, amount) -> Wallet:
    """Libère un montant précédement bloqué par un retrait (retrait rejeté/annulé)."""
    with transaction.atomic():
        wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
        wallet.locked_balance = max(
            Decimal("0"),
            Decimal(wallet.locked_balance) - Decimal(amount),
        )
        wallet.save()
    return wallet


def settle_locked_withdraw(wallet, amount, *, created_by=None, reference="") -> LedgerEntry:
    """Transforme un retrait bloqué en débit réel (transfert effectué)."""
    with transaction.atomic():
        wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
        amount = Decimal(amount)
        wallet.locked_balance = max(
            Decimal("0"), Decimal(wallet.locked_balance) - amount
        )
        wallet.balance -= amount
        wallet.save()
        entry = LedgerEntry.objects.create(
            wallet=wallet,
            type=LedgerEntry.Type.WITHDRAW,
            amount=-amount,
            balance_after=wallet.balance,
            reference=reference,
            created_by=created_by,
            related_type="withdraw",
        )
    return entry
