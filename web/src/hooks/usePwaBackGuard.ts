import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { hasActiveBackOverlay } from "./useBackToClose";

const EXIT_CONFIRM_WINDOW_MS = 2500;

interface KilnHistoryState {
  kilnExitSentinel?: boolean;
  kilnGuardArmed?: boolean;
  kilnOverlayId?: string;
  [key: string]: unknown;
}

function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: fullscreen)").matches ||
    nav.standalone === true
  );
}

function readHistoryState(state: unknown): KilnHistoryState {
  return state && typeof state === "object"
    ? (state as KilnHistoryState)
    : {};
}

/**
 * In installed standalone PWA mode:
 * 1. If the user presses Back at the bottom of history while on a secondary tab
 *    (Plan / List) or a deep-linked recipe/Cook Mode route, return to the home
 *    tab (`/recipes`, or `/recipes/:id` from Cook Mode) instead of quitting.
 * 2. On the home tab (`/recipes`), require a second Back press within 2.5s to
 *    exit, showing a brief confirmation toast (with an offline reminder when offline).
 */
export function usePwaBackGuard(online: boolean): {
  exitToastMessage: string | null;
} {
  const location = useLocation();
  const navigate = useNavigate();
  const [exitToastMessage, setExitToastMessage] = useState<string | null>(null);

  const pathnameRef = useRef(location.pathname);
  const onlineRef = useRef(online);
  const sentinelArmedRef = useRef(false);
  const exitArmedUntilRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    onlineRef.current = online;
  }, [online]);

  // Arm the root sentinel entry once after the initial "/" redirect settles and
  // the user interacts (so Chrome Android respects the pushed guard entry).
  useEffect(() => {
    if (
      !isStandalonePwa() ||
      sentinelArmedRef.current ||
      location.pathname === "/"
    ) {
      return;
    }

    const armSentinel = () => {
      if (sentinelArmedRef.current) return;
      const state = readHistoryState(window.history.state);
      if (
        state.kilnGuardArmed ||
        state.kilnExitSentinel ||
        state.kilnOverlayId
      ) {
        sentinelArmedRef.current = true;
        return;
      }

      sentinelArmedRef.current = true;
      const { kilnExitSentinel: _s, kilnGuardArmed: _g, ...rest } = state;
      window.history.replaceState(
        { ...rest, kilnExitSentinel: true },
        "",
        window.location.href,
      );
      window.history.pushState(
        { ...rest, kilnGuardArmed: true },
        "",
        window.location.href,
      );
    };

    const nav = window.navigator as Navigator & {
      userActivation?: { hasBeenActive: boolean };
    };
    if (nav.userActivation?.hasBeenActive) {
      armSentinel();
      return;
    }

    const onFirstInteraction = () => {
      armSentinel();
      window.removeEventListener("pointerdown", onFirstInteraction, true);
      window.removeEventListener("keydown", onFirstInteraction, true);
    };

    window.addEventListener("pointerdown", onFirstInteraction, true);
    window.addEventListener("keydown", onFirstInteraction, true);
    return () => {
      window.removeEventListener("pointerdown", onFirstInteraction, true);
      window.removeEventListener("keydown", onFirstInteraction, true);
    };
  }, [location.pathname]);

  // Intercept Back when reaching the root exit sentinel
  useEffect(() => {
    if (!isStandalonePwa()) return;

    const handlePopState = (event: PopStateEvent) => {
      // Let active modal/drawer/popover overlays handle Back first
      if (hasActiveBackOverlay()) return;

      const state = readHistoryState(event.state);
      if (!state.kilnExitSentinel) return;

      const currentPath = pathnameRef.current;

      // Option #3: Return to parent / home tab before exiting
      const cookMatch = /^\/recipes\/(\d+)\/cook\/?$/.exec(currentPath);
      if (cookMatch) {
        const recipePath = `/recipes/${cookMatch[1]}`;
        window.history.replaceState(
          { ...state, kilnExitSentinel: true },
          "",
          "/recipes",
        );
        navigate(recipePath);
        return;
      }

      if (currentPath !== "/recipes" && currentPath !== "/") {
        window.history.replaceState(
          { ...state, kilnExitSentinel: true },
          "",
          "/recipes",
        );
        navigate("/recipes");
        return;
      }

      // Option #2: Double-Back-to-Exit guard on home tab
      const now = Date.now();
      if (now < exitArmedUntilRef.current) {
        exitArmedUntilRef.current = 0;
        if (toastTimerRef.current !== null) {
          window.clearTimeout(toastTimerRef.current);
          toastTimerRef.current = null;
        }
        setExitToastMessage(null);
        // Allow Android/browser to pop the sentinel and exit the PWA
        window.history.back();
        return;
      }

      exitArmedUntilRef.current = now + EXIT_CONFIRM_WINDOW_MS;
      const { kilnExitSentinel: _s, ...rest } = state;
      window.history.pushState(
        { ...rest, kilnGuardArmed: true },
        "",
        window.location.href,
      );

      setExitToastMessage(
        onlineRef.current
          ? "Press back again to exit"
          : "You're offline — press back again to exit",
      );

      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        toastTimerRef.current = null;
        exitArmedUntilRef.current = 0;
        setExitToastMessage(null);
      }, EXIT_CONFIRM_WINDOW_MS);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, [navigate]);

  return { exitToastMessage };
}
