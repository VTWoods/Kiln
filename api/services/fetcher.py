from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

import requests

DEFAULT_TIMEOUT = 15
DEFAULT_MAX_HTML_BYTES = 5 * 1024 * 1024  # 5 MiB
DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MiB
MAX_REDIRECTS = 5

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 KilnRecipeImporter/1.0"
)


class InvalidURLError(ValueError):
    """Raised when a URL is malformed, disallowed, or resolves to a private IP."""


class FetchFailedError(RuntimeError):
    """Raised when fetching a remote resource fails."""


class ParseFailedError(RuntimeError):
    """Raised when a page was fetched but no recipe data could be extracted."""


@dataclass(frozen=True)
class FetchResult:
    body: bytes
    content_type: str
    final_url: str


def validate_http_url(raw_url: str) -> str:
    trimmed = (raw_url or "").strip()
    if not trimmed:
        raise InvalidURLError("URL is required")
    parsed = urlparse(trimmed)
    if parsed.scheme.lower() not in ("http", "https"):
        raise InvalidURLError("Only http and https URLs are supported")
    if not parsed.netloc or not parsed.hostname:
        raise InvalidURLError("URL must include a host")
    return trimmed


def _is_private_or_reserved_ip(raw_ip: str) -> bool:
    try:
        ip = ipaddress.ip_address(raw_ip)
    except ValueError:
        return True
    if (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_unspecified
        or ip.is_reserved
    ):
        return True
    # Block carrier-grade NAT (100.64.0.0/10)
    if isinstance(ip, ipaddress.IPv4Address):
        if ip in ipaddress.IPv4Network("100.64.0.0/10"):
            return True
    return False


def _assert_public_host(hostname: str) -> None:
    try:
        infos = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise FetchFailedError(f"resolve {hostname!r}: {exc}") from exc

    if not infos:
        raise FetchFailedError(f"no IP addresses found for {hostname!r}")

    for info in infos:
        ip_str = info[4][0]
        if _is_private_or_reserved_ip(ip_str):
            raise InvalidURLError(
                f"private or loopback address {hostname!r} is not allowed"
            )


class SafeFetcher:
    """HTTP GET fetcher with scheme validation, SSRF checks, redirect limits, and size caps."""

    def __init__(
        self,
        *,
        timeout: float = DEFAULT_TIMEOUT,
        allow_private_networks: bool = False,
    ) -> None:
        self.timeout = timeout
        self.allow_private_networks = allow_private_networks

    def fetch(
        self,
        raw_url: str,
        *,
        max_bytes: int = DEFAULT_MAX_HTML_BYTES,
        referer: str = "",
    ) -> FetchResult:
        current_url = validate_http_url(raw_url)
        headers = {
            "User-Agent": DEFAULT_USER_AGENT,
            "Accept": (
                "text/html,application/xhtml+xml,application/xml;q=0.9,"
                "image/avif,image/webp,image/*;q=0.8,*/*;q=0.5"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        }
        if referer:
            try:
                headers["Referer"] = validate_http_url(referer)
            except InvalidURLError:
                pass

        session = requests.Session()
        try:
            for _ in range(MAX_REDIRECTS + 1):
                parsed = urlparse(current_url)
                if not self.allow_private_networks and parsed.hostname:
                    _assert_public_host(parsed.hostname)

                try:
                    resp = session.get(
                        current_url,
                        headers=headers,
                        timeout=self.timeout,
                        allow_redirects=False,
                        stream=True,
                    )
                except requests.RequestException as exc:
                    raise FetchFailedError(f"request failed: {exc}") from exc

                try:
                    if resp.status_code in (301, 302, 303, 307, 308):
                        location = resp.headers.get("Location", "").strip()
                        if not location:
                            raise FetchFailedError(
                                f"remote server returned redirect HTTP {resp.status_code} without Location"
                            )
                        current_url = validate_http_url(urljoin(current_url, location))
                        continue

                    if resp.status_code < 200 or resp.status_code >= 300:
                        raise FetchFailedError(
                            f"remote server returned HTTP {resp.status_code}"
                        )

                    chunks: list[bytes] = []
                    total = 0
                    for chunk in resp.iter_content(chunk_size=65536):
                        if not chunk:
                            continue
                        total += len(chunk)
                        if total > max_bytes:
                            raise FetchFailedError(
                                f"response exceeded {max_bytes} bytes limit"
                            )
                        chunks.append(chunk)

                    return FetchResult(
                        body=b"".join(chunks),
                        content_type=resp.headers.get("Content-Type", ""),
                        final_url=current_url,
                    )
                finally:
                    resp.close()

            raise FetchFailedError("too many redirects")
        finally:
            session.close()
