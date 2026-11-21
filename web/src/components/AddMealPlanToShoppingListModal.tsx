import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getMealPlanIngredients } from "../api/mealPlan";
import { togglePantryStaple } from "../api/pantryStaples";
import {
  addShoppingListItems,
  createShoppingList,
  listShoppingLists,
} from "../api/shoppingLists";
import {
  formatDayLabel,
  formatWeekRange,
  getWeekDates,
  type MealPlanEntry,
  type MealPlanIngredientItem,
} from "../types/mealPlan";
import {
  defaultShoppingListName,
  type ShoppingList,
} from "../types/shoppingList";
import ModalSheet from "./ModalSheet";

type Props = {
  weekStart: string;
  weekEntries: MealPlanEntry[];
  onClose: () => void;
  onAdded: (result: {
    listId: number;
    listName: string;
    addedCount: number;
  }) => void;
};

const NEW_LIST_VALUE = "__new__";

export default function AddMealPlanToShoppingListModal({
  weekStart,
  weekEntries,
  onClose,
  onAdded,
}: Props) {
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);

  // Days in this week that actually have at least one planned meal
  const plannedDays = useMemo(() => {
    const byDate = new Map<string, MealPlanEntry[]>();
    for (const entry of weekEntries) {
      const bucket = byDate.get(entry.date);
      if (bucket) {
        bucket.push(entry);
      } else {
        byDate.set(entry.date, [entry]);
      }
    }
    return weekDates
      .filter((d) => (byDate.get(d)?.length ?? 0) > 0)
      .map((date) => ({
        date,
        entries: byDate.get(date) ?? [],
      }));
  }, [weekDates, weekEntries]);

  const [scope, setScope] = useState<"all" | "specific">("all");
  const [selectedDates, setSelectedDates] = useState<Set<string>>(
    () => new Set(plannedDays.map((d) => d.date)),
  );

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [allIngredients, setAllIngredients] = useState<MealPlanIngredientItem[]>(
    [],
  );
  // Set of ingredient keys included to add (pantry staples start unchecked)
  const [includedKeys, setIncludedKeys] = useState<Set<string>>(new Set());
  const [togglingStapleKey, setTogglingStapleKey] = useState<string | null>(
    null,
  );

  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [selectedListValue, setSelectedListValue] =
    useState<string>(NEW_LIST_VALUE);
  const [newListName, setNewListName] = useState(() =>
    defaultShoppingListName(),
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const allPlannedDates = plannedDays.map((d) => d.date);
    Promise.all([
      allPlannedDates.length > 0
        ? getMealPlanIngredients(allPlannedDates).then((r) => r.ingredients)
        : Promise.resolve([]),
      listShoppingLists(),
    ])
      .then(([loadedIngredients, loadedLists]) => {
        if (!active) return;
        setAllIngredients(loadedIngredients);
        setIncludedKeys(
          new Set(
            loadedIngredients
              .filter((i) => !i.is_pantry_staple)
              .map((i) => i.key),
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
            : "Failed to load meal plan ingredients or shopping lists.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [plannedDays]);

  const activeDates = useMemo(() => {
    if (scope === "all") {
      return new Set(plannedDays.map((d) => d.date));
    }
    return selectedDates;
  }, [scope, plannedDays, selectedDates]);

  const visibleIngredients = useMemo(
    () => allIngredients.filter((ing) => activeDates.has(ing.date)),
    [allIngredients, activeDates],
  );

  const stapleIngredients = visibleIngredients.filter(
    (i) => i.is_pantry_staple,
  );
  const regularIngredients = visibleIngredients.filter(
    (i) => !i.is_pantry_staple,
  );
  const selectedIngredients = visibleIngredients.filter((i) =>
    includedKeys.has(i.key),
  );
  const selectedStapleCount = stapleIngredients.filter((i) =>
    includedKeys.has(i.key),
  ).length;
  const excludedCount = visibleIngredients.length - selectedIngredients.length;

  const toggleDay = (dateISO: string) => {
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateISO)) {
        next.delete(dateISO);
      } else {
        next.add(dateISO);
      }
      return next;
    });
  };

  const toggleIngredient = (key: string) => {
    setIncludedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAllVisible = () => {
    setIncludedKeys((prev) => {
      const next = new Set(prev);
      for (const ing of visibleIngredients) {
        next.add(ing.key);
      }
      return next;
    });
  };

  const clearAllVisible = () => {
    setIncludedKeys((prev) => {
      const next = new Set(prev);
      for (const ing of visibleIngredients) {
        next.delete(ing.key);
      }
      return next;
    });
  };

  const setStaplesIncluded = (include: boolean) => {
    setIncludedKeys((prev) => {
      const next = new Set(prev);
      for (const s of stapleIngredients) {
        if (include) {
          next.add(s.key);
        } else {
          next.delete(s.key);
        }
      }
      return next;
    });
  };

  const handleToggleStaple = async (ing: MealPlanIngredientItem) => {
    setTogglingStapleKey(ing.key);
    setError(null);
    try {
      const res = await togglePantryStaple(ing.name);
      const fresh = await getMealPlanIngredients(
        plannedDays.map((d) => d.date),
      ).then((r) => r.ingredients);
      setAllIngredients(fresh);
      setIncludedKeys((prev) => {
        const next = new Set(prev);
        for (const item of fresh) {
          if (item.name.toLowerCase() === ing.name.toLowerCase()) {
            if (res.is_pantry_staple) {
              next.delete(item.key);
            } else {
              next.add(item.key);
            }
          }
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
      setTogglingStapleKey(null);
    }
  };

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
          recipe_id: ing.recipe_id,
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
          : "Failed to add meal plan ingredients to shopping list.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const footer = loading ? undefined : (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        disabled={submitting}
        className="min-h-[40px] flex-1 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 sm:flex-initial"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={submitting || selectedIngredients.length === 0}
        className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-initial"
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
  );

  return (
    <ModalSheet
      onClose={onClose}
      title="Add Meal Plan to Shopping List"
      subtitle={
        <span className="block truncate">
          {formatWeekRange(weekStart)} — duplicates across recipes merge
          automatically
        </span>
      }
      footer={footer}
      maxWidthClass="sm:max-w-2xl"
      closeDisabled={submitting}
      onSubmit={loading ? undefined : handleSubmit}
    >
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-10 animate-pulse rounded-lg bg-stone-100"
            />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Day selection question: Entire week vs Specific days */}
          <div className="space-y-2.5 rounded-xl border border-stone-200 bg-stone-50/70 p-3.5 sm:p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-medium text-stone-800">
                Which days do you want to shop for?
              </span>
              <div
                className="grid w-full grid-cols-2 rounded-lg border border-stone-200 bg-white p-0.5 text-xs sm:inline-flex sm:w-auto"
                role="group"
                aria-label="Days to include"
              >
                <button
                  type="button"
                  onClick={() => setScope("all")}
                  className={[
                    "min-h-[40px] rounded-md px-2.5 py-2 font-medium transition-colors sm:min-h-[32px] sm:py-1.5",
                    scope === "all"
                      ? "bg-amber-600 text-white"
                      : "text-stone-600 hover:text-stone-900",
                  ].join(" ")}
                >
                  All {plannedDays.length} day
                  {plannedDays.length === 1 ? "" : "s"}
                </button>
                <button
                  type="button"
                  onClick={() => setScope("specific")}
                  className={[
                    "min-h-[40px] rounded-md px-2.5 py-2 font-medium transition-colors sm:min-h-[32px] sm:py-1.5",
                    scope === "specific"
                      ? "bg-amber-600 text-white"
                      : "text-stone-600 hover:text-stone-900",
                  ].join(" ")}
                >
                  Pick days
                </button>
              </div>
            </div>

            {scope === "specific" && (
              <div className="grid gap-1.5 pt-1 sm:grid-cols-2">
                {plannedDays.map(({ date, entries }) => {
                  const day = formatDayLabel(date);
                  const checked = selectedDates.has(date);
                  return (
                    <label
                      key={date}
                      className={[
                        "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs transition-colors",
                        checked
                          ? "border-amber-400 bg-amber-50/70"
                          : "border-stone-200 bg-white opacity-70 hover:opacity-100",
                      ].join(" ")}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDay(date)}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-stone-300 accent-amber-600"
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-stone-800">
                          {day.weekday}, {day.shortDate}
                        </p>
                        <p className="truncate text-[11px] text-stone-500">
                          {entries.map((e) => e.recipe.title).join(", ")}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Target shopping list selector */}
          <div className="space-y-2">
            <label
              htmlFor="meal-plan-target-list"
              className="block text-sm font-medium text-stone-700"
            >
              Shopping List
            </label>

            {lists.length > 0 && (
              <select
                id="meal-plan-target-list"
                value={selectedListValue}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedListValue(val);
                  if (val === NEW_LIST_VALUE && !newListName.trim()) {
                    setNewListName(defaultShoppingListName());
                  }
                }}
                disabled={submitting}
                className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base text-stone-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none sm:py-2 sm:text-sm"
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
                id={lists.length === 0 ? "meal-plan-target-list" : undefined}
                type="text"
                required
                placeholder={`e.g., ${defaultShoppingListName()}`}
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                disabled={submitting}
                className="w-full rounded-lg border border-stone-300 px-3 py-2.5 text-base text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none sm:py-2 sm:text-sm"
              />
            )}
          </div>

          {/* Ingredient checklist (Pantry Staples first & unchecked, then Recipe Ingredients) */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium text-stone-800">
                Ingredients ({selectedIngredients.length} of{" "}
                {visibleIngredients.length} selected)
                {excludedCount > 0 && (
                  <span className="ml-1.5 text-xs font-normal text-stone-500">
                    · {excludedCount} removed
                  </span>
                )}
              </div>

              {visibleIngredients.length > 0 && (
                <div className="flex items-center gap-1 text-xs font-medium">
                  <button
                    type="button"
                    onClick={selectAllVisible}
                    className="min-h-[36px] rounded-md px-2.5 py-1.5 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={clearAllVisible}
                    className="min-h-[36px] rounded-md px-2.5 py-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                  >
                    Unselect all
                  </button>
                </div>
              )}
            </div>

            {visibleIngredients.length === 0 ? (
              <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-6 text-center text-sm text-stone-500">
                {activeDates.size === 0
                  ? "Select at least one day above to include its ingredients."
                  : "No ingredients found for the selected meals."}
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
                        className="min-h-[36px] rounded-md px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100/70 hover:text-amber-950"
                      >
                        {selectedStapleCount < stapleIngredients.length
                          ? "Include all staples"
                          : "Skip all staples"}
                      </button>
                    </div>
                    <ul className="divide-y divide-amber-100/80 bg-white/80">
                      {stapleIngredients.map((ing) => {
                        const included = includedKeys.has(ing.key);
                        const amount = [ing.quantity, ing.unit]
                          .filter(Boolean)
                          .join(" ");
                        const busy = togglingStapleKey === ing.key;

                        return (
                          <li
                            key={ing.key}
                            className={[
                              "flex items-center justify-between gap-2 px-3 text-sm transition-colors sm:px-3.5",
                              included
                                ? "bg-white hover:bg-amber-50/40"
                                : "bg-stone-50/60 hover:bg-stone-100/70",
                            ].join(" ")}
                          >
                            <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 py-3">
                              <input
                                type="checkbox"
                                checked={included}
                                onChange={() => toggleIngredient(ing.key)}
                                className="mt-0.5 h-5 w-5 shrink-0 rounded border-stone-300 text-amber-600 accent-amber-600 focus:ring-amber-500"
                              />
                              <span className="flex min-w-0 flex-col gap-1">
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
                                <span className="max-w-full self-start truncate rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-500">
                                  {ing.recipe_title}
                                </span>
                              </span>
                            </label>

                            <button
                              type="button"
                              onClick={() => handleToggleStaple(ing)}
                              disabled={busy || submitting}
                              title="Remove from your Pantry Staples"
                              className="min-h-[36px] shrink-0 rounded-full border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:border-stone-300 hover:text-stone-900 disabled:opacity-50"
                            >
                              {busy ? (
                                "…"
                              ) : (
                                <>
                                  Unmark
                                  <span className="hidden sm:inline">
                                    {" "}
                                    staple
                                  </span>
                                </>
                              )}
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
                        const included = includedKeys.has(ing.key);
                        const amount = [ing.quantity, ing.unit]
                          .filter(Boolean)
                          .join(" ");
                        const busy = togglingStapleKey === ing.key;

                        return (
                          <li
                            key={ing.key}
                            className={[
                              "flex items-center justify-between gap-2 px-3 text-sm transition-colors sm:px-3.5",
                              included
                                ? "hover:bg-amber-50/40"
                                : "bg-stone-50/80 hover:bg-stone-100/80",
                            ].join(" ")}
                          >
                            <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 py-3">
                              <input
                                type="checkbox"
                                checked={included}
                                onChange={() => toggleIngredient(ing.key)}
                                className="mt-0.5 h-5 w-5 shrink-0 rounded border-stone-300 text-amber-600 accent-amber-600 focus:ring-amber-500"
                              />
                              <span className="flex min-w-0 flex-col gap-1">
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
                                <span className="max-w-full self-start truncate rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                                  {ing.recipe_title}
                                </span>
                              </span>
                            </label>

                            <div className="flex shrink-0 items-center gap-1.5">
                              {!included && (
                                <span className="hidden rounded-full bg-stone-200/80 px-2 py-0.5 text-[11px] font-medium text-stone-600 sm:inline-block">
                                  Already have
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => handleToggleStaple(ing)}
                                disabled={busy || submitting}
                                title="Mark as a Pantry Staple"
                                className="min-h-[36px] shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-stone-500 hover:bg-amber-50 hover:text-amber-800 disabled:opacity-50"
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
      )}
    </ModalSheet>
  );
}
