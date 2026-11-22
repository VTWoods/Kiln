import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getImportDraft, listRecipes } from "../api/recipes";
import AddToMealPlanModal from "../components/AddToMealPlanModal";
import AddToShoppingListModal from "../components/AddToShoppingListModal";
import ImportRecipeModal from "../components/ImportRecipeModal";
import { getCachedRecipes } from "../offline/store";
import { formatDayLabel } from "../types/mealPlan";
import {
  formatHostname,
  formatMinutes,
  getMatchingIngredients,
  isSafeHttpUrl,
  matchesRecipeSearch,
  type ImportedRecipe,
  type Recipe,
} from "../types/recipe";

function extractSharedUrl(
  shareUrl: string | null,
  shareText: string | null,
  shareTitle?: string | null,
): string | null {
  const candidates = [shareUrl, shareText, shareTitle].filter(
    (v): v is string => Boolean(v && v.trim()),
  );
  for (const raw of candidates) {
    const trimmed = raw.trim();
    if (/^https?:\/\/\S+$/i.test(trimmed)) {
      return trimmed.replace(/[).,;!?]+$/, "");
    }
    const match = trimmed.match(/https?:\/\/\S+/i);
    if (match) {
      return match[0].replace(/[).,;!?]+$/, "");
    }
  }
  return null;
}

export default function RecipesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [failedImages, setFailedImages] = useState<Set<number>>(
    () => new Set(),
  );
  const [showImportModal, setShowImportModal] = useState(false);
  const [modalInitialStep, setModalInitialStep] = useState<"source" | "manual">(
    "source",
  );
  const [draftPreview, setDraftPreview] = useState<ImportedRecipe | null>(null);
  const [sharedImportUrl, setSharedImportUrl] = useState<string | null>(null);
  const [recipeForList, setRecipeForList] = useState<Recipe | null>(null);
  const [recipeForPlan, setRecipeForPlan] = useState<Recipe | null>(null);
  const [addedNotice, setAddedNotice] = useState<{
    listId: number;
    listName: string;
    addedCount: number;
    recipeTitle: string;
  } | null>(null);
  const [plannedNotice, setPlannedNotice] = useState<{
    weekStart: string;
    date: string;
    recipeTitle: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    let networkSettled = false;
    setError(null);

    // Hydrate immediately from IndexedDB so switching tabs offline never flashes empty
    void getCachedRecipes()
      .then((cached) => {
        if (!active || networkSettled) return;
        if (cached.length > 0) {
          setRecipes(cached);
          setLoading(false);
        }
      })
      .catch(() => {});

    listRecipes()
      .then((data) => {
        if (!active) return;
        networkSettled = true;
        setRecipes(data);
      })
      .catch((err: unknown) => {
        if (!active) return;
        networkSettled = true;
        setError(
          err instanceof Error ? err.message : "Failed to load recipes.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const draftToken = searchParams.get("import_draft");
    const importError = searchParams.get("import_error");
    const shareUrl = searchParams.get("share_url");
    const shareText = searchParams.get("share_text");
    const shareTitle = searchParams.get("share_title");
    const hasShare = Boolean(shareUrl || shareText || shareTitle);

    if (!draftToken && !importError && !hasShare) return;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("import_draft");
    nextParams.delete("import_error");
    nextParams.delete("share_url");
    nextParams.delete("share_text");
    nextParams.delete("share_title");
    setSearchParams(nextParams, { replace: true });

    if (importError) {
      setError(importError);
      return;
    }

    if (draftToken) {
      setLoadingDraft(true);
      getImportDraft(draftToken)
        .then((preview) => {
          setSharedImportUrl(null);
          setDraftPreview(preview);
          setShowImportModal(true);
        })
        .catch((err: unknown) => {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load bookmarklet recipe preview.",
          );
        })
        .finally(() => {
          setLoadingDraft(false);
        });
      return;
    }

    if (hasShare) {
      const extracted = extractSharedUrl(shareUrl, shareText, shareTitle);
      if (!extracted) {
        setError("Could not find a recipe URL in the shared link.");
        return;
      }
      setDraftPreview(null);
      setSharedImportUrl(extracted);
      setShowImportModal(true);
    }
  }, [searchParams, setSearchParams]);

  const handleImported = (created: Recipe) => {
    setRecipes((prev) => [created, ...prev]);
    setDraftPreview(null);
    setSharedImportUrl(null);
    setShowImportModal(false);
  };

  const filteredRecipes = useMemo(() => {
    if (!searchQuery.trim()) return recipes;
    return recipes.filter((recipe) => matchesRecipeSearch(recipe, searchQuery));
  }, [recipes, searchQuery]);

  const trimmedQuery = searchQuery.trim();

  return (
    <section className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-stone-900 sm:text-2xl">
            Recipes
          </h1>
          <p className="mt-1 hidden text-sm text-stone-600 sm:block">
            Store, organize, and browse your personal recipe collection.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setModalInitialStep("source");
            setShowImportModal(true);
          }}
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-amber-700 sm:px-4"
        >
          <span className="sm:hidden">+ Add</span>
          <span className="hidden sm:inline">+ Add Recipe</span>
        </button>
      </div>

      {recipes.length > 0 && (
        <div className="relative">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, ingredient, or site…"
            aria-label="Filter recipes"
            className="w-full appearance-none rounded-xl border border-stone-200 bg-white py-2.5 pr-11 pl-3.5 text-base text-stone-900 shadow-2xs placeholder:text-stone-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none sm:py-2 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-1 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {loadingDraft && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
          <span>Loading recipe preview…</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700"
        >
          <span className="min-w-0 break-words">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-600 transition-colors hover:bg-red-100 hover:text-red-900"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {addedNotice && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <span className="min-w-0">
            Added <strong>{addedNotice.addedCount}</strong> ingredient
            {addedNotice.addedCount === 1 ? "" : "s"} from{" "}
            <strong>{addedNotice.recipeTitle}</strong> to{" "}
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

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
          {[0, 1, 2].map((n) => (
            <div
              key={n}
              className="h-28 animate-pulse rounded-2xl border border-stone-200 bg-white sm:h-64"
            />
          ))}
        </div>
      ) : recipes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-6 text-center sm:p-10">
          <p className="text-base font-medium text-stone-800">No recipes yet</p>
          <p className="mt-1 text-sm text-stone-500">
            Import a recipe from a website or enter your own from scratch.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                setModalInitialStep("source");
                setShowImportModal(true);
              }}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-700"
            >
              Import from URL
            </button>
            <button
              type="button"
              onClick={() => {
                setModalInitialStep("manual");
                setShowImportModal(true);
              }}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              Add Manually
            </button>
          </div>
        </div>
      ) : filteredRecipes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center">
          <p className="text-base font-medium text-stone-800">
            No recipes match &ldquo;{trimmedQuery}&rdquo;
          </p>
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
          {filteredRecipes.map((recipe) => {
            const totalMinutes = recipe.prep_minutes + recipe.cook_minutes;
            const hasSource = isSafeHttpUrl(recipe.source_url);
            const showImage =
              Boolean(recipe.image_url) && !failedImages.has(recipe.id);
            const matchedIngredients = trimmedQuery
              ? getMatchingIngredients(recipe, trimmedQuery)
              : [];

            return (
              <div
                key={recipe.id}
                className="group flex flex-row overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xs transition-shadow hover:shadow-md sm:flex-col"
              >
                <Link
                  to={`/recipes/${recipe.id}`}
                  className="block w-24 shrink-0 overflow-hidden bg-stone-100 sm:aspect-16/10 sm:w-full"
                >
                  {showImage ? (
                    <img
                      src={recipe.image_url}
                      alt={recipe.title}
                      loading="lazy"
                      decoding="async"
                      onError={() =>
                        setFailedImages((prev) => {
                          if (prev.has(recipe.id)) return prev;
                          const next = new Set(prev);
                          next.add(recipe.id);
                          return next;
                        })
                      }
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-103"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-amber-50/70 px-2 text-center text-xs font-medium text-amber-800/70">
                      No photo
                    </div>
                  )}
                </Link>

                <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-4">
                  <Link
                    to={`/recipes/${recipe.id}`}
                    className="line-clamp-2 text-sm font-semibold leading-snug text-stone-900 group-hover:text-amber-700 sm:text-base"
                  >
                    {recipe.title}
                  </Link>

                  {recipe.description && (
                    <div className="hidden sm:block">
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-stone-500">
                        {recipe.description}
                      </p>
                    </div>
                  )}

                  {matchedIngredients.length > 0 && (
                    <p className="mt-1 truncate text-[11px] font-medium text-amber-800/85">
                      Matches: {matchedIngredients.slice(0, 3).join(", ")}
                      {matchedIngredients.length > 3 ? "…" : ""}
                    </p>
                  )}

                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs text-stone-500 sm:mt-auto sm:pt-4">
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                      <span>
                        {recipe.ingredient_count} ingredient
                        {recipe.ingredient_count === 1 ? "" : "s"}
                      </span>
                      {totalMinutes > 0 && (
                        <>
                          <span>•</span>
                          <span>{formatMinutes(totalMinutes)}</span>
                        </>
                      )}
                    </div>

                    {hasSource && (
                      <a
                        href={recipe.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Open original recipe on ${formatHostname(recipe.source_url)}`}
                        className="inline-block max-w-[150px] truncate py-0.5 font-medium text-amber-700 hover:text-amber-800 hover:underline"
                      >
                        {formatHostname(recipe.source_url)} ↗
                      </a>
                    )}
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2 border-t border-stone-100 pt-2 sm:mt-3 sm:pt-3">
                    <button
                      type="button"
                      onClick={() => setRecipeForPlan(recipe)}
                      title="Add to Meal Plan"
                      className="min-h-10 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-xs font-medium text-stone-700 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-900"
                    >
                      + Plan
                    </button>
                    <button
                      type="button"
                      onClick={() => setRecipeForList(recipe)}
                      title="Add to Shopping List"
                      className="min-h-10 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-xs font-medium text-stone-700 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-900"
                    >
                      + List
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showImportModal && (
        <ImportRecipeModal
          initialPreview={draftPreview}
          initialUrl={sharedImportUrl ?? undefined}
          autoFetch={Boolean(sharedImportUrl)}
          initialStep={modalInitialStep}
          onClose={() => {
            setDraftPreview(null);
            setSharedImportUrl(null);
            setModalInitialStep("source");
            setShowImportModal(false);
          }}
          onSaved={(created) => {
            setModalInitialStep("source");
            handleImported(created);
          }}
        />
      )}

      {recipeForList && (
        <AddToShoppingListModal
          recipeId={recipeForList.id}
          recipeTitle={recipeForList.title}
          onClose={() => setRecipeForList(null)}
          onAdded={(info) => {
            setAddedNotice({
              ...info,
              recipeTitle: recipeForList.title,
            });
            setRecipeForList(null);
          }}
        />
      )}

      {recipeForPlan && (
        <AddToMealPlanModal
          recipeId={recipeForPlan.id}
          recipeTitle={recipeForPlan.title}
          onClose={() => setRecipeForPlan(null)}
          onAdded={(info) => {
            setPlannedNotice(info);
            setRecipeForPlan(null);
          }}
        />
      )}
    </section>
  );
}
