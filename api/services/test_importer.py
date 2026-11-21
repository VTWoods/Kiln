from __future__ import annotations

from django.test import SimpleTestCase

from api.services.fetcher import ParseFailedError, SafeFetcher
from api.services.importer import RecipeScrapersImporter
from api.testing_utils import (
    SERIOUS_EATS_STYLE_HTML,
    STANDARD_RECIPE_HTML,
    start_fixture_server,
)


class ImporterServiceTests(SimpleTestCase):
    def test_recipe_scrapers_extracts_standard_and_serious_eats_jsonld(self) -> None:
        server, base = start_fixture_server(
            {
                "/garlic-pasta": (200, "text/html; charset=utf-8", STANDARD_RECIPE_HTML),
                "/beef-stew": (200, "text/html; charset=utf-8", SERIOUS_EATS_STYLE_HTML),
                "/blog": (200, "text/html", b"<html><body><h1>Not a recipe</h1></body></html>"),
            }
        )
        try:
            imp = RecipeScrapersImporter(SafeFetcher(allow_private_networks=True))

            pasta = imp.import_url(f"{base}/garlic-pasta")
            self.assertEqual(pasta.title, "Garlic Butter Pasta")
            self.assertEqual(pasta.description, "Quick & cozy weeknight pasta.")
            self.assertEqual((pasta.servings, pasta.prep_minutes, pasta.cook_minutes), (4, 10, 15))
            self.assertEqual(len(pasta.ingredients), 4)
            self.assertEqual(
                (pasta.ingredients[0].quantity, pasta.ingredients[0].unit, pasta.ingredients[0].name),
                ("1", "lb", "spaghetti"),
            )
            self.assertIn("Boil salted water", pasta.instructions)
            self.assertEqual(len(pasta.candidate_images), 4)

            stew = imp.import_url(f"{base}/beef-stew")
            self.assertEqual(stew.title, "All-American Beef Stew")
            self.assertEqual((stew.servings, stew.prep_minutes, stew.cook_minutes), (6, 30, 180))
            self.assertEqual(stew.image_url, f"{base}/images/beef-stew.jpg")

            with self.assertRaises(ParseFailedError):
                imp.import_url(f"{base}/blog")
        finally:
            server.shutdown()
