from __future__ import annotations

from django.test import SimpleTestCase

from api.services.ingredient_parser import clean_text, parse_ingredient


class IngredientParserTests(SimpleTestCase):
    def test_parse_ingredient_variants(self) -> None:
        cases = [
            ("2 cups all-purpose flour", "2", "cups", "all-purpose flour"),
            ("1½ tbsp olive oil", "1 1/2", "tbsp", "olive oil"),
            ("½ tsp kosher salt", "1/2", "tsp", "kosher salt"),
            ("2-3 cloves of garlic, minced", "2-3", "cloves", "garlic, minced"),
            ("8 fl oz chicken broth", "8", "fl oz", "chicken broth"),
            ("2 large eggs", "2", "", "large eggs"),
            (
                "Salt &amp; freshly cracked black pepper to taste",
                "",
                "",
                "Salt & freshly cracked black pepper to taste",
            ),
            ("   ", "", "", ""),
        ]
        for raw, qty, unit, name in cases:
            with self.subTest(raw=raw):
                got = parse_ingredient(raw)
                self.assertEqual((got.quantity, got.unit, got.name), (qty, unit, name))

    def test_clean_text_unescapes_and_normalizes_whitespace(self) -> None:
        self.assertEqual(clean_text("  Mac &amp;   Cheese \n "), "Mac & Cheese")
