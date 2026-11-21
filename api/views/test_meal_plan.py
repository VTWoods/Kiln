from __future__ import annotations

import json
from datetime import date, timedelta

from django.test import Client, TestCase
from django.utils import timezone

from api.models import MealPlanEntry, Recipe, RecipeIngredient


class MealPlanViewTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()

    def test_meal_plan_week_defaults_to_next_monday_and_crud_lifecycle(self) -> None:
        # Default GET returns next week's Monday -> Sunday
        default_res = self.client.get("/api/meal-plan")
        self.assertEqual(default_res.status_code, 200)
        body = default_res.json()
        ws = date.fromisoformat(body["week_start"])
        we = date.fromisoformat(body["week_end"])
        today = timezone.localdate()
        expected_monday = today - timedelta(days=today.weekday()) + timedelta(days=7)
        self.assertEqual(ws, expected_monday)
        self.assertEqual(ws.weekday(), 0)  # Monday
        self.assertEqual(we, expected_monday + timedelta(days=6))
        self.assertEqual(we.weekday(), 6)  # Sunday
        self.assertEqual(body["entries"], [])

        # Validation on bad query or POST payload
        self.assertEqual(
            self.client.get("/api/meal-plan?week_start=not-a-date").status_code, 400
        )
        self.assertEqual(
            self.client.post(
                "/api/meal-plan/entries",
                data=json.dumps({"recipe_id": 9999, "date": "2026-11-23"}),
                content_type="application/json",
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.post(
                "/api/meal-plan/entries",
                data=json.dumps({"recipe_id": 1, "date": "bad"}),
                content_type="application/json",
            ).status_code,
            400,
        )

        # Create two recipes with overlapping ingredients and pantry staples
        stew = Recipe.objects.create(title="Beef Stew", servings=4)
        RecipeIngredient.objects.create(
            recipe=stew, name="carrots", quantity="4", unit="", sort_order=0
        )
        RecipeIngredient.objects.create(
            recipe=stew, name="olive oil", quantity="2", unit="tablespoon", sort_order=1
        )

        roast = Recipe.objects.create(title="Pot Roast", servings=6)
        RecipeIngredient.objects.create(
            recipe=roast, name="carrots", quantity="6-8", unit="", sort_order=0
        )
        RecipeIngredient.objects.create(
            recipe=roast, name="chuck roast", quantity="3", unit="pound", sort_order=1
        )

        mon = "2026-11-23"  # Monday
        wed = "2026-11-25"  # Wednesday
        fri = "2026-11-27"  # Friday

        e1 = self.client.post(
            "/api/meal-plan/entries",
            data=json.dumps({"recipe_id": stew.id, "date": mon}),
            content_type="application/json",
        )
        self.assertEqual(e1.status_code, 201)
        e1_id = e1.json()["id"]

        e2 = self.client.post(
            "/api/meal-plan/entries",
            data=json.dumps({"recipe_id": roast.id, "date": wed}),
            content_type="application/json",
        )
        self.assertEqual(e2.status_code, 201)
        e2_id = e2.json()["id"]

        # Passing Wednesday as week_start snaps to Monday (2026-11-23 -> 2026-11-29)
        week_res = self.client.get(f"/api/meal-plan?week_start={wed}")
        self.assertEqual(week_res.status_code, 200)
        week_data = week_res.json()
        self.assertEqual(week_data["week_start"], mon)
        self.assertEqual(week_data["week_end"], "2026-11-29")
        self.assertEqual(len(week_data["entries"]), 2)
        self.assertEqual(week_data["entries"][0]["recipe"]["title"], "Beef Stew")
        self.assertEqual(week_data["entries"][1]["recipe"]["title"], "Pot Roast")

        # Move second entry from Wednesday -> Friday
        move_res = self.client.patch(
            f"/api/meal-plan/entries/{e2_id}",
            data=json.dumps({"date": fri}),
            content_type="application/json",
        )
        self.assertEqual(move_res.status_code, 200)
        self.assertEqual(move_res.json()["date"], fri)

        # Fetch ingredients for specific day (Monday only) -> only Beef Stew ingredients
        mon_ing = self.client.get(f"/api/meal-plan/ingredients?dates={mon}").json()
        self.assertEqual(
            [(i["name"], i["is_pantry_staple"]) for i in mon_ing["ingredients"]],
            [("carrots", False), ("olive oil", True)],
        )

        # Fetch ingredients for full week (Mon + Fri) -> both recipes returned
        all_ing = self.client.get(
            f"/api/meal-plan/ingredients?week_start={mon}"
        ).json()
        self.assertEqual(len(all_ing["ingredients"]), 4)

        # Deleting entry removes it cleanly
        self.assertEqual(
            self.client.delete(f"/api/meal-plan/entries/{e1_id}").status_code, 204
        )
        self.assertEqual(
            self.client.delete(f"/api/meal-plan/entries/{e1_id}").status_code, 404
        )
        self.assertEqual(MealPlanEntry.objects.count(), 1)
