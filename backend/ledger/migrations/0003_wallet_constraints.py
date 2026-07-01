# Generated manually for faille B3 — contraintes CHECK de non-négativité.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('ledger', '0002_alter_ledgerentry_type'),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='wallet',
            constraint=models.CheckConstraint(
                condition=models.Q(balance__gte=0),
                name='wallet_balance_nonneg',
            ),
        ),
        migrations.AddConstraint(
            model_name='wallet',
            constraint=models.CheckConstraint(
                condition=models.Q(locked_balance__gte=0),
                name='wallet_locked_balance_nonneg',
            ),
        ),
    ]
