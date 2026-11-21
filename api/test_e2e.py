"""End-to-end smoke tests for Kiln, organized by user-facing feature."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.test import Client, TestCase, override_settings

from api.services.caster import CastDevice, Caster
from api.services.fetcher import SafeFetcher
from api.services.images import ImageStore
from api.services.importer import RecipeScrapersImporter
from api.testing_utils import (
    PNG_1X1,
    SERIOUS_EATS_STYLE_HTML,
    STANDARD_RECIPE_HTML,
    start_fixture_server,
)


class _SmokeStubCaster(Caster):
    """Lightweight Nest Hub stub so cast smoke tests stay offline and deterministic."""

    def __init__(self) -> None:
        self.cast_calls: list[tuple[str, int, str]] = []
        self.stop_calls: list[tuple[str, int]] = []

    def discover(self, timeout: float = 3.0) -> list[CastDevice]:
        return [
            CastDevice(
                name="Kitchen Hub",
                model="Google Nest Hub",
                host="10.0.0.42",
                port=8009,
                uuid="kitchen-hub-1",
            )
        ]

    def cast_url(self, host: str, port: int, page_url: str) -> str:
        self.cast_calls.append((host, port, page_url))
        return page_url

    def stop(self, host: str, port: int) -> None:
        self.stop_calls.append((host, port))


class HealthAndFrontendSmokeTests(TestCase):
    """Smoke tests for app health and React SPA delivery."""

    def setUp(self) -> None:
        self.client = Client()

    def test_health_spa_and_api_404_smoke(self) -> None:
        health = self.client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(
            health.json(),
            {"status": "ok", "service": "kiln", "database": "ok"},
        )

        unknown = self.client.get("/api/nonexistent-endpoint")
        self.assertEqual(unknown.status_code, 404)
        self.assertIn("application/json", unknown["Content-Type"])

        with tempfile.TemporaryDirectory() as dist_dir:
            dist = Path(dist_dir)
            (dist / "index.html").write_text("<!doctype html><html><body>Kiln</body></html>")
            with override_settings(STATIC_DIST_DIR=dist):
                spa = self.client.get("/recipes")
                self.assertEqual(spa.status_code, 200)
                self.assertIn(b"Kiln", b"".join(spa.streaming_content))


class RecipeImportAndCollectionSmokeTests(TestCase):
    """Smoke tests for importing a recipe URL with recipe-scrapers, caching its photo, and managing it."""

    def setUp(self) -> None:
        self.client = Client()

    def test_import_preview_save_browse_and_delete_smoke(self) -> None:
        server, base = start_fixture_server(
            {
                "/all-american-beef-stew": (
                    200,
                    "text/html; charset=utf-8",
                    SERIOUS_EATS_STYLE_HTML,
                ),
                "/images/beef-stew.jpg": (200, "image/png", PNG_1X1),
            }
        )
        try:
            fetcher = SafeFetcher(allow_private_networks=True)
            real_importer = RecipeScrapersImporter(fetcher)

            with tempfile.TemporaryDirectory() as img_dir:
                store = ImageStore(img_dir, fetcher)
                with (
                    patch("api.views.recipes.get_importer", return_value=real_importer),
                    patch("api.views.recipes.get_image_store", return_value=store),
                ):
                    # 1. Preview import from URL via real recipe-scrapers
                    preview_res = self.client.post(
                        "/api/recipes/import-preview",
                        data=json.dumps({"url": f"{base}/all-american-beef-stew"}),
                        content_type="application/json",
                    )
                    self.assertEqual(preview_res.status_code, 200)
                    preview = preview_res.json()
                    self.assertEqual(preview["title"], "All-American Beef Stew")
                    self.assertEqual(preview["servings"], 6)
                    self.assertEqual(len(preview["ingredients"]), 2)
                    self.assertEqual(preview["ingredients"][0]["unit"], "pound")
                    self.assertIn("chunks", preview["ingredients"][0]["preparation"])
                    self.assertEqual(preview["image_url"], f"{base}/images/beef-stew.jpg")

                    # 2. Save previewed recipe (caches selected photo locally)
                    save_res = self.client.post(
                        "/api/recipes",
                        data=json.dumps(
                            {
                                "title": preview["title"],
                                "description": preview["description"],
                                "instructions": preview["instructions"],
                                "servings": preview["servings"],
                                "prep_minutes": preview["prep_minutes"],
                                "cook_minutes": preview["cook_minutes"],
                                "source_url": preview["source_url"],
                                "image_url": preview["image_url"],
                                "ingredients": preview["ingredients"],
                            }
                        ),
                        content_type="application/json",
                    )
                    self.assertEqual(save_res.status_code, 201)
                    saved = save_res.json()
                    self.assertTrue(saved["image_url"].startswith("/api/images/"))
                    self.assertEqual(saved["source_url"], f"{base}/all-american-beef-stew")

                    # 3. Verify cached photo is served locally
                    img_res = self.client.get(saved["image_url"])
                    self.assertEqual(img_res.status_code, 200)
                    self.assertEqual(b"".join(img_res.streaming_content), PNG_1X1)

                    # 4. Browse recipe list & detail
                    listed = self.client.get("/api/recipes").json()
                    self.assertEqual(len(listed), 1)
                    self.assertEqual(listed[0]["ingredient_count"], 2)

                    detail = self.client.get(f"/api/recipes/{saved['id']}").json()
                    self.assertEqual(detail["title"], "All-American Beef Stew")
                    self.assertEqual(len(detail["ingredients"]), 2)

                    # 5. Delete recipe and confirm local cached image is removed
                    del_res = self.client.delete(f"/api/recipes/{saved['id']}")
                    self.assertEqual(del_res.status_code, 204)
                    self.assertEqual(self.client.get(saved["image_url"]).status_code, 404)
        finally:
            server.shutdown()

    def test_bookmarklet_and_paste_html_import_smoke(self) -> None:
        # 1. Bookmarklet form POST with raw HTML (no server-side fetch needed!)
        bm_res = self.client.post(
            "/api/recipes/bookmarklet",
            data={
                "url": "https://www.seriouseats.com/all-american-beef-stew-recipe",
                "html": SERIOUS_EATS_STYLE_HTML.decode("utf-8"),
            },
        )
        self.assertEqual(bm_res.status_code, 303)
        self.assertIn("/recipes?import_draft=", bm_res["Location"])
        token = bm_res["Location"].split("import_draft=", 1)[1]

        draft = self.client.get(f"/api/recipes/import-draft/{token}")
        self.assertEqual(draft.status_code, 200)
        self.assertEqual(draft.json()["title"], "All-American Beef Stew")

        # 2. Direct Paste HTML via import-preview JSON endpoint
        paste_res = self.client.post(
            "/api/recipes/import-preview",
            data=json.dumps(
                {
                    "url": "https://www.seriouseats.com/all-american-beef-stew-recipe",
                    "html": SERIOUS_EATS_STYLE_HTML.decode("utf-8"),
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(paste_res.status_code, 200)
        self.assertEqual(paste_res.json()["title"], "All-American Beef Stew")


class ShoppingListSmokeTests(TestCase):
    """Smoke tests for creating a shopping list, adding filtered recipe ingredients, and checking items off."""

    def setUp(self) -> None:
        self.client = Client()

    def test_add_filtered_recipe_ingredients_and_shop_smoke(self) -> None:
        # 1. Create a recipe with multiple ingredients
        recipe_res = self.client.post(
            "/api/recipes",
            data=json.dumps(
                {
                    "title": "Garlic Butter Pasta",
                    "servings": 4,
                    "ingredients": [
                        {"quantity": "1", "unit": "lb", "name": "spaghetti"},
                        {"quantity": "4", "unit": "tbsp", "name": "unsalted butter"},
                        {"quantity": "", "unit": "", "name": "salt to taste"},
                    ],
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(recipe_res.status_code, 201)
        recipe = recipe_res.json()

        # 2. Create a date-named shopping list
        list_res = self.client.post(
            "/api/shopping-lists",
            data=json.dumps({"name": "11/21/2026"}),
            content_type="application/json",
        )
        self.assertEqual(list_res.status_code, 201)
        list_id = list_res.json()["id"]

        # 3. User removes "salt to taste" (already has it) and adds the remaining 2 ingredients
        remaining = [
            {
                "quantity": ing["quantity"],
                "unit": ing["unit"],
                "name": ing["name"],
                "recipe_id": recipe["id"],
            }
            for ing in recipe["ingredients"]
            if ing["name"] != "salt to taste"
        ]
        add_res = self.client.post(
            f"/api/shopping-lists/{list_id}/items",
            data=json.dumps({"items": remaining}),
            content_type="application/json",
        )
        self.assertEqual(add_res.status_code, 201)
        added_items = add_res.json()["items"]
        self.assertEqual(len(added_items), 2)
        self.assertTrue(all(it["recipe_title"] == "Garlic Butter Pasta" for it in added_items))

        # 4. Adding a second recipe with overlapping ingredients automatically merges quantities
        merge_res = self.client.post(
            f"/api/shopping-lists/{list_id}/items",
            data=json.dumps(
                {
                    "items": [
                        {
                            "quantity": "1/2",
                            "unit": "pound",
                            "name": "spaghetti",
                            "recipe_id": recipe["id"],
                        }
                    ]
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(merge_res.status_code, 201)
        merged_items = merge_res.json()["items"]
        self.assertEqual(len(merged_items), 2)
        spaghetti = next(it for it in merged_items if it["name"] == "spaghetti")
        self.assertEqual((spaghetti["quantity"], spaghetti["unit"]), ("1 1/2", "pound"))

        # 5. Check off spaghetti while shopping and clear checked items
        check_res = self.client.patch(
            f"/api/shopping-lists/{list_id}/items/{spaghetti['id']}",
            data=json.dumps({"checked": True}),
            content_type="application/json",
        )
        self.assertEqual(check_res.status_code, 200)
        self.assertTrue(check_res.json()["checked"])

        clear_res = self.client.delete(f"/api/shopping-lists/{list_id}/checked")
        self.assertEqual(clear_res.status_code, 200)
        self.assertEqual([it["name"] for it in clear_res.json()["items"]], ["unsalted butter"])


class NestHubCastSmokeTests(TestCase):
    """Smoke tests for discovering a Nest Hub, casting recipe instructions, rendering Cook Mode, and stopping."""

    def setUp(self) -> None:
        self.client = Client()

    def test_discover_cast_render_cook_view_and_stop_smoke(self) -> None:
        server, base = start_fixture_server(
            {"/pasta": (200, "text/html; charset=utf-8", STANDARD_RECIPE_HTML)}
        )
        try:
            # Import & save a recipe to cast
            fetcher = SafeFetcher(allow_private_networks=True)
            with patch(
                "api.views.recipes.get_importer",
                return_value=RecipeScrapersImporter(fetcher),
            ):
                preview = self.client.post(
                    "/api/recipes/import-preview",
                    data=json.dumps({"url": f"{base}/pasta"}),
                    content_type="application/json",
                ).json()

            recipe = self.client.post(
                "/api/recipes",
                data=json.dumps(
                    {
                        "title": preview["title"],
                        "instructions": preview["instructions"],
                        "servings": preview["servings"],
                        "prep_minutes": preview["prep_minutes"],
                        "cook_minutes": preview["cook_minutes"],
                        "ingredients": preview["ingredients"],
                    }
                ),
                content_type="application/json",
            ).json()

            stub_caster = _SmokeStubCaster()
            with patch("api.views.cast.get_caster", return_value=stub_caster):
                # 1. Discover Nest Hub
                devices = self.client.get("/api/cast/devices").json()["devices"]
                self.assertEqual(len(devices), 1)
                hub = devices[0]

                # 2. Cast recipe to Nest Hub
                cast_res = self.client.post(
                    f"/api/cast/recipes/{recipe['id']}",
                    data=json.dumps(
                        {
                            "host": hub["host"],
                            "port": hub["port"],
                            "base_url": "http://10.0.0.176:8090",
                        }
                    ),
                    content_type="application/json",
                )
                self.assertEqual(cast_res.status_code, 200)
                cast_url = cast_res.json()["url"]
                self.assertTrue(cast_url.endswith(f"/api/cast/recipes/{recipe['id']}/view"))

                # 3. Verify Nest Hub Cook Mode view renders instructions + touch-safe keep-alive
                view_res = self.client.get(f"/api/cast/recipes/{recipe['id']}/view")
                self.assertEqual(view_res.status_code, 200)
                html = view_res.content.decode("utf-8")
                self.assertIn("Garlic Butter Pasta", html)
                self.assertIn("Boil salted water", html)
                self.assertIn("/api/cast/silence.wav", html)
                self.assertNotIn("cast_receiver_framework.js", html)

                # 4. Verify keep-alive silence audio endpoint responds cleanly
                wav_res = self.client.get("/api/cast/silence.wav")
                self.assertEqual(wav_res.status_code, 200)
                self.assertEqual(wav_res["Content-Type"], "audio/wav")

                # 5. Stop casting
                stop_res = self.client.post(
                    "/api/cast/stop",
                    data=json.dumps({"host": hub["host"], "port": hub["port"]}),
                    content_type="application/json",
                )
                self.assertEqual(stop_res.status_code, 200)
                self.assertEqual(stub_caster.stop_calls, [(hub["host"], hub["port"])])
        finally:
            server.shutdown()
