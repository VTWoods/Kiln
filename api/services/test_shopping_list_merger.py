from __future__ import annotations

from django.test import TestCase

from api.models import Recipe, ShoppingList, ShoppingListItem
from api.services.shopping_list_merger import merge_shopping_list_items


class ShoppingListMergerTests(TestCase):
    def test_merges_same_and_compatible_us_units_across_recipes(self) -> None:
        sl = ShoppingList.objects.create(name="11/21/2026")
        r1 = Recipe.objects.create(title="Recipe 1")
        r2 = Recipe.objects.create(title="Recipe 2")

        merge_shopping_list_items(
            sl,
            [
                {"quantity": "2", "unit": "cloves", "name": "garlic", "recipe_id": r1.id},
                {"quantity": "8", "unit": "oz", "name": "butter", "recipe_id": r1.id},
                {"quantity": "1", "unit": "bunch", "name": "cilantro", "recipe_id": r1.id},
            ],
        )

        # Second recipe adds overlapping items (different case, compatible US mass, and incompatible unit)
        merge_shopping_list_items(
            sl,
            [
                {"quantity": "3", "unit": "clove", "name": "Garlic", "recipe_id": r2.id},
                {"quantity": "1", "unit": "pound", "name": "butter", "recipe_id": r2.id},
                {"quantity": "2", "unit": "tbsp", "name": "cilantro", "recipe_id": r2.id},
            ],
        )

        items = {
            (it.name.lower(), it.unit): it.quantity
            for it in ShoppingListItem.objects.filter(shopping_list=sl)
        }
        self.assertEqual(items[("garlic", "clove")], "5")
        self.assertEqual(items[("butter", "pound")], "1 1/2")
        # Incompatible cilantro units remain separate
        self.assertEqual(items[("cilantro", "bunch")], "1")
        self.assertEqual(items[("cilantro", "tablespoon")], "2")
        self.assertEqual(len(items), 4)

    def test_merges_duplicates_within_single_batch_and_skips_checked_items(self) -> None:
        sl = ShoppingList.objects.create(name="11/21/2026")
        ShoppingListItem.objects.create(
            shopping_list=sl,
            name="olive oil",
            quantity="2",
            unit="tablespoon",
            checked=True,
        )

        merge_shopping_list_items(
            sl,
            [
                {"quantity": "2", "unit": "tbsp", "name": "olive oil"},
                {"quantity": "2", "unit": "tablespoon", "name": "olive oil"},
            ],
        )

        checked = list(ShoppingListItem.objects.filter(shopping_list=sl, checked=True))
        unchecked = list(ShoppingListItem.objects.filter(shopping_list=sl, checked=False))
        self.assertEqual(len(checked), 1)
        self.assertEqual((checked[0].quantity, checked[0].unit), ("2", "tablespoon"))
        self.assertEqual(len(unchecked), 1)
        self.assertEqual((unchecked[0].quantity, unchecked[0].unit), ("1/4", "cup"))
