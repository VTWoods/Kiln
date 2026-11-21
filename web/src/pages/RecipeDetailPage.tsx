import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deleteRecipe, getRecipe } from "../api/recipes";
import AddToMealPlanModal from "../components/AddToMealPlanModal";
import AddToShoppingListModal from "../components/AddToShoppingListModal";
import CastRecipeModal from "../components/CastRecipeModal";
import { getCachedRecipe } from "../offline/store";
import { formatDayLabel } from "../types/mealPlan";
import {
  formatHostname,
  formatMinutes,
  isSafeHttpUrl,
  type Recipe,
} from "../types/recipe";

export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showAddToListModal, setShowAddToListModal] = useState(false);
  const [showAddToPlanModal, setShowAddToPlanModal] = useState(false);
  const [showCastModal, setShowCastModal] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const [mobileTab, setMobileTab] = useState<"ingredients" | "instructions">(
    "ingredients",
  );
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(
    () => new Set(),
  );
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [imageError, setImageError] = useState(false);
  const [addedNotice, setAddedNotice] = useState<{
    listId: number;
    listName: string;
    addedCount: number;
  } | null>(null);
  const [plannedNotice, setPlannedNotice] = useState<{
    weekStart: string;
    date: string;
    recipeTitle: string;
  } | null>(null);

  useEffect(() => {
    setMobileTab("ingredients");
    setCheckedIngredients(new Set());
    setActiveStep(null);
    setImageError(false);

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

    // Hydrate immediately from IndexedDB if available
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

  useEffect(() => {
    if (!showMoreMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(e.target as Node)
      ) {
        setShowMoreMenu(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowMoreMenu(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showMoreMenu]);

  const toggleIngredient = (ingId: number) => {
    setCheckedIngredients((prev) => {
      const next = new Set(prev);
      if (next.has(ingId)) next.delete(ingId);
      else next.add(ingId);
      return next;
    });
  };

  const handleDelete = async () => {
    if (!recipe) return;
    if (!window.confirm(`Delete "${recipe.title}"? This cannot be undone.`)) {
      return;
    }
    setDeleting(true);
    try {
      await deleteRecipe(recipe.id);
      navigate("/recipes");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete recipe.");
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-4 w-28 animate-pulse rounded bg-stone-200" />
        <div className="h-64 w-full animate-pulse rounded-2xl bg-stone-200" />
      </div>
    );
  }

  if (error || !recipe) {
    return (
      <div className="space-y-4">
        <Link
          to="/recipes"
          className="inline-flex items-center text-sm font-medium text-stone-600 hover:text-stone-900"
        >
          ← Back to Recipes
        </Link>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {error || "Recipe not found."}
        </div>
      </div>
    );
  }

  const totalMinutes = recipe.prep_minutes + recipe.cook_minutes;
  const ingredients = recipe.ingredients ?? [];
  const checkedCount = ingredients.reduce(
    (acc, ing) => acc + (checkedIngredients.has(ing.id) ? 1 : 0),
    0,
  );
  const instructionBlocks = recipe.instructions
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  const hasSourceUrl = isSafeHttpUrl(recipe.source_url);

  return (
    <article className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Link
          to="/recipes"
          aria-label="Back to Recipes"
          title="Back to Recipes"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-stone-300 bg-white text-base font-medium text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900"
        >
          ←
        </Link>

        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => setShowAddToPlanModal(true)}
            title="Add to Meal Plan"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-amber-600 px-2.5 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-700 sm:px-3.5"
          >
            + Plan
          </button>
          <button
            type="button"
            onClick={() => setShowAddToListModal(true)}
            title="Add to Shopping List"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-amber-600 px-2.5 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-700 sm:px-3.5"
          >
            + List
          </button>
          <button
            type="button"
            onClick={() => setShowCastModal(true)}
            title="Cast to Nest Hub"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 sm:px-3.5"
          >
            Cast
          </button>
          <div className="relative" ref={moreMenuRef}>
            <button
              type="button"
              onClick={() => setShowMoreMenu((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={showMoreMenu}
              aria-label="More recipe actions"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-stone-300 bg-white text-base font-semibold text-stone-600 hover:bg-stone-50 hover:text-stone-900"
            >
              ⋮
            </button>

            {showMoreMenu && (
              <div
                role="menu"
                className="absolute right-0 z-30 mt-1.5 w-48 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg"
              >
                <Link
                  to={`/recipes/${recipe.id}/cook`}
                  role="menuitem"
                  onClick={() => setShowMoreMenu(false)}
                  className="block px-4 py-3 text-sm font-medium text-stone-700 hover:bg-stone-50 hover:text-stone-900"
                >
                  Cook Mode
                </Link>
                <div
                  role="separator"
                  className="my-1 border-t border-stone-100"
                />
                <button
                  type="button"
                  role="menuitem"
                  disabled={deleting}
                  onClick={() => {
                    setShowMoreMenu(false);
                    void handleDelete();
                  }}
                  className="block w-full px-4 py-3 text-left text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {addedNotice && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <span className="min-w-0">
            Added <strong>{addedNotice.addedCount}</strong> ingredient
            {addedNotice.addedCount === 1 ? "" : "s"} to{" "}
            <strong>{addedNotice.listName}</strong>.
          </span>
          <div className="flex items-center gap-2">
            <Link
              to={`/shopping-lists?list=${addedNotice.listId}`}
              className="py-1 font-medium text-emerald-900 underline hover:text-emerald-700"
            >
              View Shopping List →
            </Link>
            <button
              type="button"
              onClick={() => setAddedNotice(null)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-emerald-700 transition-colors hover:bg-emerald-100 hover:text-emerald-900"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {plannedNotice && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <span className="min-w-0">
            Added <strong>{plannedNotice.recipeTitle}</strong> to your meal plan
            for{" "}
            <strong>
              {formatDayLabel(plannedNotice.date).weekday},{" "}
              {formatDayLabel(plannedNotice.date).shortDate}
            </strong>
            .
          </span>
          <div className="flex items-center gap-2">
            <Link
              to={`/meal-plan?week=${plannedNotice.weekStart}`}
              className="py-1 font-medium text-emerald-900 underline hover:text-emerald-700"
            >
              View Meal Plan →
            </Link>
            <button
              type="button"
              onClick={() => setPlannedNotice(null)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-emerald-700 transition-colors hover:bg-emerald-100 hover:text-emerald-900"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Hero card */}
      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xs">
        {recipe.image_url && !imageError && (
          <div className="h-48 w-full overflow-hidden bg-stone-100 sm:h-auto sm:max-h-96">
            <img
              src={recipe.image_url}
              alt={recipe.title}
              onError={() => setImageError(true)}
              className="h-full w-full object-cover sm:max-h-96"
            />
          </div>
        )}

        <div className="space-y-3 p-4 sm:space-y-4 sm:p-6">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
              {recipe.title}
            </h1>
            {hasSourceUrl && (
              <p className="mt-1 break-words text-xs text-stone-500">
                Imported from{" "}
                <a
                  href={recipe.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block max-w-full truncate align-bottom font-medium text-amber-700 hover:underline"
                >
                  {formatHostname(recipe.source_url)} ↗
                </a>
              </p>
            )}
          </div>

          {recipe.description && (
            <p className="break-words text-sm leading-relaxed text-stone-600">
              {recipe.description}
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1 text-xs font-medium text-stone-700">
            <span className="rounded-full bg-stone-100 px-3 py-1">
              Servings: {recipe.servings}
            </span>
            {recipe.prep_minutes > 0 && (
              <span className="rounded-full bg-stone-100 px-3 py-1">
                Prep: {formatMinutes(recipe.prep_minutes)}
              </span>
            )}
            {recipe.cook_minutes > 0 && (
              <span className="rounded-full bg-stone-100 px-3 py-1">
                Cook: {formatMinutes(recipe.cook_minutes)}
              </span>
            )}
            {totalMinutes > 0 &&
              recipe.prep_minutes > 0 &&
              recipe.cook_minutes > 0 && (
                <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-900">
                  Total: {formatMinutes(totalMinutes)}
                </span>
              )}
          </div>
        </div>
      </div>

      {/* Mobile-only sticky Ingredients / Instructions switcher */}
      <div className="sticky top-[var(--app-header-h,61px)] z-20 -mx-1 bg-stone-50/95 px-1 py-2 backdrop-blur-xs md:hidden">
        <div
          role="tablist"
          aria-label="Recipe sections"
          className="grid grid-cols-2 gap-1 rounded-xl border border-stone-200 bg-white p-1 shadow-xs"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "ingredients"}
            onClick={() => setMobileTab("ingredients")}
            className={[
              "min-h-10 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
              mobileTab === "ingredients"
                ? "bg-amber-600 text-white shadow-2xs"
                : "text-stone-600 hover:bg-stone-50 hover:text-stone-900",
            ].join(" ")}
          >
            Ingredients (
            {checkedCount > 0
              ? `${checkedCount}/${ingredients.length}`
              : ingredients.length}
            )
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "instructions"}
            onClick={() => setMobileTab("instructions")}
            className={[
              "min-h-10 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
              mobileTab === "instructions"
                ? "bg-amber-600 text-white shadow-2xs"
                : "text-stone-600 hover:bg-stone-50 hover:text-stone-900",
            ].join(" ")}
          >
            Instructions ({instructionBlocks.length})
          </button>
        </div>
      </div>

      {/* Ingredients & Instructions */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-5">
        <section
          className={[
            "min-w-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-xs sm:p-6 md:col-span-2",
            mobileTab === "ingredients" ? "block" : "hidden md:block",
          ].join(" ")}
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-stone-900">
              Ingredients
              {checkedCount > 0 && (
                <span className="ml-2 text-xs font-medium text-stone-500">
                  {checkedCount}/{ingredients.length}
                </span>
              )}
            </h2>
            {ingredients.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAddToListModal(true)}
                className="-mr-2 rounded-lg px-2 py-2 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-50 hover:text-amber-800 hover:underline"
              >
                + Add to list
              </button>
            )}
          </div>
          {ingredients.length > 0 ? (
            <ul className="mt-3 divide-y divide-stone-100 text-sm sm:mt-4">
              {ingredients.map((ing) => {
                const done = checkedIngredients.has(ing.id);
                const amount = [ing.quantity, ing.unit]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <li key={ing.id} className="first:pt-0">
                    <button
                      type="button"
                      onClick={() => toggleIngredient(ing.id)}
                      aria-pressed={done}
                      className={[
                        "flex w-full items-start gap-2.5 rounded-lg px-1.5 py-2.5 text-left transition-colors",
                        done
                          ? "text-stone-400 line-through"
                          : "text-stone-800 hover:bg-amber-50/50 active:bg-amber-50",
                      ].join(" ")}
                    >
                      <span
                        aria-hidden="true"
                        className={[
                          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs font-bold transition-colors",
                          done
                            ? "border-emerald-600 bg-emerald-600 text-white"
                            : "border-stone-300 bg-white",
                        ].join(" ")}
                      >
                        {done ? "✓" : ""}
                      </span>
                      <span className="min-w-0 flex-1 break-words leading-snug">
                        {amount && (
                          <span
                            className={[
                              "mr-1.5 font-medium",
                              done ? "text-stone-400" : "text-amber-800",
                            ].join(" ")}
                          >
                            {amount}
                          </span>
                        )}
                        <span>{ing.name}</span>
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
            <p className="mt-3 text-sm text-stone-500">
              No ingredients recorded.
            </p>
          )}
        </section>

        <section
          className={[
            "min-w-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-xs sm:p-6 md:col-span-3",
            mobileTab === "instructions" ? "block" : "hidden md:block",
          ].join(" ")}
        >
          <h2 className="text-base font-semibold text-stone-900">
            Instructions
          </h2>
          {instructionBlocks.length > 0 ? (
            <ol className="mt-3 space-y-2.5 text-base leading-relaxed text-stone-700 sm:mt-4 sm:space-y-3 sm:text-sm sm:leading-relaxed">
              {instructionBlocks.map((step, idx) => {
                const highlighted = activeStep === idx;
                return (
                  <li key={idx}>
                    <button
                      type="button"
                      onClick={() =>
                        setActiveStep((prev) => (prev === idx ? null : idx))
                      }
                      aria-pressed={highlighted}
                      className={[
                        "flex w-full items-start gap-3 rounded-xl border p-2.5 text-left transition-colors sm:p-3",
                        highlighted
                          ? "border-amber-300 bg-amber-50/70 text-stone-900 ring-1 ring-amber-200"
                          : "border-transparent hover:bg-stone-50 active:bg-amber-50/40",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                          highlighted
                            ? "bg-amber-600 text-white"
                            : "bg-amber-100 text-amber-900",
                        ].join(" ")}
                      >
                        {idx + 1}
                      </span>
                      <p className="min-w-0 flex-1 break-words whitespace-pre-line">
                        {step}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-stone-500">
              No instructions saved.{" "}
              {hasSourceUrl && (
                <a
                  href={recipe.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-amber-700 hover:underline"
                >
                  Open original recipe ↗
                </a>
              )}
            </p>
          )}
        </section>
      </div>
      {showAddToListModal && (
        <AddToShoppingListModal
          recipeId={recipe.id}
          recipeTitle={recipe.title}
          initialIngredients={recipe.ingredients}
          onClose={() => setShowAddToListModal(false)}
          onAdded={(info) => {
            setShowAddToListModal(false);
            setAddedNotice(info);
          }}
        />
      )}

      {showAddToPlanModal && (
        <AddToMealPlanModal
          recipeId={recipe.id}
          recipeTitle={recipe.title}
          onClose={() => setShowAddToPlanModal(false)}
          onAdded={(info) => {
            setShowAddToPlanModal(false);
            setPlannedNotice(info);
          }}
        />
      )}

      {showCastModal && (
        <CastRecipeModal
          recipeId={recipe.id}
          recipeTitle={recipe.title}
          onClose={() => setShowCastModal(false)}
        />
      )}
    </article>
  );
}
