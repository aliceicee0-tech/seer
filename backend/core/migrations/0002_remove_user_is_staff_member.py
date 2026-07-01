# Generated manually — suppression du champ `is_staff_member` (mort/redondant).
# L'accès admin se base sur `is_staff` (Django natif) via User.is_platform_admin.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0001_initial'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='user',
            name='is_staff_member',
        ),
    ]
