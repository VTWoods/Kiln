"""CRUD + toggle endpoints for managing household pantry staples."""

from __future__ import annotations

from typing import Any

from django.http import HttpRequest, HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.models import PantryStaple
from api.services.shopping_list_merger import ingredient_merge_key
from api.views import iso_timestamp, parse_json_body, parse_positive_int


def _serialize_staple(staple: PantryStaple) -> dict[str, Any]:
    return {
        "id": staple.id,
        "name": staple.name,
        "ingredient_key": staple.ingredient_key,
        "created_at": iso_timestamp(staple.created_at),
    }


@csrf_exempt
def pantry_staples_collection_view(request: HttpRequest) -> JsonResponse:
    if request.method == "GET":
        staples = PantryStaple.objects.all().order_by("name", "id")
        return JsonResponse(
            [_serialize_staple(s) for s in staples],
            safe=False,
            status=200,
        )

    if request.method == "POST":
        data, err_resp = parse_json_body(request)
        if err_resp is not None or data is None:
            return err_resp or JsonResponse({"error": "invalid request body"}, status=400)

        name = " ".join(str(data.get("name") or "").strip().split())
        key = ingredient_merge_key(name)
        if not name or not key:
            return JsonResponse({"error": "staple name is required"}, status=400)

        staple, created = PantryStaple.objects.get_or_create(
            ingredient_key=key,
            defaults={"name": name.lower()},
        )
        return JsonResponse(
            _serialize_staple(staple),
            status=201 if created else 200,
        )

    return JsonResponse({"error": "method not allowed"}, status=405)


@csrf_exempt
def pantry_staple_toggle_view(request: HttpRequest) -> JsonResponse:
    """Toggle an ingredient's pantry-staple status by name."""
    if request.method != "POST":
        return JsonResponse({"error": "method not allowed"}, status=405)

    data, err_resp = parse_json_body(request)
    if err_resp is not None or data is None:
        return err_resp or JsonResponse({"error": "invalid request body"}, status=400)

    name = " ".join(str(data.get("name") or "").strip().split())
    key = ingredient_merge_key(name)
    if not name or not key:
        return JsonResponse({"error": "staple name is required"}, status=400)

    existing = PantryStaple.objects.filter(ingredient_key=key).first()
    if existing is not None:
        existing.delete()
        return JsonResponse({"is_pantry_staple": False, "staple": None}, status=200)

    created = PantryStaple.objects.create(name=name.lower(), ingredient_key=key)
    return JsonResponse(
        {"is_pantry_staple": True, "staple": _serialize_staple(created)},
        status=201,
    )


@csrf_exempt
def pantry_staple_detail_view(request: HttpRequest, staple_id: str) -> HttpResponse:
    sid, id_err = parse_positive_int(staple_id, "pantry staple id")
    if id_err is not None or sid is None:
        return id_err or JsonResponse({"error": "invalid pantry staple id"}, status=400)

    if request.method == "DELETE":
        deleted, _ = PantryStaple.objects.filter(pk=sid).delete()
        if deleted == 0:
            return JsonResponse({"error": "pantry staple not found"}, status=404)
        return HttpResponse(status=204)

    return JsonResponse({"error": "method not allowed"}, status=405)
