from __future__ import annotations

import time

from django.test import SimpleTestCase

from api.services.import_drafts import ImportDraftStore
from api.services.importer import ImportedRecipe


def _sample_preview(title: str = "Pot Roast") -> ImportedRecipe:
    return ImportedRecipe(
        title=title,
        description="",
        instructions="Braise.",
        servings=6,
        prep_minutes=15,
        cook_minutes=180,
        source_url="https://example.com/pot-roast",
        image_url="",
        candidate_images=[],
        ingredients=[],
    )


class ImportDraftStoreTests(SimpleTestCase):
    def test_save_get_and_ttl_expiry(self) -> None:
        store = ImportDraftStore(ttl_seconds=0.05, max_entries=2)
        tok = store.save(_sample_preview("Pot Roast"))

        got = store.get(tok)
        self.assertIsNotNone(got)
        assert got is not None
        self.assertEqual(got.title, "Pot Roast")

        # Still readable a second time (safe under React StrictMode)
        self.assertIsNotNone(store.get(tok))

        time.sleep(0.08)
        self.assertIsNone(store.get(tok))

    def test_prunes_oldest_when_at_capacity(self) -> None:
        store = ImportDraftStore(ttl_seconds=60.0, max_entries=2)
        t1 = store.save(_sample_preview("First"))
        t2 = store.save(_sample_preview("Second"))
        t3 = store.save(_sample_preview("Third"))

        self.assertIsNone(store.get(t1))
        self.assertIsNotNone(store.get(t2))
        self.assertIsNotNone(store.get(t3))
