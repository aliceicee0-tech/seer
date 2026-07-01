"""Commande de seed : crée marchés de démo + joueurs + carnet vivant (Polymarket).

Usage :  python manage.py seed_demo
Idempotente : ne recrée pas ce qui existe déjà.
"""
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from core.models import User
from ledger.services import post_entry
from markets.models import Category, Market, MarketStatus
from markets.services import MarketError, mint_pair, place_order
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
    ("Le groupe Facebook « Ankapobeny » franchira-t-il 200 000 membres avant le 25 juillet ?",
     Category.TRENDING, "https://www.facebook.com/groups/ankapobeny"),
]


class Command(BaseCommand):
    help = "Génère des données de démonstration : joueurs, marchés, carnet d'ordres."

    def handle(self, *args, **options):
        # Garde anti-prod (M4) : cette commande crée des comptes à mots de passe
        # dev connus ('demo1234', 'mm1234') crédités de gros soldes. En production
        # ce serait une faille — on refuse catégoriquement de l'exécuter.
        if not settings.DEBUG:
            raise CommandError(
                "Refusé : seed_demo crée des comptes de démonstration à mots de "
                "passe connus. Cette commande est réservée au développement "
                "(DEBUG=True)."
            )
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
        player = self._ensure_player("0341234567", "Joueur Démo", "demo1234",
                                     credit=Decimal("500000"))

        # --- Market makers de démo : ils mintent puis placent des ordres ----
        # pour qu'un vrai carnet d'ordres soit visible côté joueur.
        # Crédit large : mint de 20 paires = 100 000 Ar par marché.
        mm1 = self._ensure_player("0340000099", "Market Maker A", "mm1234",
                                  credit=Decimal("1000000"))
        mm2 = self._ensure_player("0340000088", "Market Maker B", "mm1234",
                                  credit=Decimal("1000000"))

        nb_orders = 0
        for m in markets[:3]:
            try:
                # Chaque market maker minte 20 paires (coûte 100 000 Ar)
                mint_pair(user=mm1, market=m, count=20)
                mint_pair(user=mm2, market=m, count=20)
                # Prix en Ar (1 part = 5000 Ar) : OUI autour de 3000 Ar (60%)
                place_order(user=mm1, market=m, side="SELL", outcome="YES",
                            order_type="LIMIT", quantity=10, price=Decimal("3000"))
                place_order(user=mm2, market=m, side="SELL", outcome="YES",
                            order_type="LIMIT", quantity=10, price=Decimal("3200"))
                place_order(user=mm2, market=m, side="BUY", outcome="YES",
                            order_type="LIMIT", quantity=10, price=Decimal("2800"))
                nb_orders += 3
            except MarketError as e:
                self.stdout.write(self.style.WARNING(f"    Ordre ignoré : {e}"))

        self.stdout.write(self.style.SUCCESS(
            f"  {nb_orders} ordre(s) de marché placé(s) → carnet vivant."
        ))
        self.stdout.write(self.style.SUCCESS("\n✅ Seed terminé."))

    # --- Helpers -----------------------------------------------------------

    def _ensure_player(self, phone, name, password, credit=None):
        player, created = User.objects.get_or_create(
            phone=phone,
            defaults={"display_name": name, "password": "!invalidplaceholder!"},
        )
        if created:
            player.set_password(password)
            player.save()
            self.stdout.write(self.style.SUCCESS(
                f"  Joueur créé : {phone} / {password}"
            ))
        if credit and player.wallet.available_balance == 0:
            dep = DepositRequest.objects.create(
                user=player, amount=credit,
                operator=Operator.MVOLA, sender_phone=player.phone,
                operator_ref=f"SMS{phone[-4:]}",
            )
            approve_deposit(deposit=dep, admin_user=player, note="Seed démo")
            self.stdout.write(f"  Crédit démo de {credit} MGA versé à {phone}")
        return player
