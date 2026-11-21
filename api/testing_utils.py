"""Shared test helpers and fixtures for Kiln's test suite."""

from __future__ import annotations

import base64
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)

STANDARD_RECIPE_HTML = b"""<!doctype html>
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

SERIOUS_EATS_STYLE_HTML = b"""<!doctype html>
<html>
<head>
  <script type="application/ld+json">
  [
    {
      "@context": "http://schema.org",
      "@type": ["Recipe", "NewsArticle"],
      "name": "All-American Beef Stew",
      "description": "Hearty classic beef stew.",
      "image": {"@type": "ImageObject", "url": "/images/beef-stew.jpg"},
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


def start_fixture_server(
    routes: dict[str, tuple[int, str, bytes]],
    *,
    redirects: dict[str, tuple[int, str]] | None = None,
) -> tuple[HTTPServer, str]:
    """Start a lightweight local HTTP server for offline tests."""
    redirect_map = redirects or {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path in redirect_map:
                status, location = redirect_map[self.path]
                self.send_response(status)
                self.send_header("Location", location)
                self.end_headers()
                return

            status, content_type, body = routes.get(
                self.path, (404, "text/plain", b"not found")
            )
            self.send_response(status)
            self.send_header("Content-Type", content_type)
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
