"""
Modèles de comptabilité de Nexus.

Principe **double-écriture** : le solde d'un Wallet n'est JAMAIS modifié
directement. Toute variation passe par une `LedgerEntry` immuable, signée
(type + montant). Le solde est maintenu en cache par le service `post_entry`,
toujours dans la même transaction SQL que l'écriture.

Intégrité garantie par :
- `select_for_update()` sur le Wallet à chaque mouvement (verrou pessimiste) ;
- une transaction atomique englobant écriture + MAJ du solde ;
- une contrainte de non-négativité du solde pour les types débitaires.
"""
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.utils.translation import gettext_lazy as _


class Wallet(models.Model):
    """Portefeuille virtuel d'un utilisateur — 1 point = 1 MGA."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,   # ne jamais supprimer un user qui a un wallet
        related_name="wallet",
    )
    # Solde « confirmé » (argent réellement disponible pour parier / retirer)
    balance = models.DecimalField(
        _("Solde"), max_digits=14, decimal_places=2,
        default=Decimal("0"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    # Solde bloqué par des retraits en attente de transfert
    locked_balance = models.DecimalField(
        _("Solde bloqué"), max_digits=14, decimal_places=2,
        default=Decimal("0"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Portefeuille")
        verbose_name_plural = _("Portefeuilles")
        constraints = [
            # Barrière de dernier recours (faille B3) : un solde ne peut jamais
            # devenir négatif, même via un bug applicatif ou une manipulation ORM
            # directe. Les MinValueValidator ne s'appliquent qu'aux save() complets,
            # pas aux save(update_fields=[...]) du hot path — d'où le CHECK en base.
            models.CheckConstraint(
                condition=models.Q(balance__gte=0),
                name="wallet_balance_nonneg",
            ),
            models.CheckConstraint(
                condition=models.Q(locked_balance__gte=0),
                name="wallet_locked_balance_nonneg",
            ),
        ]

    def __str__(self):
        return f"Wallet {self.user_id} · {self.balance} pts"

    @property
    def available_balance(self):
        """Solde réellement utilisable = confirmé − bloqué."""
        return self.balance - self.locked_balance


class LedgerEntry(models.Model):
    """Écriture comptable immuable. Une ligne = un mouvement de solde.

    Convention de signe : un montant POSITIF crédite le wallet (dépot, gain),
    un montant NÉGATIF le débite (mise, retrait). Le solde résultant ne peut
    jamais devenir négatif pour les opérations débitaires (vérifié par le service).
    """

    class Type(models.TextChoices):
        DEPOSIT = "DEPOSIT", _("Dépôt")
        WITHDRAW = "WITHDRAW", _("Retrait")
        # --- Moteur Polymarket (collatéralisation) ---
        MINT = "MINT", _("Émission de paires (débit → séquestre)")
        MERGE = "MERGE", _("Fusion de paires (crédit ← séquestre)")
        TRADE_BUY = "TRADE_BUY", _("Achat au carnet")
        TRADE_SELL = "TRADE_SELL", _("Vente au carnet")
        SETTLE_WIN = "SETTLE_WIN", _("Gain de résolution (1,00 MGA / part)")
        ORDER_REFUND = "ORDER_REFUND", _("Remboursement d'ordre annulé/expiré")
        BET_PLACE = "BET_PLACE", _("(Obsolète) Mise de pari")
        BET_WIN = "BET_WIN", _("(Obsolète) Gain de pari")
        BET_REFUND = "BET_REFUND", _("(Obsolète) Remboursement de pari")
        ADJUSTMENT = "ADJUSTMENT", _("Ajustement manuel")

    wallet = models.ForeignKey(
        Wallet, on_delete=models.PROTECT,
        related_name="entries",
    )
    type = models.CharField(_("Type"), max_length=20, choices=Type.choices)
    amount = models.DecimalField(
        _("Montant signé"), max_digits=14, decimal_places=2,
        help_text=_("Positif = crédit, négatif = débit."),
    )
    balance_after = models.DecimalField(
        _("Solde après écriture"), max_digits=14, decimal_places=2,
    )
    # Lien optionnel vers l'objet métier à l'origine du mouvement
    related_type = models.CharField(_("Type objet lié"), max_length=30, blank=True)
    related_id = models.BigIntegerField(_("ID objet lié"), null=True, blank=True)
    reference = models.CharField(
        _("Référence"), max_length=60, blank=True,
        help_text=_("Ex: #DEP-1024, code de référence Mobile Money."),
    )
    note = models.CharField(_("Note"), max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="ledger_entries_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("Écriture comptable")
        verbose_name_plural = _("Écritures comptables")
        ordering = ("-created_at", "-id")
        indexes = [
            models.Index(fields=["wallet", "-created_at"]),
            models.Index(fields=["type"]),
            models.Index(fields=["reference"]),
        ]

    def __str__(self):
        return f"{self.type} {self.amount:+.2f} → {self.balance_after} ({self.reference or '-'})"

    def save(self, *args, **kwargs):
        # Les écritures sont immuables : interdiction de modifier une existante.
        if self.pk:
            raise PermissionError("Une écriture du ledger ne peut pas être modifiée.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise PermissionError("Une écriture du ledger ne peut pas être supprimée.")
