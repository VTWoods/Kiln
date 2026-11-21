from __future__ import annotations

from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from api.services.caster import (
    InvalidCastTargetError,
    PyChromecastCaster,
    resolve_cast_url,
)


class CasterServiceTests(SimpleTestCase):
    def test_resolve_cast_url(self) -> None:
        self.assertEqual(
            resolve_cast_url(
                "http://localhost:8090/api/cast/recipes/4/view", "", "10.0.0.176"
            ),
            "http://10.0.0.176:8090/api/cast/recipes/4/view",
        )
        self.assertEqual(
            resolve_cast_url(
                "http://192.168.1.25:8090/api/cast/recipes/4/view", "", "10.0.0.176"
            ),
            "http://192.168.1.25:8090/api/cast/recipes/4/view",
        )
        self.assertEqual(
            resolve_cast_url(
                "http://localhost:8090/api/cast/recipes/4/view",
                "https://kiln.home.arpa",
                "10.0.0.176",
            ),
            "https://kiln.home.arpa/api/cast/recipes/4/view",
        )
        with self.assertRaises(InvalidCastTargetError):
            resolve_cast_url("not-a-url", "", "10.0.0.176")

    def test_discover_sorts_displays_first_and_stops_browser(self) -> None:
        speaker = MagicMock(
            host="10.0.0.10",
            port=8009,
            uuid="speaker-1",
            friendly_name="Bedroom Speaker",
            model_name="Google Home Mini",
        )
        hub = MagicMock(
            host="10.0.0.20",
            port=8009,
            uuid="hub-1",
            friendly_name="Kitchen Hub",
            model_name="Google Nest Hub",
        )
        browser = MagicMock()

        with patch(
            "api.services.caster.pychromecast.discovery.discover_chromecasts",
            return_value=([speaker, hub], browser),
        ):
            devices = PyChromecastCaster().discover(timeout=1.0)

        self.assertEqual([d.name for d in devices], ["Kitchen Hub", "Bedroom Speaker"])
        browser.stop_discovery.assert_called_once()

    def test_cast_url_validates_host(self) -> None:
        caster = PyChromecastCaster()
        with self.assertRaises(InvalidCastTargetError):
            caster.cast_url("", 8009, "http://10.0.0.176:8090/api/cast/recipes/1/view")
        with self.assertRaises(InvalidCastTargetError):
            caster.stop("", 8009)
