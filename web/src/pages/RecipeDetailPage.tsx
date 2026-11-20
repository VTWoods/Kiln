import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deleteRecipe, getRecipe } from "../api/recipes";
import AddToShoppingListModal from "../components/AddToShoppingListModal";
import CastRecipeModal from "../components/CastRecipeModal";
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
  const [showCastModal, setShowCastModal] = useState(false);
  const [addedNotice, setAddedNotice] = useState<{
    listId: number;
    listName: string;
    addedCount: number;
  } | null>(null);

  useEffect(() => {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      setError("Invalid recipe ID.");
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    getRecipe(numericId)
      .then((data) => {
        if (active) setRecipe(data);
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
  const instructionBlocks = recipe.instructions
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  const hasSourceUrl = isSafeHttpUrl(recipe.source_url);

  return (
    <article className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          to="/recipes"
          className="inline-flex items-center text-sm font-medium text-stone-600 hover:text-stone-900"
        >
          ← Back to Recipes
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAddToListModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-700"
          >
            + Add to Shopping List
          </button>
          <button
            type="button"
            onClick={() => setShowCastModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
          >
            Cast to Nest Hub
          </button>
          <Link
            to={`/recipes/${recipe.id}/cook`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            Cook Mode
          </Link>
          {hasSourceUrl && (
            <a
              href={recipe.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              Original Recipe ↗
            </a>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>

      {addedNotice && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>
            Added <strong>{addedNotice.addedCount}</strong> ingredient
            {addedNotice.addedCount === 1 ? "" : "s"} to{" "}
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

      {/* Hero card */}
      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xs">
        {recipe.image_url && (
          <div className="max-h-96 w-full overflow-hidden bg-stone-100">
            <img
              src={recipe.image_url}
              alt={recipe.title}
              className="h-full max-h-96 w-full object-cover"
            />
          </div>
        )}

        <div className="space-y-4 p-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
              {recipe.title}
            </h1>
            {hasSourceUrl && (
              <p className="mt-1 text-xs text-stone-500">
                Imported from{" "}
                <a
                  href={recipe.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-amber-700 hover:underline"
                >
                  {formatHostname(recipe.source_url)} ↗
                </a>
              </p>
            )}
          </div>

          {recipe.description && (
            <p className="text-sm leading-relaxed text-stone-600">
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

      {/* Ingredients & Instructions */}
      <div className="grid gap-6 md:grid-cols-5">
        <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-xs md:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-stone-900">
              Ingredients
            </h2>
            {recipe.ingredients && recipe.ingredients.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAddToListModal(true)}
                className="text-xs font-medium text-amber-700 hover:text-amber-800 hover:underline"
              >
                + Add to list
              </button>
            )}
          </div>
          {recipe.ingredients && recipe.ingredients.length > 0 ? (
            <ul className="mt-4 divide-y divide-stone-100 text-sm">
              {recipe.ingredients.map((ing) => (
                <li key={ing.id} className="flex gap-2 py-2.5 first:pt-0">
                  {(ing.quantity || ing.unit) && (
                    <span className="shrink-0 font-medium text-amber-800">
                      {[ing.quantity, ing.unit].filter(Boolean).join(" ")}
                    </span>
                  )}
                  <span className="text-stone-800">{ing.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-stone-500">
              No ingredients recorded.
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-xs md:col-span-3">
          <h2 className="text-base font-semibold text-stone-900">
            Instructions
          </h2>
          {instructionBlocks.length > 0 ? (
            <ol className="mt-4 space-y-4 text-sm leading-relaxed text-stone-700">
              {instructionBlocks.map((step, idx) => (
                <li key={idx} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-900">
                    {idx + 1}
                  </span>
                  <p className="whitespace-pre-line pt-0.5">{step}</p>
                </li>
              ))}
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
