from __future__ import annotations

import base64
import json
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest.mock import patch

from django.test import Client, TestCase, override_settings

from api.models import Recipe
from api.services.caster import CastDevice, Caster, resolve_cast_url
from api.services.fetcher import InvalidURLError, ParseFailedError, SafeFetcher
from api.services.images import ImageStore
from api.services.importer import (
    ImportedIngredient,
    ImportedRecipe,
    RecipeImporter,
    RecipeScrapersImporter,
)
from api.services.ingredient_parser import parse_ingredient

PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def _start_fixture_server(routes: dict[str, tuple[int, str, bytes]]) -> tuple[HTTPServer, str]:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            status, ct, body = routes.get(self.path, (404, "text/plain", b"not found"))
            self.send_response(status)
            self.send_header("Content-Type", ct)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{port}"


class IngredientParserTests(TestCase):
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
        ]
        for raw, qty, unit, name in cases:
            with self.subTest(raw=raw):
                got = parse_ingredient(raw)
                self.assertEqual((got.quantity, got.unit, got.name), (qty, unit, name))


class ImporterAndImageStoreTests(TestCase):
    def test_recipe_scrapers_standard_and_serious_eats_jsonld(self) -> None:
        standard_html = b"""<!doctype html>
<html>
<head>
  <title>Garlic Butter Pasta</title>
  <meta property="og:image" content="/images/og-pasta.jpg" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Recipe",
    "name": "Garlic Butter Pasta",
    "description": "Quick &amp; cozy weeknight pasta.",
    "image": ["/images/hero-pasta.jpg", "/images/plated-pasta.jpg"],
    "recipeYield": "4 servings",
    "prepTime": "PT10M",
    "cookTime": "PT15M",
    "recipeIngredient": [
      "1 lb spaghetti",
      "4 tbsp unsalted butter",
      "4 cloves garlic, thinly sliced",
      "Salt to taste"
    ],
    "recipeInstructions": [
      {"@type": "HowToStep", "text": "Boil salted water and cook pasta until al dente."},
      {"@type": "HowToStep", "text": "Saute garlic in butter and toss with pasta."}
    ]
  }
  </script>
</head>
<body>
  <img src="/images/step-1.jpg" width="600" height="400" />
  <img src="/images/tiny-icon.png" width="24" height="24" />
  <img src="/images/site-logo.png" width="300" height="300" />
</body>
</html>"""

        serious_eats_html = b"""<!doctype html>
<html>
<head>
  <script type="application/ld+json">
  [
    {
      "@context": "http://schema.org",
      "@type": ["Recipe", "NewsArticle"],
      "name": "All-American Beef Stew",
      "description": "Hearty classic beef stew.",
      "image": {"@type": "ImageObject", "url": "https://example.com/beef-stew.jpg"},
      "recipeYield": ["6", "6 servings"],
      "prepTime": "PT30M",
      "cookTime": "PT180M",
      "recipeIngredient": [
        "3 pounds boneless beef chuck, cut into chunks",
        "2 cups low-sodium chicken stock"
      ],
      "recipeInstructions": [
        {"@type": "HowToStep", "text": "Brown the beef in batches."},
        {"@type": "HowToStep", "text": "Braise in the oven until tender."}
      ]
    }
  ]
  </script>
</head>
<body></body>
</html>"""

        server, base = _start_fixture_server(
            {
                "/garlic-pasta": (200, "text/html; charset=utf-8", standard_html),
                "/beef-stew": (200, "text/html; charset=utf-8", serious_eats_html),
                "/blog": (200, "text/html", b"<html><body><h1>Blog post</h1></body></html>"),
                "/ok.png": (200, "image/png", PNG_1X1),
                "/text.txt": (200, "text/plain", b"not an image"),
            }
        )
        try:
            fetcher = SafeFetcher(allow_private_networks=True)
            imp = RecipeScrapersImporter(fetcher)

            got = imp.import_url(f"{base}/garlic-pasta")
            self.assertEqual(got.title, "Garlic Butter Pasta")
            self.assertEqual(got.description, "Quick & cozy weeknight pasta.")
            self.assertEqual((got.servings, got.prep_minutes, got.cook_minutes), (4, 10, 15))
            self.assertEqual(len(got.ingredients), 4)
            self.assertEqual(
                (got.ingredients[0].quantity, got.ingredients[0].unit, got.ingredients[0].name),
                ("1", "lb", "spaghetti"),
            )
            self.assertIn("Boil salted water", got.instructions)
            self.assertEqual(len(got.candidate_images), 4)

            stew = imp.import_url(f"{base}/beef-stew")
            self.assertEqual(stew.title, "All-American Beef Stew")
            self.assertEqual((stew.servings, stew.prep_minutes, stew.cook_minutes), (6, 30, 180))
            self.assertEqual(stew.image_url, "https://example.com/beef-stew.jpg")

            with self.assertRaises(ParseFailedError):
                imp.import_url(f"{base}/blog")

            with tempfile.TemporaryDirectory() as tmpdir:
                store = ImageStore(tmpdir, fetcher)
                local_url = store.save_from_url(f"{base}/ok.png", referer=base)
                self.assertTrue(local_url.startswith("/api/images/"))
                self.assertTrue(local_url.endswith(".png"))

                filename = local_url.removeprefix("/api/images/")
                saved_path = store.file_path(filename)
                self.assertIsNotNone(saved_path)
                assert saved_path is not None
                self.assertTrue(saved_path.is_file())

                with self.assertRaises(InvalidURLError):
                    store.save_from_url(f"{base}/text.txt")

                store.delete_local(local_url)
                self.assertFalse(saved_path.exists())
        finally:
            server.shutdown()

    def test_safe_fetcher_blocks_ssrf_and_invalid_schemes(self) -> None:
        fetcher = SafeFetcher()
        with self.assertRaises(InvalidURLError):
            fetcher.fetch("file:///etc/passwd")
        with self.assertRaises(InvalidURLError):
            fetcher.fetch("http://127.0.0.1:8080/secret")


class HealthAndSPATests(TestCase):
    def setUp(self) -> None:
        self.client = Client()

    def test_health_and_unknown_api_404(self) -> None:
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            res.json(),
            {"status": "ok", "service": "kiln", "database": "ok"},
        )

        missing = self.client.get("/api/does-not-exist")
        self.assertEqual(missing.status_code, 404)
        self.assertIn("application/json", missing["Content-Type"])

    def test_static_and_spa_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "assets").mkdir()
            (root / "index.html").write_text("<!doctype html><html><body>Kiln SPA</body></html>")
            (root / "assets" / "app.js").write_text("console.log('kiln');")

            with override_settings(STATIC_DIST_DIR=root):
                r_root = self.client.get("/")
                self.assertEqual(r_root.status_code, 200)
                self.assertIn(b"Kiln SPA", b"".join(r_root.streaming_content))

                r_asset = self.client.get("/assets/app.js")
                self.assertEqual(r_asset.status_code, 200)
                self.assertIn(b"console.log('kiln');", b"".join(r_asset.streaming_content))

                r_spa = self.client.get("/shopping-lists/42")
                self.assertEqual(r_spa.status_code, 200)
                self.assertIn(b"Kiln SPA", b"".join(r_spa.streaming_content))


class StubImporter(RecipeImporter):
    def __init__(self, preview: ImportedRecipe) -> None:
        self._preview = preview

    def import_url(self, raw_url: str) -> ImportedRecipe:
        return self._preview


class StubCaster(Caster):
    def __init__(self) -> None:
        self.last_host = ""
        self.last_url = ""
        self.stopped = False

    def discover(self, timeout: float = 3.0) -> list[CastDevice]:
        return [
            CastDevice(
                name="Kitchen Display",
                model="Google Nest Hub",
                host="10.0.0.42",
                port=8009,
                uuid="hub-1",
            )
        ]

    def cast_url(self, host: str, port: int, page_url: str) -> str:
        self.last_host = host
        self.last_url = page_url
        return page_url

    def stop(self, host: str, port: int) -> None:
        self.last_host = host
        self.stopped = True


class RecipeShoppingListAndCastAPITests(TestCase):
    def setUp(self) -> None:
        self.client = Client()

    def test_recipe_import_preview_crud_and_local_image_cache(self) -> None:
        img_server, base = _start_fixture_server(
            {"/soup.png": (200, "image/png", PNG_1X1)}
        )
        try:
            preview = ImportedRecipe(
                title="Roasted Tomato Soup",
                description="Rich roasted tomato soup.",
                instructions="Roast tomatoes.\n\nBlend until smooth.",
                servings=4,
                prep_minutes=15,
                cook_minutes=40,
                source_url="https://example.com/tomato-soup",
                image_url=f"{base}/soup.png",
                candidate_images=[f"{base}/soup.png"],
                ingredients=[
                    ImportedIngredient("2 lbs tomatoes", "2", "lbs", "tomatoes"),
                    ImportedIngredient("3 cloves garlic", "3", "cloves", "garlic"),
                ],
            )
            with tempfile.TemporaryDirectory() as img_dir:
                test_store = ImageStore(
                    img_dir, SafeFetcher(allow_private_networks=True)
                )
                with (
                    patch("api.views.recipes.get_importer", return_value=StubImporter(preview)),
                    patch("api.views.recipes.get_image_store", return_value=test_store),
                ):
                    p_res = self.client.post(
                        "/api/recipes/import-preview",
                        data=json.dumps({"url": "https://example.com/tomato-soup"}),
                        content_type="application/json",
                    )
                    self.assertEqual(p_res.status_code, 200)
                    self.assertEqual(p_res.json()["title"], "Roasted Tomato Soup")

                    c_res = self.client.post(
                        "/api/recipes",
                        data=json.dumps(
                            {
                                "title": preview.title,
                                "description": preview.description,
                                "instructions": preview.instructions,
                                "servings": preview.servings,
                                "prep_minutes": preview.prep_minutes,
                                "cook_minutes": preview.cook_minutes,
                                "source_url": preview.source_url,
                                "image_url": f"{base}/soup.png",
                                "ingredients": [
                                    {"quantity": "2", "unit": "lbs", "name": "tomatoes"},
                                    {"quantity": "3", "unit": "cloves", "name": "garlic"},
                                ],
                            }
                        ),
                        content_type="application/json",
                    )
                    self.assertEqual(c_res.status_code, 201)
                    created = c_res.json()
                    self.assertTrue(created["image_url"].startswith("/api/images/"))
                    self.assertEqual(len(created["ingredients"]), 2)

                    img_res = self.client.get(created["image_url"])
                    self.assertEqual(img_res.status_code, 200)
                    self.assertEqual(b"".join(img_res.streaming_content), PNG_1X1)

                    list_res = self.client.get("/api/recipes")
                    self.assertEqual(list_res.status_code, 200)
                    self.assertEqual(len(list_res.json()), 1)

                    del_res = self.client.delete(f"/api/recipes/{created['id']}")
                    self.assertEqual(del_res.status_code, 204)

                    img_after = self.client.get(created["image_url"])
                    self.assertEqual(img_after.status_code, 404)
        finally:
            img_server.shutdown()

    def test_shopping_list_flow(self) -> None:
        r_res = self.client.post(
            "/api/recipes",
            data=json.dumps(
                {
                    "title": "Beef Stew",
                    "servings": 6,
                    "ingredients": [
                        {"quantity": "3", "unit": "lbs", "name": "beef chuck"}
                    ],
                }
            ),
            content_type="application/json",
        )
        recipe_id = r_res.json()["id"]

        l_res = self.client.post(
            "/api/shopping-lists",
            data=json.dumps({"name": "11/19/2026"}),
            content_type="application/json",
        )
        self.assertEqual(l_res.status_code, 201)
        list_id = l_res.json()["id"]

        add_res = self.client.post(
            f"/api/shopping-lists/{list_id}/items",
            data=json.dumps(
                {
                    "items": [
                        {
                            "quantity": "3",
                            "unit": "lbs",
                            "name": "beef chuck",
                            "recipe_id": recipe_id,
                        }
                    ]
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(add_res.status_code, 201)
        items = add_res.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["recipe_title"], "Beef Stew")

        patch_res = self.client.patch(
            f"/api/shopping-lists/{list_id}/items/{items[0]['id']}",
            data=json.dumps({"checked": True}),
            content_type="application/json",
        )
        self.assertEqual(patch_res.status_code, 200)
        self.assertTrue(patch_res.json()["checked"])

        clear_res = self.client.delete(f"/api/shopping-lists/{list_id}/checked")
        self.assertEqual(clear_res.status_code, 200)
        self.assertEqual(len(clear_res.json()["items"]), 0)

        del_res = self.client.delete(f"/api/shopping-lists/{list_id}")
        self.assertEqual(del_res.status_code, 204)

    def test_cast_routes_and_url_resolution(self) -> None:
        self.assertEqual(
            resolve_cast_url("http://localhost:8090/api/cast/recipes/1/view", "", "10.0.0.176"),
            "http://10.0.0.176:8090/api/cast/recipes/1/view",
        )
        self.assertEqual(
            resolve_cast_url(
                "http://localhost:8090/api/cast/recipes/1/view",
                "https://kiln.home.arpa",
                "10.0.0.176",
            ),
            "https://kiln.home.arpa/api/cast/recipes/1/view",
        )

        rec = Recipe.objects.create(
            title="Pancakes",
            instructions="Mix batter.\n\nCook on griddle.",
            servings=4,
        )
        stub = StubCaster()
        with patch("api.views.cast.get_caster", return_value=stub):
            dev_res = self.client.get("/api/cast/devices")
            self.assertEqual(dev_res.status_code, 200)
            self.assertEqual(len(dev_res.json()["devices"]), 1)

            cast_res = self.client.post(
                f"/api/cast/recipes/{rec.id}",
                data=json.dumps(
                    {
                        "host": "10.0.0.42",
                        "port": 8009,
                        "base_url": "http://10.0.0.176:8090",
                    }
                ),
                content_type="application/json",
            )
            self.assertEqual(cast_res.status_code, 200)
            self.assertEqual(
                stub.last_url,
                f"http://10.0.0.176:8090/api/cast/recipes/{rec.id}/view",
            )

            view_res = self.client.get(f"/api/cast/recipes/{rec.id}/view")
            self.assertEqual(view_res.status_code, 200)
            body = view_res.content.decode("utf-8")
            self.assertIn("Pancakes", body)
            self.assertIn("Mix batter.", body)
            self.assertIn("/api/cast/silence.wav", body)
            self.assertNotIn("cast_receiver_framework.js", body)

            wav_res = self.client.get("/api/cast/silence.wav")
            self.assertEqual(wav_res.status_code, 200)
            self.assertEqual(wav_res["Content-Type"], "audio/wav")
            self.assertTrue(wav_res.content.startswith(b"RIFF"))

            stop_res = self.client.post(
                "/api/cast/stop",
                data=json.dumps({"host": "10.0.0.42", "port": 8009}),
                content_type="application/json",
            )
            self.assertEqual(stop_res.status_code, 200)
            self.assertTrue(stub.stopped)
