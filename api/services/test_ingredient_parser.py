from __future__ import annotations

from django.test import SimpleTestCase

from api.services.ingredient_parser import clean_text, parse_ingredient


class IngredientParserTests(SimpleTestCase):
    def test_normalizes_us_units_and_extracts_preparation(self) -> None:
        stew_beef = parse_ingredient(
            "3 pounds boneless beef chuck, cut into 2-inch chunks, trimmed"
        )
        self.assertEqual(stew_beef.quantity, "3")
        self.assertEqual(stew_beef.unit, "pound")
        self.assertEqual(stew_beef.name, "boneless beef chuck")
        self.assertIn("chunks", stew_beef.preparation)
        self.assertIn("trimmed", stew_beef.preparation)

        butter = parse_ingredient("1½ tbsp. unsalted butter, softened")
        self.assertEqual((butter.quantity, butter.unit, butter.name), ("1 1/2", "tablespoon", "unsalted butter"))
        self.assertEqual(butter.preparation, "softened")

        garlic = parse_ingredient("2-3 cloves of garlic, finely minced")
        self.assertEqual((garlic.quantity, garlic.unit, garlic.name), ("2-3", "clove", "garlic"))
        self.assertEqual(garlic.preparation, "finely minced")

        broth = parse_ingredient("8 fl oz chicken broth")
        self.assertEqual((broth.quantity, broth.unit, broth.name), ("8", "fluid ounce", "chicken broth"))

        eggs = parse_ingredient("2 large eggs")
        self.assertEqual((eggs.quantity, eggs.unit, eggs.name), ("2", "", "eggs"))
        self.assertEqual(eggs.preparation, "large")

    def test_converts_metric_to_us_customary_and_handles_dual_and_compound(self) -> None:
        flour = parse_ingredient("500 g all-purpose flour")
        self.assertEqual(flour.unit, "pound")
        self.assertEqual(flour.quantity, "1.1")
        self.assertEqual(flour.name, "all-purpose flour")

        milk = parse_ingredient("250 ml whole milk")
        self.assertEqual(milk.unit, "cup")
        self.assertEqual(milk.quantity, "1.06")
        self.assertEqual(milk.name, "whole milk")

        # Dual metric + US listed -> prefers the US customary value directly
        cheese = parse_ingredient("200 g (7 oz) cheddar cheese, grated")
        self.assertEqual((cheese.quantity, cheese.unit, cheese.name), ("7", "ounce", "cheddar cheese"))
        self.assertEqual(cheese.preparation, "grated")

        # Compound container + singular weight -> multiplied into US ounces
        tomatoes = parse_ingredient("2 (14.5-ounce) cans diced tomatoes, drained")
        self.assertEqual((tomatoes.quantity, tomatoes.unit, tomatoes.name), ("29", "ounce", "diced tomatoes"))
        self.assertEqual(tomatoes.preparation, "drained")

    def test_handles_unitless_and_empty_lines(self) -> None:
        empty = parse_ingredient("   ")
        self.assertEqual((empty.quantity, empty.unit, empty.name, empty.preparation), ("", "", "", ""))

        seasoning = parse_ingredient("Salt &amp; freshly cracked black pepper to taste")
        self.assertEqual(seasoning.quantity, "")
        self.assertEqual(seasoning.unit, "")
        self.assertIn("salt", seasoning.name)
        self.assertIn("black pepper", seasoning.name)
        self.assertIn("to taste", seasoning.preparation)

    def test_clean_text_unescapes_and_normalizes_whitespace(self) -> None:
        self.assertEqual(clean_text("  Mac &amp;   Cheese \n "), "Mac & Cheese")
