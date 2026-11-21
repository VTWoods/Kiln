from django.db import migrations, models

from api.services.pantry_staples import DEFAULT_PANTRY_STAPLES
from api.services.shopping_list_merger import ingredient_merge_key


def seed_default_pantry_staples(apps, schema_editor):
    PantryStaple = apps.get_model("api", "PantryStaple")
    seen: set[str] = set()
    rows = []
    for raw_name in DEFAULT_PANTRY_STAPLES:
        key = ingredient_merge_key(raw_name)
        if not key or key in seen:
            continue
        seen.add(key)
        rows.append(PantryStaple(name=raw_name, ingredient_key=key))
    if rows:
        PantryStaple.objects.bulk_create(rows, ignore_conflicts=True)


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0004_aisle_categorization"),
    ]

    operations = [
        migrations.CreateModel(
            name="PantryStaple",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("name", models.TextField()),
                ("ingredient_key", models.TextField(unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "db_table": "pantry_staples",
                "ordering": ["name", "id"],
            },
        ),
        migrations.RunPython(seed_default_pantry_staples, migrations.RunPython.noop),
    ]
