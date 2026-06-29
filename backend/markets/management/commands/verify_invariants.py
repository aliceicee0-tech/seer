"""Vérification périodique des invariants financiers (cahier des charges §5).

À lancer toutes les minutes via cron / Render Cron Job :

    python manage.py verify_invariants

Invariants contrôlés :
  a) par marché : escrow == (pairs_created − pairs_destroyed)
                  ET Σ YES == Σ NO == escrow ;
  b) global     : Σ balances + Σ escrow + Σ locked ==
                  Σ dépôts − Σ retraits.

En cas d'anomalie, le (ou les) marché(s) concerné(s) sont gelés (FROZEN) :
le carnet est figé, aucune transaction n'est possible, en attente d'audit.
"""
import json

from django.core.management.base import BaseCommand

from markets.services import verify_invariants


class Command(BaseCommand):
    help = (
        "Vérifie les invariants financiers et gèle les marchés en anomalie."
    )

    def handle(self, *args, **options):
        report = verify_invariants()

        if not report["frozen_markets"] and report["global_invariant_ok"]:
            self.stdout.write(self.style.SUCCESS(
                "✅ Tous les invariants financiers sont respectés."
            ))
            return

        self.stdout.write(self.style.ERROR(
            "❌ Anomalie(s) d'invariance détectée(s) — marchés gelés :"
        ))
        self.stdout.write(json.dumps(report, indent=2, default=str))
