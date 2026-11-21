import { useEffect, useRef } from "react";

interface BackOverlayEntry {
  id: string;
  onClose: () => void;
  disabled: boolean;
  onPopped: () => void;
}

let nextOverlaySeq = 1;
const overlayStack: BackOverlayEntry[] = [];
let listenerAttached = false;
let expectedProgrammaticPops = 0;

function readOverlayId(state: unknown): string | undefined {
  if (state && typeof state === "object" && "kilnOverlayId" in state) {
    const val = (state as { kilnOverlayId?: unknown }).kilnOverlayId;
    return typeof val === "string" ? val : undefined;
  }
  return undefined;
}

function handlePopState(event: PopStateEvent) {
  if (expectedProgrammaticPops > 0) {
    expectedProgrammaticPops -= 1;
    return;
  }

  if (overlayStack.length === 0) return;

  const top = overlayStack[overlayStack.length - 1];
  const currentOverlayId = readOverlayId(event.state);

  // If our top overlay is no longer on top of history, the user pressed Back to close it
  if (currentOverlayId !== top.id) {
    if (top.disabled) {
      const baseState =
        event.state && typeof event.state === "object" ? event.state : {};
      window.history.pushState({ ...baseState, kilnOverlayId: top.id }, "");
      return;
    }

    overlayStack.pop();
    top.onPopped();
    top.onClose();
  }
}

function ensurePopStateListener() {
  if (listenerAttached || typeof window === "undefined") return;
  window.addEventListener("popstate", handlePopState);
  listenerAttached = true;
}

export function hasActiveBackOverlay(): boolean {
  return overlayStack.length > 0;
}

/**
 * Integrates an open modal, bottom sheet, drawer, or popover with the browser / Android
 * Back button by pushing a lightweight history state while open so pressing Back closes
 * the overlay instead of navigating away or exiting the PWA.
 *
 * Safe under React 19 StrictMode, nested overlays, and in-modal route navigation.
 */
export function useBackToClose(
  isOpen: boolean,
  onClose: () => void,
  disabled = false,
) {
  const onCloseRef = useRef(onClose);
  const disabledRef = useRef(disabled);
  const pushedIdRef = useRef<string | null>(null);
  const entryRef = useRef<BackOverlayEntry | null>(null);
  const cleanupTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
    disabledRef.current = disabled;
    if (entryRef.current) {
      entryRef.current.onClose = onClose;
      entryRef.current.disabled = disabled;
    }
  }, [onClose, disabled]);

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;

    ensurePopStateListener();

    // Cancel any pending StrictMode cleanup from the same component instance
    if (cleanupTimerRef.current !== null) {
      window.clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }

    if (pushedIdRef.current === null) {
      const id = `kiln-overlay-${nextOverlaySeq++}`;
      pushedIdRef.current = id;

      const entry: BackOverlayEntry = {
        id,
        onClose: onCloseRef.current,
        disabled: disabledRef.current,
        onPopped: () => {
          pushedIdRef.current = null;
          entryRef.current = null;
        },
      };
      entryRef.current = entry;
      overlayStack.push(entry);

      const baseState =
        window.history.state && typeof window.history.state === "object"
          ? window.history.state
          : {};
      window.history.pushState({ ...baseState, kilnOverlayId: id }, "");
    }

    return () => {
      const id = pushedIdRef.current;
      const entry = entryRef.current;

      // Defer cleanup to next tick so React 19 StrictMode's synchronous re-mount
      // cancels it without triggering an asynchronous history.back() race.
      cleanupTimerRef.current = window.setTimeout(() => {
        cleanupTimerRef.current = null;
        if (entry) {
          const idx = overlayStack.lastIndexOf(entry);
          if (idx !== -1) {
            overlayStack.splice(idx, 1);
          }
          entryRef.current = null;
        }
        if (id && pushedIdRef.current === id) {
          pushedIdRef.current = null;
          // Only pop our entry if it is still on top of history (skip if a Link
          // inside the modal navigated forward to a new route).
          if (readOverlayId(window.history.state) === id) {
            expectedProgrammaticPops += 1;
            window.history.back();
          }
        }
      }, 0);
    };
  }, [isOpen]);
}
