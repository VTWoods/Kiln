import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0005_pantry_staples"),
    ]

    operations = [
        migrations.CreateModel(
            name="MealPlanEntry",
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
                ("date", models.DateField(db_index=True)),
                ("notes", models.TextField(blank=True, default="")),
                ("sort_order", models.IntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "recipe",
                    models.ForeignKey(
                        db_column="recipe_id",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="meal_plan_entries",
                        to="api.recipe",
                    ),
                ),
            ],
            options={
                "db_table": "meal_plan_entries",
                "ordering": ["date", "sort_order", "id"],
            },
        ),
    ]
