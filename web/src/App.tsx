import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useMatch } from "react-router-dom";
import { useBackToClose } from "./hooks/useBackToClose";
import { usePwaBackGuard } from "./hooks/usePwaBackGuard";
import {
  initOfflineSync,
  syncAllForOffline,
  useOfflineStatus,
  type OfflineStatus,
} from "./offline/sync";
import CookModePage from "./pages/CookModePage";
import MealPlanPage from "./pages/MealPlanPage";
import RecipesPage from "./pages/RecipesPage";
import RecipeDetailPage from "./pages/RecipeDetailPage";
import ShoppingListsPage from "./pages/ShoppingListsPage";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function App() {
  const isCookMode = Boolean(useMatch("/recipes/:id/cook"));
  const offlineStatus = useOfflineStatus();
  const { exitToastMessage } = usePwaBackGuard(offlineStatus.online);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    initOfflineSync();
    if (navigator.onLine) {
      void syncAllForOffline();
    }
  }, []);

  useEffect(() => {
    if (isCookMode) return;
    const headerEl = headerRef.current;
    if (!headerEl) return;

    const updateHeaderHeight = () => {
      const height = Math.round(headerEl.getBoundingClientRect().height);
      if (height > 0) {
        document.documentElement.style.setProperty(
          "--app-header-h",
          `${height}px`,
        );
      }
    };

    updateHeaderHeight();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateHeaderHeight);
    observer.observe(headerEl);
    return () => {
      observer.disconnect();
    };
  }, [isCookMode]);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstallApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstallPrompt(null);
    }
  };

  const exitToast = exitToastMessage && (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-50 flex justify-center"
    >
      <div className="rounded-full bg-stone-900/95 px-4 py-2.5 text-center text-sm font-medium text-white shadow-lg ring-1 ring-white/10">
        {exitToastMessage}
      </div>
    </div>
  );

  if (isCookMode) {
    return (
      <>
        <Routes>
          <Route path="/recipes/:id/cook" element={<CookModePage />} />
        </Routes>
        {exitToast}
      </>
    );
  }

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    [
      "inline-flex min-h-[40px] items-center whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-medium transition-colors sm:px-3",
      isActive
        ? "bg-amber-100 text-amber-900"
        : "text-stone-600 hover:bg-stone-100 hover:text-stone-900 active:bg-stone-200",
    ].join(" ");

  return (
    <div className="flex min-h-dvh flex-col">
      <header
        ref={headerRef}
        className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 shadow-2xs backdrop-blur-xs"
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-2 sm:px-6 sm:py-2.5">
          <div className="flex min-w-0 items-center gap-2 sm:gap-5">
            <KilnBrandSyncButton status={offlineStatus} />
            <nav className="flex items-center gap-0.5 sm:gap-1">
              <NavLink to="/recipes" className={navLinkClass}>
                Recipe
              </NavLink>
              <NavLink to="/meal-plan" className={navLinkClass}>
                Plan
              </NavLink>
              <NavLink to="/shopping-lists" className={navLinkClass}>
                List
              </NavLink>
            </nav>
          </div>

          {installPrompt && (
            <button
              type="button"
              onClick={handleInstallApp}
              className="inline-flex min-h-[36px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-amber-600 px-3 py-1.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-amber-700 active:bg-amber-800"
            >
              Install
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-3.5 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/recipes" replace />} />
          <Route path="/recipes" element={<RecipesPage />} />
          <Route path="/recipes/:id" element={<RecipeDetailPage />} />
          <Route path="/meal-plan" element={<MealPlanPage />} />
          <Route path="/shopping-lists" element={<ShoppingListsPage />} />
          <Route path="*" element={<Navigate to="/recipes" replace />} />
        </Routes>
      </main>
      {exitToast}
    </div>
  );
}

function KilnBrandSyncButton({ status }: { status: OfflineStatus }) {
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useBackToClose(open, () => setOpen(false));

  const handleForceRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.race([
          Promise.all(registrations.map((reg) => reg.update().catch(() => {}))),
          new Promise((resolve) => window.setTimeout(resolve, 1500)),
        ]);
      }
    } catch {
      // Ignore service worker update errors (e.g. offline) and reload anyway
    }
    window.location.reload();
  };

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const lastSyncLabel = status.lastSyncedAt
    ? new Date(status.lastSyncedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  const statusHeadline = status.syncing
    ? "Syncing offline cache…"
    : !status.online
      ? "Offline"
      : status.syncError
        ? "Sync error"
        : status.pendingCount > 0
          ? "Pending changes"
          : "Online · Synced";

  const title = status.syncing
    ? "Syncing offline cache…"
    : !status.online
      ? `Offline (${lastSyncLabel ? `Last synced ${lastSyncLabel}` : "Not synced yet"}). Changes will sync automatically when reconnected.`
      : status.pendingCount > 0
        ? status.syncError ||
          `${status.pendingCount} pending change${status.pendingCount === 1 ? "" : "s"}`
        : `Synced · ${lastSyncLabel ? `Last synced ${lastSyncLabel}` : "Not synced yet"}`;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title={title}
        aria-label={`Kiln sync status (${statusHeadline})`}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex min-h-[40px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-stone-100 active:bg-stone-200 sm:gap-2"
      >
        <span className="text-lg font-semibold tracking-tight text-stone-900">
          Kiln
        </span>
        {status.syncing ? (
          <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
        ) : !status.online ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-stone-200/80 px-1.5 py-0.5 text-[11px] font-medium text-stone-700 sm:px-2">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            <span className="hidden sm:inline">Offline</span>
            {status.pendingCount > 0 && (
              <span>
                <span className="hidden sm:inline">(</span>
                {status.pendingCount}
                <span className="hidden sm:inline">)</span>
              </span>
            )}
          </span>
        ) : status.pendingCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 sm:px-2">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
            {status.pendingCount}
          </span>
        ) : (
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Offline sync status"
          className="absolute top-full left-0 z-40 mt-2 w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-stone-200 bg-white p-3.5 shadow-lg ring-1 ring-stone-900/5"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {status.syncing ? (
                <span className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
              ) : !status.online ? (
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" />
              ) : status.syncError ? (
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
              ) : status.pendingCount > 0 ? (
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-600" />
              ) : (
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
              )}
              <span className="truncate text-sm font-semibold text-stone-900">
                {statusHeadline}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close sync status"
              className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 active:bg-stone-200"
            >
              <span aria-hidden="true" className="text-sm leading-none">
                ✕
              </span>
            </button>
          </div>

          <dl className="mt-2.5 space-y-1.5 border-t border-stone-100 pt-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-stone-500">Last synced</dt>
              <dd className="font-medium text-stone-800">
                {lastSyncLabel ?? "Not synced yet"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-stone-500">Pending changes</dt>
              <dd className="font-medium text-stone-800">
                {status.pendingCount}
              </dd>
            </div>
          </dl>

          {!status.online && (
            <p className="mt-2.5 rounded-lg bg-stone-50 px-2.5 py-2 text-xs text-stone-600">
              Changes are saved locally and will sync automatically when you
              reconnect.
            </p>
          )}

          {status.syncError && (
            <p className="mt-2.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
              {status.syncError}
            </p>
          )}

          <button
            type="button"
            disabled={status.syncing || refreshing}
            onClick={() => {
              if (!status.syncing) {
                void syncAllForOffline();
              }
            }}
            className="mt-3 inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 active:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status.syncing ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-200 border-t-white" />
                Syncing…
              </>
            ) : (
              "Sync now"
            )}
          </button>

          <button
            type="button"
            disabled={refreshing}
            onClick={() => void handleForceRefresh()}
            className="mt-2 inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 active:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-red-200 border-t-white" />
                Refreshing…
              </>
            ) : (
              "Force Refresh"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
