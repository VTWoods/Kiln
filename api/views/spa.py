from __future__ import annotations

import mimetypes
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, HttpRequest, HttpResponse, JsonResponse


def api_not_found_view(request: HttpRequest) -> JsonResponse:
    return JsonResponse({"error": "endpoint not found"}, status=404)


def static_spa_view(request: HttpRequest, req_path: str = "") -> HttpResponse:
    if request.method not in ("GET", "HEAD"):
        return HttpResponse(status=405)

    static_root = Path(settings.STATIC_DIST_DIR).resolve()

    clean_rel = req_path.lstrip("/")
    if clean_rel:
        candidate = (static_root / clean_rel).resolve()
        if candidate.is_relative_to(static_root) and candidate.is_file():
            content_type, _ = mimetypes.guess_type(str(candidate))
            return FileResponse(
                candidate.open("rb"),
                content_type=content_type or "application/octet-stream",
            )

    index_path = static_root / "index.html"
    if not index_path.is_file():
        return HttpResponse(
            f'Frontend assets not found in "{static_root}". '
            "Build the React app first (e.g. `make build-web`).\n",
            status=503,
            content_type="text/plain; charset=utf-8",
        )

    return FileResponse(index_path.open("rb"), content_type="text/html; charset=utf-8")
