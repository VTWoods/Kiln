from __future__ import annotations

import json
import tempfile
from unittest.mock import patch

from django.test import Client, TestCase

from api.services.fetcher import (
    FetchFailedError,
    InvalidURLError,
    ParseFailedError,
    SafeFetcher,
)
from api.services.images import ImageStore
from api.services.import_drafts import draft_store
from api.services.importer import ImportedIngredient, ImportedRecipe, RecipeImporter
from api.testing_utils import PNG_1X1, start_fixture_server


class _StubImporter(RecipeImporter):
    def __init__(self, preview: ImportedRecipe | None = None, err: Exception | None = None) -> None:
        self._preview = preview
        self._err = err
        self.used_html = False

    def import_url(self, raw_url: str) -> ImportedRecipe:
        if self._err is not None:
            raise self._err
        assert self._preview is not None
        return self._preview

    def import_html(self, raw_url: str, html_bytes: bytes) -> ImportedRecipe:
        self.used_html = True
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

        # HTTP 403 returns blocked=True so UI offers Paste HTML / Bookmarklet
        with patch(
            "api.views.recipes.get_importer",
            return_value=_StubImporter(err=FetchFailedError("remote server returned HTTP 403")),
        ):
            blocked = self.client.post(
                "/api/recipes/import-preview",
                data=json.dumps({"url": "https://www.seriouseats.com/pot-roast"}),
                content_type="application/json",
            )
        self.assertEqual(blocked.status_code, 502)
        self.assertTrue(blocked.json().get("blocked"))

        # Client-supplied HTML routes through import_html
        html_stub = _StubImporter(preview=preview)
        with patch("api.views.recipes.get_importer", return_value=html_stub):
            html_res = self.client.post(
                "/api/recipes/import-preview",
                data=json.dumps({"url": "https://example.com/soup", "html": "<html>...</html>"}),
                content_type="application/json",
            )
        self.assertEqual(html_res.status_code, 200)
        self.assertTrue(html_stub.used_html)

    def test_bookmarklet_post_and_draft_retrieval(self) -> None:
        draft_store.clear()
        preview = ImportedRecipe(
            title="Perfect Pot Roast",
            description="",
            instructions="Braise.",
            servings=6,
            prep_minutes=15,
            cook_minutes=180,
            source_url="https://www.seriouseats.com/perfect-pot-roast-recipe-pioneer-woman",
            image_url="",
            candidate_images=[],
            ingredients=[],
        )
        with patch("api.views.recipes.get_importer", return_value=_StubImporter(preview=preview)):
            res = self.client.post(
                "/api/recipes/bookmarklet",
                data={
                    "url": "https://www.seriouseats.com/perfect-pot-roast-recipe-pioneer-woman",
                    "html": "<html><body>recipe</body></html>",
                },
            )
        self.assertEqual(res.status_code, 303)
        location = res["Location"]
        self.assertTrue(location.startswith("/recipes?import_draft="))
        token = location.split("import_draft=", 1)[1]

        draft_res = self.client.get(f"/api/recipes/import-draft/{token}")
        self.assertEqual(draft_res.status_code, 200)
        self.assertEqual(draft_res.json()["title"], "Perfect Pot Roast")

        self.assertEqual(self.client.get("/api/recipes/import-draft/doesnotexist").status_code, 404)

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
                                    {
                                        "quantity": "1",
                                        "unit": "pound",
                                        "name": "ground beef",
                                        "preparation": "browned",
                                    }
                                ],
                            }
                        ),
                        content_type="application/json",
                    )
                    self.assertEqual(c_res.status_code, 201)
                    created = c_res.json()
                    self.assertEqual(created["ingredients"][0]["preparation"], "browned")
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
                    self.assertEqual(
                        updated["ingredient_names"], ["ground beef", "cayenne"]
                    )

                    # List endpoint includes ingredient_names & ingredient_count for search
                    list_res = self.client.get("/api/recipes")
                    self.assertEqual(list_res.status_code, 200)
                    listed = list_res.json()
                    self.assertEqual(len(listed), 1)
                    self.assertEqual(listed[0]["ingredient_count"], 2)
                    self.assertEqual(
                        listed[0]["ingredient_names"], ["ground beef", "cayenne"]
                    )

                    # Delete removes recipe and remaining cached image
                    d_res = self.client.delete(f"/api/recipes/{created['id']}")
                    self.assertEqual(d_res.status_code, 204)
                    self.assertEqual(self.client.get(f"/api/recipes/{created['id']}").status_code, 404)
                    self.assertEqual(self.client.get(second_img).status_code, 404)
        finally:
            img_server.shutdown()
