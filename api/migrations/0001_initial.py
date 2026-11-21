# Initial migration matching Kiln's existing SQLite schema.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Recipe",
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
                ("title", models.TextField()),
                ("description", models.TextField(blank=True, default="")),
                ("instructions", models.TextField(blank=True, default="")),
                ("servings", models.IntegerField(default=1)),
                ("prep_minutes", models.IntegerField(default=0)),
                ("cook_minutes", models.IntegerField(default=0)),
                ("source_url", models.TextField(blank=True, default="")),
                ("image_url", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "recipes",
                "ordering": ["-created_at", "-id"],
            },
        ),
        migrations.CreateModel(
            name="ShoppingList",
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
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "shopping_lists",
                "ordering": ["created_at", "id"],
            },
        ),
        migrations.CreateModel(
            name="RecipeIngredient",
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
                ("quantity", models.TextField(blank=True, default="")),
                ("unit", models.TextField(blank=True, default="")),
                ("sort_order", models.IntegerField(default=0)),
                (
                    "recipe",
                    models.ForeignKey(
                        db_column="recipe_id",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="ingredients",
                        to="api.recipe",
                    ),
                ),
            ],
            options={
                "db_table": "recipe_ingredients",
                "ordering": ["sort_order", "id"],
            },
        ),
        migrations.CreateModel(
            name="ShoppingListItem",
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
                ("quantity", models.TextField(blank=True, default="")),
                ("unit", models.TextField(blank=True, default="")),
                ("checked", models.BooleanField(default=False)),
                (
                    "recipe",
                    models.ForeignKey(
                        blank=True,
                        db_column="recipe_id",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="shopping_list_items",
                        to="api.recipe",
                    ),
                ),
                (
                    "shopping_list",
                    models.ForeignKey(
                        db_column="shopping_list_id",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="items",
                        to="api.shoppinglist",
                    ),
                ),
            ],
            options={
                "db_table": "shopping_list_items",
                "ordering": ["checked", "id"],
            },
        ),
    ]
