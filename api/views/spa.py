from __future__ import annotations

import mimetypes
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, HttpRequest, HttpResponse, JsonResponse

# Ensure PWA manifest files always get the proper MIME type even on minimal Linux images
mimetypes.add_type("application/manifest+json", ".webmanifest")

_NO_CACHE_FILES = frozenset(
    {"index.html", "sw.js", "registerSW.js", "manifest.webmanifest"}
)


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
            resp = FileResponse(
                candidate.open("rb"),
                content_type=content_type or "application/octet-stream",
            )
            if candidate.name in _NO_CACHE_FILES or candidate.name.startswith("workbox-"):
                resp["Cache-Control"] = "no-cache"
            elif clean_rel.startswith("assets/"):
                resp["Cache-Control"] = "public, max-age=31536000, immutable"
            return resp

    index_path = static_root / "index.html"
    if not index_path.is_file():
        return HttpResponse(
            f'Frontend assets not found in "{static_root}". '
            "Build the React app first (e.g. `make build-web`).\n",
            status=503,
            content_type="text/plain; charset=utf-8",
        )

    resp = FileResponse(index_path.open("rb"), content_type="text/html; charset=utf-8")
    resp["Cache-Control"] = "no-cache"
    return resp
