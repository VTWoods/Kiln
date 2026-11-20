import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useMatch } from "react-router-dom";
import CookModePage from "./pages/CookModePage";
import RecipesPage from "./pages/RecipesPage";
import RecipeDetailPage from "./pages/RecipeDetailPage";
import ShoppingListsPage from "./pages/ShoppingListsPage";

type HealthResponse = {
  status: string;
  service: string;
  database: string;
};

type HealthState =
  | { kind: "loading" }
  | { kind: "ok"; data: HealthResponse }
  | { kind: "error"; message: string };

export default function App() {
  const isCookMode = Boolean(useMatch("/recipes/:id/cook"));
  const [health, setHealth] = useState<HealthState>({ kind: "loading" });

  useEffect(() => {
    if (isCookMode) return;
    let active = true;
    fetch("/api/health")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return (await res.json()) as HealthResponse;
      })
      .then((data) => {
        if (active) setHealth({ kind: "ok", data });
      })
      .catch((err: unknown) => {
        if (active) {
          setHealth({
            kind: "error",
            message: err instanceof Error ? err.message : "Failed to reach API",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [isCookMode]);

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
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <span className="text-lg font-semibold tracking-tight text-stone-900">
              Kiln
            </span>
            <nav className="flex items-center gap-1">
              <NavLink to="/recipes" className={navLinkClass}>
                Recipes
              </NavLink>
              <NavLink to="/shopping-lists" className={navLinkClass}>
                Shopping Lists
              </NavLink>
            </nav>
          </div>

          <HealthBadge health={health} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <Routes>
          <Route path="/" element={<Navigate to="/recipes" replace />} />
          <Route path="/recipes" element={<RecipesPage />} />
          <Route path="/recipes/:id" element={<RecipeDetailPage />} />
          <Route path="/shopping-lists" element={<ShoppingListsPage />} />
          <Route path="*" element={<Navigate to="/recipes" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function HealthBadge({ health }: { health: HealthState }) {
  if (health.kind === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600">
        <span className="h-2 w-2 rounded-full bg-stone-400" />
        Checking API…
      </span>
    );
  }

  if (health.kind === "error") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700"
        title={health.message}
      >
        <span className="h-2 w-2 rounded-full bg-red-500" />
        API offline
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
      API &amp; SQLite {health.data.database}
    </span>
  );
}
