"""Short-lived in-memory store for bookmarklet recipe import drafts."""

from __future__ import annotations

import threading
import time
import uuid

from .importer import ImportedRecipe

DEFAULT_DRAFT_TTL_SECONDS = 600.0  # 10 minutes
MAX_DRAFTS = 50


class ImportDraftStore:
    """Thread-safe TTL cache holding parsed recipe previews handed off by the bookmarklet."""

    def __init__(
        self,
        *,
        ttl_seconds: float = DEFAULT_DRAFT_TTL_SECONDS,
        max_entries: int = MAX_DRAFTS,
    ) -> None:
        self._ttl = ttl_seconds
        self._max_entries = max_entries
        self._lock = threading.Lock()
        self._entries: dict[str, tuple[float, ImportedRecipe]] = {}

    def _prune_locked(self, now: float) -> None:
        expired = [k for k, (exp, _) in self._entries.items() if exp <= now]
        for k in expired:
            self._entries.pop(k, None)
        while len(self._entries) >= self._max_entries:
            oldest_key = min(self._entries, key=lambda k: self._entries[k][0])
            self._entries.pop(oldest_key, None)

    def save(self, preview: ImportedRecipe) -> str:
        now = time.monotonic()
        token = uuid.uuid4().hex
        with self._lock:
            self._prune_locked(now)
            self._entries[token] = (now + self._ttl, preview)
        return token

    def get(self, token: str) -> ImportedRecipe | None:
        now = time.monotonic()
        with self._lock:
            entry = self._entries.get(token)
            if entry is None:
                return None
            expires_at, preview = entry
            if expires_at <= now:
                self._entries.pop(token, None)
                return None
            return preview

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()


draft_store = ImportDraftStore()
