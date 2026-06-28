from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core"
    verbose_name = "Cœur Seer"

    def ready(self):
        # Importe les signaux (création du Wallet à la création d'un User)
        from . import signals  # noqa: F401
