from __future__ import annotations

from django.test import TestCase

from api.models import Recipe, RecipeIngredient, ShoppingList, ShoppingListItem


class RecipeModelTests(TestCase):
    def test_recipe_str_and_ingredient_ordering_and_cascade(self) -> None:
        recipe = Recipe.objects.create(title="Tomato Soup", servings=4)
        second = RecipeIngredient.objects.create(
            recipe=recipe, name="garlic", quantity="3", unit="cloves", sort_order=1
        )
        first = RecipeIngredient.objects.create(
            recipe=recipe, name="tomatoes", quantity="2", unit="lbs", sort_order=0
        )

        self.assertEqual(str(recipe), "Tomato Soup")
        self.assertEqual(str(first), "2 lbs tomatoes")
        self.assertEqual(list(recipe.ingredients.all()), [first, second])

        recipe.delete()
        self.assertEqual(RecipeIngredient.objects.count(), 0)


class ShoppingListModelTests(TestCase):
    def test_item_ordering_and_recipe_delete_sets_null(self) -> None:
        recipe = Recipe.objects.create(title="Beef Stew")
        sl = ShoppingList.objects.create(name="11/21/2026")
        checked_item = ShoppingListItem.objects.create(
            shopping_list=sl, name="salt", checked=True
        )
        unchecked_item = ShoppingListItem.objects.create(
            shopping_list=sl,
            name="beef chuck",
            quantity="3",
            unit="lbs",
            checked=False,
            recipe=recipe,
        )

        self.assertEqual(str(sl), "11/21/2026")
        self.assertEqual(str(unchecked_item), "3 lbs beef chuck")
        # Unchecked items sort before checked items
        self.assertEqual(list(sl.items.all()), [unchecked_item, checked_item])

        # Deleting the recipe preserves the shopping list item with recipe=None
        recipe.delete()
        unchecked_item.refresh_from_db()
        self.assertIsNone(unchecked_item.recipe)

        # Deleting the shopping list cascades to its items
        sl.delete()
        self.assertEqual(ShoppingListItem.objects.count(), 0)
