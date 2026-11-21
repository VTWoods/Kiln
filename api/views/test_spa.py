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

            with override_settings(STATIC_DIST_DIR=root):
                r_root = self.client.get("/")
                self.assertEqual(r_root.status_code, 200)
                self.assertIn(b"Kiln SPA", b"".join(r_root.streaming_content))

                r_asset = self.client.get("/assets/app.js")
                self.assertEqual(r_asset.status_code, 200)
                self.assertIn(b"console.log('kiln');", b"".join(r_asset.streaming_content))

                r_route = self.client.get("/recipes/123/cook")
                self.assertEqual(r_route.status_code, 200)
                self.assertIn(b"Kiln SPA", b"".join(r_route.streaming_content))

    def test_missing_frontend_build_returns_503(self) -> None:
        with tempfile.TemporaryDirectory() as empty_dir:
            with override_settings(STATIC_DIST_DIR=Path(empty_dir)):
                res = self.client.get("/")
                self.assertEqual(res.status_code, 503)
