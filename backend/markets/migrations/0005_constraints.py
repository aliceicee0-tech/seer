# Generated manually for faille B3 — contraintes CHECK d'intégrité financière.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('markets', '0004_alter_order_price_alter_position_avg_buy_price_and_more'),
    ]

    operations = [
        # --- MarketPool : escrow jamais négatif ---
        migrations.AddConstraint(
            model_name='marketpool',
            constraint=models.CheckConstraint(
                condition=models.Q(escrow_balance__gte=0),
                name='marketpool_escrow_nonneg',
            ),
        ),
        # --- Position : quantités non-négatives, locked <= quantity ---
        migrations.AddConstraint(
            model_name='position',
            constraint=models.CheckConstraint(
                condition=models.Q(quantity__gte=0),
                name='position_quantity_nonneg',
            ),
        ),
        migrations.AddConstraint(
            model_name='position',
            constraint=models.CheckConstraint(
                condition=models.Q(locked_quantity__gte=0),
                name='position_locked_nonneg',
            ),
        ),
        migrations.AddConstraint(
            model_name='position',
            constraint=models.CheckConstraint(
                condition=models.Q(locked_quantity__lte=models.F('quantity')),
                name='position_locked_lte_quantity',
            ),
        ),
        # --- Order : quantité > 0, filled dans [0, quantity] ---
        migrations.AddConstraint(
            model_name='order',
            constraint=models.CheckConstraint(
                condition=models.Q(quantity__gt=0),
                name='order_quantity_positive',
            ),
        ),
        migrations.AddConstraint(
            model_name='order',
            constraint=models.CheckConstraint(
                condition=models.Q(filled_quantity__gte=0),
                name='order_filled_nonneg',
            ),
        ),
        migrations.AddConstraint(
            model_name='order',
            constraint=models.CheckConstraint(
                condition=models.Q(filled_quantity__lte=models.F('quantity')),
                name='order_filled_lte_quantity',
            ),
        ),
    ]
