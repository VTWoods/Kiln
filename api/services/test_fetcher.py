from __future__ import annotations

from django.test import SimpleTestCase

from api.services.fetcher import (
    FetchFailedError,
    InvalidURLError,
    SafeFetcher,
    validate_http_url,
)
from api.testing_utils import start_fixture_server


class FetcherTests(SimpleTestCase):
    def test_validate_http_url(self) -> None:
        self.assertEqual(
            validate_http_url("  https://example.com/recipe "),
            "https://example.com/recipe",
        )
        for bad in ("", "   ", "ftp://example.com/a", "file:///etc/passwd", "not-a-url", "https://"):
            with self.subTest(url=bad):
                with self.assertRaises(InvalidURLError):
                    validate_http_url(bad)

    def test_blocks_ssrf_private_and_loopback_ips(self) -> None:
        fetcher = SafeFetcher()
        for blocked in (
            "http://127.0.0.1:8080/secret",
            "http://10.0.0.1/admin",
            "http://192.168.1.1/",
            "http://169.254.169.254/latest/meta-data/",
        ):
            with self.subTest(url=blocked):
                with self.assertRaises(InvalidURLError):
                    fetcher.fetch(blocked)

    def test_follows_redirects_and_enforces_size_and_status(self) -> None:
        server, base = start_fixture_server(
            {
                "/final": (200, "text/html", b"hello world"),
                "/big": (200, "text/plain", b"x" * 200),
                "/err": (500, "text/plain", b"boom"),
            },
            redirects={"/start": (302, "/final")},
        )
        try:
            fetcher = SafeFetcher(allow_private_networks=True)

            res = fetcher.fetch(f"{base}/start")
            self.assertEqual(res.body, b"hello world")
            self.assertEqual(res.final_url, f"{base}/final")

            with self.assertRaises(FetchFailedError):
                fetcher.fetch(f"{base}/big", max_bytes=50)

            with self.assertRaises(FetchFailedError):
                fetcher.fetch(f"{base}/err")
        finally:
            server.shutdown()
