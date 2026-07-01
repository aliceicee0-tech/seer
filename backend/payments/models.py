"""
Modèles de paiements manuels Nexus.

Aucun agrégateur de paiement en Phase 1 : les flux reposent sur des transferts
Mobile Money réels (MVola / Orange Money / Airtel Money) que l'administrateur
valide/exécute manuellement depuis le dashboard.

DÉPÔT (DepositRequest)
    1. joueur génère un code #DEP-XXXX et effectue le transfert réel hors app
    2. joueur déclare (numéro expéditeur + référence SMS opérateur)
    3. admin identifie la transaction et clique « Approuver » → crédit wallet

RETRAIT (WithdrawRequest)
    1. joueur demande un retrait → montant bloqué immédiatement (locked_balance)
    2. admin effectue le transfert réel depuis son téléphone
    3. admin clique « Marquer comme Payé » → débit définitif (settle_locked_withdraw)
       ou « Rejeter » → déblocage du montant (unlock_amount)
"""
import uuid
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.utils.translation import gettext_lazy as _


def _gen_code(prefix: str) -> str:
    """Code de référence unique (ex: #DEP-7F3A9C2)."""
    return f"#{prefix}-{uuid.uuid4().hex[:7].upper()}"


def _dep_code():
    return _gen_code("DEP")


def _wdr_code():
    return _gen_code("WDR")


class Operator(models.TextChoices):
    MVOLA = "MVOLA", "MVola"
    ORANGE = "ORANGE", "Orange Money"
    AIRTEL = "AIRTEL", "Airtel Money"


class DepositRequest(models.Model):
    """Demande de dépôt déclarée par un joueur (en attente de validation admin)."""

    class Status(models.TextChoices):
        PENDING = "PENDING", _("En attente de validation")
        APPROVED = "APPROVED", _("Approuvée (créditée)")
        REJECTED = "REJECTED", _("Rejetée")

    code = models.CharField(
        _("Code de référence"), max_length=20, unique=True,
        default=_dep_code,
        help_text=_("Code à inclure dans le motif du transfert opérateur."),
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="deposits"
    )
    amount = models.DecimalField(
        _("Montant"), max_digits=14, decimal_places=2,
        validators=[MinValueValidator(Decimal("1"))],
    )
    operator = models.CharField(max_length=10, choices=Operator.choices)
    # Déclarés par le joueur après son transfert hors-app
    sender_phone = models.CharField(_("N° expéditeur"), max_length=20)
    operator_ref = models.CharField(
        _("Référence SMS opérateur"), max_length=40, blank=True,
        help_text=_("Identifiant de transaction communiqué par l'opérateur."),
    )
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING
    )
    ledger_entry = models.ForeignKey(
        "ledger.LedgerEntry", on_delete=models.PROTECT,
        null=True, blank=True, related_name="deposits",
    )
    processed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="processed_deposits",
    )
    processed_at = models.DateTimeField(null=True, blank=True)
    admin_note = models.TextField(_("Note admin"), blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Demande de dépôt")
        verbose_name_plural = _("Demandes de dépôt")
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["status", "-created_at"]),
            models.Index(fields=["user", "-created_at"]),
        ]
        constraints = [
            # Faille B3 : le montant d'un dépôt doit être strictement positif.
            models.CheckConstraint(
                condition=models.Q(amount__gt=0),
                name="deposit_amount_positive",
            ),
        ]

    def __str__(self):
        return f"{self.code} · {self.amount} pts · {self.get_status_display()}"


class WithdrawRequest(models.Model):
    """Demande de retrait : le montant est bloqué jusqu'à exécution admin."""

    class Status(models.TextChoices):
        PENDING = "PENDING", _("En attente de transfert")
        PAID = "PAID", _("Payée (transfert effectué)")
        REJECTED = "REJECTED", _("Rejetée (montant débloqué)")

    code = models.CharField(
        _("Code de référence"), max_length=20, unique=True,
        default=_wdr_code,
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="withdrawals"
    )
    amount = models.DecimalField(
        _("Montant"), max_digits=14, decimal_places=2,
        validators=[MinValueValidator(Decimal("1"))],
    )
    operator = models.CharField(max_length=10, choices=Operator.choices)
    # Numéro de réception du joueur
    recipient_phone = models.CharField(_("N° réception"), max_length=20)
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING
    )
    ledger_entry = models.ForeignKey(
        "ledger.LedgerEntry", on_delete=models.PROTECT,
        null=True, blank=True, related_name="withdrawals",
    )
    processed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="processed_withdrawals",
    )
    processed_at = models.DateTimeField(null=True, blank=True)
    operator_ref = models.CharField(
        _("Référence transfert admin"), max_length=40, blank=True
    )
    admin_note = models.TextField(_("Note admin"), blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Demande de retrait")
        verbose_name_plural = _("Demandes de retrait")
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["status", "-created_at"]),
            models.Index(fields=["user", "-created_at"]),
        ]
        constraints = [
            # Faille B3 : le montant d'un retrait doit être strictement positif.
            models.CheckConstraint(
                condition=models.Q(amount__gt=0),
                name="withdraw_amount_positive",
            ),
        ]

    def __str__(self):
        return f"{self.code} · {self.amount} pts · {self.get_status_display()}"
