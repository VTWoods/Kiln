from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Callable

from recipe_scrapers import scrape_html

from .fetcher import (
    DEFAULT_MAX_HTML_BYTES,
    InvalidURLError,
    ParseFailedError,
    SafeFetcher,
    validate_http_url,
)
from .images import extract_candidate_images
from .ingredient_parser import ImportedIngredient, clean_text, parse_ingredient

FIRST_INT_RE = re.compile(r"\d+")
MAX_SUPPLIED_HTML_BYTES = 10 * 1024 * 1024  # 10 MiB


@dataclass(frozen=True)
class ImportedRecipe:
    title: str
    description: str
    instructions: str
    servings: int
    prep_minutes: int
    cook_minutes: int
    source_url: str
    image_url: str
    candidate_images: list[str]
    ingredients: list[ImportedIngredient]

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "description": self.description,
            "instructions": self.instructions,
            "servings": self.servings,
            "prep_minutes": self.prep_minutes,
            "cook_minutes": self.cook_minutes,
            "source_url": self.source_url,
            "image_url": self.image_url,
            "candidate_images": self.candidate_images,
            "ingredients": [ing.to_dict() for ing in self.ingredients],
        }


class RecipeImporter(ABC):
    """Provider-agnostic interface for extracting recipes from URLs or supplied HTML."""

    @abstractmethod
    def import_url(self, raw_url: str) -> ImportedRecipe:
        raise NotImplementedError

    @abstractmethod
    def import_html(self, raw_url: str, html_bytes: bytes) -> ImportedRecipe:
        raise NotImplementedError


def _safe_call(fn: Callable[[], Any], default: Any = None) -> Any:
    try:
        value = fn()
        return default if value is None else value
    except Exception:
        return default


def _safe_int(value: Any) -> int:
    try:
        n = int(round(float(value)))
        return n if n > 0 else 0
    except Exception:
        return 0


def _parse_servings(yields: str) -> int:
    match = FIRST_INT_RE.search(yields or "")
    if not match:
        return 1
    try:
        n = int(match.group(0))
        return n if n > 0 else 1
    except ValueError:
        return 1


class RecipeScrapersImporter(RecipeImporter):
    """RecipeImporter backed directly by Python's recipe-scrapers library."""

    def __init__(self, fetcher: SafeFetcher | None = None) -> None:
        self.fetcher = fetcher or SafeFetcher()

    def import_url(self, raw_url: str) -> ImportedRecipe:
        fetched = self.fetcher.fetch(raw_url, max_bytes=DEFAULT_MAX_HTML_BYTES)
        return self.import_html(fetched.final_url, fetched.body)

    def import_html(self, raw_url: str, html_bytes: bytes) -> ImportedRecipe:
        clean_url = validate_http_url(raw_url)
        if not html_bytes or not html_bytes.strip():
            raise InvalidURLError("Page HTML is required")
        if len(html_bytes) > MAX_SUPPLIED_HTML_BYTES:
            raise InvalidURLError("Page HTML exceeds 10 MB limit")

        html_text = html_bytes.decode("utf-8", errors="replace")

        try:
            scraper = scrape_html(
                html_text, org_url=clean_url, supported_only=False
            )
        except Exception as exc:
            raise ParseFailedError(f"recipe-scrapers failed: {exc}") from exc

        title = clean_text(str(_safe_call(scraper.title, "") or ""))
        description = clean_text(str(_safe_call(scraper.description, "") or ""))

        raw_ingredients = _safe_call(scraper.ingredients, []) or []
        ingredients: list[ImportedIngredient] = []
        for raw in raw_ingredients:
            parsed = parse_ingredient(str(raw))
            if parsed.name:
                ingredients.append(parsed)

        raw_steps = _safe_call(scraper.instructions_list, []) or []
        steps = [clean_text(str(s)) for s in raw_steps if clean_text(str(s))]
        if not steps:
            raw_inst = str(_safe_call(scraper.instructions, "") or "").strip()
            if raw_inst:
                steps = [
                    clean_text(line)
                    for line in raw_inst.splitlines()
                    if clean_text(line)
                ]

        if not title and not ingredients and not steps:
            raise ParseFailedError("no recipe details found on page")

        prep_minutes = _safe_int(_safe_call(scraper.prep_time, 0))
        cook_minutes = _safe_int(_safe_call(scraper.cook_time, 0))
        total_minutes = _safe_int(_safe_call(scraper.total_time, 0))
        if prep_minutes == 0 and cook_minutes == 0 and total_minutes > 0:
            cook_minutes = total_minutes

        servings = _parse_servings(str(_safe_call(scraper.yields, "") or ""))
        primary_image = str(_safe_call(scraper.image, "") or "").strip()

        candidate_images = extract_candidate_images(
            clean_url, html_bytes, primary_image
        )
        selected_image = candidate_images[0] if candidate_images else ""

        return ImportedRecipe(
            title=title,
            description=description,
            instructions="\n\n".join(steps),
            servings=servings,
            prep_minutes=prep_minutes,
            cook_minutes=cook_minutes,
            source_url=clean_url,
            image_url=selected_image,
            candidate_images=candidate_images,
            ingredients=ingredients,
        )
