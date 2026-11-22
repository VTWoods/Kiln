from __future__ import annotations

import tempfile

from django.test import SimpleTestCase

from api.services.fetcher import InvalidURLError, SafeFetcher
from api.services.images import (
    ImageStore,
    extract_candidate_images,
    is_local_image_url,
)
from api.testing_utils import PNG_1X1, STANDARD_RECIPE_HTML, start_fixture_server


class ImagesServiceTests(SimpleTestCase):
    def test_extract_candidate_images_ranks_resolves_and_filters_junk(self) -> None:
        base = "https://recipes.example.com/pasta"
        candidates = extract_candidate_images(
            base, STANDARD_RECIPE_HTML, primary_image="/images/hero-pasta.jpg"
        )
        self.assertEqual(candidates[0], "https://recipes.example.com/images/hero-pasta.jpg")
        self.assertEqual(
            candidates,
            [
                "https://recipes.example.com/images/hero-pasta.jpg",
                "https://recipes.example.com/images/plated-pasta.jpg",
                "https://recipes.example.com/images/og-pasta.jpg",
                "https://recipes.example.com/images/step-1.jpg",
            ],
        )

    def test_image_store_save_lookup_and_delete(self) -> None:
        server, base = start_fixture_server(
            {
                "/ok.png": (200, "image/png", PNG_1X1),
                "/text.txt": (200, "text/plain", b"not an image"),
            }
        )
        try:
            fetcher = SafeFetcher(allow_private_networks=True)
            with tempfile.TemporaryDirectory() as tmpdir:
                store = ImageStore(tmpdir, fetcher)

                local_url = store.save_from_url(f"{base}/ok.png", referer=base)
                self.assertTrue(is_local_image_url(local_url))
                self.assertTrue(local_url.endswith(".png"))

                filename = local_url.removeprefix("/api/images/")
                saved_path = store.file_path(filename)
                self.assertIsNotNone(saved_path)
                assert saved_path is not None
                self.assertTrue(saved_path.is_file())
                self.assertEqual(saved_path.read_bytes(), PNG_1X1)

                # Reject path traversal filenames
                self.assertIsNone(store.file_path("../secret.png"))
                self.assertIsNone(store.file_path("sub/img.png"))

                # Reject non-image content
                with self.assertRaises(InvalidURLError):
                    store.save_from_url(f"{base}/text.txt")

                store.delete_local(local_url)
                self.assertFalse(saved_path.exists())

                # Direct byte uploads (for manual recipe photos)
                uploaded_url = store.save_bytes(PNG_1X1, content_type="image/png")
                self.assertTrue(is_local_image_url(uploaded_url))
                self.assertTrue(uploaded_url.endswith(".png"))
                with self.assertRaises(InvalidURLError):
                    store.save_bytes(b"", content_type="image/png")
                with self.assertRaises(InvalidURLError):
                    store.save_bytes(b"plain text", content_type="text/plain")
                store.delete_local(uploaded_url)
        finally:
            server.shutdown()
