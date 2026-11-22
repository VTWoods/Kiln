"""URL routing for Kiln."""

from django.contrib import admin
from django.urls import path, re_path

from api.views import cast, health, meal_plan, pantry_staples, recipes, shopping_lists, spa

urlpatterns = [
    path("admin/", admin.site.urls),
    # Health
    path("api/health", health.health_view),
    # Recipes & Importer
    path("api/recipes/import-preview", recipes.import_preview_view),
    path("api/recipes/bookmarklet", recipes.bookmarklet_import_view),
    path("api/recipes/import-draft/<str:token>", recipes.import_draft_view),
    path("api/ingredients/parse", recipes.parse_ingredients_view),
    path("api/recipes", recipes.recipes_collection_view),
    path("api/recipes/<str:recipe_id>", recipes.recipe_detail_view),
    path("api/images/upload", recipes.upload_image_view),
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
    # Pantry staples
    path("api/pantry-staples/toggle", pantry_staples.pantry_staple_toggle_view),
    path("api/pantry-staples", pantry_staples.pantry_staples_collection_view),
    path(
        "api/pantry-staples/<str:staple_id>",
        pantry_staples.pantry_staple_detail_view,
    ),
    # Meal plan
    path("api/meal-plan", meal_plan.meal_plan_week_view),
    path("api/meal-plan/entries", meal_plan.meal_plan_entries_view),
    path(
        "api/meal-plan/entries/<str:entry_id>",
        meal_plan.meal_plan_entry_detail_view,
    ),
    path("api/meal-plan/ingredients", meal_plan.meal_plan_ingredients_view),
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
