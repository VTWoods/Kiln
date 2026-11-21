from django.db import migrations, models

from api.services.aisle_categorizer import categorize_ingredient


def backfill_item_aisles(apps, schema_editor):
    ShoppingListItem = apps.get_model("api", "ShoppingListItem")
    dirty = []
    for item in ShoppingListItem.objects.filter(aisle=""):
        item.aisle = categorize_ingredient(item.name, unit=item.unit)
        dirty.append(item)
    if dirty:
        ShoppingListItem.objects.bulk_update(dirty, ["aisle"])


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0003_shoppinglistitem_recipes"),
    ]

    operations = [
        migrations.AddField(
            model_name="shoppinglistitem",
            name="aisle",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.CreateModel(
            name="IngredientAisleOverride",
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
                ("ingredient_key", models.TextField(unique=True)),
                ("aisle", models.TextField()),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "ingredient_aisle_overrides",
                "ordering": ["ingredient_key"],
            },
        ),
        migrations.RunPython(backfill_item_aisles, migrations.RunPython.noop),
    ]
