from __future__ import annotations

from django.test import SimpleTestCase

from api.services.pantry_staples import DEFAULT_PANTRY_STAPLES, is_ingredient_staple
from api.services.shopping_list_merger import ingredient_merge_key


class PantryStaplesServiceTests(SimpleTestCase):
    def setUp(self) -> None:
        self.keys = {ingredient_merge_key(name) for name in DEFAULT_PANTRY_STAPLES}

    def test_matches_default_staples_and_common_condiments(self) -> None:
        for name in (
            "water",
            "cold water",
            "boiling water",
            "kosher salt",
            "black pepper",
            "freshly ground black pepper",
            "kosher salt and black pepper",
            "olive oil",
            "vegetable oil",
            "soy sauce",
            "worcestershire sauce",
            "all-purpose flour",
            "bay leaves",
            "bay leaf",
            "dijon mustard",
            "apple cider vinegar",
        ):
            with self.subTest(name=name):
                self.assertTrue(is_ingredient_staple(name, staple_keys=self.keys))

    def test_does_not_match_produce_fresh_herbs_or_proteins(self) -> None:
        cases = [
            ("carrots", ""),
            ("chuck roast", "pound"),
            ("red bell pepper", ""),
            ("jalapeno pepper", ""),
            ("fresh rosemary", "sprig"),
            ("fresh thyme", ""),
            ("thyme", "sprig"),
            ("beef stock", "cup"),
            ("yukon gold potatoes", "pound"),
        ]
        for name, unit in cases:
            with self.subTest(name=name, unit=unit):
                self.assertFalse(
                    is_ingredient_staple(name, unit=unit, staple_keys=self.keys)
                )
