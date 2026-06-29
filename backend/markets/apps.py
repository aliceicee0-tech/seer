from django.apps import AppConfig


class MarketsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "markets"
    verbose_name = "Marchés prédictifs"

    def ready(self):
        # Import des signaux pour brancher la création auto du MarketPool.
        from . import signals  # noqa: F401
