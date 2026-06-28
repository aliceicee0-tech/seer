"""Serializers DRF pour l'API marchés."""
from decimal import Decimal

from rest_framework import serializers

from .models import Bet, Market
from .services import estimate_payout


class MarketListSerializer(serializers.ModelSerializer):
    proba_yes = serializers.SerializerMethodField()
    proba_no = serializers.SerializerMethodField()
    pool_total = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)
    category_label = serializers.CharField(source="get_category_display", read_only=True)

    class Meta:
        model = Market
        fields = (
            "id", "question", "category", "category_label", "status",
            "proba_yes", "proba_no", "pool_total", "pool_yes", "pool_no",
            "bet_close_at", "resolve_at", "image_url", "is_featured", "outcome",
        )

    def get_proba_yes(self, obj):
        return str(obj.proba()["YES"])

    def get_proba_no(self, obj):
        return str(obj.proba()["NO"])


class MarketDetailSerializer(MarketListSerializer):
    class Meta(MarketListSerializer.Meta):
        fields = MarketListSerializer.Meta.fields + (
            "description", "source_url", "source_rules", "resolved_at",
        )


class PlaceBetSerializer(serializers.Serializer):
    outcome = serializers.ChoiceField(choices=["YES", "NO"])
    amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("1")
    )

    def validate_amount(self, value):
        from django.conf import settings
        if Decimal(value) < Decimal(settings.MIN_BET_AMOUNT):
            raise serializers.ValidationError(
                f"Mise minimale : {settings.MIN_BET_AMOUNT} MGA."
            )
        return value


class BetSerializer(serializers.ModelSerializer):
    market_question = serializers.CharField(source="market.question", read_only=True)
    category = serializers.CharField(source="market.category", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    outcome_label = serializers.CharField(source="get_outcome_display", read_only=True)
    market = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Bet
        fields = (
            "id", "market", "market_question", "category",
            "outcome", "outcome_label", "amount", "payout",
            "proba_at_place", "status", "status_label", "created_at",
        )


class EstimateSerializer(serializers.Serializer):
    """Schéma de sortie pour l'estimation de gain."""
    stake = serializers.CharField()
    estimated_payout = serializers.CharField()
    estimated_net = serializers.CharField()
    current_pool_yes = serializers.CharField()
    current_pool_no = serializers.CharField()
    current_pool_total = serializers.CharField()
    commission_rate = serializers.CharField()
