from __future__ import annotations

import json
from collections.abc import Callable
from types import SimpleNamespace

from django.test import SimpleTestCase

from api.services.fetcher import FetchFailedError, InvalidURLError, ParseFailedError
from api.services.photo_extractor import (
    DEFAULT_GEMINI_FALLBACK_MODEL,
    DEFAULT_GEMINI_MODEL,
    FALLBACK_IDLE_TIMEOUT_SECONDS,
    PRIMARY_IDLE_TIMEOUT_SECONDS,
    QUOTA_COOLDOWN_SECONDS,
    TRANSIENT_COOLDOWN_SECONDS,
    GeminiPhotoRecipeExtractor,
    ModelHealthTracker,
    PhotoExtractorUnavailableError,
)
from api.testing_utils import PNG_1X1


class _QuotaError(RuntimeError):
    def __init__(self, message: str = "429 RESOURCE_EXHAUSTED: quota exceeded") -> None:
        super().__init__(message)
        self.code = 429
        self.status = "RESOURCE_EXHAUSTED"
        self.message = message


class _AuthError(RuntimeError):
    def __init__(self, message: str = "401 UNAUTHENTICATED: invalid API key") -> None:
        super().__init__(message)
        self.code = 401
        self.status = "UNAUTHENTICATED"
        self.message = message


class _FakeClock:
    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class _FakeStream:
    """Simulates a google-genai Interactions SSE Stream with close tracking."""

    def __init__(
        self,
        events: list[object],
        *,
        on_step: Callable[[int], None] | None = None,
    ) -> None:
        self._events = list(events)
        self._on_step = on_step
        self.closed = False

    def __iter__(self):
        for idx, event in enumerate(self._events):
            if self._on_step is not None:
                self._on_step(idx)
            if isinstance(event, Exception):
                raise event
            yield event

    def close(self) -> None:
        self.closed = True


def _sse_text_stream(
    text: str,
    *,
    chunk_size: int = 40,
    on_step: Callable[[int], None] | None = None,
) -> _FakeStream:
    events: list[object] = [
        SimpleNamespace(event_type="interaction.created"),
        SimpleNamespace(
            event_type="step.delta",
            delta=SimpleNamespace(type="thought_signature", signature="sig"),
        ),
    ]
    for i in range(0, len(text), chunk_size):
        events.append(
            SimpleNamespace(
                event_type="step.delta",
                delta=SimpleNamespace(type="text", text=text[i : i + chunk_size]),
            )
        )
    events.append(
        SimpleNamespace(
            event_type="interaction.completed",
            interaction=SimpleNamespace(status="completed"),
        )
    )
    return _FakeStream(events, on_step=on_step)


class _FakeInteractions:
    def __init__(self, responses: dict[str, object]) -> None:
        self.responses = responses
        self.calls: list[dict[str, object]] = []
        self.streams: list[_FakeStream] = []

    def create(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        model = str(kwargs["model"])
        outcome = self.responses[model]
        if callable(outcome):
            outcome = outcome(kwargs)
        if isinstance(outcome, Exception):
            raise outcome
        if isinstance(outcome, str):
            stream = _sse_text_stream(outcome)
            self.streams.append(stream)
            return stream
        if isinstance(outcome, _FakeStream):
            self.streams.append(outcome)
            return outcome
        return outcome


class _FakeGenAIClient:
    def __init__(self, responses: dict[str, object]) -> None:
        self.interactions = _FakeInteractions(responses)


SAMPLE_JSON = json.dumps(
    {
        "title": "Skillet Cornbread",
        "description": "Crispy-edged cast iron cornbread.",
        "servings": 8,
        "prep_minutes": 10,
        "cook_minutes": 25,
        "ingredients": [
            "1 cup yellow cornmeal",
            "2 tbsp unsalted butter, melted",
            "1/2 tsp kosher salt",
        ],
        "steps": [
            "Preheat oven to 425°F with a cast iron skillet inside.",
            "Whisk dry ingredients, fold in wet ingredients, and bake 25 minutes.",
        ],
    }
)


class PhotoExtractorTests(SimpleTestCase):
    def test_streams_multi_photo_recipe_with_hydrogen_and_normalizes_ingredients(
        self,
    ) -> None:
        clock = _FakeClock()
        tracker = ModelHealthTracker(clock=clock)
        fake_client = _FakeGenAIClient({DEFAULT_GEMINI_MODEL: SAMPLE_JSON})
        extractor = GeminiPhotoRecipeExtractor(
            api_key="test-key",
            client=fake_client,
            health_tracker=tracker,
            clock=clock,
        )

        result = extractor.extract(
            [(PNG_1X1, "image/png"), (PNG_1X1, "image/png")],
            hint="Combine both pages",
        )

        self.assertEqual(result.model_used, "gemini-4-hydrogen")
        self.assertFalse(result.fell_back)
        self.assertEqual(result.recipe.title, "Skillet Cornbread")
        self.assertEqual(result.recipe.servings, 8)
        self.assertEqual(result.recipe.prep_minutes, 10)
        self.assertEqual(result.recipe.cook_minutes, 25)
        self.assertEqual(result.recipe.source_url, "")
        self.assertEqual(result.recipe.image_url, "")
        self.assertEqual(result.recipe.candidate_images, [])
        self.assertIn("\n\n", result.recipe.instructions)

        # Ingredients are normalized via Kiln's NLP parser
        self.assertEqual(len(result.recipe.ingredients), 3)
        self.assertEqual(result.recipe.ingredients[1].unit, "tablespoon")
        self.assertEqual(result.recipe.ingredients[1].preparation, "melted")

        # Interactions API request shape (2 images + 1 text prompt, stream=True, store=False)
        self.assertEqual(len(fake_client.interactions.calls), 1)
        call = fake_client.interactions.calls[0]
        self.assertEqual(call["model"], "gemini-4-hydrogen")
        self.assertIs(call["store"], False)
        self.assertIs(call["stream"], True)
        self.assertEqual(call["timeout"], PRIMARY_IDLE_TIMEOUT_SECONDS)
        self.assertEqual(call["generation_config"], {"thinking_level": "low"})
        input_blocks = call["input"]
        assert isinstance(input_blocks, list)
        self.assertEqual(len(input_blocks), 3)
        self.assertEqual(input_blocks[0]["type"], "text")
        self.assertIn("Combine both pages", input_blocks[0]["text"])
        self.assertEqual(input_blocks[1]["type"], "image")
        self.assertEqual(input_blocks[2]["type"], "image")
        self.assertEqual(call["response_format"]["type"], "text")
        self.assertEqual(call["response_format"]["mime_type"], "application/json")
        self.assertTrue(fake_client.interactions.streams[0].closed)

    def test_slow_actively_streaming_extraction_succeeds_past_idle_timeout(self) -> None:
        """A healthy 45s multi-page stream should finish on Hydrogen without falling back."""
        clock = _FakeClock()
        tracker = ModelHealthTracker(clock=clock)

        # Advance 5s per chunk across ~11 events (~55s total), well above the 15s idle timeout
        # but within the 90s total extraction budget.
        def slow_stream(_kwargs: object) -> _FakeStream:
            return _sse_text_stream(
                SAMPLE_JSON,
                chunk_size=50,
                on_step=lambda _idx: clock.advance(5.0),
            )

        fake_client = _FakeGenAIClient(
            {
                DEFAULT_GEMINI_MODEL: slow_stream,
                DEFAULT_GEMINI_FALLBACK_MODEL: SAMPLE_JSON,
            }
        )
        extractor = GeminiPhotoRecipeExtractor(
            api_key="test-key",
            client=fake_client,
            health_tracker=tracker,
            clock=clock,
        )

        result = extractor.extract([(PNG_1X1, "image/png")])

        self.assertEqual(result.model_used, DEFAULT_GEMINI_MODEL)
        self.assertFalse(result.fell_back)
        self.assertEqual(result.recipe.title, "Skillet Cornbread")
        self.assertEqual(len(fake_client.interactions.calls), 1)
        self.assertIsNone(tracker.get_active_cooldown(DEFAULT_GEMINI_MODEL))

    def test_exceeding_total_extraction_budget_aborts_and_falls_back(self) -> None:
        clock = _FakeClock()
        tracker = ModelHealthTracker(clock=clock)

        def runaway_stream(_kwargs: object) -> _FakeStream:
            return _sse_text_stream(
                SAMPLE_JSON,
                chunk_size=50,
                on_step=lambda _idx: clock.advance(25.0),
            )

        fake_client = _FakeGenAIClient(
            {
                DEFAULT_GEMINI_MODEL: runaway_stream,
                DEFAULT_GEMINI_FALLBACK_MODEL: SAMPLE_JSON,
            }
        )
        extractor = GeminiPhotoRecipeExtractor(
            api_key="test-key",
            client=fake_client,
            health_tracker=tracker,
            total_timeout=60.0,
            clock=clock,
        )

        result = extractor.extract([(PNG_1X1, "image/png")])

        self.assertEqual(result.model_used, DEFAULT_GEMINI_FALLBACK_MODEL)
        self.assertTrue(result.fell_back)
        self.assertTrue(fake_client.interactions.streams[0].closed)
        cooldown = tracker.get_active_cooldown(DEFAULT_GEMINI_MODEL)
        self.assertIsNotNone(cooldown)
        assert cooldown is not None
        self.assertEqual(cooldown.category, "transient")

    def test_mid_stream_error_event_falls_back_and_cools_down(self) -> None:
        clock = _FakeClock()
        tracker = ModelHealthTracker(clock=clock)
        error_stream = _FakeStream(
            [
                SimpleNamespace(event_type="interaction.created"),
                SimpleNamespace(
                    event_type="error",
                    error=SimpleNamespace(
                        code="RESOURCE_EXHAUSTED",
                        message="Quota exceeded mid-stream",
                    ),
                ),
            ]
        )
        fake_client = _FakeGenAIClient(
            {
                DEFAULT_GEMINI_MODEL: error_stream,
                DEFAULT_GEMINI_FALLBACK_MODEL: SAMPLE_JSON,
            }
        )
        extractor = GeminiPhotoRecipeExtractor(
            api_key="test-key",
            client=fake_client,
            health_tracker=tracker,
            clock=clock,
        )

        result = extractor.extract([(PNG_1X1, "image/png")])

        self.assertEqual(result.model_used, DEFAULT_GEMINI_FALLBACK_MODEL)
        self.assertTrue(result.fell_back)
        self.assertTrue(error_stream.closed)
        cooldown = tracker.get_active_cooldown(DEFAULT_GEMINI_MODEL)
        self.assertIsNotNone(cooldown)
        assert cooldown is not None
        self.assertEqual(cooldown.category, "quota")

    def test_circuit_breaker_skips_primary_during_transient_cooldown_then_recovers(
        self,
    ) -> None:
        clock = _FakeClock()
        tracker = ModelHealthTracker(clock=clock)
        responses: dict[str, object] = {
            DEFAULT_GEMINI_MODEL: TimeoutError("Read timed out"),
            DEFAULT_GEMINI_FALLBACK_MODEL: SAMPLE_JSON,
        }
        fake_client = _FakeGenAIClient(responses)
        extractor = GeminiPhotoRecipeExtractor(
            api_key="test-key",
            client=fake_client,
            health_tracker=tracker,
            clock=clock,
        )

        # 1) Primary stalls -> falls back and enters 15-minute cooldown
        first = extractor.extract([(PNG_1X1, "image/png")])
        self.assertEqual(first.model_used, DEFAULT_GEMINI_FALLBACK_MODEL)
        self.assertTrue(first.fell_back)
        self.assertEqual(
            [c["model"] for c in fake_client.interactions.calls],
            [DEFAULT_GEMINI_MODEL, DEFAULT_GEMINI_FALLBACK_MODEL],
        )
        self.assertEqual(
            fake_client.interactions.calls[1]["timeout"],
            FALLBACK_IDLE_TIMEOUT_SECONDS,
        )

        # 2) Five minutes later, Hydrogen is skipped immediately (zero calls to Hydrogen)
        clock.advance(5 * 60.0)
        second = extractor.extract([(PNG_1X1, "image/png")])
        self.assertEqual(second.model_used, DEFAULT_GEMINI_FALLBACK_MODEL)
        self.assertTrue(second.fell_back)
        self.assertEqual(
            [c["model"] for c in fake_client.interactions.calls],
            [
                DEFAULT_GEMINI_MODEL,
                DEFAULT_GEMINI_FALLBACK_MODEL,
                DEFAULT_GEMINI_FALLBACK_MODEL,
            ],
        )

        # 3) After cooldown expires, Hydrogen is tried again and recovers
        clock.advance(TRANSIENT_COOLDOWN_SECONDS)
        responses[DEFAULT_GEMINI_MODEL] = SAMPLE_JSON
        third = extractor.extract([(PNG_1X1, "image/png")])
        self.assertEqual(third.model_used, DEFAULT_GEMINI_MODEL)
        self.assertFalse(third.fell_back)
        self.assertEqual(
            fake_client.interactions.calls[-1]["model"],
            DEFAULT_GEMINI_MODEL,
        )
        self.assertIsNone(tracker.get_active_cooldown(DEFAULT_GEMINI_MODEL))

    def test_downgrades_to_flash_lite_on_quota_exhaustion_with_longer_cooldown(
        self,
    ) -> None:
        clock = _FakeClock()
        tracker = ModelHealthTracker(clock=clock)
        responses: dict[str, object] = {
            DEFAULT_GEMINI_MODEL: _QuotaError(),
            DEFAULT_GEMINI_FALLBACK_MODEL: SAMPLE_JSON,
        }
        fake_client = _FakeGenAIClient(responses)
        extractor = GeminiPhotoRecipeExtractor(
            api_key="test-key",
            client=fake_client,
            health_tracker=tracker,
            clock=clock,
        )

        result = extractor.extract([(PNG_1X1, "image/png")])

        self.assertEqual(result.model_used, "gemini-3.5-flash-lite")
        self.assertTrue(result.fell_back)
        self.assertEqual(result.recipe.title, "Skillet Cornbread")
        self.assertEqual(
            [c["model"] for c in fake_client.interactions.calls],
            ["gemini-4-hydrogen", "gemini-3.5-flash-lite"],
        )
        self.assertEqual(
            fake_client.interactions.calls[1]["generation_config"],
            {"thinking_level": "minimal"},
        )

        # Still in quota cooldown after 30 minutes (longer than 15m transient cooldown)
        clock.advance(30 * 60.0)
        self.assertIsNotNone(tracker.get_active_cooldown(DEFAULT_GEMINI_MODEL))
        extractor.extract([(PNG_1X1, "image/png")])
        self.assertEqual(
            fake_client.interactions.calls[-1]["model"],
            DEFAULT_GEMINI_FALLBACK_MODEL,
        )

        # After 60 minutes total, primary is probed again
        clock.advance(QUOTA_COOLDOWN_SECONDS - 30 * 60.0 + 1.0)
        responses[DEFAULT_GEMINI_MODEL] = SAMPLE_JSON
        recovered = extractor.extract([(PNG_1X1, "image/png")])
        self.assertEqual(recovered.model_used, DEFAULT_GEMINI_MODEL)
        self.assertFalse(recovered.fell_back)

    def test_does_not_fallback_or_cooldown_on_non_quota_error(self) -> None:
        clock = _FakeClock()
        tracker = ModelHealthTracker(clock=clock)
        fake_client = _FakeGenAIClient(
            {
                DEFAULT_GEMINI_MODEL: _AuthError(),
                DEFAULT_GEMINI_FALLBACK_MODEL: SAMPLE_JSON,
            }
        )
        extractor = GeminiPhotoRecipeExtractor(
            api_key="test-key",
            client=fake_client,
            health_tracker=tracker,
            clock=clock,
        )

        with self.assertRaises(FetchFailedError):
            extractor.extract([(PNG_1X1, "image/png")])
        self.assertEqual(len(fake_client.interactions.calls), 1)
        self.assertIsNone(tracker.get_active_cooldown(DEFAULT_GEMINI_MODEL))

    def test_validation_and_missing_api_key(self) -> None:
        extractor = GeminiPhotoRecipeExtractor(api_key="")
        with self.assertRaises(InvalidURLError):
            extractor.extract([])
        with self.assertRaises(InvalidURLError):
            extractor.extract([(PNG_1X1, "image/png")] * 4)
        with self.assertRaises(InvalidURLError):
            extractor.extract([(b"not an image", "text/plain")])
        with self.assertRaises(PhotoExtractorUnavailableError):
            extractor.extract([(PNG_1X1, "image/png")])

    def test_empty_recipe_raises_parse_failed(self) -> None:
        clock = _FakeClock()
        tracker = ModelHealthTracker(clock=clock)
        empty_json = json.dumps(
            {
                "title": "",
                "description": "",
                "servings": 1,
                "prep_minutes": 0,
                "cook_minutes": 0,
                "ingredients": [],
                "steps": [],
            }
        )
        fake_client = _FakeGenAIClient({DEFAULT_GEMINI_MODEL: empty_json})
        extractor = GeminiPhotoRecipeExtractor(
            api_key="test-key",
            client=fake_client,
            health_tracker=tracker,
            clock=clock,
        )
        with self.assertRaises(ParseFailedError):
            extractor.extract([(PNG_1X1, "image/png")])
