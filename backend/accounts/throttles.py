"""Throttles d'authentification — protection anti brute-force.

Le rate-limit par IP est complété par un verrou par numéro de téléphone :
même en changeant d'IP, un attaquant ne peut tester qu'un nombre borné de
mots de passe pour un téléphone donné.
"""
from django.core.cache import cache
from rest_framework.throttling import SimpleRateThrottle


class LoginRateThrottle(SimpleRateThrottle):
    """Limite stricte sur les tentatives de connexion (scope 'login')."""
    scope = "login"

    def get_cache_ident(self, key: str) -> str:
        return cache.get_or_set(key, 0)

    def get_ident(self, request):
        # Identifiant = IP du client (X-Forwarded-For en premier si proxy)
        return super().get_ident(request)


class PhoneLoginThrottle(SimpleRateThrottle):
    """Verrou par numéro de téléphone : plafonne les essais pour un même compte.

    Indépendant de l'IP : un attaquant multi-IP ne peut pas brute-forcer
    un numéro au-delà de la limite 'login'. Seules les requêtes portant un
    'phone' sont concernées.
    """
    scope = "login"

    def get_ident(self, request):
        phone = (request.data or {}).get("phone", "")
        if not phone:
            return None  # pas de phone → SimpleRateThrottle ignore
        return f"phone:{phone}"

    def get_cache_key(self, request, view):
        ident = self.get_ident(request)
        if ident is None:
            return None
        return self.cache_format % {"scope": self.scope, "ident": ident}
