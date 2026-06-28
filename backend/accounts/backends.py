"""Backend d'authentification par téléphone."""
from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend

from core.models import normalize_phone

User = get_user_model()


class PhoneBackend(ModelBackend):
    """Authentifie avec le numéro de téléphone (normalisé) + mot de passe."""

    def authenticate(self, request, phone=None, password=None, **kwargs):
        if phone is None:
            # Fallback username
            phone = kwargs.get("username")
        if phone is None:
            return None
        phone = normalize_phone(phone)
        try:
            user = User.objects.get(phone=phone)
        except User.DoesNotExist:
            # Évite le timing oracle : on vérifie quand même un hash
            User().set_password(password)
            return None
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
