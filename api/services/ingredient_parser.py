from __future__ import annotations

import html
import re
from dataclasses import dataclass

UNICODE_FRACTIONS: dict[str, str] = {
    "¼": "1/4",
    "½": "1/2",
    "¾": "3/4",
    "⅓": "1/3",
    "⅔": "2/3",
    "⅕": "1/5",
    "⅖": "2/5",
    "⅗": "3/5",
    "⅘": "4/5",
    "⅙": "1/6",
    "⅚": "5/6",
    "⅛": "1/8",
    "⅜": "3/8",
    "⅝": "5/8",
    "⅞": "7/8",
}

QUANTITY_PREFIX_RE = re.compile(
    r"^(\d+(?:\s+\d+/\d+|\.\d+|/\d+)?(?:\s*(?:[-–—]|to)\s*\d+(?:\s+\d+/\d+|\.\d+|/\d+)?)?)\s+(.*)$"
)
WHITESPACE_RE = re.compile(r"\s+")

KNOWN_UNITS: set[str] = {
    "cup", "cups", "c",
    "tbsp", "tbs", "tablespoon", "tablespoons",
    "tsp", "teaspoon", "teaspoons",
    "oz", "ounce", "ounces",
    "fl",
    "lb", "lbs", "pound", "pounds",
    "g", "gram", "grams",
    "kg", "kilogram", "kilograms",
    "ml", "milliliter", "milliliters", "millilitre", "millilitres",
    "l", "liter", "liters", "litre", "litres",
    "pt", "pint", "pints",
    "qt", "quart", "quarts",
    "gal", "gallon", "gallons",
    "clove", "cloves",
    "can", "cans",
    "pinch", "pinches",
    "dash", "dashes",
    "slice", "slices",
    "piece", "pieces",
    "bunch", "bunches",
    "sprig", "sprigs",
    "stalk", "stalks",
    "head", "heads",
    "stick", "sticks",
    "package", "packages", "pkg", "pkgs",
    "packet", "packets",
    "bag", "bags",
    "jar", "jars",
    "box", "boxes",
    "bottle", "bottles",
    "drop", "drops",
    "handful", "handfuls",
    "inch", "inches",
    "leaf", "leaves",
}


@dataclass(frozen=True)
class ImportedIngredient:
    raw: str
    quantity: str
    unit: str
    name: str

    def to_dict(self) -> dict[str, str]:
        return {
            "raw": self.raw,
            "quantity": self.quantity,
            "unit": self.unit,
            "name": self.name,
        }


def clean_whitespace(text: str) -> str:
    return WHITESPACE_RE.sub(" ", text).strip()


def clean_text(text: str) -> str:
    return clean_whitespace(html.unescape(text or ""))


def _replace_unicode_fractions(text: str) -> str:
    out: list[str] = []
    prev_digit = False
    for ch in text:
        frac = UNICODE_FRACTIONS.get(ch)
        if frac is not None:
            if prev_digit:
                out.append(" ")
            out.append(frac)
            prev_digit = False
            continue
        out.append(ch)
        prev_digit = "0" <= ch <= "9"
    return clean_whitespace("".join(out))


def _strip_leading_of(text: str) -> str:
    trimmed = text.strip()
    if len(trimmed) > 3 and trimmed[:3].lower() == "of ":
        return trimmed[3:].strip()
    return trimmed


def _split_unit_and_name(rest: str) -> tuple[str, str]:
    fields = rest.split()
    if len(fields) < 2:
        return "", rest

    first_raw = fields[0]
    first_norm = first_raw.rstrip(".,").lower()

    if first_norm in ("fl", "fluid") and len(fields) >= 3:
        second_norm = fields[1].rstrip(".,").lower()
        if second_norm in ("oz", "ounce", "ounces"):
            unit = f"{first_raw} {fields[1].rstrip(',')}"
            name = _strip_leading_of(" ".join(fields[2:]))
            return unit, name

    if first_norm in KNOWN_UNITS:
        unit = first_raw.rstrip(",")
        name = _strip_leading_of(" ".join(fields[1:]))
        return unit, name

    return "", rest


def parse_ingredient(raw: str) -> ImportedIngredient:
    cleaned = clean_text(raw)
    if not cleaned:
        return ImportedIngredient(raw="", quantity="", unit="", name="")

    normalized = _replace_unicode_fractions(cleaned)
    match = QUANTITY_PREFIX_RE.match(normalized)
    if not match:
        return ImportedIngredient(raw=cleaned, quantity="", unit="", name=cleaned)

    qty = match.group(1).strip()
    rest = match.group(2).strip()
    if not rest:
        return ImportedIngredient(raw=cleaned, quantity="", unit="", name=cleaned)

    unit, name = _split_unit_and_name(rest)
    if not name:
        return ImportedIngredient(raw=cleaned, quantity=qty, unit="", name=rest)

    return ImportedIngredient(raw=cleaned, quantity=qty, unit=unit, name=name)
