from __future__ import annotations

import json
import tempfile
from unittest.mock import patch

from django.test import Client, TestCase

from api.services.fetcher import InvalidURLError, ParseFailedError, SafeFetcher
from api.services.images import ImageStore
from api.services.importer import ImportedIngredient, ImportedRecipe, RecipeImporter
from api.testing_utils import PNG_1X1, start_fixture_server


class _StubImporter(RecipeImporter):
    def __init__(self, preview: ImportedRecipe | None = None, err: Exception | None = None) -> None:
        self._preview = preview
        self._err = err

    def import_url(self, raw_url: str) -> ImportedRecipe:
        if self._err is not None:
            raise self._err
        assert self._preview is not None
        return self._preview


class RecipesViewTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()

    def test_import_preview_maps_success_and_error_codes(self) -> None:
        preview = ImportedRecipe(
            title="Tomato Soup",
            description="Cozy soup",
            instructions="Roast.\n\nBlend.",
            servings=4,
            prep_minutes=10,
            cook_minutes=30,
            source_url="https://example.com/soup",
            image_url="https://example.com/soup.jpg",
            candidate_images=["https://example.com/soup.jpg"],
            ingredients=[ImportedIngredient("2 lbs tomatoes", "2", "lbs", "tomatoes")],
        )
        with patch("api.views.recipes.get_importer", return_value=_StubImporter(preview=preview)):
            res = self.client.post(
                "/api/recipes/import-preview",
                data=json.dumps({"url": "https://example.com/soup"}),
                content_type="application/json",
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["title"], "Tomato Soup")

        with patch(
            "api.views.recipes.get_importer",
            return_value=_StubImporter(err=InvalidURLError("bad url")),
        ):
            bad = self.client.post(
                "/api/recipes/import-preview",
                data=json.dumps({"url": "ftp://bad"}),
                content_type="application/json",
            )
        self.assertEqual(bad.status_code, 400)

        with patch(
            "api.views.recipes.get_importer",
            return_value=_StubImporter(err=ParseFailedError("no schema")),
        ):
            unparsed = self.client.post(
                "/api/recipes/import-preview",
                data=json.dumps({"url": "https://example.com/blog"}),
                content_type="application/json",
            )
        self.assertEqual(unparsed.status_code, 422)

    def test_recipe_crud_and_local_image_lifecycle(self) -> None:
        img_server, base = start_fixture_server(
            {
                "/first.png": (200, "image/png", PNG_1X1),
                "/second.png": (200, "image/png", PNG_1X1),
            }
        )
        try:
            with tempfile.TemporaryDirectory() as img_dir:
                store = ImageStore(img_dir, SafeFetcher(allow_private_networks=True))
                with patch("api.views.recipes.get_image_store", return_value=store):
                    # Validation error when title missing
                    bad = self.client.post(
                        "/api/recipes",
                        data=json.dumps({"title": "   "}),
                        content_type="application/json",
                    )
                    self.assertEqual(bad.status_code, 400)

                    # Create with remote image -> downloaded & cached locally
                    c_res = self.client.post(
                        "/api/recipes",
                        data=json.dumps(
                            {
                                "title": "Chili",
                                "servings": 6,
                                "source_url": "https://example.com/chili",
                                "image_url": f"{base}/first.png",
                                "ingredients": [
                                    {"quantity": "1", "unit": "lb", "name": "ground beef"}
                                ],
                            }
                        ),
                        content_type="application/json",
                    )
                    self.assertEqual(c_res.status_code, 201)
                    created = c_res.json()
                    first_img = created["image_url"]
                    self.assertTrue(first_img.startswith("/api/images/"))
                    self.assertEqual(self.client.get(first_img).status_code, 200)

                    # Update replaces image and deletes old local file
                    u_res = self.client.put(
                        f"/api/recipes/{created['id']}",
                        data=json.dumps(
                            {
                                "title": "Spicy Chili",
                                "servings": 8,
                                "source_url": "https://example.com/chili",
                                "image_url": f"{base}/second.png",
                                "ingredients": [
                                    {"quantity": "2", "unit": "lbs", "name": "ground beef"},
                                    {"quantity": "1", "unit": "tsp", "name": "cayenne"},
                                ],
                            }
                        ),
                        content_type="application/json",
                    )
                    self.assertEqual(u_res.status_code, 200)
                    updated = u_res.json()
                    second_img = updated["image_url"]
                    self.assertNotEqual(first_img, second_img)
                    self.assertEqual(self.client.get(first_img).status_code, 404)
                    self.assertEqual(self.client.get(second_img).status_code, 200)
                    self.assertEqual(len(updated["ingredients"]), 2)

                    # Delete removes recipe and remaining cached image
                    d_res = self.client.delete(f"/api/recipes/{created['id']}")
                    self.assertEqual(d_res.status_code, 204)
                    self.assertEqual(self.client.get(f"/api/recipes/{created['id']}").status_code, 404)
                    self.assertEqual(self.client.get(second_img).status_code, 404)
        finally:
            img_server.shutdown()
