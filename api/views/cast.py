from __future__ import annotations

import io
import logging
import wave
from urllib.parse import urlparse

from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt

from api.models import Recipe
from api.services.caster import DEFAULT_CAST_PORT, InvalidCastTargetError
from api.views import get_caster, parse_json_body, parse_positive_int

logger = logging.getLogger(__name__)


def _build_silent_wav(duration_seconds: int = 2, sample_rate: int = 8000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(1)  # 8-bit unsigned PCM (0x80 = silence)
        wf.setframerate(sample_rate)
        wf.writeframes(bytes([0x80]) * (sample_rate * duration_seconds))
    return buf.getvalue()


_SILENT_WAV_BYTES = _build_silent_wav()


def silence_wav_view(request: HttpRequest) -> HttpResponse:
    if request.method not in ("GET", "HEAD"):
        return HttpResponse(status=405)
    resp = HttpResponse(_SILENT_WAV_BYTES, content_type="audio/wav")
    resp["Cache-Control"] = "public, max-age=86400"
    resp["Accept-Ranges"] = "bytes"
    return resp


def _format_duration_minutes(minutes: int) -> str:
    if not minutes or minutes <= 0:
        return ""
    if minutes < 60:
        return f"{minutes} min"
    hrs, rem = divmod(minutes, 60)
    return f"{hrs} hr" if rem == 0 else f"{hrs} hr {rem} min"


def discover_devices_view(request: HttpRequest) -> JsonResponse:
    if request.method != "GET":
        return JsonResponse({"error": "method not allowed"}, status=405)

    try:
        devices = get_caster().discover(timeout=3.0)
    except Exception as exc:
        logger.warning("cast device discovery error: %s", exc)
        return JsonResponse(
            {"error": "failed to scan for Cast devices"}, status=500
        )

    return JsonResponse({"devices": [d.to_dict() for d in devices]}, status=200)


@csrf_exempt
def cast_recipe_view(request: HttpRequest, recipe_id: str) -> JsonResponse:
    if request.method != "POST":
        return JsonResponse({"error": "method not allowed"}, status=405)

    rid, id_err = parse_positive_int(recipe_id, "recipe id")
    if id_err is not None or rid is None:
        return id_err or JsonResponse({"error": "invalid recipe id"}, status=400)

    if not Recipe.objects.filter(pk=rid).exists():
        return JsonResponse({"error": "recipe not found"}, status=404)

    data, err_resp = parse_json_body(request)
    if err_resp is not None or data is None:
        return err_resp or JsonResponse({"error": "invalid request body"}, status=400)

    host = str(data.get("host") or "").strip()
    if not host:
        return JsonResponse({"error": "device host IP is required"}, status=400)

    try:
        port = int(data.get("port") or DEFAULT_CAST_PORT)
    except (TypeError, ValueError):
        port = DEFAULT_CAST_PORT

    raw_base_url = str(data.get("base_url") or "").strip().rstrip("/")
    if not raw_base_url:
        scheme = "https" if request.is_secure() else "http"
        base_url = f"{scheme}://{request.get_host()}"
    else:
        parsed = urlparse(raw_base_url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return JsonResponse({"error": "invalid base_url"}, status=400)
        base_url = f"{parsed.scheme}://{parsed.netloc}"

    cook_url = f"{base_url}/api/cast/recipes/{rid}/view"
    try:
        resolved_url = get_caster().cast_url(host, port, cook_url)
    except InvalidCastTargetError as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    except Exception as exc:
        logger.warning("cast recipe %d to %s:%d failed: %s", rid, host, port, exc)
        return JsonResponse(
            {"error": f"Could not cast to {host}: {exc}"}, status=502
        )

    logger.info("cast recipe %d to %s:%d -> %s", rid, host, port, resolved_url)
    return JsonResponse(
        {"status": "ok", "url": resolved_url, "host": host}, status=200
    )


def cast_recipe_html_view(request: HttpRequest, recipe_id: str) -> HttpResponse:
    if request.method not in ("GET", "HEAD"):
        return HttpResponse("method not allowed", status=405)

    rid, id_err = parse_positive_int(recipe_id, "recipe id")
    if id_err is not None or rid is None:
        return HttpResponse("invalid recipe id", status=400)

    try:
        recipe = Recipe.objects.prefetch_related("ingredients").get(pk=rid)
    except Recipe.DoesNotExist:
        return HttpResponse("recipe not found", status=404)

    ingredients = [
        {
            "amount": " ".join(p for p in (ing.quantity.strip(), ing.unit.strip()) if p),
            "name": ing.name,
            "preparation": ing.preparation.strip(),
        }
        for ing in recipe.ingredients.all().order_by("sort_order", "id")
    ]
    steps = [s.strip() for s in recipe.instructions.split("\n\n") if s.strip()]

    total_text = ""
    if recipe.prep_minutes > 0 and recipe.cook_minutes > 0:
        total_text = _format_duration_minutes(recipe.prep_minutes + recipe.cook_minutes)

    context = {
        "title": recipe.title,
        "servings": recipe.servings,
        "prep_text": _format_duration_minutes(recipe.prep_minutes),
        "cook_text": _format_duration_minutes(recipe.cook_minutes),
        "total_text": total_text,
        "ingredients": ingredients,
        "steps": steps,
    }
    return render(request, "api/cast_view.html", context)


@csrf_exempt
def stop_cast_view(request: HttpRequest) -> JsonResponse:
    if request.method != "POST":
        return JsonResponse({"error": "method not allowed"}, status=405)

    data, err_resp = parse_json_body(request)
    if err_resp is not None or data is None:
        return err_resp or JsonResponse({"error": "invalid request body"}, status=400)

    host = str(data.get("host") or "").strip()
    if not host:
        return JsonResponse({"error": "device host IP is required"}, status=400)

    try:
        port = int(data.get("port") or DEFAULT_CAST_PORT)
    except (TypeError, ValueError):
        port = DEFAULT_CAST_PORT

    try:
        get_caster().stop(host, port)
    except Exception as exc:
        logger.warning("stop cast on %s:%d failed: %s", host, port, exc)
        return JsonResponse(
            {"error": f"Could not stop casting on {host}: {exc}"}, status=502
        )

    return JsonResponse({"status": "stopped"}, status=200)
