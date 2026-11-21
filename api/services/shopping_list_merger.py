"""Automatic deduplication and unit-aware merging when adding items to a shopping list."""

from __future__ import annotations

from typing import Any

from django.db import transaction
from django.utils import timezone

from api.models import Recipe, ShoppingList, ShoppingListItem
from api.services.units import (
    format_quantity_range,
    normalize_unit_name,
    parse_quantity_range,
    to_us_customary,
    try_merge_quantities,
)


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

    recipe_id: int | None = None
    raw_rid = raw.get("recipe_id")
    if raw_rid is not None:
        try:
            rid = int(raw_rid)
            if rid > 0:
                recipe_id = rid
        except (TypeError, ValueError):
            pass

    return {
        "name": name,
        "key": name.lower(),
        "quantity": qty,
        "unit": unit,
        "recipe_id": recipe_id,
    }


def merge_shopping_list_items(
    shopping_list: ShoppingList,
    raw_items: list[dict[str, Any]],
) -> None:
    """Normalize and merge incoming items into unchecked items on shopping_list.

    - Merges duplicate items with matching names (case-insensitive) and compatible units
      both within the incoming batch and against existing unchecked list items.
    - Incompatible units (e.g., '1 bunch cilantro' vs '2 tablespoon cilantro') are kept
      as separate rows so no information is lost.
    - Already checked-off items are left untouched; new additions create fresh unchecked items.
    """
    normalized_batch = [_normalize_incoming_item(it) for it in raw_items]
    normalized_batch = [it for it in normalized_batch if it["name"]]
    if not normalized_batch:
        return

    existing_recipe_ids = set(
        Recipe.objects.filter(
            pk__in=[it["recipe_id"] for it in normalized_batch if it["recipe_id"]]
        ).values_list("id", flat=True)
    )
    for it in normalized_batch:
        if it["recipe_id"] not in existing_recipe_ids:
            it["recipe_id"] = None

    with transaction.atomic():
        unchecked_existing = list(
            ShoppingListItem.objects.filter(
                shopping_list=shopping_list, checked=False
            ).order_by("id")
        )
        dirty_existing: dict[int, ShoppingListItem] = {}
        new_items: list[ShoppingListItem] = []

        for incoming in normalized_batch:
            merged = False

            # 1. Try merging into an existing unchecked DB item with the same normalized name
            for existing in unchecked_existing:
                if existing.name.strip().lower() != incoming["key"]:
                    continue
                result = try_merge_quantities(
                    existing.quantity,
                    existing.unit,
                    incoming["quantity"],
                    incoming["unit"],
                )
                if result is not None:
                    existing.quantity, existing.unit = result
                    if existing.recipe_id is None and incoming["recipe_id"] is not None:
                        existing.recipe_id = incoming["recipe_id"]
                    dirty_existing[existing.id] = existing
                    merged = True
                    break

            if merged:
                continue

            # 2. Try merging into a pending new item from the same batch
            for pending in new_items:
                if pending.name.strip().lower() != incoming["key"]:
                    continue
                result = try_merge_quantities(
                    pending.quantity,
                    pending.unit,
                    incoming["quantity"],
                    incoming["unit"],
                )
                if result is not None:
                    pending.quantity, pending.unit = result
                    if pending.recipe_id is None and incoming["recipe_id"] is not None:
                        pending.recipe_id = incoming["recipe_id"]
                    merged = True
                    break

            if not merged:
                new_items.append(
                    ShoppingListItem(
                        shopping_list=shopping_list,
                        name=incoming["name"],
                        quantity=incoming["quantity"],
                        unit=incoming["unit"],
                        checked=False,
                        recipe_id=incoming["recipe_id"],
                    )
                )

        if dirty_existing:
            ShoppingListItem.objects.bulk_update(
                list(dirty_existing.values()),
                ["quantity", "unit", "recipe_id"],
            )
        if new_items:
            ShoppingListItem.objects.bulk_create(new_items)

        shopping_list.updated_at = timezone.now()
        shopping_list.save(update_fields=["updated_at"])
