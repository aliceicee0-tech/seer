"""Commande de seed : crée marchés de démo + joueurs + mises de démonstration.

Usage :  python manage.py seed_demo
Idempotente : ne recrée pas ce qui existe déjà.
"""
import random
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import User
from ledger.services import post_entry
from markets.models import Category, Market, MarketStatus
from markets.services import place_bet
from payments.services import approve_deposit
from payments.models import DepositRequest, Operator


TITLES = [
    # --- Sport (Coupe du Monde) ---
    ("Madagascar se qualifiera-t-elle pour la phase finale de la prochaine Coupe du Monde ?",
     Category.SPORTS, "https://www.fifa.com/fifa-world-ranking"),
    ("Le Brésil atteindra-t-il les demi-finales de la Coupe du Monde 2026 ?",
     Category.SPORTS, "https://www.fifa.com/en/tournaments/mens/worldcup"),
    ("Plus de 3 buts seront-ils marqués lors du prochain France – Argentine ?",
     Category.SPORTS, "https://www.fifa.com/en/tournaments/mens/worldcup"),
    # --- Réseaux sociaux (suivi d'influenceurs) ---
    ("La page Facebook de Tefihaja atteindra-t-elle 1 000 000 d'abonnés avant le 31 décembre 2026 ?",
     Category.SOCIAL, "https://www.facebook.com/tefihaja"),
    ("La page « Buzz Madagascar » atteindra-t-elle 500 000 fans avant le 31 juillet ?",
     Category.SOCIAL, "https://www.facebook.com/buzzmadagascar"),
    ("La vidéo de l'artiste X dépassera-t-elle 1 000 000 de vues avant le 10 juillet ?",
     Category.SOCIAL, "https://www.youtube.com/watch?v=demo"),
    # --- Météo ---
    ("Le cyclone « Batsirai » touchera-t-il Toamasina avant le 20 juillet ?",
     Category.WEATHER, "http://www.meteomadagascar.mg/cyclones"),
    ("La température à Toliara dépassera-t-elle 38°C avant le 15 juillet ?",
     Category.WEATHER, "http://www.meteomadagascar.mg/temperature"),
    # --- Tendances ---
    ("Le groupe Facebook « Ankapobeny » franchira-t-elle 200 000 membres avant le 25 juillet ?",
     Category.TRENDING, "https://www.facebook.com/groups/ankapobeny"),
]


class Command(BaseCommand):
    help = "Génère des données de démonstration : joueurs, marchés, mises."

    def handle(self, *args, **options):
        now = timezone.now()

        # --- Marchés --------------------------------------------------------
        markets = []
        for i, (q, cat, src) in enumerate(TITLES):
            m, created = Market.objects.get_or_create(
                question=q,
                defaults={
                    "category": cat,
                    "description": q + "\n\nRèglement strict et source vérifiable ci-dessous.",
                    "source_url": src,
                    "source_rules": (
                        "Si la source officielle est indisponible pendant plus de 24h après la "
                        "date prévue, le marché sera ANNULÉ et toutes les mises remboursées "
                        "intégralement."
                    ),
                    "bet_close_at": now + timezone.timedelta(days=7 + i),
                    "resolve_at": now + timezone.timedelta(days=10 + i),
                    "status": MarketStatus.OPEN,
                    "is_featured": i < 2,
                },
            )
            markets.append(m)
            tag = "créé" if created else "existant"
            self.stdout.write(f"  Marché {tag} : {q[:50]}...")

        # --- Joueur démo ----------------------------------------------------
        phone = "0341234567"
        player, created = User.objects.get_or_create(
            phone=phone,
            defaults={"display_name": "Joueur Démo", "password": "!invalidplaceholder!"},
        )
        if created:
            player.set_password("demo1234")
            player.save()
            self.stdout.write(self.style.SUCCESS("  Joueur démo créé : 0341234567 / demo1234"))

        # --- Crédit initial via dépôt approuvé ------------------------------
        if player.wallet.available_balance == 0:
            dep = DepositRequest.objects.create(
                user=player, amount=Decimal("10000"),
                operator=Operator.MVOLA, sender_phone=player.phone,
                operator_ref="SMSDEMO001",
            )
            approve_deposit(deposit=dep, admin_user=player, note="Seed démo")
            self.stdout.write(f"  Crédit démo de 10 000 MGA versé à {player.phone}")

        # --- Quelques mises aléatoires pour alimenter les pools ------------
        outcomes = ["YES", "NO"]
        amounts = [Decimal("500"), Decimal("1000"), Decimal("2000")]
        nb = 0
        for m in markets[:3]:
            for _ in range(3):
                try:
                    place_bet(
                        user=player, market=m,
                        outcome=random.choice(outcomes),
                        amount=random.choice(amounts),
                    )
                    nb += 1
                except Exception as e:  # noqa: BLE001
                    self.stdout.write(self.style.WARNING(f"    Mise ignorée : {e}"))
        self.stdout.write(self.style.SUCCESS(f"  {nb} mise(s) de démo placée(s)."))
        self.stdout.write(self.style.SUCCESS("\n✅ Seed terminé."))
