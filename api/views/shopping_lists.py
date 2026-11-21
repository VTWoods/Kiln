from __future__ import annotations

from typing import Any

from django.db.models import Count, Q
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from api.models import IngredientAisleOverride, ShoppingList, ShoppingListItem
from api.services.aisle_categorizer import AISLES, DEFAULT_AISLE, normalize_aisle
from api.services.shopping_list_merger import (
    ingredient_merge_key,
    merge_shopping_list_items,
)
from api.views import iso_timestamp, parse_json_body, parse_positive_int


def _serialize_item(item: ShoppingListItem) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": item.id,
        "shopping_list_id": item.shopping_list_id,
        "name": item.name,
        "quantity": item.quantity,
        "unit": item.unit,
        "aisle": item.aisle or DEFAULT_AISLE,
        "checked": bool(item.checked),
    }

    contributing: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    for r in sorted(item.recipes.all(), key=lambda rec: rec.id):
        if r.id not in seen_ids:
            seen_ids.add(r.id)
            contributing.append({"id": r.id, "title": r.title})
    if item.recipe_id is not None and item.recipe_id not in seen_ids:
        if item.recipe is not None and item.recipe.title:
            contributing.append({"id": item.recipe_id, "title": item.recipe.title})

    if contributing:
        payload["recipes"] = contributing
        payload["recipe_id"] = contributing[0]["id"]
        payload["recipe_title"] = contributing[0]["title"]
    elif item.recipe_id is not None:
        payload["recipe_id"] = item.recipe_id
        if item.recipe is not None and item.recipe.title:
            payload["recipe_title"] = item.recipe.title

    return payload


def _serialize_list(
    shopping_list: ShoppingList,
    *,
    include_items: bool = False,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": shopping_list.id,
        "name": shopping_list.name,
        "created_at": iso_timestamp(shopping_list.created_at),
        "updated_at": iso_timestamp(shopping_list.updated_at),
    }
    if include_items:
        items = list(
            shopping_list.items.select_related("recipe")
            .prefetch_related("recipes")
            .order_by("checked", "id")
        )
        payload["items"] = [_serialize_item(it) for it in items]
        payload["aisles"] = list(AISLES)
        payload["item_count"] = len(items)
        payload["checked_count"] = sum(1 for it in items if it.checked)
    else:
        payload["item_count"] = getattr(shopping_list, "annotated_item_count", 0)
        payload["checked_count"] = getattr(
            shopping_list, "annotated_checked_count", 0
        )
    return payload


@csrf_exempt
def shopping_lists_collection_view(request: HttpRequest) -> JsonResponse:
    if request.method == "GET":
        qs = ShoppingList.objects.annotate(
            annotated_item_count=Count("items"),
            annotated_checked_count=Count("items", filter=Q(items__checked=True)),
        ).order_by("created_at", "id")
        return JsonResponse(
            [_serialize_list(sl) for sl in qs],
            safe=False,
            status=200,
        )

    if request.method == "POST":
        data, err_resp = parse_json_body(request)
        if err_resp is not None or data is None:
            return err_resp or JsonResponse({"error": "invalid request body"}, status=400)

        name = str(data.get("name") or "").strip()
        if not name:
            return JsonResponse(
                {"error": "shopping list name is required"}, status=400
            )

        created = ShoppingList.objects.create(name=name)
        return JsonResponse(
            _serialize_list(created, include_items=True), status=201
        )

    return JsonResponse({"error": "method not allowed"}, status=405)


@csrf_exempt
def shopping_list_detail_view(request: HttpRequest, list_id: str) -> HttpResponse:
    lid, id_err = parse_positive_int(list_id, "shopping list id")
    if id_err is not None or lid is None:
        return id_err or JsonResponse({"error": "invalid shopping list id"}, status=400)

    if request.method == "GET":
        try:
            sl = ShoppingList.objects.get(pk=lid)
        except ShoppingList.DoesNotExist:
            return JsonResponse({"error": "shopping list not found"}, status=404)
        return JsonResponse(_serialize_list(sl, include_items=True), status=200)

    if request.method == "DELETE":
        deleted, _ = ShoppingList.objects.filter(pk=lid).delete()
        if deleted == 0:
            return JsonResponse({"error": "shopping list not found"}, status=404)
        return HttpResponse(status=204)

    return JsonResponse({"error": "method not allowed"}, status=405)


@csrf_exempt
def shopping_list_items_view(request: HttpRequest, list_id: str) -> JsonResponse:
    if request.method != "POST":
        return JsonResponse({"error": "method not allowed"}, status=405)

    lid, id_err = parse_positive_int(list_id, "shopping list id")
    if id_err is not None or lid is None:
        return id_err or JsonResponse({"error": "invalid shopping list id"}, status=400)

    data, err_resp = parse_json_body(request)
    if err_resp is not None or data is None:
        return err_resp or JsonResponse({"error": "invalid request body"}, status=400)

    raw_items = data.get("items")
    if not isinstance(raw_items, list):
        return JsonResponse(
            {"error": "at least one item with a name is required"}, status=400
        )

    valid_items: list[dict[str, Any]] = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if not name:
            continue
        recipe_id: int | None = None
        raw_rid = raw.get("recipe_id")
        if raw_rid is not None:
            try:
                parsed_rid = int(raw_rid)
                if parsed_rid > 0:
                    recipe_id = parsed_rid
            except (TypeError, ValueError):
                pass
        valid_items.append(
            {
                "name": name,
                "quantity": str(raw.get("quantity") or "").strip(),
                "unit": str(raw.get("unit") or "").strip(),
                "recipe_id": recipe_id,
            }
        )

    if not valid_items:
        return JsonResponse(
            {"error": "at least one item with a name is required"}, status=400
        )

    try:
        sl = ShoppingList.objects.get(pk=lid)
    except ShoppingList.DoesNotExist:
        return JsonResponse({"error": "shopping list not found"}, status=404)

    merge_shopping_list_items(sl, valid_items)
    sl.refresh_from_db()
    return JsonResponse(_serialize_list(sl, include_items=True), status=201)


@csrf_exempt
def shopping_list_item_detail_view(
    request: HttpRequest, list_id: str, item_id: str
) -> HttpResponse:
    lid, id_err = parse_positive_int(list_id, "shopping list id")
    if id_err is not None or lid is None:
        return id_err or JsonResponse({"error": "invalid shopping list id"}, status=400)
    iid, item_err = parse_positive_int(item_id, "shopping list item id")
    if item_err is not None or iid is None:
        return item_err or JsonResponse({"error": "invalid shopping list item id"}, status=400)

    if request.method == "PATCH":
        data, err_resp = parse_json_body(request)
        if err_resp is not None or data is None:
            return err_resp or JsonResponse({"error": "invalid request body"}, status=400)

        try:
            item = (
                ShoppingListItem.objects.select_related("recipe")
                .prefetch_related("recipes")
                .get(pk=iid, shopping_list_id=lid)
            )
        except ShoppingListItem.DoesNotExist:
            return JsonResponse({"error": "shopping list item not found"}, status=404)

        if "name" in data and data["name"] is not None:
            trimmed = str(data["name"]).strip()
            if trimmed:
                item.name = trimmed
        if "quantity" in data and data["quantity"] is not None:
            item.quantity = str(data["quantity"]).strip()
        if "unit" in data and data["unit"] is not None:
            item.unit = str(data["unit"]).strip()
        if "aisle" in data and data["aisle"] is not None:
            valid_aisle = normalize_aisle(str(data["aisle"]))
            if valid_aisle is None:
                return JsonResponse({"error": "invalid aisle"}, status=400)
            item.aisle = valid_aisle
            merge_key = ingredient_merge_key(item.name)
            if merge_key:
                IngredientAisleOverride.objects.update_or_create(
                    ingredient_key=merge_key,
                    defaults={"aisle": valid_aisle},
                )
        if "checked" in data and data["checked"] is not None:
            item.checked = bool(data["checked"])

        item.save()
        ShoppingList.objects.filter(pk=lid).update(updated_at=timezone.now())
        return JsonResponse(_serialize_item(item), status=200)

    if request.method == "DELETE":
        deleted, _ = ShoppingListItem.objects.filter(
            pk=iid, shopping_list_id=lid
        ).delete()
        if deleted == 0:
            return JsonResponse({"error": "shopping list item not found"}, status=404)
        ShoppingList.objects.filter(pk=lid).update(updated_at=timezone.now())
        return HttpResponse(status=204)

    return JsonResponse({"error": "method not allowed"}, status=405)


@csrf_exempt
def shopping_list_clear_checked_view(
    request: HttpRequest, list_id: str
) -> JsonResponse:
    if request.method != "DELETE":
        return JsonResponse({"error": "method not allowed"}, status=405)

    lid, id_err = parse_positive_int(list_id, "shopping list id")
    if id_err is not None or lid is None:
        return id_err or JsonResponse({"error": "invalid shopping list id"}, status=400)

    try:
        sl = ShoppingList.objects.get(pk=lid)
    except ShoppingList.DoesNotExist:
        return JsonResponse({"error": "shopping list not found"}, status=404)

    sl.items.filter(checked=True).delete()
    sl.updated_at = timezone.now()
    sl.save(update_fields=["updated_at"])
    return JsonResponse(_serialize_list(sl, include_items=True), status=200)
