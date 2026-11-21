"""Management command to normalize legacy recipe ingredients and optionally re-merge shopping lists."""

from __future__ import annotations

from typing import Any

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import Recipe, RecipeIngredient, ShoppingList, ShoppingListItem
from api.services.ingredient_parser import parse_ingredient
from api.services.shopping_list_merger import merge_shopping_list_items


def _combine_preparation(existing: str, parsed_prep: str) -> str:
    parts: list[str] = []
    for chunk in (parsed_prep, existing):
        for piece in (chunk or "").split(","):
            cleaned = piece.strip()
            if cleaned and cleaned.lower() not in [p.lower() for p in parts]:
                parts.append(cleaned)
    return ", ".join(parts)


class Command(BaseCommand):
    help = "Re-parse and normalize recipe ingredients using NLPIngredientParser."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument(
            "--recipe-id",
            type=int,
            default=None,
            help="Only normalize ingredients for a single recipe ID.",
        )
        parser.add_argument(
            "--remerge-shopping-lists",
            action="store_true",
            help="Also normalize and re-merge unchecked items across all shopping lists.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show proposed changes without modifying the database.",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        recipe_id: int | None = options["recipe_id"]
        remerge_lists: bool = options["remerge_shopping_lists"]
        dry_run: bool = options["dry_run"]

        recipes_qs = Recipe.objects.all().order_by("id")
        if recipe_id is not None:
            recipes_qs = recipes_qs.filter(pk=recipe_id)

        updated_count = 0
        for recipe in recipes_qs:
            ingredients = list(
                RecipeIngredient.objects.filter(recipe=recipe).order_by("sort_order", "id")
            )
            dirty: list[RecipeIngredient] = []
            for ing in ingredients:
                raw = " ".join(
                    p.strip() for p in (ing.quantity, ing.unit, ing.name) if p and p.strip()
                )
                if not raw:
                    continue
                parsed = parse_ingredient(raw)
                new_qty = parsed.quantity
                new_unit = parsed.unit
                new_name = parsed.name or ing.name
                new_prep = _combine_preparation(ing.preparation, parsed.preparation)

                if (
                    new_qty != ing.quantity
                    or new_unit != ing.unit
                    or new_name != ing.name
                    or new_prep != ing.preparation
                ):
                    self.stdout.write(
                        f"Recipe #{recipe.id} ({recipe.title}): "
                        f"({ing.quantity!r}, {ing.unit!r}, {ing.name!r}, {ing.preparation!r}) -> "
                        f"({new_qty!r}, {new_unit!r}, {new_name!r}, {new_prep!r})"
                    )
                    ing.quantity = new_qty
                    ing.unit = new_unit
                    ing.name = new_name
                    ing.preparation = new_prep
                    dirty.append(ing)
                    updated_count += 1

            if dirty and not dry_run:
                RecipeIngredient.objects.bulk_update(
                    dirty, ["quantity", "unit", "name", "preparation"]
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"{'Would update' if dry_run else 'Updated'} {updated_count} recipe ingredient(s)."
            )
        )

        if remerge_lists:
            for sl in ShoppingList.objects.all().order_by("id"):
                unchecked = list(
                    ShoppingListItem.objects.filter(
                        shopping_list=sl, checked=False
                    )
                    .prefetch_related("recipes")
                    .order_by("id")
                )
                if not unchecked:
                    continue

                normalized_items: list[dict[str, Any]] = []
                for item in unchecked:
                    raw = " ".join(
                        p.strip()
                        for p in (item.quantity, item.unit, item.name)
                        if p and p.strip()
                    )
                    parsed = parse_ingredient(raw)
                    rids = [r.id for r in item.recipes.all()]
                    if item.recipe_id is not None and item.recipe_id not in rids:
                        rids.append(item.recipe_id)
                    normalized_items.append(
                        {
                            "quantity": parsed.quantity,
                            "unit": parsed.unit,
                            "name": parsed.name or item.name,
                            "recipe_ids": rids,
                        }
                    )

                if dry_run:
                    self.stdout.write(
                        f"Would normalize and re-merge {len(unchecked)} unchecked item(s) "
                        f"on shopping list #{sl.id} ({sl.name})."
                    )
                    continue

                with transaction.atomic():
                    ShoppingListItem.objects.filter(
                        pk__in=[it.id for it in unchecked]
                    ).delete()
                    merge_shopping_list_items(sl, normalized_items)

                after_count = ShoppingListItem.objects.filter(
                    shopping_list=sl, checked=False
                ).count()
                self.stdout.write(
                    self.style.SUCCESS(
                        f"Shopping list #{sl.id} ({sl.name}): "
                        f"{len(unchecked)} -> {after_count} unchecked item(s) after normalization & merge."
                    )
                )
