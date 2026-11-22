from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from .fetcher import (
    DEFAULT_MAX_IMAGE_BYTES,
    FetchFailedError,
    InvalidURLError,
    SafeFetcher,
)

MAX_CANDIDATE_IMAGES = 12
LOCAL_IMAGE_PREFIX = "/api/images/"

JUNK_IMAGE_TOKENS = (
    "favicon",
    "gravatar.com",
    "/avatar",
    "sprite",
    "pixel.gif",
    "1x1",
    "spacer",
    "badge",
    "logo",
    "icon-",
    "/icons/",
    "doubleclick",
    "adservice",
    "facebook.com/tr",
    "pinterest.com/v3",
)

MIME_TO_EXT: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
}


def is_local_image_url(raw_url: str) -> bool:
    return (raw_url or "").strip().startswith(LOCAL_IMAGE_PREFIX)


def _resolve_image_url(base_url: str, raw: str) -> str:
    trimmed = (raw or "").strip()
    if not trimmed or trimmed.lower().startswith("data:"):
        return ""
    resolved = urljoin(base_url, trimmed)
    parsed = urlparse(resolved)
    if parsed.scheme.lower() not in ("http", "https") or not parsed.netloc:
        return ""
    return resolved


def _looks_like_junk_image_url(raw_url: str) -> bool:
    lower = raw_url.lower()
    path_only = lower.split("?", 1)[0].split("#", 1)[0]
    if path_only.endswith(".svg") or path_only.endswith(".ico"):
        return True
    return any(token in lower for token in JUNK_IMAGE_TOKENS)


def _parse_pixel_attr(raw: str | None) -> int | None:
    if not raw:
        return None
    cleaned = str(raw).strip().lower().removesuffix("px").strip()
    try:
        return int(cleaned)
    except ValueError:
        return None


def _is_small_img(tag: Any) -> bool:
    min_dim = 120
    w = _parse_pixel_attr(tag.get("width"))
    if w is not None and 0 < w < min_dim:
        return True
    h = _parse_pixel_attr(tag.get("height"))
    if h is not None and 0 < h < min_dim:
        return True
    return False


def _pick_best_srcset_url(srcset: str) -> str:
    best_url = ""
    best_width = -1
    for part in srcset.split(","):
        fields = part.strip().split()
        if not fields:
            continue
        candidate = fields[0]
        width = 0
        if len(fields) >= 2 and fields[1].endswith("w"):
            try:
                width = int(fields[1][:-1])
            except ValueError:
                width = 0
        if not best_url or width > best_width:
            best_url = candidate
            best_width = width
    return best_url


def _collect_jsonld_images(node: Any, add: Any) -> None:
    if isinstance(node, list):
        for item in node:
            _collect_jsonld_images(item, add)
    elif isinstance(node, dict):
        if "image" in node:
            _extract_image_field(node["image"], add)
        if "@graph" in node:
            _collect_jsonld_images(node["@graph"], add)


def _extract_image_field(val: Any, add: Any) -> None:
    if isinstance(val, str):
        add(val)
    elif isinstance(val, list):
        for item in val:
            _extract_image_field(item, add)
    elif isinstance(val, dict):
        if isinstance(val.get("url"), str):
            add(val["url"])
        if isinstance(val.get("contentUrl"), str):
            add(val["contentUrl"])


def extract_candidate_images(
    base_url: str, html_bytes: bytes, primary_image: str = ""
) -> list[str]:
    seen: set[str] = set()
    candidates: list[str] = []

    def add_candidate(raw: str) -> None:
        if len(candidates) >= MAX_CANDIDATE_IMAGES:
            return
        resolved = _resolve_image_url(base_url, raw)
        if not resolved or resolved in seen or _looks_like_junk_image_url(resolved):
            return
        seen.add(resolved)
        candidates.append(resolved)

    add_candidate(primary_image)

    soup = BeautifulSoup(html_bytes, "html.parser")

    # JSON-LD images
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw_json = (script.string or script.get_text() or "").strip()
        if not raw_json:
            continue
        try:
            payload = json.loads(raw_json)
        except json.JSONDecodeError:
            continue
        _collect_jsonld_images(payload, add_candidate)

    # OpenGraph / Twitter meta images
    meta_queries = (
        {"property": "og:image"},
        {"property": "og:image:secure_url"},
        {"name": "twitter:image"},
        {"name": "twitter:image:src"},
    )
    for attrs in meta_queries:
        for meta in soup.find_all("meta", attrs=attrs):
            content = meta.get("content")
            if isinstance(content, str):
                add_candidate(content)

    # Prominent <img> tags
    for img in soup.find_all("img"):
        if len(candidates) >= MAX_CANDIDATE_IMAGES:
            break
        if _is_small_img(img):
            continue
        added = False
        for attr in ("src", "data-src", "data-lazy-src", "data-original"):
            val = img.get(attr)
            if isinstance(val, str) and val.strip():
                add_candidate(val)
                added = True
                break
        if not added:
            srcset = img.get("srcset")
            if isinstance(srcset, str) and srcset.strip():
                best = _pick_best_srcset_url(srcset)
                if best:
                    add_candidate(best)

    return candidates


def _sniff_image_ext(header_ct: str, data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if len(data) >= 12 and data[4:8] == b"ftyp" and b"avif" in data[8:16]:
        return ".avif"

    media_type = (header_ct or "").split(";", 1)[0].strip().lower()
    return MIME_TO_EXT.get(media_type)


class ImageStore:
    """Downloads remote recipe photos and caches them locally on disk."""

    def __init__(self, directory: Path | str, fetcher: SafeFetcher | None = None) -> None:
        self.dir = Path(directory).resolve()
        self.fetcher = fetcher or SafeFetcher()

    def save_bytes(self, data: bytes, content_type: str = "") -> str:
        if not data:
            raise InvalidURLError("image file is empty")
        if len(data) > DEFAULT_MAX_IMAGE_BYTES:
            raise InvalidURLError("image exceeds 10 MB limit")

        ext = _sniff_image_ext(content_type, data)
        if not ext:
            raise InvalidURLError("unsupported image format (use JPG, PNG, WebP, GIF, or AVIF)")

        self.dir.mkdir(parents=True, exist_ok=True)
        filename = f"{uuid.uuid4()}{ext}"
        dest = self.dir / filename
        dest.write_bytes(data)
        return f"{LOCAL_IMAGE_PREFIX}{filename}"

    def save_from_url(self, raw_url: str, referer: str = "") -> str:
        result = self.fetcher.fetch(
            raw_url, max_bytes=DEFAULT_MAX_IMAGE_BYTES, referer=referer
        )
        if not result.body:
            raise FetchFailedError("remote image was empty")

        ext = _sniff_image_ext(result.content_type, result.body)
        if not ext:
            raise InvalidURLError("URL did not return a supported image format")

        self.dir.mkdir(parents=True, exist_ok=True)
        filename = f"{uuid.uuid4()}{ext}"
        dest = self.dir / filename
        dest.write_bytes(result.body)
        return f"{LOCAL_IMAGE_PREFIX}{filename}"

    def file_path(self, filename: str) -> Path | None:
        cleaned = Path(filename).name
        if (
            not cleaned
            or cleaned in (".", "..")
            or cleaned != filename
            or "/" in filename
            or "\\" in filename
        ):
            return None
        return self.dir / cleaned

    def delete_local(self, image_url: str) -> None:
        if not is_local_image_url(image_url):
            return
        filename = image_url.strip().removeprefix(LOCAL_IMAGE_PREFIX)
        path = self.file_path(filename)
        if path and path.is_file():
            try:
                path.unlink()
            except OSError:
                pass
