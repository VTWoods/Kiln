from __future__ import annotations

import json

from django.test import Client, TestCase

from api.models import PantryStaple, Recipe, RecipeIngredient


class PantryStaplesViewTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()

    def test_pantry_staples_crud_toggle_and_recipe_serialization(self) -> None:
        # Default migration seeds pantry staples
        list_res = self.client.get("/api/pantry-staples")
        self.assertEqual(list_res.status_code, 200)
        seeded = list_res.json()
        self.assertGreater(len(seeded), 20)
        self.assertTrue(any(s["ingredient_key"] == "olive oil" for s in seeded))
        self.assertTrue(any(s["ingredient_key"] == "soy sauce" for s in seeded))

        # Validation on blank name
        bad = self.client.post(
            "/api/pantry-staples",
            data=json.dumps({"name": "   "}),
            content_type="application/json",
        )
        self.assertEqual(bad.status_code, 400)

        # Create custom staple (and verify idempotent second POST)
        create_res = self.client.post(
            "/api/pantry-staples",
            data=json.dumps({"name": "Unsalted Butter"}),
            content_type="application/json",
        )
        self.assertEqual(create_res.status_code, 201)
        staple_id = create_res.json()["id"]
        self.assertEqual(create_res.json()["ingredient_key"], "unsalted butter")

        dup_res = self.client.post(
            "/api/pantry-staples",
            data=json.dumps({"name": "unsalted butter"}),
            content_type="application/json",
        )
        self.assertEqual(dup_res.status_code, 200)
        self.assertEqual(dup_res.json()["id"], staple_id)

        # Recipe detail returns live is_pantry_staple flags
        recipe = Recipe.objects.create(title="Test Roast")
        RecipeIngredient.objects.create(
            recipe=recipe, name="olive oil", quantity="2", unit="tablespoon", sort_order=0
        )
        RecipeIngredient.objects.create(
            recipe=recipe, name="unsalted butter", quantity="1", unit="tablespoon", sort_order=1
        )
        RecipeIngredient.objects.create(
            recipe=recipe, name="carrots", quantity="4", unit="", sort_order=2
        )

        detail = self.client.get(f"/api/recipes/{recipe.id}").json()
        flags = {ing["name"]: ing["is_pantry_staple"] for ing in detail["ingredients"]}
        self.assertEqual(
            flags,
            {"olive oil": True, "unsalted butter": True, "carrots": False},
        )

        # Toggle removes an existing staple and adds a new one
        off_res = self.client.post(
            "/api/pantry-staples/toggle",
            data=json.dumps({"name": "unsalted butter"}),
            content_type="application/json",
        )
        self.assertEqual(off_res.status_code, 200)
        self.assertFalse(off_res.json()["is_pantry_staple"])

        on_res = self.client.post(
            "/api/pantry-staples/toggle",
            data=json.dumps({"name": "garlic"}),
            content_type="application/json",
        )
        self.assertEqual(on_res.status_code, 201)
        self.assertTrue(on_res.json()["is_pantry_staple"])
        garlic_id = on_res.json()["staple"]["id"]

        # Delete by ID
        self.assertEqual(
            self.client.delete(f"/api/pantry-staples/{garlic_id}").status_code, 204
        )
        self.assertEqual(
            self.client.delete(f"/api/pantry-staples/{garlic_id}").status_code, 404
        )
        self.assertFalse(PantryStaple.objects.filter(pk=garlic_id).exists())
