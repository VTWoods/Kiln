import { useEffect, useState, type FormEvent } from "react";
import { togglePantryStaple } from "../api/pantryStaples";
import { getRecipe } from "../api/recipes";
import {
  addShoppingListItems,
  createShoppingList,
  listShoppingLists,
} from "../api/shoppingLists";
import type { RecipeIngredient } from "../types/recipe";
import {
  defaultShoppingListName,
  type ShoppingList,
} from "../types/shoppingList";

type Props = {
  recipeId: number;
  recipeTitle: string;
  initialIngredients?: RecipeIngredient[];
  onClose: () => void;
  onAdded: (result: {
    listId: number;
    listName: string;
    addedCount: number;
  }) => void;
};

const NEW_LIST_VALUE = "__new__";

export default function AddToShoppingListModal({
  recipeId,
  recipeTitle,
  initialIngredients,
  onClose,
  onAdded,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ingredients, setIngredients] = useState<RecipeIngredient[]>(
    initialIngredients ?? [],
  );
  // Set of ingredient IDs the user wants to ADD (pantry staples start unchecked)
  const [includedIds, setIncludedIds] = useState<Set<number>>(
    () =>
      new Set(
        (initialIngredients ?? [])
          .filter((i) => !i.is_pantry_staple)
          .map((i) => i.id),
      ),
  );
  const [togglingStapleId, setTogglingStapleId] = useState<number | null>(null);

  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [selectedListValue, setSelectedListValue] =
    useState<string>(NEW_LIST_VALUE);
  const [newListName, setNewListName] = useState(() =>
    defaultShoppingListName(),
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [submitting, onClose]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    // Always fetch recipe ingredients fresh so pantry staple flags reflect latest edits
    const recipePromise = getRecipe(recipeId).then((r) => r.ingredients ?? []);

    Promise.all([recipePromise, listShoppingLists()])
      .then(([loadedIngredients, loadedLists]) => {
        if (!active) return;
        setIngredients(loadedIngredients);
        setIncludedIds(
          new Set(
            loadedIngredients
              .filter((i) => !i.is_pantry_staple)
              .map((i) => i.id),
          ),
        );
        setLists(loadedLists);
        if (loadedLists.length > 0) {
          setSelectedListValue(String(loadedLists[0].id));
        } else {
          setSelectedListValue(NEW_LIST_VALUE);
          setNewListName(defaultShoppingListName());
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load recipe ingredients or shopping lists.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [recipeId]);

  const toggleIngredient = (id: number) => {
    setIncludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setIncludedIds(new Set(ingredients.map((i) => i.id)));
  };

  const clearAll = () => {
    setIncludedIds(new Set());
  };

  const stapleIngredients = ingredients.filter((i) => i.is_pantry_staple);
  const regularIngredients = ingredients.filter((i) => !i.is_pantry_staple);
  const selectedStapleCount = stapleIngredients.filter((i) =>
    includedIds.has(i.id),
  ).length;

  const setStaplesIncluded = (include: boolean) => {
    setIncludedIds((prev) => {
      const next = new Set(prev);
      for (const s of stapleIngredients) {
        if (include) {
          next.add(s.id);
        } else {
          next.delete(s.id);
        }
      }
      return next;
    });
  };

  const handleToggleStaple = async (ing: RecipeIngredient) => {
    setTogglingStapleId(ing.id);
    setError(null);
    try {
      const res = await togglePantryStaple(ing.name);
      // Refresh recipe ingredients so compound/matching items stay accurate
      const fresh = await getRecipe(recipeId).then((r) => r.ingredients ?? []);
      setIngredients(fresh);
      setIncludedIds((prev) => {
        const next = new Set(prev);
        if (res.is_pantry_staple) {
          next.delete(ing.id);
        } else {
          next.add(ing.id);
        }
        return next;
      });
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to update pantry staple.",
      );
    } finally {
      setTogglingStapleId(null);
    }
  };

  const selectedIngredients = ingredients.filter((i) => includedIds.has(i.id));
  const excludedCount = ingredients.length - selectedIngredients.length;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (selectedIngredients.length === 0) {
      setError("Select at least one ingredient to add to your shopping list.");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      let targetListId: number;
      let targetListName: string;

      if (selectedListValue === NEW_LIST_VALUE) {
        const trimmedName = newListName.trim();
        if (!trimmedName) {
          setError("Please enter a name for the new shopping list.");
          setSubmitting(false);
          return;
        }
        const created = await createShoppingList(trimmedName);
        targetListId = created.id;
        targetListName = created.name;
      } else {
        targetListId = Number(selectedListValue);
        const found = lists.find((l) => l.id === targetListId);
        targetListName = found ? found.name : "Shopping List";
      }

      await addShoppingListItems(
        targetListId,
        selectedIngredients.map((ing) => ({
          name: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
          recipe_id: recipeId,
        })),
      );

      onAdded({
        listId: targetListId,
        listName: targetListName,
        addedCount: selectedIngredients.length,
      });
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to add ingredients to shopping list.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-to-list-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-stone-200">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-6 py-4">
          <div className="min-w-0">
            <h2
              id="add-to-list-title"
              className="text-lg font-semibold text-stone-900"
            >
              Add to Shopping List
            </h2>
            <p className="mt-0.5 truncate text-xs text-stone-500">
              {recipeTitle} — uncheck what you already have (duplicates merge
              automatically)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-50"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        {loading ? (
          <div className="space-y-3 p-6">
            {[0, 1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-10 animate-pulse rounded-lg bg-stone-100"
              />
            ))}
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex-1 space-y-5 overflow-y-auto p-6">
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                  {error}
                </div>
              )}

              {/* Target shopping list selector */}
              <div className="space-y-2">
                <label
                  htmlFor="target-shopping-list"
                  className="block text-sm font-medium text-stone-700"
                >
                  Shopping List
                </label>

                {lists.length > 0 && (
                  <select
                    id="target-shopping-list"
                    value={selectedListValue}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedListValue(val);
                      if (val === NEW_LIST_VALUE && !newListName.trim()) {
                        setNewListName(defaultShoppingListName());
                      }
                    }}
                    disabled={submitting}
                    className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none"
                  >
                    {lists.map((list) => (
                      <option key={list.id} value={String(list.id)}>
                        {list.name} ({list.item_count} item
                        {list.item_count === 1 ? "" : "s"})
                      </option>
                    ))}
                    <option value={NEW_LIST_VALUE}>+ Create a new list…</option>
                  </select>
                )}

                {selectedListValue === NEW_LIST_VALUE && (
                  <input
                    id={lists.length === 0 ? "target-shopping-list" : undefined}
                    type="text"
                    required
                    placeholder={`e.g., ${defaultShoppingListName()}`}
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    disabled={submitting}
                    className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none"
                  />
                )}
              </div>

              {/* Ingredient checklist */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium text-stone-800">
                    Ingredients ({selectedIngredients.length} of{" "}
                    {ingredients.length} selected)
                    {excludedCount > 0 && (
                      <span className="ml-1.5 text-xs font-normal text-stone-500">
                        · {excludedCount} removed
                      </span>
                    )}
                  </div>

                  {ingredients.length > 0 && (
                    <div className="flex items-center gap-3 text-xs font-medium">
                      <button
                        type="button"
                        onClick={selectAll}
                        className="text-amber-700 hover:text-amber-800 hover:underline"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={clearAll}
                        className="text-stone-500 hover:text-stone-800 hover:underline"
                      >
                        Unselect all
                      </button>
                    </div>
                  )}
                </div>

                {ingredients.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-6 text-center text-sm text-stone-500">
                    This recipe has no ingredients to add.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {stapleIngredients.length > 0 && (
                      <div className="overflow-hidden rounded-xl border border-amber-200/80 bg-amber-50/30">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200/60 bg-amber-50/70 px-3.5 py-2">
                          <div>
                            <p className="text-xs font-semibold tracking-wide text-amber-900 uppercase">
                              Pantry Staples ({selectedStapleCount}/
                              {stapleIngredients.length} selected)
                            </p>
                            <p className="text-[11px] text-amber-800/80">
                              Unchecked by default — check any you&apos;re out of
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setStaplesIncluded(
                                selectedStapleCount < stapleIngredients.length,
                              )
                            }
                            className="text-xs font-medium text-amber-800 hover:text-amber-950 hover:underline"
                          >
                            {selectedStapleCount < stapleIngredients.length
                              ? "Include all staples"
                              : "Skip all staples"}
                          </button>
                        </div>
                        <ul className="divide-y divide-amber-100/80 bg-white/80">
                          {stapleIngredients.map((ing) => {
                            const included = includedIds.has(ing.id);
                            const amount = [ing.quantity, ing.unit]
                              .filter(Boolean)
                              .join(" ");
                            const busy = togglingStapleId === ing.id;

                            return (
                              <li
                                key={ing.id}
                                className={[
                                  "flex items-center justify-between gap-2 px-3.5 py-2 text-sm transition-colors",
                                  included
                                    ? "bg-white hover:bg-amber-50/40"
                                    : "bg-stone-50/60 hover:bg-stone-100/70",
                                ].join(" ")}
                              >
                                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                                  <input
                                    type="checkbox"
                                    checked={included}
                                    onChange={() => toggleIngredient(ing.id)}
                                    className="h-4 w-4 shrink-0 rounded border-stone-300 text-amber-600 accent-amber-600 focus:ring-amber-500"
                                  />
                                  <span
                                    className={[
                                      "min-w-0 break-words",
                                      included
                                        ? "text-stone-800"
                                        : "text-stone-400 line-through",
                                    ].join(" ")}
                                  >
                                    {amount && (
                                      <span
                                        className={[
                                          "mr-1.5 font-medium",
                                          included
                                            ? "text-amber-800"
                                            : "text-stone-400",
                                        ].join(" ")}
                                      >
                                        {amount}
                                      </span>
                                    )}
                                    {ing.name}
                                  </span>
                                </label>

                                <button
                                  type="button"
                                  onClick={() => handleToggleStaple(ing)}
                                  disabled={busy || submitting}
                                  title="Remove from your Pantry Staples"
                                  className="shrink-0 rounded-full border border-stone-200 bg-white px-2 py-0.5 text-[11px] font-medium text-stone-500 hover:border-stone-300 hover:text-stone-800 disabled:opacity-50"
                                >
                                  {busy ? "…" : "Unmark staple"}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    {regularIngredients.length > 0 && (
                      <div className="space-y-1.5">
                        {stapleIngredients.length > 0 && (
                          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                            Recipe Ingredients ({regularIngredients.length})
                          </p>
                        )}
                        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
                          {regularIngredients.map((ing) => {
                            const included = includedIds.has(ing.id);
                            const amount = [ing.quantity, ing.unit]
                              .filter(Boolean)
                              .join(" ");
                            const busy = togglingStapleId === ing.id;

                            return (
                              <li
                                key={ing.id}
                                className={[
                                  "flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm transition-colors",
                                  included
                                    ? "hover:bg-amber-50/40"
                                    : "bg-stone-50/80 hover:bg-stone-100/80",
                                ].join(" ")}
                              >
                                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                                  <input
                                    type="checkbox"
                                    checked={included}
                                    onChange={() => toggleIngredient(ing.id)}
                                    className="h-4 w-4 shrink-0 rounded border-stone-300 text-amber-600 accent-amber-600 focus:ring-amber-500"
                                  />
                                  <span
                                    className={[
                                      "min-w-0 break-words",
                                      included
                                        ? "text-stone-800"
                                        : "text-stone-400 line-through",
                                    ].join(" ")}
                                  >
                                    {amount && (
                                      <span
                                        className={[
                                          "mr-1.5 font-medium",
                                          included
                                            ? "text-amber-800"
                                            : "text-stone-400",
                                        ].join(" ")}
                                      >
                                        {amount}
                                      </span>
                                    )}
                                    {ing.name}
                                  </span>
                                </label>

                                <div className="flex shrink-0 items-center gap-1.5">
                                  {!included && (
                                    <span className="rounded-full bg-stone-200/80 px-2 py-0.5 text-[11px] font-medium text-stone-600">
                                      Already have
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleToggleStaple(ing)}
                                    disabled={busy || submitting}
                                    title="Mark as a Pantry Staple (unchecked by default on future recipes)"
                                    className="rounded-full px-2 py-0.5 text-[11px] font-medium text-stone-400 hover:bg-amber-50 hover:text-amber-800 disabled:opacity-50"
                                  >
                                    {busy ? "…" : "+ Staple"}
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-stone-200 bg-stone-50 px-6 py-3.5">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || selectedIngredients.length === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Adding…
                  </>
                ) : (
                  `Add ${selectedIngredients.length} Ingredient${selectedIngredients.length === 1 ? "" : "s"}`
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
