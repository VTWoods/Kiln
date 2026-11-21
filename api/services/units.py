"""Unit normalization, metric-to-US customary conversion, and quantity merging.

Uses:
- `pint` for unit alias resolution, dimension checks, metric->US conversion, and unit math.
- `inflect` for singularizing non-physical culinary units (cloves -> clove, leaves -> leaf, etc.).
- `unicodedata` for parsing Unicode vulgar fractions (½, ¼, ¾, ⅓, ...).
"""

from __future__ import annotations

import math
import re
import unicodedata
from fractions import Fraction
from typing import Any

import inflect
import pint

UREG = pint.UnitRegistry()
_INFLECT = inflect.engine()

# Only the handful of culinary abbreviations Pint doesn't recognize or parses ambiguously
# (e.g., "fl oz" -> femtoliter*ounce, "c" -> speed of light, "t" -> metric ton).
_CULINARY_OVERRIDES: dict[str, str] = {
    "fl oz": "fluid_ounce",
    "fl. oz": "fluid_ounce",
    "fl. oz.": "fluid_ounce",
    "fluid ounce": "fluid_ounce",
    "fluid ounces": "fluid_ounce",
    "tbs": "tablespoon",
    "tbl": "tablespoon",
    "tbls": "tablespoon",
    "c": "cup",
    "t": "teaspoon",
    "pkg": "package",
    "pkgs": "package",
}

# Culinary words that Pint would misinterpret via SI prefixes (e.g. "pinch" -> picoinch).
_NON_PHYSICAL_UNITS = {"pinch", "pinches"}

# Physical units we actively convert/merge via Pint (prevents random SI prefix matches).
_US_MASS_UNITS = {"ounce", "pound"}
_US_VOLUME_UNITS = {
    "teaspoon",
    "tablespoon",
    "fluid_ounce",
    "cup",
    "pint",
    "quart",
    "gallon",
}
_METRIC_MASS_UNITS = {"milligram", "gram", "kilogram"}
_METRIC_VOLUME_UNITS = {"milliliter", "centiliter", "deciliter", "liter"}
_METRIC_LENGTH_UNITS = {"millimeter", "centimeter", "meter"}
_ALLOWED_PINT_UNITS = (
    _US_MASS_UNITS
    | _US_VOLUME_UNITS
    | _METRIC_MASS_UNITS
    | _METRIC_VOLUME_UNITS
    | _METRIC_LENGTH_UNITS
    | {"inch"}
)

_COMMON_DENOMINATORS = (1, 2, 3, 4, 8)
_RANGE_SPLIT_RE = re.compile(r"\s*(?:[-–—]|\bto\b)\s*", re.IGNORECASE)
_MIXED_FRAC_RE = re.compile(r"^(\d+)\s+(\d+)/(\d+)$")
_SIMPLE_FRAC_RE = re.compile(r"^(\d+)/(\d+)$")


def _parse_pint_unit(raw: Any) -> pint.Unit | None:
    """Resolve raw to a Pint culinary mass/volume/length Unit, or None if non-physical."""
    if raw is None:
        return None
    if isinstance(raw, pint.Unit):
        name = str(raw).removeprefix("us_")
        return UREG.Unit(name) if name in _ALLOWED_PINT_UNITS else None

    cleaned = re.sub(r"\s+", " ", str(raw).replace("_", " ").strip().rstrip(".,").lower())
    if not cleaned or cleaned == "dimensionless" or cleaned in _NON_PHYSICAL_UNITS:
        return None
    if cleaned.startswith("us "):
        cleaned = cleaned[3:].strip()

    token = _CULINARY_OVERRIDES.get(cleaned, cleaned)
    try:
        parsed = UREG.parse_units(token)
    except Exception:
        return None

    canonical = str(parsed).removeprefix("us_")
    return parsed if canonical in _ALLOWED_PINT_UNITS else None


def normalize_unit_name(unit: Any) -> str:
    """Return a canonical full singular unit name (e.g., 'tablespoon', 'fluid ounce', 'clove')."""
    if unit is None:
        return ""
    raw = str(unit).strip()
    if not raw or raw == "dimensionless":
        return ""

    pint_unit = _parse_pint_unit(unit)
    if pint_unit is not None:
        return str(pint_unit).removeprefix("us_").replace("_", " ")

    cleaned = re.sub(r"\s+", " ", raw.replace("_", " ").strip().rstrip(".,").lower())
    cleaned = _CULINARY_OVERRIDES.get(cleaned, cleaned).replace("_", " ")
    if not cleaned:
        return ""

    singular = _INFLECT.singular_noun(cleaned)
    return singular if isinstance(singular, str) and singular else cleaned


def _pick_us_mass(q_low: pint.Quantity, q_high: pint.Quantity) -> tuple[float, float, str]:
    oz_low = float(q_low.to("ounce").magnitude)
    oz_high = float(q_high.to("ounce").magnitude)
    if max(oz_low, oz_high) >= 16.0:
        return oz_low / 16.0, oz_high / 16.0, "pound"
    return oz_low, oz_high, "ounce"


def _pick_us_volume(q_low: pint.Quantity, q_high: pint.Quantity) -> tuple[float, float, str]:
    tsp_low = float(q_low.to("teaspoon").magnitude)
    tsp_high = float(q_high.to("teaspoon").magnitude)
    ref = max(tsp_low, tsp_high)
    # 1 tbsp = 3 tsp; 1 cup = 48 tsp; 1 qt = 192 tsp; 1 gal = 768 tsp
    if ref >= 768.0:
        return tsp_low / 768.0, tsp_high / 768.0, "gallon"
    if ref >= 192.0:
        return tsp_low / 192.0, tsp_high / 192.0, "quart"
    if ref >= 12.0:  # >= 1/4 cup
        return tsp_low / 48.0, tsp_high / 48.0, "cup"
    if ref >= 3.0:  # >= 1 tablespoon
        return tsp_low / 3.0, tsp_high / 3.0, "tablespoon"
    return tsp_low, tsp_high, "teaspoon"


def to_us_customary(low: float, high: float, unit: Any) -> tuple[float, float, str]:
    """Convert metric mass/volume/length units to natural US customary singular units."""
    pint_unit = _parse_pint_unit(unit)
    if pint_unit is None:
        return low, high, normalize_unit_name(unit)

    unit_name = str(pint_unit).removeprefix("us_")
    q_low = UREG.Quantity(low, pint_unit)
    q_high = UREG.Quantity(high, pint_unit)

    if unit_name in _METRIC_MASS_UNITS:
        return _pick_us_mass(q_low, q_high)
    if unit_name in _METRIC_VOLUME_UNITS:
        return _pick_us_volume(q_low, q_high)
    if unit_name in _METRIC_LENGTH_UNITS:
        return (
            float(q_low.to("inch").magnitude),
            float(q_high.to("inch").magnitude),
            "inch",
        )
    return low, high, unit_name.replace("_", " ")


def _parse_single_number(token: str) -> float | None:
    s = token.strip()
    if not s:
        return None

    # Handle trailing Unicode vulgar fractions like "1½" or "½" via stdlib unicodedata.
    if len(s) >= 1 and unicodedata.category(s[-1]) == "No":
        frac_val = unicodedata.numeric(s[-1], None)
        if frac_val is not None:
            prefix = s[:-1].strip()
            if not prefix:
                return float(frac_val)
            base = _parse_single_number(prefix)
            return (base + float(frac_val)) if base is not None else None

    m = _MIXED_FRAC_RE.match(s)
    if m:
        whole, num, den = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return whole + (num / den) if den != 0 else None
    m = _SIMPLE_FRAC_RE.match(s)
    if m:
        num, den = int(m.group(1)), int(m.group(2))
        return (num / den) if den != 0 else None
    try:
        val = float(s)
        return val if math.isfinite(val) and val >= 0 else None
    except ValueError:
        return None


def parse_quantity_range(raw: str) -> tuple[float, float] | None:
    """Parse a quantity string (number, fraction, mixed fraction, or range) into (low, high)."""
    cleaned = (raw or "").strip()
    if not cleaned:
        return None
    parts = _RANGE_SPLIT_RE.split(cleaned)
    if len(parts) == 1:
        val = _parse_single_number(parts[0])
        return (val, val) if val is not None else None
    if len(parts) == 2:
        low = _parse_single_number(parts[0])
        high = _parse_single_number(parts[1])
        if low is not None and high is not None:
            return (min(low, high), max(low, high))
    return None


def format_quantity(val: float | Fraction) -> str:
    """Format a quantity cleanly as an integer, common cooking fraction, or rounded decimal."""
    fval = float(val)
    if not math.isfinite(fval) or fval <= 0:
        return ""

    for den in _COMMON_DENOMINATORS:
        scaled = fval * den
        nearest = round(scaled)
        if nearest > 0 and abs(scaled - nearest) < 1e-4:
            frac = Fraction(nearest, den)
            whole, rem = divmod(frac.numerator, frac.denominator)
            if rem == 0:
                return str(whole)
            return f"{rem}/{frac.denominator}" if whole == 0 else f"{whole} {rem}/{frac.denominator}"

    rounded = round(fval, 2) or round(fval, 3)
    return f"{rounded:.2f}".rstrip("0").rstrip(".")


def format_quantity_range(low: float | Fraction, high: float | Fraction) -> str:
    low_str = format_quantity(low)
    high_str = format_quantity(high)
    if not low_str:
        return high_str
    if not high_str or low_str == high_str:
        return low_str
    return f"{low_str}-{high_str}"


def try_merge_quantities(
    qty1: str, unit1: str, qty2: str, unit2: str
) -> tuple[str, str] | None:
    """Merge two (quantity, unit) pairs into a single normalized US (quantity, unit).

    Returns None when units are incompatible or non-empty quantities cannot be parsed.
    """
    u1_str = normalize_unit_name(unit1)
    u2_str = normalize_unit_name(unit2)
    q1_str = (qty1 or "").strip()
    q2_str = (qty2 or "").strip()

    if not q1_str and not q2_str and u1_str == u2_str:
        return ("", u1_str)

    r1 = parse_quantity_range(q1_str)
    r2 = parse_quantity_range(q2_str)
    if r1 is None or r2 is None:
        return None

    pu1 = _parse_pint_unit(unit1)
    pu2 = _parse_pint_unit(unit2)

    if pu1 is not None and pu2 is not None:
        q1_low, q1_high = UREG.Quantity(r1[0], pu1), UREG.Quantity(r1[1], pu1)
        q2_low, q2_high = UREG.Quantity(r2[0], pu2), UREG.Quantity(r2[1], pu2)
        if not q1_low.is_compatible_with(q2_low):
            return None
        sum_low = q1_low + q2_low
        sum_high = q1_high + q2_high
        if sum_low.check("[mass]"):
            fl, fh, fu = _pick_us_mass(sum_low, sum_high)
            return (format_quantity_range(fl, fh), fu)
        if sum_low.check("[volume]"):
            fl, fh, fu = _pick_us_volume(sum_low, sum_high)
            return (format_quantity_range(fl, fh), fu)
        if sum_low.check("[length]"):
            return (
                format_quantity_range(
                    float(sum_low.to("inch").magnitude),
                    float(sum_high.to("inch").magnitude),
                ),
                "inch",
            )

    if u1_str == u2_str:
        return (format_quantity_range(r1[0] + r2[0], r1[1] + r2[1]), u1_str)

    return None
