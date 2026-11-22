from __future__ import annotations

from unittest import mock

from curl_cffi import requests as cffi_requests
from curl_cffi.const import CurlOpt
from django.test import SimpleTestCase

from api.services.fetcher import (
    FetchFailedError,
    InvalidURLError,
    SafeFetcher,
    _resolve_pin,
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

    def test_pins_connection_to_validated_ip(self) -> None:
        """DNS-rebinding guard: libcurl must connect to the IP we validated."""
        public_ip = "93.184.216.34"
        fake_resp = mock.MagicMock(status_code=200, headers={"Content-Type": "text/html"})
        fake_resp.iter_content.return_value = [b"ok"]
        with mock.patch(
            "api.services.fetcher.socket.getaddrinfo",
            return_value=[(None, None, None, "", (public_ip, 0))],
        ), mock.patch("api.services.fetcher.cffi_requests.Session") as session_cls:
            session_cls.return_value.get.return_value = fake_resp
            res = SafeFetcher().fetch("https://recipes.example.com/pie")

        self.assertEqual(res.body, b"ok")
        session_cls.assert_called_once_with(
            curl_options={CurlOpt.RESOLVE: [f"recipes.example.com:443:{public_ip}"]}
        )
        _, kwargs = session_cls.return_value.get.call_args
        self.assertNotIn("impersonate", kwargs)

    def test_resolve_pin_formats_ipv6(self) -> None:
        self.assertEqual(
            _resolve_pin("example.com", 8443, "2001:db8::1"),
            "example.com:8443:[2001:db8::1]",
        )

    def test_redirect_to_private_host_is_blocked(self) -> None:
        def fake_getaddrinfo(host, *_args, **_kwargs):
            ip = "10.0.0.5" if host == "internal.example.com" else "93.184.216.34"
            return [(None, None, None, "", (ip, 0))]

        redirect = mock.MagicMock(
            status_code=302, headers={"Location": "http://internal.example.com/admin"}
        )
        with mock.patch(
            "api.services.fetcher.socket.getaddrinfo", side_effect=fake_getaddrinfo
        ), mock.patch("api.services.fetcher.cffi_requests.Session") as session_cls:
            session_cls.return_value.get.return_value = redirect
            with self.assertRaises(InvalidURLError):
                SafeFetcher().fetch("https://public.example.com/start")
        self.assertEqual(session_cls.return_value.get.call_count, 1)

    def test_transport_errors_become_fetch_failed(self) -> None:
        with mock.patch(
            "api.services.fetcher.socket.getaddrinfo",
            return_value=[(None, None, None, "", ("93.184.216.34", 0))],
        ), mock.patch("api.services.fetcher.cffi_requests.Session") as session_cls:
            session_cls.return_value.get.side_effect = cffi_requests.RequestsError("boom")
            with self.assertRaises(FetchFailedError):
                SafeFetcher().fetch("https://recipes.example.com/pie")
