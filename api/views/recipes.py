from __future__ import annotations

import logging
import mimetypes
from typing import Any

from django.db import transaction
from django.db.models import Count
from django.http import FileResponse, HttpRequest, HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from api.models import Recipe, RecipeIngredient
from api.services.fetcher import (
    FetchFailedError,
    InvalidURLError,
    ParseFailedError,
    validate_http_url,
)
from api.services.images import ImageStore, is_local_image_url
from api.views import (
    get_image_store,
    get_importer,
    iso_timestamp,
    parse_json_body,
    parse_positive_int,
)

logger = logging.getLogger(__name__)


def _serialize_ingredient(ing: RecipeIngredient) -> dict[str, Any]:
    return {
        "id": ing.id,
        "recipe_id": ing.recipe_id,
        "name": ing.name,
        "quantity": ing.quantity,
        "unit": ing.unit,
        "sort_order": ing.sort_order,
    }


def _serialize_recipe(
    recipe: Recipe,
    *,
    include_ingredients: bool = False,
    ingredient_count: int | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": recipe.id,
        "title": recipe.title,
        "description": recipe.description,
        "instructions": recipe.instructions,
        "servings": recipe.servings,
        "prep_minutes": recipe.prep_minutes,
        "cook_minutes": recipe.cook_minutes,
        "source_url": recipe.source_url,
        "image_url": recipe.image_url,
        "created_at": iso_timestamp(recipe.created_at),
        "updated_at": iso_timestamp(recipe.updated_at),
    }
    if include_ingredients:
        ingredients = list(recipe.ingredients.all().order_by("sort_order", "id"))
        payload["ingredients"] = [_serialize_ingredient(i) for i in ingredients]
        payload["ingredient_count"] = len(ingredients)
    else:
        payload["ingredient_count"] = (
            ingredient_count
            if ingredient_count is not None
            else getattr(recipe, "annotated_ingredient_count", 0)
        )
    return payload


def _importer_error_response(exc: Exception) -> JsonResponse:
    logger.warning("recipe import error: %s", exc)
    if isinstance(exc, InvalidURLError):
        return JsonResponse({"error": str(exc)}, status=400)
    if isinstance(exc, ParseFailedError):
        return JsonResponse(
            {
                "error": (
                    "Could not extract recipe data from this page. "
                    "The site may not include supported recipe markup."
                )
            },
            status=422,
        )
    if isinstance(exc, FetchFailedError):
        return JsonResponse({"error": str(exc)}, status=502)
    return JsonResponse({"error": str(exc)}, status=500)


def _validate_recipe_payload(data: dict[str, Any]) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    title = str(data.get("title") or "").strip()
    if not title:
        return None, JsonResponse({"error": "recipe title is required"}, status=400)

    source_url = str(data.get("source_url") or "").strip()
    if source_url:
        try:
            source_url = validate_http_url(source_url)
        except InvalidURLError as exc:
            return None, JsonResponse({"error": str(exc)}, status=400)

    def _to_int(val: Any, default: int, minimum: int) -> int:
        try:
            n = int(val)
        except (TypeError, ValueError):
            return default
        return max(n, minimum)

    raw_ingredients = data.get("ingredients")
    ingredients: list[dict[str, str]] = []
    if isinstance(raw_ingredients, list):
        for item in raw_ingredients:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            ingredients.append(
                {
                    "name": name,
                    "quantity": str(item.get("quantity") or "").strip(),
                    "unit": str(item.get("unit") or "").strip(),
                }
            )

    cleaned = {
        "title": title,
        "description": str(data.get("description") or "").strip(),
        "instructions": str(data.get("instructions") or "").strip(),
        "servings": _to_int(data.get("servings"), default=1, minimum=1),
        "prep_minutes": _to_int(data.get("prep_minutes"), default=0, minimum=0),
        "cook_minutes": _to_int(data.get("cook_minutes"), default=0, minimum=0),
        "source_url": source_url,
        "image_url": str(data.get("image_url") or "").strip(),
        "ingredients": ingredients,
    }
    return cleaned, None


def _resolve_and_cache_image(
    store: ImageStore, raw_image_url: str, source_url: str
) -> tuple[str, bool]:
    trimmed = raw_image_url.strip()
    if not trimmed:
        return "", False
    if is_local_image_url(trimmed):
        return trimmed, False
    validate_http_url(trimmed)
    local_path = store.save_from_url(trimmed, referer=source_url)
    return local_path, True


@csrf_exempt
def import_preview_view(request: HttpRequest) -> JsonResponse:
    if request.method != "POST":
        return JsonResponse({"error": "method not allowed"}, status=405)

    data, err_resp = parse_json_body(request)
    if err_resp is not None or data is None:
        return err_resp or JsonResponse({"error": "invalid request body"}, status=400)

    raw_url = str(data.get("url") or "")
    try:
        preview = get_importer().import_url(raw_url)
    except Exception as exc:
        return _importer_error_response(exc)

    return JsonResponse(preview.to_dict(), status=200)


@csrf_exempt
def recipes_collection_view(request: HttpRequest) -> JsonResponse:
    if request.method == "GET":
        qs = Recipe.objects.annotate(
            annotated_ingredient_count=Count("ingredients")
        ).order_by("-created_at", "-id")
        return JsonResponse(
            [_serialize_recipe(r) for r in qs],
            safe=False,
            status=200,
        )

    if request.method == "POST":
        data, err_resp = parse_json_body(request)
        if err_resp is not None or data is None:
            return err_resp or JsonResponse({"error": "invalid request body"}, status=400)

        cleaned, val_err = _validate_recipe_payload(data)
        if val_err is not None or cleaned is None:
            return val_err or JsonResponse({"error": "invalid recipe data"}, status=400)

        store = get_image_store()
        try:
            image_url, newly_cached = _resolve_and_cache_image(
                store, cleaned["image_url"], cleaned["source_url"]
            )
        except Exception as exc:
            return _importer_error_response(exc)

        try:
            with transaction.atomic():
                recipe = Recipe.objects.create(
                    title=cleaned["title"],
                    description=cleaned["description"],
                    instructions=cleaned["instructions"],
                    servings=cleaned["servings"],
                    prep_minutes=cleaned["prep_minutes"],
                    cook_minutes=cleaned["cook_minutes"],
                    source_url=cleaned["source_url"],
                    image_url=image_url,
                )
                if cleaned["ingredients"]:
                    RecipeIngredient.objects.bulk_create(
                        [
                            RecipeIngredient(
                                recipe=recipe,
                                name=ing["name"],
                                quantity=ing["quantity"],
                                unit=ing["unit"],
                                sort_order=idx,
                            )
                            for idx, ing in enumerate(cleaned["ingredients"])
                        ]
                    )
        except Exception:
            if newly_cached:
                store.delete_local(image_url)
            logger.exception("failed to save recipe")
            return JsonResponse({"error": "failed to save recipe"}, status=500)

        return JsonResponse(
            _serialize_recipe(recipe, include_ingredients=True),
            status=201,
        )

    return JsonResponse({"error": "method not allowed"}, status=405)


@csrf_exempt
def recipe_detail_view(request: HttpRequest, recipe_id: str) -> HttpResponse:
    rid, id_err = parse_positive_int(recipe_id, "recipe id")
    if id_err is not None or rid is None:
        return id_err or JsonResponse({"error": "invalid recipe id"}, status=400)

    if request.method == "GET":
        try:
            recipe = Recipe.objects.prefetch_related("ingredients").get(pk=rid)
        except Recipe.DoesNotExist:
            return JsonResponse({"error": "recipe not found"}, status=404)
        return JsonResponse(
            _serialize_recipe(recipe, include_ingredients=True), status=200
        )

    if request.method == "PUT":
        data, err_resp = parse_json_body(request)
        if err_resp is not None or data is None:
            return err_resp or JsonResponse({"error": "invalid request body"}, status=400)

        cleaned, val_err = _validate_recipe_payload(data)
        if val_err is not None or cleaned is None:
            return val_err or JsonResponse({"error": "invalid recipe data"}, status=400)

        try:
            recipe = Recipe.objects.get(pk=rid)
        except Recipe.DoesNotExist:
            return JsonResponse({"error": "recipe not found"}, status=404)

        prev_image_url = recipe.image_url
        store = get_image_store()
        try:
            image_url, newly_cached = _resolve_and_cache_image(
                store, cleaned["image_url"], cleaned["source_url"]
            )
        except Exception as exc:
            return _importer_error_response(exc)

        try:
            with transaction.atomic():
                recipe.title = cleaned["title"]
                recipe.description = cleaned["description"]
                recipe.instructions = cleaned["instructions"]
                recipe.servings = cleaned["servings"]
                recipe.prep_minutes = cleaned["prep_minutes"]
                recipe.cook_minutes = cleaned["cook_minutes"]
                recipe.source_url = cleaned["source_url"]
                recipe.image_url = image_url
                recipe.save()

                recipe.ingredients.all().delete()
                if cleaned["ingredients"]:
                    RecipeIngredient.objects.bulk_create(
                        [
                            RecipeIngredient(
                                recipe=recipe,
                                name=ing["name"],
                                quantity=ing["quantity"],
                                unit=ing["unit"],
                                sort_order=idx,
                            )
                            for idx, ing in enumerate(cleaned["ingredients"])
                        ]
                    )
        except Exception:
            if newly_cached:
                store.delete_local(image_url)
            logger.exception("failed to update recipe %d", rid)
            return JsonResponse({"error": "failed to update recipe"}, status=500)

        if prev_image_url and prev_image_url != image_url:
            store.delete_local(prev_image_url)

        return JsonResponse(
            _serialize_recipe(recipe, include_ingredients=True), status=200
        )

    if request.method == "DELETE":
        try:
            recipe = Recipe.objects.get(pk=rid)
        except Recipe.DoesNotExist:
            return JsonResponse({"error": "recipe not found"}, status=404)

        prev_image_url = recipe.image_url
        recipe.delete()
        get_image_store().delete_local(prev_image_url)
        return HttpResponse(status=204)

    return JsonResponse({"error": "method not allowed"}, status=405)


def serve_image_view(request: HttpRequest, filename: str) -> HttpResponse:
    if request.method not in ("GET", "HEAD"):
        return JsonResponse({"error": "method not allowed"}, status=405)

    store = get_image_store()
    path = store.file_path(filename)
    if path is None:
        return JsonResponse({"error": "invalid image filename"}, status=400)
    if not path.is_file():
        return JsonResponse({"error": "image not found"}, status=404)

    content_type, _ = mimetypes.guess_type(str(path))
    resp = FileResponse(
        path.open("rb"),
        content_type=content_type or "application/octet-stream",
    )
    resp["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp
