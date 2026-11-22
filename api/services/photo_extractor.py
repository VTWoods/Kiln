"""Multimodal photo-to-recipe extraction service (swappable ABC + Gemini implementation)."""

from __future__ import annotations

import base64
import json
import logging
import threading
import time
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .fetcher import DEFAULT_MAX_IMAGE_BYTES, FetchFailedError, InvalidURLError, ParseFailedError
from .images import _sniff_image_ext
from .importer import ImportedRecipe
from .ingredient_parser import ImportedIngredient, clean_text, parse_ingredient

logger = logging.getLogger(__name__)

MAX_PHOTO_IMPORT_FILES = 3
DEFAULT_GEMINI_MODEL = "gemini-4-hydrogen"
DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite"

# Streaming timeouts:
# - Idle/per-chunk read timeout detects a hung/unresponsive model quickly.
# - Total wall-clock budget lets legitimately large multi-page extractions finish
#   as long as SSE events keep streaming.
PRIMARY_IDLE_TIMEOUT_SECONDS = 15.0
FALLBACK_IDLE_TIMEOUT_SECONDS = 30.0
TOTAL_EXTRACTION_TIMEOUT_SECONDS = 90.0

# Circuit-breaker cooldowns for the primary model after fallback-eligible failures.
TRANSIENT_COOLDOWN_SECONDS = 15 * 60.0
QUOTA_COOLDOWN_SECONDS = 60 * 60.0

EXT_TO_MIME: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif",
}

RECIPE_EXTRACTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "title": {
            "type": "string",
            "description": "Recipe title.",
        },
        "description": {
            "type": "string",
            "description": "One short sentence, in your own words, summarizing the dish (empty string if unclear). Do not copy the headnote.",
        },
        "servings": {
            "type": "integer",
            "description": "Number of servings as a positive integer (default 1 if not mentioned).",
        },
        "prep_minutes": {
            "type": "integer",
            "description": "Preparation time in minutes (0 if not mentioned).",
        },
        "cook_minutes": {
            "type": "integer",
            "description": "Cooking or baking time in minutes (0 if not mentioned; if only total time is listed, put it here).",
        },
        "ingredients": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Full list of ingredient lines from the recipe, one per item, "
                "including quantity, unit, ingredient name, and preparation notes "
                "(e.g. '2 cups all-purpose flour', '3 cloves garlic, minced')."
            ),
        },
        "steps": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Ordered list of concise cooking steps rewritten in your own words "
                "(keep every temperature, time, quantity, and technique), without leading step numbers."
            ),
        },
    },
    "required": [
        "title",
        "description",
        "servings",
        "prep_minutes",
        "cook_minutes",
        "ingredients",
        "steps",
    ],
}

_BASE_PROMPT = (
    "You are helping a home cook save a recipe from their own cookbook or recipe card into a personal meal-planning app. "
    "Read the provided photo(s) and return the recipe as structured data. "
    "Multiple photos may show consecutive pages or the front and back of the same recipe — "
    "combine them in order into one complete recipe. "
    "Ingredients: list each ingredient line with its quantity, unit, name, and preparation notes "
    "(convert vulgar fractions like ½ to 1/2, and keep notes like 'chopped' or 'divided'). "
    "Steps: do NOT transcribe the directions verbatim. Rewrite them as short, plain, imperative steps "
    "in your own words, like notes a cook would jot down — drop anecdotes, tips, and filler, "
    "but keep every temperature, time, quantity, doneness cue, and technique so the recipe still works. "
    "Description: write at most one short sentence of your own; never copy the headnote or introduction. "
    "If prep time, cook time, or servings are not shown, use 0 for times and 1 for servings. "
    "If no recipe is visible in the photo(s), return empty strings and empty arrays."
)


class PhotoExtractorUnavailableError(RuntimeError):
    """Raised when photo recipe extraction is not configured on the server."""


@dataclass(frozen=True)
class PhotoExtractionResult:
    recipe: ImportedRecipe
    model_used: str
    fell_back: bool = False


class PhotoRecipeExtractor(ABC):
    """Provider-agnostic interface for extracting recipes from uploaded photos."""

    @abstractmethod
    def extract(
        self,
        images: list[tuple[bytes, str]],
        *,
        hint: str = "",
    ) -> PhotoExtractionResult:
        raise NotImplementedError


def _safe_int(value: Any, *, default: int = 0, minimum: int = 0) -> int:
    try:
        n = int(round(float(value)))
    except (TypeError, ValueError):
        return default
    return max(n, minimum)


def _classify_fallback_error(exc: Exception) -> str | None:
    """Classify a fallback-eligible exception as 'quota' or 'transient', or None otherwise."""
    if isinstance(exc, TimeoutError):
        return "transient"

    exc_type_name = type(exc).__name__.lower()
    if "timeout" in exc_type_name:
        return "transient"

    for attr in ("code", "status_code"):
        val = getattr(exc, attr, None)
        if val == 429:
            return "quota"
        if val in (500, 503, 504):
            return "transient"

    status = str(getattr(exc, "status", "") or "").upper()
    if any(token in status for token in ("RESOURCE_EXHAUSTED", "TOO_MANY_REQUESTS")):
        return "quota"
    if any(token in status for token in ("DEADLINE_EXCEEDED", "UNAVAILABLE")):
        return "transient"

    msg = f"{getattr(exc, 'message', '') or ''} {exc}".lower()
    quota_tokens = (
        "resource_exhausted",
        "resource exhausted",
        "quota",
        "rate limit",
        "rate_limit",
        "too many requests",
        "429",
        "not available on the free tier",
        "free tier",
    )
    if any(token in msg for token in quota_tokens):
        return "quota"

    transient_tokens = (
        "timed out",
        "timeout",
        "deadline_exceeded",
        "unavailable",
        "overloaded",
    )
    if any(token in msg for token in transient_tokens):
        return "transient"

    return None


def _is_fallback_eligible_error(exc: Exception) -> bool:
    """Return True when an exception indicates quota/tier exhaustion, timeout, or transient unavailability."""
    return _classify_fallback_error(exc) is not None


@dataclass(frozen=True)
class ModelCooldown:
    until: float
    category: str  # "quota" or "transient"
    reason: str


class ModelHealthTracker:
    """Thread-safe in-memory circuit breaker / cooldown tracker for Gemini models."""

    def __init__(
        self,
        *,
        clock: Callable[[], float] = time.monotonic,
        transient_cooldown_seconds: float = TRANSIENT_COOLDOWN_SECONDS,
        quota_cooldown_seconds: float = QUOTA_COOLDOWN_SECONDS,
    ) -> None:
        self._clock = clock
        self._transient_cooldown_seconds = transient_cooldown_seconds
        self._quota_cooldown_seconds = quota_cooldown_seconds
        self._lock = threading.Lock()
        self._cooldowns: dict[str, ModelCooldown] = {}

    def get_active_cooldown(self, model_name: str) -> ModelCooldown | None:
        now = self._clock()
        with self._lock:
            entry = self._cooldowns.get(model_name)
            if entry is None:
                return None
            if now >= entry.until:
                del self._cooldowns[model_name]
                return None
            return entry

    def remaining_seconds(self, model_name: str) -> float:
        entry = self.get_active_cooldown(model_name)
        if entry is None:
            return 0.0
        return max(0.0, entry.until - self._clock())

    def record_failure(self, model_name: str, *, category: str, reason: str) -> float:
        duration = (
            self._quota_cooldown_seconds
            if category == "quota"
            else self._transient_cooldown_seconds
        )
        now = self._clock()
        with self._lock:
            self._cooldowns[model_name] = ModelCooldown(
                until=now + duration,
                category=category,
                reason=reason,
            )
        return duration

    def record_success(self, model_name: str) -> None:
        with self._lock:
            self._cooldowns.pop(model_name, None)

    def reset(self) -> None:
        with self._lock:
            self._cooldowns.clear()


_DEFAULT_HEALTH_TRACKER = ModelHealthTracker()


class _StreamError(RuntimeError):
    """Raised when the Interactions SSE stream emits an error event."""

    def __init__(self, message: str, *, code: Any = None, status: str = "") -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.message = message


def _thinking_level_for_model(model_name: str) -> str:
    return "minimal" if "flash-lite" in model_name.lower() else "low"


def _parse_extracted_payload(raw_text: str) -> ImportedRecipe:
    text = (raw_text or "").strip()
    if not text:
        raise ParseFailedError("Gemini returned an empty response")

    # Strip accidental markdown code fences if a model ever wraps JSON
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ParseFailedError(f"failed to parse extracted recipe JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise ParseFailedError("extracted recipe JSON was not an object")

    title = clean_text(str(data.get("title") or ""))
    description = clean_text(str(data.get("description") or ""))
    servings = _safe_int(data.get("servings"), default=1, minimum=1)
    prep_minutes = _safe_int(data.get("prep_minutes"), default=0, minimum=0)
    cook_minutes = _safe_int(data.get("cook_minutes"), default=0, minimum=0)

    raw_ingredients = data.get("ingredients")
    ingredients: list[ImportedIngredient] = []
    if isinstance(raw_ingredients, list):
        for raw in raw_ingredients:
            line = clean_text(str(raw or ""))
            if not line:
                continue
            parsed = parse_ingredient(line)
            if parsed.name:
                ingredients.append(parsed)

    raw_steps = data.get("steps")
    steps: list[str] = []
    if isinstance(raw_steps, list):
        for step in raw_steps:
            cleaned = clean_text(str(step or ""))
            if cleaned:
                steps.append(cleaned)

    if not title and not ingredients and not steps:
        raise ParseFailedError(
            "Could not find a recipe in the uploaded photo(s). Try a clearer or closer shot."
        )

    return ImportedRecipe(
        title=title,
        description=description,
        instructions="\n\n".join(steps),
        servings=servings,
        prep_minutes=prep_minutes,
        cook_minutes=cook_minutes,
        source_url="",
        image_url="",
        candidate_images=[],
        ingredients=ingredients,
    )


class GeminiPhotoRecipeExtractor(PhotoRecipeExtractor):
    """Extracts structured recipes from 1–3 photos via the Gemini Interactions API.

    Uses SSE streaming (`stream=True`) so a hung/unresponsive primary model fails over
    quickly on an idle read timeout while legitimately large multi-page extractions can
    continue streaming up to `total_timeout`. Tracks primary model failures in an
    in-memory cooldown circuit breaker (`ModelHealthTracker`) to avoid paying repeated
    failover stalls or hammering depleted quota.
    """

    def __init__(
        self,
        *,
        api_key: str,
        model: str = DEFAULT_GEMINI_MODEL,
        fallback_model: str = DEFAULT_GEMINI_FALLBACK_MODEL,
        client: Any = None,
        health_tracker: ModelHealthTracker | None = None,
        primary_idle_timeout: float = PRIMARY_IDLE_TIMEOUT_SECONDS,
        fallback_idle_timeout: float = FALLBACK_IDLE_TIMEOUT_SECONDS,
        total_timeout: float = TOTAL_EXTRACTION_TIMEOUT_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.api_key = (api_key or "").strip()
        self.model = (model or DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
        self.fallback_model = (fallback_model or "").strip()
        self._client = client
        self._health_tracker = (
            health_tracker if health_tracker is not None else _DEFAULT_HEALTH_TRACKER
        )
        self._primary_idle_timeout = primary_idle_timeout
        self._fallback_idle_timeout = fallback_idle_timeout
        self._total_timeout = total_timeout
        self._clock = clock

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        if not self.api_key:
            raise PhotoExtractorUnavailableError(
                "Photo recipe import is not configured. Set GEMINI_API_KEY on the server."
            )
        try:
            from google import genai
        except ImportError as exc:
            raise PhotoExtractorUnavailableError(
                "google-genai SDK is not installed on the server."
            ) from exc
        # Disable SDK-level retries so failover & circuit breaker trigger immediately
        # after the idle read timeout or a 429/503 instead of retrying 4× in the background.
        self._client = genai.Client(
            api_key=self.api_key,
            http_options={"retry_options": {"attempts": 1}},
        )
        return self._client

    def _validate_images(
        self, images: list[tuple[bytes, str]]
    ) -> list[tuple[bytes, str]]:
        if not images:
            raise InvalidURLError("at least one recipe photo is required")
        if len(images) > MAX_PHOTO_IMPORT_FILES:
            raise InvalidURLError(
                f"upload at most {MAX_PHOTO_IMPORT_FILES} photos at a time"
            )

        validated: list[tuple[bytes, str]] = []
        for idx, (data, content_type) in enumerate(images, start=1):
            if not data:
                raise InvalidURLError(f"photo #{idx} is empty")
            if len(data) > DEFAULT_MAX_IMAGE_BYTES:
                raise InvalidURLError(f"photo #{idx} exceeds 10 MB limit")
            ext = _sniff_image_ext(content_type, data)
            if not ext or ext not in EXT_TO_MIME:
                raise InvalidURLError(
                    f"photo #{idx} is not a supported image format (use JPG, PNG, WebP, GIF, or AVIF)"
                )
            validated.append((data, EXT_TO_MIME[ext]))
        return validated

    def _call_model(
        self,
        client: Any,
        model_name: str,
        input_blocks: list[dict[str, Any]],
        *,
        idle_timeout: float,
        total_timeout: float,
    ) -> str:
        t0 = self._clock()
        first_event_at: float | None = None
        response = client.interactions.create(
            model=model_name,
            input=input_blocks,
            generation_config={
                "thinking_level": _thinking_level_for_model(model_name),
            },
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": RECIPE_EXTRACTION_SCHEMA,
            },
            store=False,
            stream=True,
            timeout=idle_timeout,
        )

        # Backwards-compatible fallback if a test double returns a non-stream response
        if not hasattr(response, "__iter__"):
            text = str(getattr(response, "output_text", None) or "")
            logger.info(
                "Gemini %s extracted recipe photo(s) in %.1fs (%d chars)",
                model_name,
                self._clock() - t0,
                len(text),
            )
            return text

        chunks: list[str] = []
        completed_text = ""
        try:
            for event in response:
                now = self._clock()
                if first_event_at is None:
                    first_event_at = now
                if now - t0 > total_timeout:
                    raise TimeoutError(
                        f"Gemini {model_name} exceeded {total_timeout:.0f}s total extraction budget"
                    )

                event_type = getattr(event, "event_type", "")
                if event_type == "error":
                    err = getattr(event, "error", None)
                    err_code = getattr(err, "code", None)
                    err_msg = (
                        getattr(err, "message", None)
                        or str(err or "stream error")
                    )
                    raise _StreamError(
                        str(err_msg),
                        code=err_code,
                        status=str(err_code or ""),
                    )

                if event_type == "step.delta":
                    delta = getattr(event, "delta", None)
                    if getattr(delta, "type", None) == "text":
                        delta_text = getattr(delta, "text", None)
                        if delta_text:
                            chunks.append(str(delta_text))
                elif event_type == "interaction.completed":
                    interaction = getattr(event, "interaction", None)
                    maybe_text = getattr(interaction, "output_text", None)
                    if maybe_text:
                        completed_text = str(maybe_text)
        finally:
            close_fn = getattr(response, "close", None)
            if callable(close_fn):
                try:
                    close_fn()
                except Exception:
                    pass

        text = "".join(chunks) if chunks else completed_text
        total_elapsed = self._clock() - t0
        ttfe = (first_event_at - t0) if first_event_at is not None else total_elapsed
        logger.info(
            "Gemini %s streamed recipe photo(s) in %.1fs (first event %.1fs, %d chars)",
            model_name,
            total_elapsed,
            ttfe,
            len(text),
        )
        return text

    def extract(
        self,
        images: list[tuple[bytes, str]],
        *,
        hint: str = "",
    ) -> PhotoExtractionResult:
        validated = self._validate_images(images)
        client = self._get_client()

        prompt = _BASE_PROMPT
        clean_hint = (hint or "").strip()
        if clean_hint:
            prompt = f"{_BASE_PROMPT}\n\nAdditional user note: {clean_hint}"

        input_blocks: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        for data, mime_type in validated:
            input_blocks.append(
                {
                    "type": "image",
                    "data": base64.b64encode(data).decode("ascii"),
                    "mime_type": mime_type,
                }
            )

        has_fallback = bool(self.fallback_model) and self.fallback_model != self.model
        primary_idle_timeout = (
            self._primary_idle_timeout if has_fallback else self._fallback_idle_timeout
        )

        # Circuit breaker: if primary is in cooldown, route directly to fallback without waiting.
        active_cooldown = (
            self._health_tracker.get_active_cooldown(self.model)
            if has_fallback
            else None
        )
        if active_cooldown is not None:
            remaining = self._health_tracker.remaining_seconds(self.model)
            logger.info(
                "Skipping %s (in %s cooldown for %.0fs more); using %s directly",
                self.model,
                active_cooldown.category,
                remaining,
                self.fallback_model,
            )
            try:
                raw_text = self._call_model(
                    client,
                    self.fallback_model,
                    input_blocks,
                    idle_timeout=self._fallback_idle_timeout,
                    total_timeout=self._total_timeout,
                )
            except Exception as fallback_exc:
                raise FetchFailedError(
                    f"Gemini photo extraction failed on {self.fallback_model} "
                    f"({self.model} is in cooldown): {fallback_exc}"
                ) from fallback_exc
            recipe = _parse_extracted_payload(raw_text)
            return PhotoExtractionResult(
                recipe=recipe,
                model_used=self.fallback_model,
                fell_back=True,
            )

        model_used = self.model
        fell_back = False
        try:
            raw_text = self._call_model(
                client,
                self.model,
                input_blocks,
                idle_timeout=primary_idle_timeout,
                total_timeout=self._total_timeout,
            )
            self._health_tracker.record_success(self.model)
        except Exception as exc:
            failure_category = _classify_fallback_error(exc)
            can_fallback = has_fallback and failure_category is not None
            if not can_fallback:
                raise FetchFailedError(f"Gemini photo extraction failed: {exc}") from exc

            assert failure_category is not None
            cooldown_seconds = self._health_tracker.record_failure(
                self.model,
                category=failure_category,
                reason=str(exc),
            )
            logger.warning(
                "Gemini model %s failed (%s: %s); cooling down for %.0fm and falling back to %s",
                self.model,
                failure_category,
                exc,
                cooldown_seconds / 60.0,
                self.fallback_model,
            )
            model_used = self.fallback_model
            fell_back = True
            try:
                raw_text = self._call_model(
                    client,
                    self.fallback_model,
                    input_blocks,
                    idle_timeout=self._fallback_idle_timeout,
                    total_timeout=self._total_timeout,
                )
            except Exception as fallback_exc:
                raise FetchFailedError(
                    f"Gemini photo extraction failed on both {self.model} and "
                    f"{self.fallback_model}: {fallback_exc}"
                ) from fallback_exc

        recipe = _parse_extracted_payload(raw_text)
        return PhotoExtractionResult(
            recipe=recipe,
            model_used=model_used,
            fell_back=fell_back,
        )
