from __future__ import annotations

import json
from unittest.mock import patch

from django.test import Client, TestCase

from api.models import Recipe, RecipeIngredient
from api.services.caster import CastDevice, Caster


class _StubCaster(Caster):
    def __init__(self) -> None:
        self.last_host = ""
        self.last_url = ""
        self.stopped = False

    def discover(self, timeout: float = 3.0) -> list[CastDevice]:
        return [
            CastDevice(
                name="Kitchen Hub",
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


class CastViewTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()

    def test_discover_cast_and_stop_endpoints(self) -> None:
        recipe = Recipe.objects.create(
            title="Pancakes",
            instructions="Mix batter.\n\nCook on griddle.",
            servings=4,
            prep_minutes=10,
            cook_minutes=15,
        )
        RecipeIngredient.objects.create(
            recipe=recipe, name="flour", quantity="2", unit="cups", sort_order=0
        )

        stub = _StubCaster()
        with patch("api.views.cast.get_caster", return_value=stub):
            dev_res = self.client.get("/api/cast/devices")
            self.assertEqual(dev_res.status_code, 200)
            self.assertEqual(dev_res.json()["devices"][0]["name"], "Kitchen Hub")

            bad = self.client.post(
                f"/api/cast/recipes/{recipe.id}",
                data=json.dumps({"host": ""}),
                content_type="application/json",
            )
            self.assertEqual(bad.status_code, 400)

            cast_res = self.client.post(
                f"/api/cast/recipes/{recipe.id}",
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
                f"http://10.0.0.176:8090/api/cast/recipes/{recipe.id}/view",
            )

            stop_res = self.client.post(
                "/api/cast/stop",
                data=json.dumps({"host": "10.0.0.42", "port": 8009}),
                content_type="application/json",
            )
            self.assertEqual(stop_res.status_code, 200)
            self.assertTrue(stub.stopped)

    def test_cast_html_view_and_silence_wav(self) -> None:
        recipe = Recipe.objects.create(
            title="Omelette",
            instructions="Whisk eggs.\n\nFold in pan.",
            servings=2,
        )
        view_res = self.client.get(f"/api/cast/recipes/{recipe.id}/view")
        self.assertEqual(view_res.status_code, 200)
        body = view_res.content.decode("utf-8")
        self.assertIn("Omelette", body)
        self.assertIn("Whisk eggs.", body)
        self.assertIn("/api/cast/silence.wav", body)
        self.assertNotIn("cast_receiver_framework.js", body)

        self.assertEqual(self.client.get("/api/cast/recipes/9999/view").status_code, 404)

        wav_res = self.client.get("/api/cast/silence.wav")
        self.assertEqual(wav_res.status_code, 200)
        self.assertEqual(wav_res["Content-Type"], "audio/wav")
        self.assertTrue(wav_res.content.startswith(b"RIFF"))
