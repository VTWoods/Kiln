import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listRecipes } from "../api/recipes";
import ImportRecipeModal from "../components/ImportRecipeModal";
import {
  formatHostname,
  formatMinutes,
  isSafeHttpUrl,
  type Recipe,
} from "../types/recipe";

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);

  const loadRecipes = () => {
    setLoading(true);
    setError(null);
    listRecipes()
      .then((data) => setRecipes(data))
      .catch((err: unknown) =>
        setError(
          err instanceof Error ? err.message : "Failed to load recipes.",
        ),
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadRecipes();
  }, []);

  const handleImported = (created: Recipe) => {
    setRecipes((prev) => [created, ...prev]);
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
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showImportModal && (
        <ImportRecipeModal
          onClose={() => setShowImportModal(false)}
          onSaved={handleImported}
        />
      )}
    </section>
  );
}
