from __future__ import annotations

from typing import Any

from django.db import transaction
from django.db.models import Count, Q
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from api.models import Recipe, ShoppingList, ShoppingListItem
from api.views import iso_timestamp, parse_json_body, parse_positive_int


def _serialize_item(item: ShoppingListItem) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": item.id,
        "shopping_list_id": item.shopping_list_id,
        "name": item.name,
        "quantity": item.quantity,
        "unit": item.unit,
        "checked": bool(item.checked),
    }
    if item.recipe_id is not None:
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
            shopping_list.items.select_related("recipe").order_by("checked", "id")
        )
        payload["items"] = [_serialize_item(it) for it in items]
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

    existing_recipe_ids = set(
        Recipe.objects.filter(
            pk__in=[it["recipe_id"] for it in valid_items if it["recipe_id"]]
        ).values_list("id", flat=True)
    )

    with transaction.atomic():
        ShoppingListItem.objects.bulk_create(
            [
                ShoppingListItem(
                    shopping_list=sl,
                    name=it["name"],
                    quantity=it["quantity"],
                    unit=it["unit"],
                    checked=False,
                    recipe_id=(
                        it["recipe_id"]
                        if it["recipe_id"] in existing_recipe_ids
                        else None
                    ),
                )
                for it in valid_items
            ]
        )
        sl.updated_at = timezone.now()
        sl.save(update_fields=["updated_at"])

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
            item = ShoppingListItem.objects.select_related("recipe").get(
                pk=iid, shopping_list_id=lid
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
