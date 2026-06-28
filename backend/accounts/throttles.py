"""Throttles d'authentification — protection anti brute-force.

Deux verrous complémentaires sur les tentatives de connexion :
- LoginRateThrottle  : par IP du client.
- PhoneLoginThrottle : par numéro de téléphone visé (indépendant de l'IP).

Note : SimpleRateThrottle lève NotImplementedError sur get_cache_key() par
défaut ; il faut donc l'implémenter explicitement dans chaque sous-classe.
"""
from rest_framework.throttling import SimpleRateThrottle


class LoginRateThrottle(SimpleRateThrottle):
    """Limite stricte sur les tentatives de connexion, par IP (scope 'login')."""
    scope = "login"

    def get_cache_key(self, request, view):
        ident = self.get_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": ident}


class PhoneLoginThrottle(SimpleRateThrottle):
    """Verrou par numéro de téléphone : plafonne les essais pour un même compte.

    Indépendant de l'IP : un attaquant multi-IP ne peut pas brute-forcer
    un numéro au-delà de la limite 'login'. Seules les requêtes portant un
    'phone' sont concernées.
    """
    scope = "login"

    def get_cache_key(self, request, view):
        phone = (request.data or {}).get("phone", "")
        if not phone:
            return None  # pas de phone → on ne throttle pas cette requête
        ident = f"phone:{phone}"
        return self.cache_format % {"scope": self.scope, "ident": ident}
