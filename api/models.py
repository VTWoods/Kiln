from __future__ import annotations

from django.db import models


class Recipe(models.Model):
    title = models.TextField()
    description = models.TextField(blank=True, default="")
    instructions = models.TextField(blank=True, default="")
    servings = models.IntegerField(default=1)
    prep_minutes = models.IntegerField(default=0)
    cook_minutes = models.IntegerField(default=0)
    source_url = models.TextField(blank=True, default="")
    image_url = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "recipes"
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return self.title


class RecipeIngredient(models.Model):
    recipe = models.ForeignKey(
        Recipe,
        on_delete=models.CASCADE,
        related_name="ingredients",
        db_column="recipe_id",
    )
    name = models.TextField()
    quantity = models.TextField(blank=True, default="")
    unit = models.TextField(blank=True, default="")
    preparation = models.TextField(blank=True, default="")
    sort_order = models.IntegerField(default=0)

    class Meta:
        db_table = "recipe_ingredients"
        ordering = ["sort_order", "id"]

    def __str__(self) -> str:
        parts = [p for p in (self.quantity, self.unit, self.name) if p]
        return " ".join(parts)


class ShoppingList(models.Model):
    name = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "shopping_lists"
        ordering = ["created_at", "id"]

    def __str__(self) -> str:
        return self.name


class ShoppingListItem(models.Model):
    shopping_list = models.ForeignKey(
        ShoppingList,
        on_delete=models.CASCADE,
        related_name="items",
        db_column="shopping_list_id",
    )
    name = models.TextField()
    quantity = models.TextField(blank=True, default="")
    unit = models.TextField(blank=True, default="")
    aisle = models.TextField(blank=True, default="")
    checked = models.BooleanField(default=False)
    recipe = models.ForeignKey(
        Recipe,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="shopping_list_items",
        db_column="recipe_id",
    )
    recipes = models.ManyToManyField(
        Recipe,
        blank=True,
        related_name="merged_shopping_list_items",
        db_table="shopping_list_item_recipes",
    )

    class Meta:
        db_table = "shopping_list_items"
        ordering = ["checked", "id"]

    def __str__(self) -> str:
        parts = [p for p in (self.quantity, self.unit, self.name) if p]
        return " ".join(parts)


class IngredientAisleOverride(models.Model):
    """User-remembered grocery aisle overrides keyed by normalized ingredient name."""

    ingredient_key = models.TextField(unique=True)
    aisle = models.TextField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "ingredient_aisle_overrides"
        ordering = ["ingredient_key"]

    def __str__(self) -> str:
        return f"{self.ingredient_key} -> {self.aisle}"


class PantryStaple(models.Model):
    """Common household staples shown first & unchecked when adding recipes to a shopping list."""

    name = models.TextField()
    ingredient_key = models.TextField(unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "pantry_staples"
        ordering = ["name", "id"]

    def __str__(self) -> str:
        return self.name


class MealPlanEntry(models.Model):
    """A recipe scheduled on a specific calendar date in the weekly meal plan."""

    date = models.DateField(db_index=True)
    recipe = models.ForeignKey(
        Recipe,
        on_delete=models.CASCADE,
        related_name="meal_plan_entries",
        db_column="recipe_id",
    )
    notes = models.TextField(blank=True, default="")
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "meal_plan_entries"
        ordering = ["date", "sort_order", "id"]

    def __str__(self) -> str:
        return f"{self.date.isoformat()} - {self.recipe.title}"
