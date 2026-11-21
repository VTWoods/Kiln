from django.db import migrations, models


def backfill_item_recipes(apps, schema_editor):
    ShoppingListItem = apps.get_model("api", "ShoppingListItem")
    Through = ShoppingListItem.recipes.through
    links = [
        Through(shoppinglistitem_id=item.id, recipe_id=item.recipe_id)
        for item in ShoppingListItem.objects.filter(recipe_id__isnull=False).only(
            "id", "recipe_id"
        )
    ]
    if links:
        Through.objects.bulk_create(links, ignore_conflicts=True)


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0002_recipeingredient_preparation"),
    ]

    operations = [
        migrations.AddField(
            model_name="shoppinglistitem",
            name="recipes",
            field=models.ManyToManyField(
                blank=True,
                db_table="shopping_list_item_recipes",
                related_name="merged_shopping_list_items",
                to="api.recipe",
            ),
        ),
        migrations.RunPython(backfill_item_recipes, migrations.RunPython.noop),
    ]
