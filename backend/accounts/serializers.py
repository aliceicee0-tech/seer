"""Serializers d'authentification et de compte."""
from rest_framework import serializers

from core.models import User, normalize_phone
from ledger.models import LedgerEntry


class RegisterSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)
    display_name = serializers.CharField(max_length=80, required=False, allow_blank=True)
    password = serializers.CharField(min_length=6, write_only=True)

    def validate_phone(self, value):
        phone = normalize_phone(value)
        if not phone:
            raise serializers.ValidationError("Numéro de téléphone invalide.")
        if User.objects.filter(phone=phone).exists():
            raise serializers.ValidationError("Ce numéro est déjà inscrit.")
        return phone

    def create(self, validated_data):
        # Avec USERNAME_FIELD="phone", le manager Django attend le téléphone
        # comme argument positionnel `username`. On le passe ici, le save()
        # du modèle génère ensuite un username interne (`user_<phone>`).
        return User.objects.create_user(
            username=validated_data["phone"],
            phone=validated_data["phone"],
            password=validated_data["password"],
            display_name=validated_data.get("display_name", ""),
        )


class LoginSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        from django.contrib.auth import authenticate
        phone = normalize_phone(attrs.get("phone", ""))
        password = attrs.get("password", "")
        user = authenticate(request=self.context.get("request"),
                            phone=phone, password=password)
        if not user:
            raise serializers.ValidationError("Numéro ou mot de passe incorrect.")
        if not user.is_active:
            raise serializers.ValidationError("Compte désactivé.")
        attrs["user"] = user
        return attrs


class UserSerializer(serializers.ModelSerializer):
    """Profil utilisateur + solde du wallet."""
    balance = serializers.SerializerMethodField()
    available_balance = serializers.SerializerMethodField()
    locked_balance = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "phone", "display_name",
                  "balance", "available_balance", "locked_balance",
                  "is_platform_admin", "date_joined")
        read_only_fields = fields

    def _wallet(self, obj):
        return getattr(obj, "wallet", None)

    def get_balance(self, obj):
        w = self._wallet(obj)
        return str(w.balance) if w else "0"

    def get_available_balance(self, obj):
        w = self._wallet(obj)
        return str(w.available_balance) if w else "0"

    def get_locked_balance(self, obj):
        w = self._wallet(obj)
        return str(w.locked_balance) if w else "0"


class LedgerEntrySerializer(serializers.ModelSerializer):
    type_label = serializers.CharField(source="get_type_display", read_only=True)

    class Meta:
        model = LedgerEntry
        fields = ("id", "type", "type_label", "amount", "balance_after",
                  "reference", "note", "created_at")
