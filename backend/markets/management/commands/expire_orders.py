"""Expiration automatique des ordres dont `expires_at` est dépassé.

    python manage.py expire_orders

Idempotent : les ordres déjà terminés (FILLED/CANCELLED/EXPIRED) sont ignorés.
"""
from django.core.management.base import BaseCommand

from markets.services import expire_orders


class Command(BaseCommand):
    help = "Marque EXPIRÉS les ordres ouverts dont expires_at est dépassé."

    def handle(self, *args, **options):
        n = expire_orders()
        if n:
            self.stdout.write(self.style.SUCCESS(
                f"✅ {n} ordre(s) expiré(s) et remboursé(s)."
            ))
        else:
            self.stdout.write("Aucun ordre à expirer.")
