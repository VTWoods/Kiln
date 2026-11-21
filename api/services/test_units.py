from __future__ import annotations

from django.test import SimpleTestCase

from api.services.units import (
    format_quantity,
    normalize_unit_name,
    parse_quantity_range,
    to_us_customary,
    try_merge_quantities,
)


class UnitsServiceTests(SimpleTestCase):
    def test_normalize_unit_name_to_full_singular(self) -> None:
        cases = {
            "tbsp.": "tablespoon",
            "tablespoons": "tablespoon",
            "tsp": "teaspoon",
            "lbs": "pound",
            "pounds": "pound",
            "oz.": "ounce",
            "fl oz": "fluid ounce",
            "fluid_ounce": "fluid ounce",
            "cups": "cup",
            "cloves": "clove",
            "cans": "can",
            "leaves": "leaf",
            "loaves": "loaf",
            "pinches": "pinch",
            "pinch": "pinch",
            "dimensionless": "",
            "": "",
        }
        for raw, want in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(normalize_unit_name(raw), want)

    def test_metric_to_us_customary_conversion(self) -> None:
        # 500 g -> ~1.1 pound
        low, high, unit = to_us_customary(500, 500, "gram")
        self.assertEqual(unit, "pound")
        self.assertAlmostEqual(low, 1.1023, places=3)
        self.assertEqual(low, high)

        # 100 g -> ~3.53 ounce
        low, _, unit = to_us_customary(100, 100, "g")
        self.assertEqual(unit, "ounce")
        self.assertAlmostEqual(low, 3.5274, places=3)

        # 250 ml -> ~1.06 cup
        low, _, unit = to_us_customary(250, 250, "ml")
        self.assertEqual(unit, "cup")
        self.assertAlmostEqual(low, 1.0567, places=3)

        # 15 ml -> ~1.01 tablespoon
        low, _, unit = to_us_customary(15, 15, "ml")
        self.assertEqual(unit, "tablespoon")
        self.assertAlmostEqual(low, 1.0144, places=3)

        # 5 ml -> ~1.01 teaspoon
        low, _, unit = to_us_customary(5, 5, "ml")
        self.assertEqual(unit, "teaspoon")
        self.assertAlmostEqual(low, 1.0144, places=3)

        # 2 L -> ~2.11 quart
        low, _, unit = to_us_customary(2, 2, "liter")
        self.assertEqual(unit, "quart")
        self.assertAlmostEqual(low, 2.1134, places=3)

    def test_parse_and_format_quantities(self) -> None:
        self.assertEqual(parse_quantity_range("1 1/2"), (1.5, 1.5))
        self.assertEqual(parse_quantity_range("2-3"), (2.0, 3.0))
        self.assertEqual(parse_quantity_range("1½"), (1.5, 1.5))
        self.assertEqual(format_quantity(1.5), "1 1/2")
        self.assertEqual(format_quantity(0.25), "1/4")
        self.assertEqual(format_quantity(3.0), "3")
        self.assertEqual(format_quantity(1.1023), "1.1")

    def test_try_merge_quantities(self) -> None:
        # Identical discrete unit
        self.assertEqual(
            try_merge_quantities("2", "clove", "3", "cloves"),
            ("5", "clove"),
        )
        # Compatible mass units: 8 ounce + 1 pound -> 1 1/2 pound
        self.assertEqual(
            try_merge_quantities("8", "ounce", "1", "pound"),
            ("1 1/2", "pound"),
        )
        # Compatible volume units: 2 tablespoon + 2 tablespoon -> 1/4 cup
        self.assertEqual(
            try_merge_quantities("2", "tablespoon", "2", "tablespoon"),
            ("1/4", "cup"),
        )
        # Unitless counts: 2 + 3 -> 5
        self.assertEqual(
            try_merge_quantities("2", "", "3", ""),
            ("5", ""),
        )
        # Both empty -> deduplicate
        self.assertEqual(
            try_merge_quantities("", "", "", ""),
            ("", ""),
        )
        # Incompatible units -> None (do not merge)
        self.assertIsNone(try_merge_quantities("1", "bunch", "2", "tablespoon"))
