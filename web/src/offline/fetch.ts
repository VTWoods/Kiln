import { OfflineNetworkError } from "./store";
import {
  getOfflineStatus,
  isOfflineCircuitOpen,
  markApiOffline,
  markApiReachable,
} from "./sync";

const DEFAULT_READ_TIMEOUT_MS = 2500;
const DEFAULT_WRITE_TIMEOUT_MS = 6000;

export type ApiFetchOptions = {
  /** Override request timeout in milliseconds. */
  timeoutMs?: number;
  /** Allow bypassing the offline circuit breaker (e.g. explicit user retry / health probe). */
  bypassCircuitBreaker?: boolean;
  /** Treat HTTP 502 as an application error rather than Kiln being unreachable (e.g. import-preview). */
  allow502AppError?: boolean;
};

/**
 * Fetch wrapper tailored for a local-LAN PWA:
 * - Short timeout (2.5s default for GETs) so turning off Wi-Fi while still on cellular
 *   never hangs for 30-75s waiting on an unreachable LAN host.
 * - Circuit breaker: once Kiln is detected unreachable, subsequent tab switches fall back
 *   to IndexedDB immediately (< 1ms) until the background health probe reconnects.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: ApiFetchOptions = {},
): Promise<Response> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    markApiOffline();
    throw new OfflineNetworkError();
  }

  if (!options.bypassCircuitBreaker && isOfflineCircuitOpen()) {
    throw new OfflineNetworkError("Kiln server is currently unreachable.");
  }

  const method = (init?.method || "GET").toUpperCase();
  const timeoutMs =
    options.timeoutMs ??
    (method === "GET" || method === "HEAD"
      ? DEFAULT_READ_TIMEOUT_MS
      : DEFAULT_WRITE_TIMEOUT_MS);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    markApiOffline();
    if (err instanceof Error && err.name === "AbortError") {
      throw new OfflineNetworkError("Timed out reaching Kiln server.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (
    (res.status === 502 && !options.allow502AppError) ||
    res.status === 503 ||
    res.status === 504
  ) {
    markApiOffline();
    throw new OfflineNetworkError(`Kiln server unavailable (HTTP ${res.status})`);
  }

  // If a captive portal or external router returns HTML for a 200 OK /api/* route, treat as offline
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (res.ok && res.status !== 204 && contentType.includes("text/html")) {
    markApiOffline();
    throw new OfflineNetworkError("Unexpected HTML response from API.");
  }

  if (!getOfflineStatus().online) {
    markApiReachable();
  }
  return res;
}
