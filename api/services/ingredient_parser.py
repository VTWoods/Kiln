"""Ingredient parsing and normalization backed by ingredient-parser-nlp."""

from __future__ import annotations

import html
import logging
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from fractions import Fraction
from typing import Any

from ingredient_parser import parse_ingredient as nlp_parse_ingredient
from ingredient_parser.dataclasses import (
    CompositeIngredientAmount,
    IngredientAmount,
    UnitSystem,
)

from .units import (
    format_quantity_range,
    normalize_unit_name,
    to_us_customary,
)

logger = logging.getLogger(__name__)

WHITESPACE_RE = re.compile(r"\s+")

CONTAINER_UNITS = {"can", "jar", "bottle", "package", "packet", "bag", "box", "container"}


@dataclass(frozen=True)
class ImportedIngredient:
    raw: str
    quantity: str
    unit: str
    name: str
    preparation: str = ""

    def to_dict(self) -> dict[str, str]:
        return {
            "raw": self.raw,
            "quantity": self.quantity,
            "unit": self.unit,
            "name": self.name,
            "preparation": self.preparation,
        }


def clean_whitespace(text: str) -> str:
    return WHITESPACE_RE.sub(" ", text).strip()


def clean_text(text: str) -> str:
    return clean_whitespace(html.unescape(text or ""))


class IngredientParser(ABC):
    """Swappable interface for parsing & normalizing raw recipe ingredient strings."""

    @abstractmethod
    def parse(self, raw: str) -> ImportedIngredient:
        raise NotImplementedError


def _to_float(val: Any) -> float | None:
    if val is None or val == "":
        return None
    if isinstance(val, (int, float, Fraction)):
        return float(val)
    try:
        return float(Fraction(str(val)))
    except (ValueError, ZeroDivisionError):
        try:
            return float(str(val))
        except ValueError:
            return None


def _extract_amount(
    amounts: list[IngredientAmount | CompositeIngredientAmount],
) -> tuple[str, str]:
    if not amounts:
        return "", ""

    # Unwrap CompositeIngredientAmount if returned
    flat: list[IngredientAmount] = []
    for item in amounts:
        if isinstance(item, CompositeIngredientAmount):
            flat.extend(item.amounts)
        elif isinstance(item, IngredientAmount):
            flat.append(item)

    if not flat:
        return "", ""

    # Case 1: Container + per-unit size (e.g., "2 (14.5-ounce) cans" -> 29 ounce)
    if len(flat) >= 2:
        first, second = flat[0], flat[1]
        first_unit = normalize_unit_name(first.unit)
        second_unit = normalize_unit_name(second.unit)
        if first_unit in CONTAINER_UNITS and getattr(second, "SINGULAR", False) and second_unit:
            c_low = _to_float(first.quantity)
            c_high = _to_float(first.quantity_max) or c_low
            s_low = _to_float(second.quantity)
            s_high = _to_float(second.quantity_max) or s_low
            if c_low is not None and s_low is not None:
                tot_low = c_low * s_low
                tot_high = (c_high or c_low) * (s_high or s_low)
                us_low, us_high, us_unit = to_us_customary(tot_low, tot_high, second_unit)
                return format_quantity_range(us_low, us_high), us_unit

    # Case 2: Primary amount is metric with a US customary equivalent listed
    # (e.g. "200 g (7 oz)") -> prefer the US customary one.
    # Do NOT override non-metric primary amounts like counts or packages
    # (e.g. "4 medium carrots (10 ounces; 275g)" stays 4 carrots).
    chosen = flat[0]
    if len(flat) > 1 and flat[0].unit_system == UnitSystem.METRIC:
        for candidate in flat[1:]:
            if candidate.unit_system == UnitSystem.US_CUSTOMARY and not getattr(
                candidate, "SINGULAR", False
            ):
                chosen = candidate
                break

    low = _to_float(chosen.quantity)
    high = _to_float(chosen.quantity_max)
    if high is None:
        high = low

    norm_unit = normalize_unit_name(chosen.unit)
    if low is None:
        return "", norm_unit

    us_low, us_high, us_unit = to_us_customary(low, high if high is not None else low, norm_unit)
    return format_quantity_range(us_low, us_high), us_unit


_SIZE_QUALIFIERS = frozenset({"small", "medium", "large", "extra-large", "jumbo", "mini"})


def _split_unit_size_prefix(unit: str) -> tuple[str, str]:
    """Split a leading size adjective out of a unit (e.g. 'medium clove' -> ('clove', 'medium'))."""
    parts = unit.split()
    if len(parts) >= 2 and parts[0].lower() in _SIZE_QUALIFIERS:
        return " ".join(parts[1:]), parts[0].lower()
    return unit, ""


class NLPIngredientParser(IngredientParser):
    """IngredientParser powered by ingredient-parser-nlp with US singular unit normalization."""

    def parse(self, raw: str) -> ImportedIngredient:
        cleaned = clean_text(raw)
        if not cleaned:
            return ImportedIngredient(
                raw="", quantity="", unit="", name="", preparation=""
            )

        try:
            parsed = nlp_parse_ingredient(
                cleaned,
                separate_names=False,
                discard_isolated_stop_words=True,
                expect_name_in_output=True,
                volumetric_units_system="us_customary",
            )
        except Exception as exc:
            logger.warning("NLP ingredient parsing failed for %r: %s", cleaned, exc)
            return ImportedIngredient(
                raw=cleaned, quantity="", unit="", name=cleaned, preparation=""
            )

        quantity, unit = _extract_amount(list(parsed.amount or []))
        unit, unit_size = _split_unit_size_prefix(unit)

        # Combine extracted ingredient name tokens cleanly
        name_parts = [
            clean_whitespace(n.text)
            for n in (parsed.name or [])
            if n and clean_whitespace(n.text)
        ]
        if len(name_parts) == 1:
            name = name_parts[0]
        elif len(name_parts) > 1:
            name = " and ".join(name_parts)
        else:
            name = cleaned

        # Normalize casing gently (preserve acronyms like BBQ if all-caps, else lowercase)
        if name and not name.isupper():
            name = name.lower()

        # Combine size, preparation, comment, and purpose into the preparation column
        prep_parts: list[str] = []
        if unit_size:
            prep_parts.append(unit_size)
        for field in (parsed.size, parsed.preparation, parsed.comment, parsed.purpose):
            if field is not None:
                txt = clean_whitespace(field.text).strip(",; ")
                if txt and txt.lower() not in [p.lower() for p in prep_parts]:
                    prep_parts.append(txt)
        preparation = ", ".join(prep_parts)

        return ImportedIngredient(
            raw=cleaned,
            quantity=quantity,
            unit=unit,
            name=name,
            preparation=preparation,
        )


_DEFAULT_PARSER: IngredientParser = NLPIngredientParser()


def parse_ingredient(raw: str) -> ImportedIngredient:
    """Parse and normalize a raw ingredient line into US singular units + preparation."""
    return _DEFAULT_PARSER.parse(raw)
