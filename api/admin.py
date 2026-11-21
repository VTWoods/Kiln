from django.contrib import admin

from .models import Recipe, RecipeIngredient, ShoppingList, ShoppingListItem


class RecipeIngredientInline(admin.TabularInline):
    model = RecipeIngredient
    extra = 0


@admin.register(Recipe)
class RecipeAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "servings", "prep_minutes", "cook_minutes", "created_at")
    search_fields = ("title", "description", "source_url")
    inlines = [RecipeIngredientInline]


class ShoppingListItemInline(admin.TabularInline):
    model = ShoppingListItem
    extra = 0


@admin.register(ShoppingList)
class ShoppingListAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "created_at", "updated_at")
    search_fields = ("name",)
    inlines = [ShoppingListItemInline]
