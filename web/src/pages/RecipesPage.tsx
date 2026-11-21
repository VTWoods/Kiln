import { useEffect, useState } from "react";
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
  isSafeHttpUrl,
  type ImportedRecipe,
  type Recipe,
} from "../types/recipe";

function extractSharedUrl(
  shareUrl: string | null,
  shareText: string | null,
): string | null {
  const candidates = [shareUrl, shareText].filter(
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
  const [error, setError] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
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
    setError(null);

    // Hydrate immediately from IndexedDB so switching tabs offline never flashes empty
    void getCachedRecipes().then((cached) => {
      if (active && cached.length > 0) {
        setRecipes(cached);
        setLoading(false);
      }
    });

    listRecipes()
      .then((data) => {
        if (active) setRecipes(data);
      })
      .catch((err: unknown) => {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Failed to load recipes.",
          );
        }
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
        });
      return;
    }

    if (hasShare) {
      const extracted = extractSharedUrl(shareUrl, shareText);
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

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
            Recipes
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            Store, organize, and browse your personal recipe collection.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowImportModal(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-amber-700"
        >
          + Import from URL
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {addedNotice && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>
            Added <strong>{addedNotice.addedCount}</strong> ingredient
            {addedNotice.addedCount === 1 ? "" : "s"} from{" "}
            <strong>{addedNotice.recipeTitle}</strong> to{" "}
            <strong>{addedNotice.listName}</strong>.
          </span>
          <div className="flex items-center gap-3">
            <Link
              to={`/shopping-lists?list=${addedNotice.listId}`}
              className="font-medium text-emerald-900 underline hover:text-emerald-700"
            >
              View Shopping List →
            </Link>
            <button
              type="button"
              onClick={() => setAddedNotice(null)}
              className="text-emerald-600 hover:text-emerald-900"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {plannedNotice && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>
            Added <strong>{plannedNotice.recipeTitle}</strong> to your meal plan
            for{" "}
            <strong>
              {formatDayLabel(plannedNotice.date).weekday},{" "}
              {formatDayLabel(plannedNotice.date).shortDate}
            </strong>
            .
          </span>
          <div className="flex items-center gap-3">
            <Link
              to={`/meal-plan?week=${plannedNotice.weekStart}`}
              className="font-medium text-emerald-900 underline hover:text-emerald-700"
            >
              View Meal Plan →
            </Link>
            <button
              type="button"
              onClick={() => setPlannedNotice(null)}
              className="text-emerald-600 hover:text-emerald-900"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((n) => (
            <div
              key={n}
              className="h-64 animate-pulse rounded-2xl border border-stone-200 bg-white"
            />
          ))}
        </div>
      ) : recipes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center">
          <p className="text-base font-medium text-stone-800">No recipes yet</p>
          <p className="mt-1 text-sm text-stone-500">
            Paste a link from a recipe website to import its ingredients,
            instructions, and photo.
          </p>
          <button
            type="button"
            onClick={() => setShowImportModal(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-700"
          >
            Import Your First Recipe
          </button>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {recipes.map((recipe) => {
            const totalMinutes = recipe.prep_minutes + recipe.cook_minutes;
            const hasSource = isSafeHttpUrl(recipe.source_url);

            return (
              <div
                key={recipe.id}
                className="group flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xs transition-shadow hover:shadow-md"
              >
                <Link
                  to={`/recipes/${recipe.id}`}
                  className="block aspect-16/10 w-full overflow-hidden bg-stone-100"
                >
                  {recipe.image_url ? (
                    <img
                      src={recipe.image_url}
                      alt={recipe.title}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-103"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-amber-50/70 text-xs font-medium text-amber-800/70">
                      No photo
                    </div>
                  )}
                </Link>

                <div className="flex flex-1 flex-col p-4">
                  <Link
                    to={`/recipes/${recipe.id}`}
                    className="line-clamp-2 text-base font-semibold text-stone-900 group-hover:text-amber-700"
                  >
                    {recipe.title}
                  </Link>

                  {recipe.description && (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-stone-500">
                      {recipe.description}
                    </p>
                  )}

                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4 text-xs text-stone-500">
                    <div className="flex flex-wrap items-center gap-2">
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
                        className="shrink-0 font-medium text-amber-700 hover:text-amber-800 hover:underline"
                      >
                        {formatHostname(recipe.source_url)} ↗
                      </a>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-stone-100 pt-3">
                    <button
                      type="button"
                      onClick={() => setRecipeForPlan(recipe)}
                      title="Add to Meal Plan"
                      className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-900"
                    >
                      + Plan
                    </button>
                    <button
                      type="button"
                      onClick={() => setRecipeForList(recipe)}
                      title="Add to Shopping List"
                      className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-900"
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
          onClose={() => {
            setDraftPreview(null);
            setSharedImportUrl(null);
            setShowImportModal(false);
          }}
          onSaved={handleImported}
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
