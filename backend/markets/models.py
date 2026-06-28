"""
Modèles de marchés prédictifs Seer.

Un `Market` est une question binaire (OUI/NON) avec une source publique de
résolution, une date de clôture des paris et une date de vérification.
Les mises (`Bet`) sont regroupées dans un pool commun (pari mutuel).

États d'un marché :
- DRAFT        : brouillon (invisible aux joueurs)
- OPEN         : paris ouverts
- LOCKED       : clôture des paris atteinte, en attente de vérification
- RESOLVING    : admin en cours de résolution
- RESOLVED     : résolu (gagnant défini), gains redistribués
- CANCELLED    : annulé (source indisponible, litige) → remboursement
"""
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _


class Category(models.TextChoices):
    WEATHER = "WEATHER", _("Météo")
    SOCIAL = "SOCIAL", _("Réseaux sociaux")
    TRENDING = "TRENDING", _("Tendances")
    SPORTS = "SPORTS", _("Sport")


class MarketOutcome(models.TextChoices):
    YES = "YES", _("OUI")
    NO = "NO", _("NON")


class MarketStatus(models.TextChoices):
    DRAFT = "DRAFT", _("Brouillon")
    OPEN = "OPEN", _("Ouvert")
    LOCKED = "LOCKED", _("Clôturé (en attente vérification)")
    RESOLVING = "RESOLVING", _("Résolution en cours")
    RESOLVED = "RESOLVED", _("Résolu")
    CANCELLED = "CANCELLED", _("Annulé (remboursé)")


class Market(models.Model):
    """Un marché prédictif binaire."""

    question = models.CharField(
        _("Question"), max_length=255,
        help_text=_("Syntaxe conseillée : [Quoi] [Seuil] [Où] [Avant quand] ?"),
    )
    description = models.TextField(_("Description / règlement"))
    category = models.CharField(
        _("Catégorie"), max_length=20, choices=Category.choices, default=Category.WEATHER
    )
    source_url = models.URLField(
        _("Lien source officiel"),
        help_text=_("Source publique de vérification (ex: météo, page Facebook)."),
    )
    source_rules = models.TextField(
        _("Règles de résolution / litige"),
        help_text=_("Conduite à adopter si la source est indisponible, litige, etc."),
    )
    # Dates clés
    bet_close_at = models.DateTimeField(
        _("Clôture des paris"),
        help_text=_("Date/heure limite pour miser (heure de Madagascar)."),
    )
    resolve_at = models.DateTimeField(
        _("Date de vérification"),
        help_text=_("Date/heure à laquelle le résultat peut être vérifié."),
    )

    status = models.CharField(
        _("Statut"), max_length=20, choices=MarketStatus.choices, default=MarketStatus.DRAFT
    )
    outcome = models.CharField(
        _("Résultat officiel"), max_length=10, choices=MarketOutcome.choices, blank=True
    )
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="resolved_markets",
    )
    resolved_at = models.DateTimeField(null=True, blank=True)

    # Compteurs de pool (cache pour calcul de cotes rapide)
    pool_yes = models.DecimalField(
        max_digits=16, decimal_places=2, default=Decimal("0"),
        validators=[MinValueValidator(Decimal("0"))],
    )
    pool_no = models.DecimalField(
        max_digits=16, decimal_places=2, default=Decimal("0"),
        validators=[MinValueValidator(Decimal("0"))],
    )

    image_url = models.URLField(_("Image (optionnel)"), blank=True)
    is_featured = models.BooleanField(_("Mis en avant"), default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Marché")
        verbose_name_plural = _("Marchés")
        ordering = ("-is_featured", "-bet_close_at")
        indexes = [
            models.Index(fields=["status", "category"]),
            models.Index(fields=["-bet_close_at"]),
        ]

    def __str__(self):
        return f"[{self.get_status_display()}] {self.question[:60]}"

    # --- Helpers de pool / cotes -------------------------------------------

    @property
    def pool_total(self):
        return (Decimal(self.pool_yes) + Decimal(self.pool_no)).quantize(Decimal("0.01"))

    def proba(self) -> dict:
        """Probabilités implicites (= part du pool sur chaque issue)."""
        total = self.pool_total
        if total <= 0:
            return {"YES": Decimal("0.50"), "NO": Decimal("0.50")}
        return {
            "YES": (Decimal(self.pool_yes) / total).quantize(Decimal("0.0001")),
            "NO": (Decimal(self.pool_no) / total).quantize(Decimal("0.0001")),
        }

    def is_bettable(self) -> bool:
        return self.status == MarketStatus.OPEN and timezone.now() < self.bet_close_at

    def is_resolvable(self) -> bool:
        return self.status in (MarketStatus.LOCKED, MarketStatus.RESOLVING) \
               and timezone.now() >= self.resolve_at


class Bet(models.Model):
    """Une mise d'un utilisateur sur un marché."""

    class Status(models.TextChoices):
        PLACED = "PLACED", _("Placée")
        WON = "WON", _("Gagnée")
        LOST = "LOST", _("Perdue")
        REFUNDED = "REFUNDED", _("Remboursée")

    market = models.ForeignKey(
        Market, on_delete=models.PROTECT, related_name="bets"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="bets"
    )
    outcome = models.CharField(max_length=10, choices=MarketOutcome.choices)
    amount = models.DecimalField(
        _("Mise"), max_digits=14, decimal_places=2,
        validators=[MinValueValidator(Decimal("0"))],
    )
    # Gain net crédité à la résolution (0 si perdu)
    payout = models.DecimalField(
        _("Gain redistribué"), max_digits=14, decimal_places=2,
        default=Decimal("0"),
    )
    # Probabilité « indicative » au moment de la mise (pour historique)
    proba_at_place = models.DecimalField(
        max_digits=6, decimal_places=4, default=Decimal("0.5")
    )
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PLACED
    )
    ledger_entry = models.ForeignKey(
        "ledger.LedgerEntry", on_delete=models.PROTECT,
        null=True, blank=True, related_name="bets",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("Pari")
        verbose_name_plural = _("Paris")
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["market", "outcome"]),
            models.Index(fields=["user", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.user_id} → {self.outcome} {self.amount} sur « {self.market_id} »"
