#!/usr/bin/env python3
"""Extract recipe data from HTML on stdin using recipe-scrapers.

Usage:
    scrape_recipe.py <url> < page.html

Outputs a single JSON object to stdout on success, or writes an error message
to stderr and exits non-zero on failure.
"""

from __future__ import annotations

import json
import sys
from typing import Any, Callable

from recipe_scrapers import scrape_html


def safe_call(fn: Callable[[], Any], default: Any = None) -> Any:
    try:
        value = fn()
        return default if value is None else value
    except Exception:
        return default


def safe_int(value: Any) -> int:
    try:
        n = int(round(float(value)))
        return n if n > 0 else 0
    except Exception:
        return 0


def main() -> int:
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        print("usage: scrape_recipe.py <url>", file=sys.stderr)
        return 2

    url = sys.argv[1].strip()
    html = sys.stdin.read()
    if not html.strip():
        print("empty HTML input", file=sys.stderr)
        return 2

    try:
        scraper = scrape_html(html, org_url=url, supported_only=False)
    except Exception as exc:
        print(f"scrape_html failed: {exc}", file=sys.stderr)
        return 1

    title = str(safe_call(scraper.title, "") or "").strip()
    description = str(safe_call(scraper.description, "") or "").strip()
    raw_ingredients = safe_call(scraper.ingredients, []) or []
    ingredients = [str(item).strip() for item in raw_ingredients if str(item).strip()]

    instructions_list = safe_call(scraper.instructions_list, []) or []
    instructions = [str(step).strip() for step in instructions_list if str(step).strip()]
    if not instructions:
        raw_instructions = str(safe_call(scraper.instructions, "") or "").strip()
        if raw_instructions:
            instructions = [
                line.strip() for line in raw_instructions.splitlines() if line.strip()
            ]

    prep_minutes = safe_int(safe_call(scraper.prep_time, 0))
    cook_minutes = safe_int(safe_call(scraper.cook_time, 0))
    total_minutes = safe_int(safe_call(scraper.total_time, 0))
    if prep_minutes == 0 and cook_minutes == 0 and total_minutes > 0:
        cook_minutes = total_minutes

    yields = str(safe_call(scraper.yields, "") or "").strip()
    image = str(safe_call(scraper.image, "") or "").strip()

    if not title and not ingredients and not instructions:
        print("no recipe content found on page", file=sys.stderr)
        return 1

    payload = {
        "title": title,
        "description": description,
        "ingredients": ingredients,
        "instructions": instructions,
        "prep_minutes": prep_minutes,
        "cook_minutes": cook_minutes,
        "yields": yields,
        "image": image,
    }
    json.dump(payload, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
