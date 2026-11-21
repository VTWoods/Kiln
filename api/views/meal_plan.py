"""Weekly meal plan endpoints (Monday-Sunday weeks, defaulting to next week)."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from django.db.models import Count
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from api.models import MealPlanEntry, Recipe
from api.services.pantry_staples import get_pantry_staple_keys, is_ingredient_staple
from api.views import iso_timestamp, parse_json_body, parse_positive_int


def _monday_of_week(d: date) -> date:
    """Return the Monday (start of week) containing date d."""
    return d - timedelta(days=d.weekday())


def _default_next_week_start() -> date:
    today = timezone.localdate()
    return _monday_of_week(today) + timedelta(days=7)


def _parse_iso_date(raw: str) -> date | None:
    cleaned = (raw or "").strip()
    if not cleaned:
        return None
    try:
        return date.fromisoformat(cleaned)
    except ValueError:
        return None


def _serialize_entry(entry: MealPlanEntry) -> dict[str, Any]:
    recipe = entry.recipe
    ing_count = getattr(entry, "annotated_ingredient_count", None)
    if ing_count is None:
        ing_count = recipe.ingredients.count()
    return {
        "id": entry.id,
        "date": entry.date.isoformat(),
        "recipe_id": entry.recipe_id,
        "notes": entry.notes,
        "sort_order": entry.sort_order,
        "created_at": iso_timestamp(entry.created_at),
        "recipe": {
            "id": recipe.id,
            "title": recipe.title,
            "image_url": recipe.image_url,
            "prep_minutes": recipe.prep_minutes,
            "cook_minutes": recipe.cook_minutes,
            "servings": recipe.servings,
            "ingredient_count": ing_count,
        },
    }


def meal_plan_week_view(request: HttpRequest) -> JsonResponse:
    """GET /api/meal-plan?week_start=YYYY-MM-DD -> Monday-Sunday entries for that week."""
    if request.method != "GET":
        return JsonResponse({"error": "method not allowed"}, status=405)

    raw_start = request.GET.get("week_start", "").strip()
    if raw_start:
        parsed = _parse_iso_date(raw_start)
        if parsed is None:
            return JsonResponse(
                {"error": "week_start must be a valid YYYY-MM-DD date"}, status=400
            )
        week_start = _monday_of_week(parsed)
    else:
        week_start = _default_next_week_start()

    week_end = week_start + timedelta(days=6)
    entries = list(
        MealPlanEntry.objects.filter(date__range=(week_start, week_end))
        .select_related("recipe")
        .annotate(annotated_ingredient_count=Count("recipe__ingredients"))
        .order_by("date", "sort_order", "id")
    )

    return JsonResponse(
        {
            "week_start": week_start.isoformat(),
            "week_end": week_end.isoformat(),
            "entries": [_serialize_entry(e) for e in entries],
        },
        status=200,
    )


@csrf_exempt
def meal_plan_entries_view(request: HttpRequest) -> JsonResponse:
    """POST /api/meal-plan/entries -> add a recipe to a specific date."""
    if request.method != "POST":
        return JsonResponse({"error": "method not allowed"}, status=405)

    data, err_resp = parse_json_body(request)
    if err_resp is not None or data is None:
        return err_resp or JsonResponse({"error": "invalid request body"}, status=400)

    raw_recipe_id = data.get("recipe_id")
    try:
        recipe_id = int(raw_recipe_id)
        if recipe_id <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return JsonResponse({"error": "valid recipe_id is required"}, status=400)

    target_date = _parse_iso_date(str(data.get("date") or ""))
    if target_date is None:
        return JsonResponse(
            {"error": "date must be a valid YYYY-MM-DD date"}, status=400
        )

    try:
        recipe = Recipe.objects.get(pk=recipe_id)
    except Recipe.DoesNotExist:
        return JsonResponse({"error": "recipe not found"}, status=404)

    notes = str(data.get("notes") or "").strip()
    next_sort = MealPlanEntry.objects.filter(date=target_date).count()
    entry = MealPlanEntry.objects.create(
        date=target_date,
        recipe=recipe,
        notes=notes,
        sort_order=next_sort,
    )
    return JsonResponse(_serialize_entry(entry), status=201)


@csrf_exempt
def meal_plan_entry_detail_view(
    request: HttpRequest, entry_id: str
) -> HttpResponse:
    """PATCH / DELETE /api/meal-plan/entries/<entry_id>."""
    eid, id_err = parse_positive_int(entry_id, "meal plan entry id")
    if id_err is not None or eid is None:
        return id_err or JsonResponse({"error": "invalid meal plan entry id"}, status=400)

    if request.method == "PATCH":
        data, err_resp = parse_json_body(request)
        if err_resp is not None or data is None:
            return err_resp or JsonResponse({"error": "invalid request body"}, status=400)

        try:
            entry = MealPlanEntry.objects.select_related("recipe").get(pk=eid)
        except MealPlanEntry.DoesNotExist:
            return JsonResponse({"error": "meal plan entry not found"}, status=404)

        if "date" in data and data["date"] is not None:
            new_date = _parse_iso_date(str(data["date"]))
            if new_date is None:
                return JsonResponse(
                    {"error": "date must be a valid YYYY-MM-DD date"}, status=400
                )
            entry.date = new_date

        if "notes" in data and data["notes"] is not None:
            entry.notes = str(data["notes"]).strip()

        entry.save()
        return JsonResponse(_serialize_entry(entry), status=200)

    if request.method == "DELETE":
        deleted, _ = MealPlanEntry.objects.filter(pk=eid).delete()
        if deleted == 0:
            return JsonResponse({"error": "meal plan entry not found"}, status=404)
        return HttpResponse(status=204)

    return JsonResponse({"error": "method not allowed"}, status=405)


def meal_plan_ingredients_view(request: HttpRequest) -> JsonResponse:
    """GET /api/meal-plan/ingredients?week_start=... OR ?dates=YYYY-MM-DD,..."""
    if request.method != "GET":
        return JsonResponse({"error": "method not allowed"}, status=405)

    raw_dates = request.GET.get("dates", "").strip()
    raw_week_start = request.GET.get("week_start", "").strip()

    target_dates: list[date] = []
    if raw_dates:
        for chunk in raw_dates.split(","):
            parsed = _parse_iso_date(chunk)
            if parsed is None:
                return JsonResponse(
                    {"error": f"invalid date in dates parameter: {chunk!r}"},
                    status=400,
                )
            if parsed not in target_dates:
                target_dates.append(parsed)
        target_dates.sort()
    else:
        if raw_week_start:
            parsed = _parse_iso_date(raw_week_start)
            if parsed is None:
                return JsonResponse(
                    {"error": "week_start must be a valid YYYY-MM-DD date"},
                    status=400,
                )
            week_start = _monday_of_week(parsed)
        else:
            week_start = _default_next_week_start()
        target_dates = [week_start + timedelta(days=i) for i in range(7)]

    entries = list(
        MealPlanEntry.objects.filter(date__in=target_dates)
        .select_related("recipe")
        .prefetch_related("recipe__ingredients")
        .order_by("date", "sort_order", "id")
    )

    staple_keys = get_pantry_staple_keys()
    ingredients_payload: list[dict[str, Any]] = []
    for entry in entries:
        recipe = entry.recipe
        for ing in recipe.ingredients.all().order_by("sort_order", "id"):
            ingredients_payload.append(
                {
                    "key": f"{entry.id}-{ing.id}",
                    "entry_id": entry.id,
                    "date": entry.date.isoformat(),
                    "recipe_id": recipe.id,
                    "recipe_title": recipe.title,
                    "ingredient_id": ing.id,
                    "name": ing.name,
                    "quantity": ing.quantity,
                    "unit": ing.unit,
                    "preparation": ing.preparation,
                    "is_pantry_staple": is_ingredient_staple(
                        ing.name, unit=ing.unit, staple_keys=staple_keys
                    ),
                }
            )

    return JsonResponse(
        {
            "dates": [d.isoformat() for d in target_dates],
            "entries": [_serialize_entry(e) for e in entries],
            "ingredients": ingredients_payload,
        },
        status=200,
    )
