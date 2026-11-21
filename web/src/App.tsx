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
      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
      isActive
        ? "bg-amber-100 text-amber-900"
        : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
    ].join(" ");

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4 sm:gap-6">
            <span className="text-lg font-semibold tracking-tight text-stone-900">
              Kiln
            </span>
            <nav className="flex items-center gap-1">
              <NavLink to="/recipes" className={navLinkClass}>
                Recipes
              </NavLink>
              <NavLink to="/meal-plan" className={navLinkClass}>
                Meal Plan
              </NavLink>
              <NavLink to="/shopping-lists" className={navLinkClass}>
                Shopping Lists
              </NavLink>
            </nav>
          </div>

          <div className="flex items-center gap-2">
            {installPrompt && (
              <button
                type="button"
                onClick={handleInstallApp}
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-3 py-1 text-xs font-medium text-white shadow-xs transition-colors hover:bg-amber-700"
              >
                Install App
              </button>
            )}
            <OfflineSyncBadge status={offlineStatus} />
          </div>
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

function OfflineSyncBadge({ status }: { status: OfflineStatus }) {
  const lastSyncLabel = status.lastSyncedAt
    ? `Last synced ${new Date(status.lastSyncedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}`
    : "Not synced yet";

  if (status.syncing) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
        <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
        Syncing…
      </span>
    );
  }

  if (!status.online) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-stone-200/80 px-2.5 py-1 text-xs font-medium text-stone-700"
        title={`Working offline (${lastSyncLabel}). Changes will sync automatically when reconnected.`}
      >
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        Offline
        {status.pendingCount > 0 ? ` · ${status.pendingCount} pending` : ""}
      </span>
    );
  }

  if (status.pendingCount > 0) {
    return (
      <button
        type="button"
        onClick={() => void syncAllForOffline()}
        title={status.syncError || "Click to sync pending offline changes now"}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-200"
      >
        <span className="h-2 w-2 rounded-full bg-amber-600" />
        Sync {status.pendingCount} change{status.pendingCount === 1 ? "" : "s"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void syncAllForOffline()}
      title={`${lastSyncLabel} · Click to refresh offline cache`}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
    >
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
      Synced
    </button>
  );
}
