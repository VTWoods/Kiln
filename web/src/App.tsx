import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useMatch } from "react-router-dom";
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
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    initOfflineSync();
    if (navigator.onLine) {
      void syncAllForOffline();
    }
  }, []);

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

  if (isCookMode) {
    return (
      <Routes>
        <Route path="/recipes/:id/cook" element={<CookModePage />} />
      </Routes>
    );
  }

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    [
      "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
      isActive
        ? "bg-amber-100 text-amber-900"
        : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
    ].join(" ");

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 shadow-2xs backdrop-blur-xs">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3 sm:gap-5">
            <KilnBrandSyncButton status={offlineStatus} />
            <nav className="flex items-center gap-1">
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
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-600 px-3 py-1 text-xs font-medium text-white shadow-xs transition-colors hover:bg-amber-700"
            >
              Install
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <Routes>
          <Route path="/" element={<Navigate to="/recipes" replace />} />
          <Route path="/recipes" element={<RecipesPage />} />
          <Route path="/recipes/:id" element={<RecipeDetailPage />} />
          <Route path="/meal-plan" element={<MealPlanPage />} />
          <Route path="/shopping-lists" element={<ShoppingListsPage />} />
          <Route path="*" element={<Navigate to="/recipes" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function KilnBrandSyncButton({ status }: { status: OfflineStatus }) {
  const lastSyncLabel = status.lastSyncedAt
    ? `Last synced ${new Date(status.lastSyncedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}`
    : "Not synced yet";

  const title = status.syncing
    ? "Syncing offline cache…"
    : !status.online
      ? `Offline (${lastSyncLabel}). Changes will sync automatically when reconnected.`
      : status.pendingCount > 0
        ? status.syncError ||
          `${status.pendingCount} pending change${status.pendingCount === 1 ? "" : "s"} · Click to sync now`
        : `Synced · ${lastSyncLabel} · Click to refresh offline cache`;

  return (
    <button
      type="button"
      onClick={() => {
        if (!status.syncing) {
          void syncAllForOffline();
        }
      }}
      title={title}
      aria-label={`Kiln (${title})`}
      className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-stone-100"
    >
      <span className="text-lg font-semibold tracking-tight text-stone-900">
        Kiln
      </span>
      {status.syncing ? (
        <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
      ) : !status.online ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-stone-200/80 px-2 py-0.5 text-[11px] font-medium text-stone-700">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Offline{status.pendingCount > 0 ? ` (${status.pendingCount})` : ""}
        </span>
      ) : status.pendingCount > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
          {status.pendingCount}
        </span>
      ) : (
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
      )}
    </button>
  );
}
