import { useEffect, useRef, useState, type TouchEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { getRecipe } from "../api/recipes";
import { useBackToClose } from "../hooks/useBackToClose";
import { getCachedRecipe } from "../offline/store";
import { formatMinutes, type Recipe } from "../types/recipe";

export default function CookModePage() {
  const { id } = useParams<{ id: string }>();

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [stepIndex, setStepIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"step" | "all">("step");
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(
    () => new Set(),
  );
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(min-width: 768px)").matches
      : true,
  );
  const [showIngredients, setShowIngredients] = useState(() => isDesktop);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useBackToClose(showIngredients && !isDesktop, () => setShowIngredients(false));

  useEffect(() => {
    setStepIndex(0);
    setCheckedIngredients(new Set());

    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      setError("Invalid recipe ID.");
      setLoading(false);
      return;
    }

    let active = true;
    let hydrated = false;
    let networkSettled = false;
    setError(null);
    setLoading(true);

    // Hydrate immediately from IndexedDB so Cook Mode opens instantly offline or on flaky Wi-Fi
    void getCachedRecipe(numericId)
      .then((cached) => {
        if (!active || networkSettled) return;
        if (cached) {
          hydrated = true;
          setRecipe(cached);
          setLoading(false);
        }
      })
      .catch(() => {});

    getRecipe(numericId)
      .then((data) => {
        if (!active) return;
        networkSettled = true;
        setRecipe(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        networkSettled = true;
        if (!hydrated) {
          setError(
            err instanceof Error ? err.message : "Failed to load recipe.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id]);

  // Keep phone/tablet display awake while in Cook Mode
  useEffect(() => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      return;
    }
    let released = false;
    let sentinel: WakeLockSentinel | null = null;

    const acquire = async () => {
      if (released || document.visibilityState !== "visible") return;
      try {
        sentinel = (await navigator.wakeLock?.request("screen")) ?? null;
        if (released && sentinel) {
          void sentinel.release().catch(() => {});
          sentinel = null;
        }
      } catch {
        // Ignore unsupported or denied wake lock requests
      }
    };

    void acquire();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void acquire();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (sentinel) {
        void sentinel.release().catch(() => {});
        sentinel = null;
      }
    };
  }, []);

  // Sync ingredients default when crossing the md breakpoint (drawer closed on <md, sidebar open on md+)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(min-width: 768px)");
    const onChange = (e: MediaQueryListEvent) => {
      setIsDesktop(e.matches);
      setShowIngredients(e.matches);
    };
    mql.addEventListener("change", onChange);
    return () => {
      mql.removeEventListener("change", onChange);
    };
  }, []);

  // Close mobile ingredients drawer on Escape
  useEffect(() => {
    if (!showIngredients) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !window.matchMedia("(min-width: 768px)").matches
      ) {
        setShowIngredients(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showIngredients]);

  const toggleIngredient = (ingId: number) => {
    setCheckedIngredients((prev) => {
      const next = new Set(prev);
      if (next.has(ingId)) next.delete(ingId);
      else next.add(ingId);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-stone-50 p-8 text-lg text-stone-600">
        Loading recipe…
      </div>
    );
  }

  if (error || !recipe) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-stone-50 p-8 text-center">
        <p className="text-xl font-semibold text-red-700">
          {error || "Recipe not found."}
        </p>
        <Link
          to="/recipes"
          className="rounded-xl bg-amber-600 px-5 py-3 text-base font-medium text-white"
        >
          Back to Recipes
        </Link>
      </div>
    );
  }

  const ingredients = recipe.ingredients ?? [];
  const checkedCount = ingredients.reduce(
    (acc, ing) => acc + (checkedIngredients.has(ing.id) ? 1 : 0),
    0,
  );
  const steps = recipe.instructions
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  const clampedStep = Math.min(stepIndex, Math.max(steps.length - 1, 0));
  const totalMinutes = recipe.prep_minutes + recipe.cook_minutes;
  const progressPercent =
    steps.length > 0 ? ((clampedStep + 1) / steps.length) * 100 : 0;

  const handleStepTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) {
      touchStartRef.current = null;
      return;
    }
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleStepTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || e.changedTouches.length !== 1 || steps.length <= 1) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) {
        setStepIndex((i) => Math.min(steps.length - 1, i + 1));
      } else {
        setStepIndex((i) => Math.max(0, i - 1));
      }
    }
  };

  const renderIngredientsList = () =>
    ingredients.length > 0 ? (
      <ul className="space-y-1.5">
        {ingredients.map((ing) => {
          const done = checkedIngredients.has(ing.id);
          const amount = [ing.quantity, ing.unit].filter(Boolean).join(" ");
          return (
            <li key={ing.id}>
              <button
                type="button"
                onClick={() => toggleIngredient(ing.id)}
                aria-pressed={done}
                className={[
                  "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-base transition-colors",
                  done
                    ? "bg-stone-100 text-stone-400 line-through"
                    : "bg-stone-50/70 text-stone-900 hover:bg-amber-50/60",
                ].join(" ")}
              >
                <span
                  aria-hidden="true"
                  className={[
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs font-bold",
                    done
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-stone-300 bg-white",
                  ].join(" ")}
                >
                  {done ? "✓" : ""}
                </span>
                <span className="min-w-0 flex-1 break-words leading-snug">
                  {amount && (
                    <strong
                      className={
                        done
                          ? "mr-1.5 font-semibold text-stone-400"
                          : "mr-1.5 font-semibold text-amber-800"
                      }
                    >
                      {amount}
                    </strong>
                  )}
                  {ing.name}
                  {ing.preparation && (
                    <span
                      className={done ? "text-stone-400" : "text-stone-500"}
                    >
                      , {ing.preparation}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    ) : (
      <p className="px-2 py-4 text-base text-stone-500">
        No ingredients listed.
      </p>
    );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-stone-50 text-stone-900">
      {/* Compact top bar: 44px exit icon + truncated title + All/Steps on <md; full Nest Hub/desktop header on md+ */}
      <header className="flex shrink-0 items-center justify-between gap-2.5 border-b border-stone-200 bg-white px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2.5 shadow-2xs sm:gap-4 sm:px-5 sm:pt-[max(0.75rem,env(safe-area-inset-top))] sm:pb-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Link
            to={`/recipes/${recipe.id}`}
            aria-label="Exit Cook Mode"
            title="Exit Cook Mode"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-stone-300 bg-white text-lg font-semibold text-stone-700 hover:bg-stone-50 md:hidden"
          >
            ←
          </Link>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold tracking-tight text-stone-900 sm:text-xl md:text-2xl">
              {recipe.title}
            </h1>
            <div className="mt-0.5 hidden flex-wrap items-center gap-3 text-xs font-medium text-stone-500 md:flex md:text-sm">
              <span>Servings: {recipe.servings}</span>
              {recipe.prep_minutes > 0 && (
                <span>Prep: {formatMinutes(recipe.prep_minutes)}</span>
              )}
              {recipe.cook_minutes > 0 && (
                <span>Cook: {formatMinutes(recipe.cook_minutes)}</span>
              )}
              {totalMinutes > 0 &&
                recipe.prep_minutes > 0 &&
                recipe.cook_minutes > 0 && (
                  <span className="text-amber-800">
                    Total: {formatMinutes(totalMinutes)}
                  </span>
                )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setShowIngredients((v) => !v)}
            className={[
              "hidden rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors md:inline-flex",
              showIngredients
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-stone-300 bg-white text-stone-700",
            ].join(" ")}
          >
            Ingredients
          </button>

          {steps.length > 1 && (
            <button
              type="button"
              onClick={() =>
                setViewMode((m) => (m === "step" ? "all" : "step"))
              }
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50 md:min-h-0 md:px-3.5 md:text-sm"
            >
              <span className="md:hidden">
                {viewMode === "step" ? "All" : "Steps"}
              </span>
              <span className="hidden md:inline">
                {viewMode === "step" ? "All Steps" : "Step-by-Step"}
              </span>
            </button>
          )}

          <Link
            to={`/recipes/${recipe.id}`}
            className="hidden rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-sm font-semibold text-stone-600 hover:bg-stone-50 md:inline-flex"
          >
            Exit
          </Link>
        </div>
      </header>

      {/* Thin top step progress bar */}
      {steps.length > 0 && viewMode === "step" && (
        <div
          role="progressbar"
          aria-label="Cooking progress"
          aria-valuenow={clampedStep + 1}
          aria-valuemin={1}
          aria-valuemax={steps.length}
          className="h-1 w-full shrink-0 bg-stone-200"
        >
          <div
            className="h-full bg-amber-600 transition-all duration-200"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      {/* Main split workspace (inline sidebar on md+, full viewport step on <md) */}
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-12">
        {/* Desktop/Nest Hub inline Ingredients sidebar */}
        {showIngredients && (
          <aside className="hidden min-h-0 flex-col border-r border-stone-200 bg-white md:col-span-4 md:flex">
            <div className="border-b border-stone-100 px-5 py-3">
              <h2 className="text-sm font-bold tracking-wide text-stone-500 uppercase">
                Ingredients (
                {checkedCount > 0
                  ? `${checkedCount}/${ingredients.length}`
                  : ingredients.length}
                )
              </h2>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
              {renderIngredientsList()}
            </div>
          </aside>
        )}

        {/* Instructions panel */}
        <main
          className={[
            "flex min-h-0 flex-col bg-stone-50",
            showIngredients ? "md:col-span-8" : "md:col-span-12",
          ].join(" ")}
        >
          {steps.length === 0 ? (
            <>
              <div className="flex flex-1 items-center justify-center p-6 text-center text-lg text-stone-500">
                No instructions saved for this recipe.
              </div>
              <footer className="flex shrink-0 items-center justify-center border-t border-stone-200 bg-white px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
                <button
                  type="button"
                  onClick={() => setShowIngredients(true)}
                  className="min-h-12 w-full rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900"
                >
                  Ingredients ({checkedCount}/{ingredients.length})
                </button>
              </footer>
            </>
          ) : viewMode === "all" ? (
            <>
              <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-8">
                <ol className="mx-auto max-w-3xl space-y-3 sm:space-y-6">
                  {steps.map((step, idx) => {
                    const isCurrent = idx === clampedStep;
                    return (
                      <li key={idx}>
                        <button
                          type="button"
                          onClick={() => {
                            setStepIndex(idx);
                            setViewMode("step");
                          }}
                          className={[
                            "flex w-full items-start gap-3 rounded-2xl border p-4 text-left shadow-2xs transition-colors sm:gap-4 sm:p-5",
                            isCurrent
                              ? "border-amber-300 bg-amber-50/50"
                              : "border-stone-200 bg-white hover:border-amber-200 hover:bg-amber-50/30",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold sm:h-9 sm:w-9 sm:text-base",
                              isCurrent
                                ? "bg-amber-600 text-white"
                                : "bg-amber-100 text-amber-900",
                            ].join(" ")}
                          >
                            {idx + 1}
                          </span>
                          <p className="min-w-0 flex-1 break-words whitespace-pre-line text-lg leading-relaxed text-stone-900 sm:text-xl sm:leading-relaxed">
                            {step}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
              <footer className="flex shrink-0 items-center justify-center border-t border-stone-200 bg-white px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
                <button
                  type="button"
                  onClick={() => setShowIngredients(true)}
                  className="min-h-12 w-full rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900"
                >
                  Ingredients ({checkedCount}/{ingredients.length})
                </button>
              </footer>
            </>
          ) : (
            <>
              {/* Active step (my-auto centers short steps without clipping tall steps) */}
              <div
                className="flex flex-1 flex-col overflow-y-auto overscroll-contain p-4 sm:p-10"
                onTouchStart={handleStepTouchStart}
                onTouchEnd={handleStepTouchEnd}
              >
                <div className="mx-auto my-auto w-full max-w-3xl space-y-4 sm:space-y-5">
                  <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3.5 py-1 text-sm font-bold text-amber-900 sm:px-4 sm:py-1.5">
                    Step {clampedStep + 1} of {steps.length}
                  </div>
                  <p className="break-words whitespace-pre-line text-xl leading-relaxed font-medium text-stone-900 sm:text-3xl sm:leading-relaxed">
                    {steps[clampedStep]}
                  </p>
                </div>
              </div>

              {/* Large touch-friendly step controls + mobile Ingredients trigger */}
              <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-stone-200 bg-white px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:gap-4 sm:px-6 sm:pt-4">
                <button
                  type="button"
                  onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                  disabled={clampedStep === 0}
                  className="min-h-12 flex-1 rounded-2xl border border-stone-300 bg-white px-2.5 py-3 text-sm font-bold text-stone-800 shadow-2xs hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40 md:min-w-32 md:flex-none md:px-6 md:py-3.5 md:text-base"
                >
                  <span className="md:hidden">← Prev</span>
                  <span className="hidden md:inline">← Previous</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowIngredients(true)}
                  className={[
                    "inline-flex min-h-12 shrink-0 items-center justify-center rounded-2xl border px-2.5 py-3 text-xs font-bold transition-colors md:hidden",
                    checkedCount > 0
                      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                      : "border-amber-300 bg-amber-50 text-amber-900",
                  ].join(" ")}
                >
                  Ingredients ({checkedCount}/{ingredients.length})
                </button>

                <div className="hidden flex-wrap items-center justify-center gap-2 md:flex">
                  {steps.map((_, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setStepIndex(idx)}
                      aria-label={`Go to step ${idx + 1}`}
                      className={[
                        "h-3.5 rounded-full transition-all",
                        idx === clampedStep
                          ? "w-8 bg-amber-600"
                          : "w-3.5 bg-stone-300 hover:bg-stone-400",
                      ].join(" ")}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setStepIndex((i) => Math.min(steps.length - 1, i + 1))
                  }
                  disabled={clampedStep >= steps.length - 1}
                  className="min-h-12 flex-1 rounded-2xl bg-amber-600 px-2.5 py-3 text-sm font-bold text-white shadow-xs hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-40 md:min-w-32 md:flex-none md:px-6 md:py-3.5 md:text-base"
                >
                  <span className="md:hidden">Next →</span>
                  <span className="hidden md:inline">Next Step →</span>
                </button>
              </footer>
            </>
          )}
        </main>
      </div>

      {/* Mobile bottom-sheet Ingredients drawer (<md) */}
      {showIngredients && (
        <div
          className="fixed inset-0 z-40 flex items-end bg-stone-950/50 md:hidden"
          onClick={() => setShowIngredients(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Ingredients"
        >
          <div
            className="flex max-h-[82dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-stone-300" />
            <div className="flex items-start justify-between gap-3 border-b border-stone-100 px-4 pt-2 pb-3">
              <div className="min-w-0">
                <h2 className="text-sm font-bold tracking-wide text-stone-700 uppercase">
                  Ingredients ({checkedCount}/{ingredients.length})
                </h2>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs font-medium text-stone-500">
                  <span>Servings: {recipe.servings}</span>
                  {recipe.prep_minutes > 0 && (
                    <span>Prep: {formatMinutes(recipe.prep_minutes)}</span>
                  )}
                  {recipe.cook_minutes > 0 && (
                    <span>Cook: {formatMinutes(recipe.cook_minutes)}</span>
                  )}
                  {totalMinutes > 0 &&
                    recipe.prep_minutes > 0 &&
                    recipe.cook_minutes > 0 && (
                      <span className="text-amber-800">
                        Total: {formatMinutes(totalMinutes)}
                      </span>
                    )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowIngredients(false)}
                aria-label="Close ingredients"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
              {renderIngredientsList()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
