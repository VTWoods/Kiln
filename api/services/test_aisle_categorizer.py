from __future__ import annotations

from django.test import SimpleTestCase

from api.services.aisle_categorizer import (
    AISLES,
    categorize_ingredient,
    normalize_aisle,
)


class AisleCategorizerTests(SimpleTestCase):
    def test_state_and_herb_unit_rules(self) -> None:
        self.assertEqual(categorize_ingredient("frozen peas"), "Frozen")
        self.assertEqual(categorize_ingredient("frozen spinach", unit="ounce"), "Frozen")
        self.assertEqual(categorize_ingredient("canned tuna", unit="can"), "Canned & Broths")
        self.assertEqual(
            categorize_ingredient("oil-packed or salt-packed anchovy fillets"),
            "Canned & Broths",
        )
        # Fresh herbs vs dried herbs
        self.assertEqual(categorize_ingredient("fresh rosemary", unit="sprig"), "Produce")
        self.assertEqual(categorize_ingredient("thyme", unit="sprig"), "Produce")
        self.assertEqual(categorize_ingredient("dried thyme", unit="teaspoon"), "Spices & Seasonings")

    def test_phrase_precedence_and_lexicon_coverage(self) -> None:
        self.assertEqual(categorize_ingredient("carrots"), "Produce")
        self.assertEqual(categorize_ingredient("butternut squash"), "Produce")
        self.assertEqual(categorize_ingredient("red bell pepper"), "Produce")
        self.assertEqual(categorize_ingredient("chuck roast"), "Meat & Seafood")
        self.assertEqual(categorize_ingredient("unsalted butter"), "Dairy & Eggs")
        self.assertEqual(categorize_ingredient("peanut butter"), "Condiments & Oils")
        self.assertEqual(categorize_ingredient("olive oil"), "Condiments & Oils")
        self.assertEqual(categorize_ingredient("chicken stock"), "Canned & Broths")
        self.assertEqual(categorize_ingredient("kosher salt and black pepper"), "Spices & Seasonings")
        self.assertEqual(categorize_ingredient("all-purpose flour"), "Pantry & Baking")
        self.assertEqual(categorize_ingredient("powdered unflavored gelatin"), "Pantry & Baking")
        self.assertEqual(categorize_ingredient("sherry, dry vermouth, or red wine"), "Beverages")
        self.assertEqual(categorize_ingredient("sourdough bread"), "Bakery")

    def test_wordnet_fallback_and_non_food_other(self) -> None:
        # Uncommon foods not in curated lexicon fall back to WordNet hypernyms
        self.assertEqual(categorize_ingredient("salsify"), "Produce")
        self.assertEqual(categorize_ingredient("monkfish"), "Meat & Seafood")
        # Non-food household items fall back to Other
        self.assertEqual(categorize_ingredient("paper towels"), "Other")
        self.assertEqual(categorize_ingredient("aluminum foil"), "Other")

    def test_normalize_aisle_validates_and_canonicalizes(self) -> None:
        self.assertEqual(normalize_aisle("produce"), "Produce")
        self.assertEqual(normalize_aisle("  Meat & Seafood  "), "Meat & Seafood")
        self.assertIsNone(normalize_aisle("Not A Real Aisle"))
        self.assertIn("Produce", AISLES)
        self.assertIn("Other", AISLES)
