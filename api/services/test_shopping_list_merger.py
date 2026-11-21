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
            (it.name.lower(), it.unit): it
            for it in ShoppingListItem.objects.filter(shopping_list=sl).prefetch_related("recipes")
        }
        self.assertEqual(items[("garlic", "clove")].quantity, "5")
        self.assertEqual(
            {r.id for r in items[("garlic", "clove")].recipes.all()},
            {r1.id, r2.id},
        )
        self.assertEqual(items[("butter", "pound")].quantity, "1 1/2")
        self.assertEqual(
            {r.id for r in items[("butter", "pound")].recipes.all()},
            {r1.id, r2.id},
        )
        # Incompatible cilantro units remain separate with their individual recipes
        self.assertEqual(items[("cilantro", "bunch")].quantity, "1")
        self.assertEqual(
            {r.id for r in items[("cilantro", "bunch")].recipes.all()},
            {r1.id},
        )
        self.assertEqual(items[("cilantro", "tablespoon")].quantity, "2")
        self.assertEqual(
            {r.id for r in items[("cilantro", "tablespoon")].recipes.all()},
            {r2.id},
        )
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

    def test_merges_singular_and_plural_ingredient_names_and_counts(self) -> None:
        sl = ShoppingList.objects.create(name="11/21/2026")
        merge_shopping_list_items(
            sl,
            [
                {"quantity": "6-8", "unit": "", "name": "carrots"},
                {"quantity": "1", "unit": "", "name": "bay leaf"},
            ],
        )
        merge_shopping_list_items(
            sl,
            [
                {"quantity": "4", "unit": "", "name": "carrot"},
                {"quantity": "2", "unit": "", "name": "bay leaves"},
            ],
        )

        items = {
            it.name.lower(): (it.quantity, it.unit)
            for it in ShoppingListItem.objects.filter(shopping_list=sl)
        }
        self.assertEqual(items["carrots"], ("10-12", ""))
        self.assertEqual(items["bay leaf"], ("3", ""))
        self.assertEqual(len(items), 2)
