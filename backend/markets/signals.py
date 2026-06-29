"""Signaux markets : création automatique du MarketPool (séquestre).

Chaque marché dispose d'un pool de collatéralisation unique (cahier des charges
§4). Le créer automatiquement à l'enregistrement garantit qu'aucun marché ne
peut exister sans son coffre — et donc sans sa garantie d'invariance.
"""
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Market, MarketPool


@receiver(post_save, sender=Market)
def ensure_market_pool(sender, instance, created, **kwargs):
    if created:
        MarketPool.objects.get_or_create(market=instance)
