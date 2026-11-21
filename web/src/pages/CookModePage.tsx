import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getRecipe } from "../api/recipes";
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
  const [showIngredients, setShowIngredients] = useState(true);

  useEffect(() => {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      setError("Invalid recipe ID.");
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    getRecipe(numericId)
      .then((data) => {
        if (active) {
          setRecipe(data);
          setStepIndex(0);
        }
      })
      .catch((err: unknown) => {
        if (active) {
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
      <div className="flex min-h-screen items-center justify-center bg-stone-50 p-8 text-lg text-stone-600">
        Loading recipe…
      </div>
    );
  }

  if (error || !recipe) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-stone-50 p-8 text-center">
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

  const steps = recipe.instructions
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  const clampedStep = Math.min(stepIndex, Math.max(steps.length - 1, 0));
  const totalMinutes = recipe.prep_minutes + recipe.cook_minutes;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-stone-50 text-stone-900">
      {/* Compact top bar sized for Nest Hub displays */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-stone-200 bg-white px-5 py-3 shadow-2xs">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight text-stone-900 sm:text-2xl">
            {recipe.title}
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs font-medium text-stone-500 sm:text-sm">
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

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setShowIngredients((v) => !v)}
            className={[
              "rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors",
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
              className="rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
            >
              {viewMode === "step" ? "All Steps" : "Step-by-Step"}
            </button>
          )}

          <Link
            to={`/recipes/${recipe.id}`}
            className="rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-sm font-semibold text-stone-600 hover:bg-stone-50"
          >
            Exit
          </Link>
        </div>
      </header>

      {/* Main split workspace */}
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-12">
        {/* Ingredients sidebar */}
        {showIngredients && (
          <aside className="flex min-h-0 flex-col border-b border-stone-200 bg-white md:col-span-4 md:border-r md:border-b-0">
            <div className="border-b border-stone-100 px-5 py-3">
              <h2 className="text-sm font-bold tracking-wide text-stone-500 uppercase">
                Ingredients ({recipe.ingredients?.length ?? 0})
              </h2>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {recipe.ingredients && recipe.ingredients.length > 0 ? (
                <ul className="space-y-1.5">
                  {recipe.ingredients.map((ing) => {
                    const done = checkedIngredients.has(ing.id);
                    const amount = [ing.quantity, ing.unit]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <li key={ing.id}>
                        <button
                          type="button"
                          onClick={() => toggleIngredient(ing.id)}
                          className={[
                            "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-base transition-colors",
                            done
                              ? "bg-stone-100 text-stone-400 line-through"
                              : "bg-stone-50/70 text-stone-900 hover:bg-amber-50/60",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs font-bold",
                              done
                                ? "border-emerald-600 bg-emerald-600 text-white"
                                : "border-stone-300 bg-white",
                            ].join(" ")}
                          >
                            {done ? "✓" : ""}
                          </span>
                          <span className="leading-snug">
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
                                className={
                                  done ? "text-stone-400" : "text-stone-500"
                                }
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
              )}
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
            <div className="flex flex-1 items-center justify-center p-8 text-lg text-stone-500">
              No instructions saved for this recipe.
            </div>
          ) : viewMode === "all" ? (
            <div className="flex-1 overflow-y-auto p-6 sm:p-8">
              <ol className="mx-auto max-w-3xl space-y-6">
                {steps.map((step, idx) => (
                  <li
                    key={idx}
                    className="flex gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-2xs"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-base font-bold text-amber-900">
                      {idx + 1}
                    </span>
                    <p className="whitespace-pre-line text-xl leading-relaxed text-stone-900">
                      {step}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <>
              {/* Active step */}
              <div className="flex flex-1 flex-col justify-center overflow-y-auto p-6 sm:p-10">
                <div className="mx-auto w-full max-w-3xl space-y-5">
                  <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-4 py-1.5 text-sm font-bold text-amber-900">
                    Step {clampedStep + 1} of {steps.length}
                  </div>
                  <p className="whitespace-pre-line text-2xl leading-relaxed font-medium text-stone-900 sm:text-3xl sm:leading-relaxed">
                    {steps[clampedStep]}
                  </p>
                </div>
              </div>

              {/* Large touch-friendly step controls */}
              <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-stone-200 bg-white px-6 py-4">
                <button
                  type="button"
                  onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                  disabled={clampedStep === 0}
                  className="min-w-32 rounded-2xl border border-stone-300 bg-white px-6 py-3.5 text-base font-bold text-stone-800 shadow-2xs hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ← Previous
                </button>

                <div className="hidden flex-wrap items-center justify-center gap-2 sm:flex">
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
                  className="min-w-32 rounded-2xl bg-amber-600 px-6 py-3.5 text-base font-bold text-white shadow-xs hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next Step →
                </button>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
