"""
Modèles de marchés prédictifs Nexus — moteur Polymarket (collatéralisation).

Contrairement à un bookmaker (pari mutuel), la plateforme n'a **aucun risque de
caisse** : chaque paire de parts (1 YES + 1 NO) est strictement adossée à
1,00 MGA séquestré dans le `MarketPool` du marché. L'invariant fondamental :

    escrow(market) == YES_en_circulation × 1,00 == NO_en_circulation × 1,00
                  == (pairs_created − pairs_destroyed) × 1,00

est maintenu à chaque opération (mint / merge / trade / settlement). C'est ce
que vérifie le cron `verify_invariants` (cahier des charges §5).

États d'un marché :
- DRAFT        : brouillon (invisible aux joueurs)
- OPEN         : échanges ouverts
- LOCKED       : clôture des échanges atteinte, en attente de vérification
- RESOLVING    : admin en cours de résolution
- RESOLVED     : résolu (gagnant défini), gains payés à 1,00 MGA / part
- CANCELLED    : annulé → remboursement intégral à 1,00 MGA / part
- FROZEN       : gel automatique (anomalie d'invariance détectée par le cron)
"""
from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Sum
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
    FROZEN = "FROZEN", _("Gelé (anomalie d'invariance)")


class Market(models.Model):
    """Un marché prédictif binaire (OUI/NON)."""

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
        _("Clôture des échanges"),
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

    # --- Helpers -----------------------------------------------------------

    def is_tradeable(self) -> bool:
        """Un marché accepte des ordres uniquement s'il est OPEN et non clôturé."""
        return self.status == MarketStatus.OPEN and timezone.now() < self.bet_close_at

    def is_resolvable(self) -> bool:
        return self.status in (MarketStatus.LOCKED, MarketStatus.RESOLVING) \
               and timezone.now() >= self.resolve_at

    def last_trade_price(self) -> Decimal | None:
        """Dernier prix d'exécution sur ce marché (quel que soit le côté)."""
        last = self.trades.order_by("-created_at", "-id").first()
        return last.price if last else None

    def proba(self) -> dict:
        """Probabilités implicites dérivées du dernier prix de trade.

        Une part vaut SHARE_VALUE Ar (5000) à la résolution, donc :
            proba(YES) = prix_YES / SHARE_VALUE   (entre 0 et 1)
        Avant tout échange : 0.50 / 0.50 par convention.
        """
        from django.conf import settings
        share_value = Decimal(settings.SHARE_VALUE)
        p = self.last_trade_price()
        if p is None:
            return {"YES": Decimal("0.5000"), "NO": Decimal("0.5000")}
        yes = (p / share_value).quantize(Decimal("0.0001"))
        return {
            "YES": yes,
            "NO": (Decimal("1") - yes),
        }


# --------------------------------------------------------------------------
# Séquestre collatéralisé
# --------------------------------------------------------------------------

class MarketPool(models.Model):
    """Coffre-fort d'un marché : SHARE_VALUE Ar bloqués par paire (YES+NO).

    **Invariant (cahier des charges §2, §4, §5)** :
        escrow_balance == (pairs_created − pairs_destroyed) × SHARE_VALUE

    Cette table est l'argent séquestré, intouchable par la plateforme.
    """

    market = models.OneToOneField(
        Market, on_delete=models.PROTECT, related_name="pool",
        primary_key=True,
    )
    escrow_balance = models.DecimalField(
        _("Solde séquestré"), max_digits=16, decimal_places=2,
        default=Decimal("0"),
        help_text=_("MGA bloqués = paires en circulation × 1,00."),
    )
    pairs_created = models.BigIntegerField(default=0)
    pairs_destroyed = models.BigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Pool de marché")
        verbose_name_plural = _("Pools de marché")

    def __str__(self):
        return f"Pool « {self.market_id} » · escrow {self.escrow_balance} MGA"

    @property
    def pairs_in_circulation(self) -> int:
        return self.pairs_created - self.pairs_destroyed

    def invariant_ok(self) -> bool:
        """Vérifie escrow == paires en circulation × SHARE_VALUE (cahier des charges §5)."""
        from django.conf import settings
        return Decimal(self.escrow_balance) == (
            Decimal(self.pairs_in_circulation) * Decimal(settings.SHARE_VALUE)
        )


# --------------------------------------------------------------------------
# Positions utilisateurs (parts possédées)
# --------------------------------------------------------------------------

class Position(models.Model):
    """Parts détenues par un utilisateur sur un marché et un côté (YES/NO)."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="positions"
    )
    market = models.ForeignKey(
        Market, on_delete=models.PROTECT, related_name="positions"
    )
    outcome = models.CharField(max_length=3, choices=MarketOutcome.choices)
    # Parts détenues (1 part = potentiellement 1,00 MGA à la résolution)
    quantity = models.BigIntegerField(default=0)
    # Parts bloquées par des ordres de vente en attente (non vendables)
    locked_quantity = models.BigIntegerField(default=0)
    # Prix moyen d'achat pondéré (en Ar) — pour le P&L affiché
    avg_buy_price = models.DecimalField(
        max_digits=7, decimal_places=2, default=Decimal("0"),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Position")
        verbose_name_plural = _("Positions")
        unique_together = (("user", "market", "outcome"),)
        indexes = [
            models.Index(fields=["market", "outcome"]),
            models.Index(fields=["user", "market"]),
        ]

    def __str__(self):
        return f"{self.user_id} · {self.outcome} ×{self.quantity} sur « {self.market_id} »"

    @property
    def available_quantity(self) -> int:
        """Parts réellement vendables = détenues − bloquées par ordres de vente."""
        return self.quantity - self.locked_quantity

    @classmethod
    def total_quantity(cls, market, outcome) -> int:
        """Nombre total de parts `outcome` en circulation sur ce marché."""
        agg = cls.objects.filter(market=market, outcome=outcome).aggregate(
            t=Sum("quantity")
        )
        return agg["t"] or 0


# --------------------------------------------------------------------------
# Carnet d'ordres (CLOB)
# --------------------------------------------------------------------------

class Order(models.Model):
    """Un ordre du carnet (CLOB) : achat/vente de parts YES ou NO.

    Prix d'une action bornés entre MIN_ORDER_PRICE (0,01) et MAX_ORDER_PRICE
    (0,99) — cahier des charges §2. Les ordres MARKET n'ont pas de prix.
    """

    class Side(models.TextChoices):
        BUY = "BUY", _("Achat")
        SELL = "SELL", _("Vente")

    class OrderType(models.TextChoices):
        LIMIT = "LIMIT", _("À cours limité")
        MARKET = "MARKET", _("Au marché")

    class Status(models.TextChoices):
        OPEN = "OPEN", _("Ouvert")
        PARTIAL = "PARTIAL", _("Partiellement exécuté")
        FILLED = "FILLED", _("Exécuté")
        CANCELLED = "CANCELLED", _("Annulé")
        EXPIRED = "EXPIRED", _("Expiré")

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="orders"
    )
    market = models.ForeignKey(
        Market, on_delete=models.PROTECT, related_name="orders"
    )
    side = models.CharField(max_length=5, choices=Side.choices)
    order_type = models.CharField(max_length=6, choices=OrderType.choices)
    outcome = models.CharField(max_length=3, choices=MarketOutcome.choices)
    price = models.DecimalField(
        _("Prix limite"), max_digits=7, decimal_places=2, null=True, blank=True,
        help_text=_("Requis pour LIMIT (1 à 4999 Ar). Vide pour MARKET."),
        validators=[
            MinValueValidator(Decimal("1")),
            MaxValueValidator(Decimal("4999")),
        ],
    )
    quantity = models.BigIntegerField(_("Quantité demandée"))
    filled_quantity = models.BigIntegerField(default=0)
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.OPEN
    )
    expires_at = models.DateTimeField(
        _("Expire le"), null=True, blank=True,
        help_text=_("Optionnel : l'ordre expire tout seul après cette date."),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Ordre")
        verbose_name_plural = _("Ordres")
        ordering = ("-created_at",)
        indexes = [
            # Index du matching : recherche rapide du meilleur ordre opposé.
            models.Index(fields=["market", "outcome", "side", "status", "price"]),
            models.Index(fields=["user", "-created_at"]),
        ]

    def __str__(self):
        p = f"@{self.price}" if self.price is not None else "@MKT"
        return f"{self.user_id} {self.side} {self.outcome} ×{self.quantity} {p}"

    @property
    def remaining_quantity(self) -> int:
        return self.quantity - self.filled_quantity

    @property
    def is_active(self) -> bool:
        """Encore susceptible d'être exécuté : non rempli et non annulé."""
        return self.status in (Order.Status.OPEN, Order.Status.PARTIAL)


class Trade(models.Model):
    """Une transaction exécutée (appariement d'un achat et d'une vente)."""

    market = models.ForeignKey(
        Market, on_delete=models.PROTECT, related_name="trades"
    )
    outcome = models.CharField(max_length=3, choices=MarketOutcome.choices)
    buyer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="trades_as_buyer"
    )
    seller = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="trades_as_seller"
    )
    buy_order = models.ForeignKey(
        Order, on_delete=models.PROTECT, related_name="buy_trades"
    )
    sell_order = models.ForeignKey(
        Order, on_delete=models.PROTECT, related_name="sell_trades"
    )
    price = models.DecimalField(max_digits=7, decimal_places=2)
    quantity = models.BigIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("Transaction")
        verbose_name_plural = _("Transactions")
        ordering = ("-created_at", "-id")
        indexes = [
            models.Index(fields=["market", "-created_at"]),
            models.Index(fields=["market", "outcome", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.outcome} ×{self.quantity} @ {self.price} « {self.market_id} »"
