# Generated manually for faille B3 — montants de dépôt/retrait strictement positifs.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0001_initial'),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='depositrequest',
            constraint=models.CheckConstraint(
                condition=models.Q(amount__gt=0),
                name='deposit_amount_positive',
            ),
        ),
        migrations.AddConstraint(
            model_name='withdrawrequest',
            constraint=models.CheckConstraint(
                condition=models.Q(amount__gt=0),
                name='withdraw_amount_positive',
            ),
        ),
    ]
