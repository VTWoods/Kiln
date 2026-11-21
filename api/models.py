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
    checked = models.BooleanField(default=False)
    recipe = models.ForeignKey(
        Recipe,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="shopping_list_items",
        db_column="recipe_id",
    )

    class Meta:
        db_table = "shopping_list_items"
        ordering = ["checked", "id"]

    def __str__(self) -> str:
        parts = [p for p in (self.quantity, self.unit, self.name) if p]
        return " ".join(parts)
