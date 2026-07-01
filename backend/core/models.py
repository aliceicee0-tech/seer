"""
Modèle utilisateur central de Nexus.

L'authentification se fait par **numéro de téléphone** (utilisé pour Mobile Money),
complété par un mot de passe. Les numéros sont stockés sous forme normalisée
(chiffres uniquement) pour garantir l'unicité.
"""
import re

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils.translation import gettext_lazy as _


def normalize_phone(raw: str) -> str:
    """Normalise un numéro de téléphone malgache en chiffres (ex: 034XX -> 034XX)."""
    if not raw:
        return ""
    digits = re.sub(r"\D", "", raw)
    # +261 / 00261 / 0… → on garde la forme locale "0XXXXXXXXX"
    if digits.startswith("00261"):
        digits = "0" + digits[5:]
    elif digits.startswith("261"):
        digits = "0" + digits[3:]
    return digits


class User(AbstractUser):
    """Utilisateur Nexus — identifié par son numéro de téléphone."""

    # Le `username` Django reste mais n'est plus l'identifiant public.
    username = models.CharField(
        _("Nom d'utilisateur"), max_length=150, blank=True, null=True
    )
    phone = models.CharField(
        _("Téléphone"), max_length=20, unique=True,
        help_text=_("Numéro Mobile Money du joueur, format 0XXXXXXXXX."),
    )
    display_name = models.CharField(
        _("Nom affiché"), max_length=80, blank=True
    )
    # NOTE : l'accès au dashboard admin se base sur `is_staff` (Django natif) via
    # la propriété `is_platform_admin` ci-dessous. Pas de champ redondant — un
    # admin = un user avec is_staff=True (ou is_superuser=True).

    # Identifiant d'authentification = téléphone
    USERNAME_FIELD = "phone"
    REQUIRED_FIELDS = ["username"]

    class Meta:
        verbose_name = _("Utilisateur")
        verbose_name_plural = _("Utilisateurs")

    def __str__(self):
        return f"{self.phone} ({self.display_name or 'joueur'})"

    def clean(self):
        super().clean()
        if self.phone:
            self.phone = normalize_phone(self.phone)

    def save(self, *args, **kwargs):
        if self.phone:
            self.phone = normalize_phone(self.phone)
        # username facultatif : on en génère un si manquant
        if not self.username:
            self.username = f"user_{self.phone}"
        super().save(*args, **kwargs)

    @property
    def is_platform_admin(self):
        return self.is_superuser or self.is_staff
