"""Serializers DRF pour l'API marchés (moteur Polymarket)."""
from decimal import Decimal

from rest_framework import serializers

from django.conf import settings
from django.utils import timezone

from .models import Market, MarketOutcome, MarketPool, Order, Position, Trade
from .services import estimate_payout


# --------------------------------------------------------------------------
# Catalogue public
# --------------------------------------------------------------------------

class MarketListSerializer(serializers.ModelSerializer):
    proba_yes = serializers.SerializerMethodField()
    proba_no = serializers.SerializerMethodField()
    last_price = serializers.SerializerMethodField()
    category_label = serializers.CharField(source="get_category_display", read_only=True)

    class Meta:
        model = Market
        fields = (
            "id", "question", "category", "category_label", "status",
            "proba_yes", "proba_no", "last_price",
            "bet_close_at", "resolve_at", "image_url", "is_featured", "outcome",
        )

    def get_proba_yes(self, obj):
        return str(obj.proba()["YES"])

    def get_proba_no(self, obj):
        return str(obj.proba()["NO"])

    def get_last_price(self, obj):
        p = obj.last_trade_price()
        return str(p) if p is not None else None


class MarketDetailSerializer(MarketListSerializer):
    class Meta(MarketListSerializer.Meta):
        fields = MarketListSerializer.Meta.fields + (
            "description", "source_url", "source_rules", "resolved_at",
        )


# --------------------------------------------------------------------------
# Émission / fusion de paires
# --------------------------------------------------------------------------

class MintSerializer(serializers.Serializer):
    """Demande d'émission de paires YES+NO (Split)."""
    count = serializers.IntegerField(min_value=1)


class MergeSerializer(serializers.Serializer):
    """Demande de fusion de paires YES+NO (Merge)."""
    count = serializers.IntegerField(min_value=1)


# --------------------------------------------------------------------------
# Ordres
# --------------------------------------------------------------------------

class OrderCreateSerializer(serializers.Serializer):
    """Création d'un ordre (limit/market, sur YES ou NO)."""
    side = serializers.ChoiceField(choices=Order.Side.choices)
    outcome = serializers.ChoiceField(choices=MarketOutcome.choices)
    order_type = serializers.ChoiceField(choices=Order.OrderType.choices)
    price = serializers.DecimalField(
        max_digits=5, decimal_places=2,
        min_value=Decimal(settings.MIN_ORDER_PRICE),
        max_value=Decimal(settings.MAX_ORDER_PRICE),
        required=False, allow_null=True,
    )
    quantity = serializers.IntegerField(min_value=1)
    expires_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate(self, attrs):
        if attrs["order_type"] == Order.OrderType.LIMIT and attrs.get("price") is None:
            raise serializers.ValidationError(
                {"price": "Un ordre LIMIT requiert un prix."}
            )
        return attrs


class OrderSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    side_label = serializers.CharField(source="get_side_display", read_only=True)
    outcome_label = serializers.CharField(source="get_outcome_display", read_only=True)
    market_question = serializers.CharField(source="market.question", read_only=True)
    remaining_quantity = serializers.IntegerField(read_only=True)

    class Meta:
        model = Order
        fields = (
            "id", "market", "market_question", "side", "side_label",
            "outcome", "outcome_label", "order_type", "price",
            "quantity", "filled_quantity", "remaining_quantity",
            "status", "status_label", "expires_at", "created_at",
        )
        read_only_fields = (
            "id", "market", "filled_quantity", "remaining_quantity",
            "status", "created_at",
        )


# --------------------------------------------------------------------------
# Transactions
# --------------------------------------------------------------------------

class TradeSerializer(serializers.ModelSerializer):
    buyer_phone = serializers.CharField(source="buyer.phone", read_only=True)
    seller_phone = serializers.CharField(source="seller.phone", read_only=True)

    class Meta:
        model = Trade
        fields = (
            "id", "market", "outcome", "price", "quantity",
            "buyer_phone", "seller_phone", "created_at",
        )


# --------------------------------------------------------------------------
# Carnet d'ordres (vue agrégée profondeur)
# --------------------------------------------------------------------------

class OrderBookLevelSerializer(serializers.Serializer):
    price = serializers.DecimalField(max_digits=5, decimal_places=2)
    quantity = serializers.IntegerField()


class OrderBookSerializer(serializers.Serializer):
    """Carnet agrégé par niveau de prix, pour YES et NO."""
    outcome = serializers.CharField()
    bids = OrderBookLevelSerializer(many=True)   # achats en attente (meilleur = +haut)
    asks = OrderBookLevelSerializer(many=True)   # ventes en attente (meilleur = +bas)
    spread = serializers.DecimalField(max_digits=6, decimal_places=2)
    last_price = serializers.DecimalField(
        max_digits=5, decimal_places=2, allow_null=True
    )


# --------------------------------------------------------------------------
# Positions
# --------------------------------------------------------------------------

class PositionSerializer(serializers.ModelSerializer):
    market_question = serializers.CharField(source="market.question", read_only=True)
    outcome_label = serializers.CharField(source="get_outcome_display", read_only=True)
    available_quantity = serializers.IntegerField(read_only=True)
    market_status = serializers.CharField(source="market.status", read_only=True)
    last_price = serializers.SerializerMethodField()
    current_value = serializers.SerializerMethodField()
    pnl = serializers.SerializerMethodField()

    class Meta:
        model = Position
        fields = (
            "id", "market", "market_question", "market_status",
            "outcome", "outcome_label",
            "quantity", "locked_quantity", "available_quantity",
            "avg_buy_price", "last_price", "current_value", "pnl",
            "updated_at",
        )

    def get_last_price(self, obj):
        p = obj.market.last_trade_price()
        return str(p) if p is not None else None

    def get_current_value(self, obj):
        p = obj.market.last_trade_price()
        if p is None:
            return "0"
        return str(p * obj.quantity)

    def get_pnl(self, obj):
        """Plus-value latente = valeur actuelle − coût moyen."""
        p = obj.market.last_trade_price()
        if p is None:
            return "0"
        cost = obj.avg_buy_price * obj.quantity
        return str((p * obj.quantity - cost).quantize(Decimal("0.01")))


# --------------------------------------------------------------------------
# Estimation
# --------------------------------------------------------------------------

class EstimateSerializer(serializers.Serializer):
    quantity = serializers.CharField()
    outcome = serializers.CharField()
    current_price = serializers.CharField(allow_null=True)
    current_cost = serializers.CharField(allow_null=True)
    payout_if_win = serializers.CharField()
    profit_if_win = serializers.CharField(allow_null=True)


# --------------------------------------------------------------------------
# Pool (info séquestre — lecture publique)
# --------------------------------------------------------------------------

class MarketPoolSerializer(serializers.ModelSerializer):
    pairs_in_circulation = serializers.IntegerField(read_only=True)
    invariant_ok = serializers.BooleanField(read_only=True)

    class Meta:
        model = MarketPool
        fields = (
            "escrow_balance", "pairs_created", "pairs_destroyed",
            "pairs_in_circulation", "invariant_ok",
        )
