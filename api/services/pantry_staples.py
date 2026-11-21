"""Pantry staple management and matching for recipe-to-shopping-list filtering."""

from __future__ import annotations

import re

from api.models import PantryStaple
from api.services.shopping_list_merger import ingredient_merge_key

DEFAULT_PANTRY_STAPLES: tuple[str, ...] = (
    # Water & ice
    "water",
    "ice",
    # Salt & pepper
    "salt",
    "kosher salt",
    "sea salt",
    "table salt",
    "flaky salt",
    "black pepper",
    "pepper",
    "white pepper",
    "peppercorns",
    # Cooking oils
    "olive oil",
    "extra-virgin olive oil",
    "vegetable oil",
    "canola oil",
    "neutral oil",
    "avocado oil",
    "sesame oil",
    "cooking oil",
    "cooking spray",
    # Baking & dry basics
    "all-purpose flour",
    "flour",
    "sugar",
    "granulated sugar",
    "brown sugar",
    "powdered sugar",
    "baking powder",
    "baking soda",
    "cornstarch",
    "vanilla extract",
    # Common dried spices & seasonings
    "bay leaves",
    "paprika",
    "smoked paprika",
    "cumin",
    "cinnamon",
    "chili powder",
    "cayenne pepper",
    "garlic powder",
    "onion powder",
    "red pepper flakes",
    "crushed red pepper",
    "dried oregano",
    "dried thyme",
    "dried basil",
    "italian seasoning",
    "nutmeg",
    "turmeric",
    # Common condiments & vinegars
    "soy sauce",
    "worcestershire sauce",
    "apple cider vinegar",
    "balsamic vinegar",
    "red wine vinegar",
    "white wine vinegar",
    "white vinegar",
    "rice vinegar",
    "dijon mustard",
    "mustard",
    "ketchup",
    "mayonnaise",
    "hot sauce",
    "sriracha",
    "fish sauce",
    "honey",
    "maple syrup",
)

_FRESH_PRODUCE_UNITS = frozenset({"sprig", "bunch", "head", "stalk", "bulb", "ear", "rib"})
_WATER_MODIFIER_RE = re.compile(
    r"^(?:cold|warm|hot|boiling|lukewarm|tepid|room-temperature|ice|tap|filtered)\s+water$"
)
_PEPPER_MODIFIER_RE = re.compile(
    r"^(?:freshly\s+)?(?:ground|cracked|coarse)\s+(?:black|white)?\s*pepper(?:corns?)?$"
)
_COMPOUND_SPLIT_RE = re.compile(r"\s+(?:and|&)\s+", re.IGNORECASE)


def get_pantry_staple_keys() -> set[str]:
    """Return the current set of normalized ingredient keys marked as pantry staples."""
    return set(PantryStaple.objects.values_list("ingredient_key", flat=True))


def is_ingredient_staple(
    name: str,
    unit: str = "",
    staple_keys: set[str] | None = None,
) -> bool:
    """Return True if an ingredient matches the user's PantryStaple table."""
    cleaned = " ".join((name or "").strip().lower().split())
    if not cleaned:
        return False

    keys = staple_keys if staple_keys is not None else get_pantry_staple_keys()
    if not keys:
        return False

    norm_unit = (unit or "").strip().lower()
    key = ingredient_merge_key(cleaned)

    # 1. Direct normalized match (e.g. "kosher salt", "olive oil", "bay leaves", "soy sauce")
    if key in keys:
        return True

    # 2. Compound seasoning lines like "kosher salt and black pepper" where every part is a staple
    if " and " in cleaned or " & " in cleaned:
        parts = [p.strip() for p in _COMPOUND_SPLIT_RE.split(cleaned) if p.strip()]
        if len(parts) >= 2 and all(
            is_ingredient_staple(part, unit="", staple_keys=keys) for part in parts
        ):
            return True

    # Do not fuzzily match fresh produce herbs (e.g. "fresh thyme", "4 sprig thyme")
    if norm_unit in _FRESH_PRODUCE_UNITS or cleaned.startswith("fresh "):
        return False

    # 3. Common qualified forms of water and ground pepper
    if _WATER_MODIFIER_RE.match(cleaned) and "water" in keys:
        return True
    if _PEPPER_MODIFIER_RE.match(cleaned) and (
        "black pepper" in keys or "pepper" in keys
    ):
        return True

    return False
