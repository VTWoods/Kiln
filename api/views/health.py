from __future__ import annotations

from django.db import connection
from django.http import HttpRequest, JsonResponse
from django.views.decorators.http import require_GET


@require_GET
def health_view(request: HttpRequest) -> JsonResponse:
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1;")
            cursor.fetchone()
    except Exception as exc:
        return JsonResponse(
            {
                "status": "degraded",
                "service": "kiln",
                "database": "error",
                "error": str(exc),
            },
            status=503,
        )

    return JsonResponse(
        {
            "status": "ok",
            "service": "kiln",
            "database": "ok",
        },
        status=200,
    )
