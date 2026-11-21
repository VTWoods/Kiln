from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from django.conf import settings
from django.http import HttpRequest, JsonResponse

from api.services.caster import Caster, PyChromecastCaster
from api.services.fetcher import SafeFetcher
from api.services.images import ImageStore
from api.services.importer import RecipeImporter, RecipeScrapersImporter


def parse_json_body(request: HttpRequest) -> tuple[dict[str, Any] | None, JsonResponse | None]:
    if not request.body:
        return {}, None
    try:
        data = json.loads(request.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None, JsonResponse({"error": "invalid request body"}, status=400)
    if not isinstance(data, dict):
        return None, JsonResponse({"error": "invalid request body"}, status=400)
    return data, None


def parse_positive_int(raw: str, label: str) -> tuple[int | None, JsonResponse | None]:
    try:
        val = int(raw)
    except (TypeError, ValueError):
        return None, JsonResponse({"error": f"invalid {label}"}, status=400)
    if val <= 0:
        return None, JsonResponse({"error": f"invalid {label}"}, status=400)
    return val, None


def iso_timestamp(dt: datetime | None) -> str:
    if dt is None:
        return ""
    return dt.isoformat()


def get_importer() -> RecipeImporter:
    return RecipeScrapersImporter(SafeFetcher())


def get_image_store() -> ImageStore:
    return ImageStore(settings.IMAGES_DIR, SafeFetcher())


def get_caster() -> Caster:
    return PyChromecastCaster(settings.PUBLIC_BASE_URL)
