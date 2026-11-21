from __future__ import annotations

import ipaddress
import socket
import threading
import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse, urlunparse

import pychromecast
from pychromecast.config import APP_DASHCAST
from pychromecast.controllers.dashcast import DashCastController

DEFAULT_CAST_PORT = 8009
DEFAULT_SCAN_TIMEOUT = 3.0


class InvalidCastTargetError(ValueError):
    """Raised when a Cast device host or target URL is invalid."""


@dataclass(frozen=True)
class CastDevice:
    name: str
    model: str
    host: str
    port: int
    uuid: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "model": self.model,
            "host": self.host,
            "port": self.port,
            "uuid": self.uuid,
        }


class Caster(ABC):
    """Provider-agnostic interface for discovering and casting to Google Cast devices."""

    @abstractmethod
    def discover(self, timeout: float = DEFAULT_SCAN_TIMEOUT) -> list[CastDevice]:
        raise NotImplementedError

    @abstractmethod
    def cast_url(self, host: str, port: int, page_url: str) -> str:
        raise NotImplementedError

    @abstractmethod
    def stop(self, host: str, port: int) -> None:
        raise NotImplementedError


def _is_loopback_host(hostname: str) -> bool:
    lower = (hostname or "").strip().lower()
    if lower in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
        return True
    try:
        ip = ipaddress.ip_address(lower)
        return ip.is_loopback or ip.is_unspecified
    except ValueError:
        return False


def _detect_local_ip_for_target(target_host: str, target_port: int) -> str:
    """Determine the local LAN IP address routed toward target_host."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect((target_host, target_port or DEFAULT_CAST_PORT))
        return str(sock.getsockname()[0])
    except OSError:
        return ""
    finally:
        sock.close()


def resolve_cast_url(page_url: str, public_base_url: str, local_ip: str) -> str:
    parsed = urlparse((page_url or "").strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise InvalidCastTargetError(f"invalid cast URL {page_url!r}")

    if public_base_url:
        base = urlparse(public_base_url.strip())
        if base.scheme in ("http", "https") and base.netloc:
            return urlunparse(
                (
                    base.scheme,
                    base.netloc,
                    parsed.path,
                    parsed.params,
                    parsed.query,
                    parsed.fragment,
                )
            )

    hostname = parsed.hostname or ""
    if _is_loopback_host(hostname) and local_ip:
        new_netloc = f"{local_ip}:{parsed.port}" if parsed.port else local_ip
        return urlunparse(
            (
                parsed.scheme,
                new_netloc,
                parsed.path,
                parsed.params,
                parsed.query,
                parsed.fragment,
            )
        )

    return parsed.geturl()


def _is_likely_display(model: str) -> bool:
    lower = (model or "").lower()
    return any(tok in lower for tok in ("hub", "display", "tv", "chromecast"))


class PyChromecastCaster(Caster):
    """Caster implementation backed by pychromecast + DashCastController."""

    def __init__(self, public_base_url: str = "") -> None:
        self.public_base_url = (public_base_url or "").strip().rstrip("/")

    def discover(self, timeout: float = DEFAULT_SCAN_TIMEOUT) -> list[CastDevice]:
        cast_infos, browser = pychromecast.discovery.discover_chromecasts(
            timeout=timeout
        )
        try:
            seen: set[str] = set()
            devices: list[CastDevice] = []
            for info in cast_infos:
                host = (info.host or "").strip()
                if not host:
                    continue
                port = info.port or DEFAULT_CAST_PORT
                uid = str(info.uuid) if info.uuid else f"{host}:{port}"
                if uid in seen:
                    continue
                seen.add(uid)
                devices.append(
                    CastDevice(
                        name=(info.friendly_name or host).strip(),
                        model=(info.model_name or "").strip(),
                        host=host,
                        port=port,
                        uuid=uid,
                    )
                )

            devices.sort(
                key=lambda d: (not _is_likely_display(d.model), d.name.lower())
            )
            return devices
        finally:
            browser.stop_discovery()

    def cast_url(self, host: str, port: int, page_url: str) -> str:
        host = (host or "").strip()
        if not host:
            raise InvalidCastTargetError("device host is required")
        port = port if port and port > 0 else DEFAULT_CAST_PORT

        local_ip = _detect_local_ip_for_target(host, port)
        resolved_url = resolve_cast_url(page_url, self.public_base_url, local_ip)

        cast_dev = pychromecast.get_chromecast_from_host(
            (host, port, uuid.UUID(int=0), None, None),
            tries=1,
            timeout=10,
        )
        try:
            dashcast = DashCastController()
            cast_dev.register_handler(dashcast)
            cast_dev.wait(timeout=10)

            # If DashCast is already running with force=True, stop it first so it reloads cleanly.
            if cast_dev.app_id == APP_DASHCAST:
                cast_dev.quit_app()
                time.sleep(0.5)

            done = threading.Event()
            error_holder: list[str] = []

            def _on_loaded(msg_sent: bool, response: dict[str, Any] | None) -> None:
                if not msg_sent:
                    error_holder.append("failed to send DashCast load_url message")
                done.set()

            dashcast.load_url(
                resolved_url, force=True, callback_function=_on_loaded
            )
            done.wait(timeout=10)
            if error_holder:
                raise RuntimeError(error_holder[0])

            # Give the Nest Hub a brief moment to process navigation before disconnecting.
            time.sleep(1.0)
            return resolved_url
        finally:
            cast_dev.disconnect(timeout=3)

    def stop(self, host: str, port: int) -> None:
        host = (host or "").strip()
        if not host:
            raise InvalidCastTargetError("device host is required")
        port = port if port and port > 0 else DEFAULT_CAST_PORT

        cast_dev = pychromecast.get_chromecast_from_host(
            (host, port, uuid.UUID(int=0), None, None),
            tries=1,
            timeout=10,
        )
        try:
            cast_dev.wait(timeout=10)
            cast_dev.quit_app()
            time.sleep(0.3)
        finally:
            cast_dev.disconnect(timeout=3)
