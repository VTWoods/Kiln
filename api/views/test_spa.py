from __future__ import annotations

import tempfile
from pathlib import Path

from django.test import Client, TestCase, override_settings


class SPAViewTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()

    def test_unknown_api_route_returns_json_404(self) -> None:
        res = self.client.get("/api/does-not-exist")
        self.assertEqual(res.status_code, 404)
        self.assertIn("application/json", res["Content-Type"])
        self.assertEqual(res.json(), {"error": "endpoint not found"})

    def test_serves_static_assets_and_spa_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "assets").mkdir()
            (root / "index.html").write_text("<!doctype html><html><body>Kiln SPA</body></html>")
            (root / "assets" / "app.js").write_text("console.log('kiln');")
            (root / "manifest.webmanifest").write_text('{"name":"Kiln"}')
            (root / "sw.js").write_text("// service worker")

            with override_settings(STATIC_DIST_DIR=root):
                r_root = self.client.get("/")
                self.assertEqual(r_root.status_code, 200)
                self.assertEqual(r_root["Cache-Control"], "no-cache")
                self.assertIn(b"Kiln SPA", b"".join(r_root.streaming_content))

                r_asset = self.client.get("/assets/app.js")
                self.assertEqual(r_asset.status_code, 200)
                self.assertIn("immutable", r_asset["Cache-Control"])
                self.assertIn(b"console.log('kiln');", b"".join(r_asset.streaming_content))

                r_manifest = self.client.get("/manifest.webmanifest")
                self.assertEqual(r_manifest.status_code, 200)
                self.assertIn("application/manifest+json", r_manifest["Content-Type"])
                self.assertEqual(r_manifest["Cache-Control"], "no-cache")

                r_sw = self.client.get("/sw.js")
                self.assertEqual(r_sw.status_code, 200)
                self.assertEqual(r_sw["Cache-Control"], "no-cache")

                r_route = self.client.get("/recipes/123/cook")
                self.assertEqual(r_route.status_code, 200)
                self.assertEqual(r_route["Cache-Control"], "no-cache")
                self.assertIn(b"Kiln SPA", b"".join(r_route.streaming_content))

    def test_missing_frontend_build_returns_503(self) -> None:
        with tempfile.TemporaryDirectory() as empty_dir:
            with override_settings(STATIC_DIST_DIR=Path(empty_dir)):
                res = self.client.get("/")
                self.assertEqual(res.status_code, 503)
