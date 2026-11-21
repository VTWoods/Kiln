from __future__ import annotations

import json

from django.test import Client, TestCase

from api.models import Recipe


class ShoppingListsViewTests(TestCase):
    def setUp(self) -> None:
        self.client = Client()

    def test_shopping_list_crud_validation_and_item_operations(self) -> None:
        # Reject blank name
        bad_list = self.client.post(
            "/api/shopping-lists",
            data=json.dumps({"name": "  "}),
            content_type="application/json",
        )
        self.assertEqual(bad_list.status_code, 400)

        recipe = Recipe.objects.create(title="Tacos")

        # Create list
        l_res = self.client.post(
            "/api/shopping-lists",
            data=json.dumps({"name": "11/21/2026"}),
            content_type="application/json",
        )
        self.assertEqual(l_res.status_code, 201)
        list_id = l_res.json()["id"]

        # Reject empty items batch
        bad_items = self.client.post(
            f"/api/shopping-lists/{list_id}/items",
            data=json.dumps({"items": [{"name": "  "}]}),
            content_type="application/json",
        )
        self.assertEqual(bad_items.status_code, 400)

        # Add items (one linked to recipe, one manual)
        add_res = self.client.post(
            f"/api/shopping-lists/{list_id}/items",
            data=json.dumps(
                {
                    "items": [
                        {"quantity": "1", "unit": "lb", "name": "beef", "recipe_id": recipe.id},
                        {"quantity": "", "unit": "", "name": "paper towels"},
                    ]
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(add_res.status_code, 201)
        items = add_res.json()["items"]
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["recipe_title"], "Tacos")

        # Toggle checked on first item
        p_res = self.client.patch(
            f"/api/shopping-lists/{list_id}/items/{items[0]['id']}",
            data=json.dumps({"checked": True}),
            content_type="application/json",
        )
        self.assertEqual(p_res.status_code, 200)
        self.assertTrue(p_res.json()["checked"])

        # List summary reflects counts
        summary = self.client.get("/api/shopping-lists").json()
        self.assertEqual(summary[0]["item_count"], 2)
        self.assertEqual(summary[0]["checked_count"], 1)

        # Clear checked leaves only unchecked manual item
        c_res = self.client.delete(f"/api/shopping-lists/{list_id}/checked")
        self.assertEqual(c_res.status_code, 200)
        self.assertEqual([i["name"] for i in c_res.json()["items"]], ["paper towels"])

        # Delete single item and then list
        del_item = self.client.delete(
            f"/api/shopping-lists/{list_id}/items/{items[1]['id']}"
        )
        self.assertEqual(del_item.status_code, 204)
        self.assertEqual(
            self.client.delete(f"/api/shopping-lists/{list_id}").status_code, 204
        )
        self.assertEqual(self.client.get(f"/api/shopping-lists/{list_id}").status_code, 404)
