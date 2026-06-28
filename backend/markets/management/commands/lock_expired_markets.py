"""Clôture automatique des marchés dont la date de fin des paris est dépassée.

À lancer périodiquement (cron, Render Cron Job, etc.). Sans lui, un marché
reste pariable indéfiniment après son `bet_close_at`, ce qui fausse le
pari mutuel et la résolution.

    python manage.py lock_expired_markets

Idempotent : peut tourner plusieurs fois sans effet de bord (le filtre
sur status=OPEN rend la double exécution inoffensive).
"""
from django.core.management.base import BaseCommand

from markets.services import auto_lock_expired_markets


class Command(BaseCommand):
    help = "Passe en LOCKED les marchés OPEN dont bet_close_at est dépassé."

    def handle(self, *args, **options):
        n = auto_lock_expired_markets()
        if n:
            self.stdout.write(self.style.SUCCESS(
                f"✅ {n} marché(s) clôturé(s) (passage OPEN → LOCKED)."
            ))
        else:
            self.stdout.write("Aucun marché à clôturer.")
