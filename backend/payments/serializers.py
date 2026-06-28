"""Serializers DRF pour les paiements."""
from decimal import Decimal

from django.conf import settings
from rest_framework import serializers

from .models import DepositRequest, Operator, WithdrawRequest


class MobileMoneyInfoSerializer(serializers.Serializer):
    """Infos publiques des numéros de réception Mobile Money de la plateforme."""
    holder = serializers.CharField()
    numbers = serializers.DictField(child=serializers.CharField())


class CreateDepositSerializer(serializers.Serializer):
    amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("1")
    )
    operator = serializers.ChoiceField(choices=Operator.choices)


class DeclareDepositSerializer(serializers.Serializer):
    """Le joueur a effectué son transfert hors-app : il le déclare."""
    sender_phone = serializers.CharField(max_length=20)
    operator_ref = serializers.CharField(max_length=40, required=False, allow_blank=True)


class CreateWithdrawSerializer(serializers.Serializer):
    amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("1")
    )
    operator = serializers.ChoiceField(choices=Operator.choices)
    recipient_phone = serializers.CharField(max_length=20)


class DepositSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    operator_label = serializers.CharField(source="get_operator_display", read_only=True)

    class Meta:
        model = DepositRequest
        fields = (
            "id", "code", "amount", "operator", "operator_label",
            "sender_phone", "operator_ref", "status", "status_label",
            "admin_note", "created_at", "processed_at",
        )
        read_only_fields = ("code", "status", "admin_note", "processed_at")


class WithdrawSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    operator_label = serializers.CharField(source="get_operator_display", read_only=True)

    class Meta:
        model = WithdrawRequest
        fields = (
            "id", "code", "amount", "operator", "operator_label",
            "recipient_phone", "status", "status_label",
            "admin_note", "created_at", "processed_at", "operator_ref",
        )
        read_only_fields = ("code", "status", "admin_note", "processed_at",
                            "operator_ref")
