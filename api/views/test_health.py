from __future__ import annotations

from unittest.mock import patch

from django.test import Client, TestCase


class HealthViewTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()

    def test_health_returns_ok(self) -> None:
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            res.json(),
            {"status": "ok", "service": "kiln", "database": "ok"},
        )

    def test_health_returns_503_when_database_fails(self) -> None:
        with patch("api.views.health.connection.cursor", side_effect=RuntimeError("db down")):
            res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json()["status"], "degraded")
        self.assertEqual(res.json()["database"], "error")
