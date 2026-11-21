"""Automatic deduplication and unit-aware merging when adding items to a shopping list."""

from __future__ import annotations

from typing import Any

import inflect
from django.db import transaction
from django.utils import timezone

from api.models import IngredientAisleOverride, Recipe, ShoppingList, ShoppingListItem
from api.services.aisle_categorizer import categorize_ingredient, normalize_aisle
from api.services.units import (
    format_quantity_range,
    normalize_unit_name,
    parse_quantity_range,
    to_us_customary,
    try_merge_quantities,
)

_INFLECT = inflect.engine()


def ingredient_merge_key(name: str) -> str:
    """Return a case-insensitive, singularized comparison key for matching ingredient names."""
    parts = " ".join(name.strip().lower().split()).split(" ")
    if not parts or not parts[0]:
        return ""
    last = parts[-1]
    singular = _INFLECT.singular_noun(last)
    if singular:
        parts[-1] = singular
    return " ".join(parts)


def _normalize_incoming_item(raw: dict[str, Any]) -> dict[str, Any]:
    name = str(raw.get("name") or "").strip()
    qty = str(raw.get("quantity") or "").strip()
    unit = normalize_unit_name(str(raw.get("unit") or "").strip())

    # Convert metric units to US customary singular units if quantity parses cleanly
    if qty and unit:
        parsed_range = parse_quantity_range(qty)
        if parsed_range is not None:
            us_low, us_high, us_unit = to_us_customary(
                parsed_range[0], parsed_range[1], unit
            )
            qty = format_quantity_range(us_low, us_high)
            unit = us_unit

    recipe_ids: list[int] = []
    raw_rids = raw.get("recipe_ids")
    if isinstance(raw_rids, (list, tuple, set)):
        for rid_val in raw_rids:
            try:
                rid = int(rid_val)
                if rid > 0 and rid not in recipe_ids:
                    recipe_ids.append(rid)
            except (TypeError, ValueError):
                pass
    raw_rid = raw.get("recipe_id")
    if raw_rid is not None:
        try:
            rid = int(raw_rid)
            if rid > 0 and rid not in recipe_ids:
                recipe_ids.append(rid)
        except (TypeError, ValueError):
            pass

    explicit_aisle = normalize_aisle(str(raw.get("aisle") or ""))

    return {
        "name": name,
        "key": ingredient_merge_key(name),
        "quantity": qty,
        "unit": unit,
        "aisle": explicit_aisle or "",
        "recipe_ids": recipe_ids,
    }


def merge_shopping_list_items(
    shopping_list: ShoppingList,
    raw_items: list[dict[str, Any]],
) -> None:
    """Normalize and merge incoming items into unchecked items on shopping_list.

    - Merges duplicate items with matching names (case-insensitive, singular/plural-aware)
      and compatible units both within the incoming batch and against existing unchecked items.
    - Records every contributing recipe on the merged item's `recipes` M2M relation.
    - Assigns a grocery store aisle using saved user overrides first, then HybridAisleCategorizer.
    - Incompatible units (e.g., '1 bunch cilantro' vs '2 tablespoon cilantro') are kept
      as separate rows so no information is lost.
    - Already checked-off items are left untouched; new additions create fresh unchecked items.
    """
    normalized_batch = [_normalize_incoming_item(it) for it in raw_items]
    normalized_batch = [it for it in normalized_batch if it["name"]]
    if not normalized_batch:
        return

    requested_recipe_ids = {
        rid for it in normalized_batch for rid in it["recipe_ids"]
    }
    existing_recipe_ids = (
        set(
            Recipe.objects.filter(pk__in=requested_recipe_ids).values_list(
                "id", flat=True
            )
        )
        if requested_recipe_ids
        else set()
    )
    for it in normalized_batch:
        it["recipe_ids"] = [
            rid for rid in it["recipe_ids"] if rid in existing_recipe_ids
        ]

    # Look up any user-remembered aisle overrides in one query
    batch_keys = {it["key"] for it in normalized_batch if it["key"]}
    overrides = (
        dict(
            IngredientAisleOverride.objects.filter(
                ingredient_key__in=batch_keys
            ).values_list("ingredient_key", "aisle")
        )
        if batch_keys
        else {}
    )
    for it in normalized_batch:
        if not it["aisle"]:
            override_aisle = overrides.get(it["key"])
            if override_aisle:
                it["aisle"] = override_aisle
            else:
                it["aisle"] = categorize_ingredient(it["name"], unit=it["unit"])

    with transaction.atomic():
        unchecked_existing = list(
            ShoppingListItem.objects.filter(
                shopping_list=shopping_list, checked=False
            ).order_by("id")
        )
        dirty_existing: dict[int, ShoppingListItem] = {}
        existing_added_recipes: dict[int, set[int]] = {}
        new_items: list[ShoppingListItem] = []
        new_item_recipe_ids: list[list[int]] = []

        for incoming in normalized_batch:
            merged = False

            # 1. Try merging into an existing unchecked DB item with the same normalized name
            for existing in unchecked_existing:
                if ingredient_merge_key(existing.name) != incoming["key"]:
                    continue
                result = try_merge_quantities(
                    existing.quantity,
                    existing.unit,
                    incoming["quantity"],
                    incoming["unit"],
                )
                if result is not None:
                    existing.quantity, existing.unit = result
                    if not existing.aisle and incoming["aisle"]:
                        existing.aisle = incoming["aisle"]
                    if incoming["recipe_ids"]:
                        if existing.recipe_id is None:
                            existing.recipe_id = incoming["recipe_ids"][0]
                        existing_added_recipes.setdefault(existing.id, set()).update(
                            incoming["recipe_ids"]
                        )
                        if existing.recipe_id is not None:
                            existing_added_recipes[existing.id].add(existing.recipe_id)
                    dirty_existing[existing.id] = existing
                    merged = True
                    break

            if merged:
                continue

            # 2. Try merging into a pending new item from the same batch
            for idx, pending in enumerate(new_items):
                if ingredient_merge_key(pending.name) != incoming["key"]:
                    continue
                result = try_merge_quantities(
                    pending.quantity,
                    pending.unit,
                    incoming["quantity"],
                    incoming["unit"],
                )
                if result is not None:
                    pending.quantity, pending.unit = result
                    for rid in incoming["recipe_ids"]:
                        if rid not in new_item_recipe_ids[idx]:
                            new_item_recipe_ids[idx].append(rid)
                    if pending.recipe_id is None and incoming["recipe_ids"]:
                        pending.recipe_id = incoming["recipe_ids"][0]
                    merged = True
                    break

            if not merged:
                rids = list(incoming["recipe_ids"])
                new_items.append(
                    ShoppingListItem(
                        shopping_list=shopping_list,
                        name=incoming["name"],
                        quantity=incoming["quantity"],
                        unit=incoming["unit"],
                        aisle=incoming["aisle"],
                        checked=False,
                        recipe_id=rids[0] if rids else None,
                    )
                )
                new_item_recipe_ids.append(rids)

        if dirty_existing:
            ShoppingListItem.objects.bulk_update(
                list(dirty_existing.values()),
                ["quantity", "unit", "aisle", "recipe_id"],
            )
        if new_items:
            ShoppingListItem.objects.bulk_create(new_items)

        # Persist all contributing recipe links in a single batch insert
        Through = ShoppingListItem.recipes.through
        through_links: list[Any] = []
        for item_id, rids_set in existing_added_recipes.items():
            for rid in sorted(rids_set):
                through_links.append(
                    Through(shoppinglistitem_id=item_id, recipe_id=rid)
                )
        for item_obj, rids in zip(new_items, new_item_recipe_ids):
            for rid in rids:
                through_links.append(
                    Through(shoppinglistitem_id=item_obj.id, recipe_id=rid)
                )
        if through_links:
            Through.objects.bulk_create(through_links, ignore_conflicts=True)

        shopping_list.updated_at = timezone.now()
        shopping_list.save(update_fields=["updated_at"])
