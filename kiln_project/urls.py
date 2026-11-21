"""URL routing for Kiln."""

from django.contrib import admin
from django.urls import path, re_path

from api.views import cast, health, recipes, shopping_lists, spa

urlpatterns = [
    path("admin/", admin.site.urls),
    # Health
    path("api/health", health.health_view),
    # Recipes & Importer
    path("api/recipes/import-preview", recipes.import_preview_view),
    path("api/recipes", recipes.recipes_collection_view),
    path("api/recipes/<str:recipe_id>", recipes.recipe_detail_view),
    path("api/images/<str:filename>", recipes.serve_image_view),
    # Shopping lists
    path("api/shopping-lists", shopping_lists.shopping_lists_collection_view),
    path(
        "api/shopping-lists/<str:list_id>",
        shopping_lists.shopping_list_detail_view,
    ),
    path(
        "api/shopping-lists/<str:list_id>/items",
        shopping_lists.shopping_list_items_view,
    ),
    path(
        "api/shopping-lists/<str:list_id>/items/<str:item_id>",
        shopping_lists.shopping_list_item_detail_view,
    ),
    path(
        "api/shopping-lists/<str:list_id>/checked",
        shopping_lists.shopping_list_clear_checked_view,
    ),
    # Nest Hub / Cast
    path("api/cast/devices", cast.discover_devices_view),
    path("api/cast/recipes/<str:recipe_id>", cast.cast_recipe_view),
    path("api/cast/recipes/<str:recipe_id>/view", cast.cast_recipe_html_view),
    path("api/cast/silence.wav", cast.silence_wav_view),
    path("api/cast/stop", cast.stop_cast_view),
    # Catch-all for unknown /api routes (always return JSON 404, never index.html)
    re_path(r"^api(?:/.*)?$", spa.api_not_found_view),
    # React SPA static files + index.html fallback
    re_path(r"^(?P<req_path>.*)$", spa.static_spa_view),
]
