"""Serializers de l'API dashboard admin.

Réutilisent les serializers métier quand c'est possible, et ajoutent
ce dont l'admin a besoin : infos du joueur sur chaque demande, écritures
comptables élargies, et un formulaire de création/édition de marché.
"""
from decimal import Decimal

from rest_framework import serializers

from core.models import User
from ledger.models import LedgerEntry, Wallet
from markets.models import Market
from markets.serializers import MarketDetailSerializer
from payments.models import DepositRequest, WithdrawRequest
from payments.serializers import DepositSerializer, WithdrawSerializer


# --------------------------------------------------------------------------
# Dépôts / retraits enrichis (avec infos du joueur)
# --------------------------------------------------------------------------

class AdminDepositSerializer(DepositSerializer):
    """Dépôt + identité du joueur (pour la file de validation admin)."""
    user_phone = serializers.CharField(source="user.phone", read_only=True)
    user_name = serializers.CharField(source="user.display_name", read_only=True)
    user_id = serializers.IntegerField(source="user.id", read_only=True)

    class Meta(DepositSerializer.Meta):
        fields = DepositSerializer.Meta.fields + (
            "user_id", "user_phone", "user_name",
        )


class AdminWithdrawSerializer(WithdrawSerializer):
    """Retrait + identité du joueur."""
    user_phone = serializers.CharField(source="user.phone", read_only=True)
    user_name = serializers.CharField(source="user.display_name", read_only=True)
    user_id = serializers.IntegerField(source="user.id", read_only=True)

    class Meta(WithdrawSerializer.Meta):
        fields = WithdrawSerializer.Meta.fields + (
            "user_id", "user_phone", "user_name",
        )


# --------------------------------------------------------------------------
# Marchés (CRUD admin)
# --------------------------------------------------------------------------

class MarketAdminSerializer(MarketDetailSerializer):
    """Marché vu côté admin : expose aussi les dates de résolution et l'auteur."""

    class Meta(MarketDetailSerializer.Meta):
        fields = MarketDetailSerializer.Meta.fields + ("resolved_at",)


class MarketCreateSerializer(serializers.ModelSerializer):
    """Création d'un marché selon la syntaxe [Quoi][Seuil][Où][Avant quand]."""

    class Meta:
        model = Market
        fields = (
            "question", "description", "category", "source_url", "source_rules",
            "bet_close_at", "resolve_at", "image_url", "is_featured", "status",
        )

    def create(self, validated_data):
        # Par défaut un nouveau marché est OPEN, sauf si l'admin impose un statut.
        validated_data.setdefault("status", "OPEN")
        return Market.objects.create(**validated_data)


# --------------------------------------------------------------------------
# Utilisateurs / wallets
# --------------------------------------------------------------------------

class AdminUserSerializer(serializers.ModelSerializer):
    """Joueur vu par l'admin : soldes + compteurs d'activité."""
    balance = serializers.SerializerMethodField()
    available_balance = serializers.SerializerMethodField()
    locked_balance = serializers.SerializerMethodField()
    positions_count = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id", "phone", "display_name", "is_active", "is_staff",
            "balance", "available_balance", "locked_balance",
            "positions_count", "date_joined",
        )
        read_only_fields = fields

    def _wallet(self, obj):
        w = getattr(obj, "wallet", None)
        if w is None:
            w = Wallet.objects.filter(user=obj).first()
        return w

    def get_balance(self, obj):
        w = self._wallet(obj)
        return str(w.balance) if w else "0"

    def get_available_balance(self, obj):
        w = self._wallet(obj)
        return str(w.available_balance) if w else "0"

    def get_locked_balance(self, obj):
        w = self._wallet(obj)
        return str(w.locked_balance) if w else "0"

    def get_positions_count(self, obj):
        from markets.models import Position
        return obj.positions.filter(quantity__gt=0).count()


class AdminLedgerEntrySerializer(serializers.ModelSerializer):
    """Écriture comptable étendue (avec téléphone du joueur pour le filtre admin)."""
    type_label = serializers.CharField(source="get_type_display", read_only=True)
    user_phone = serializers.CharField(source="wallet.user.phone", read_only=True)

    class Meta:
        model = LedgerEntry
        fields = (
            "id", "type", "type_label", "amount", "balance_after",
            "reference", "note", "user_phone", "created_by", "created_at",
        )


# --------------------------------------------------------------------------
# Entrées des actions de validation (body des requêtes admin)
# --------------------------------------------------------------------------

class ProcessNoteSerializer(serializers.Serializer):
    """Note optionnelle accompagnant une action admin (approuver/rejeter/payer)."""
    note = serializers.CharField(required=False, allow_blank=True)
    operator_ref = serializers.CharField(required=False, allow_blank=True)


class ResolveSerializer(serializers.Serializer):
    """Résolution d'un marché : OUI ou NON."""
    outcome = serializers.ChoiceField(choices=["YES", "NO"])
