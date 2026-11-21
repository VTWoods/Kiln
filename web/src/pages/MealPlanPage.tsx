import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  addMealPlanEntry,
  deleteMealPlanEntry,
  getMealPlanWeek,
  updateMealPlanEntry,
} from "../api/mealPlan";
import { listRecipes } from "../api/recipes";
import AddMealPlanToShoppingListModal from "../components/AddMealPlanToShoppingListModal";
import {
  formatDateISO,
  formatDayLabel,
  formatWeekRange,
  getMondayOfWeek,
  getNextWeekMonday,
  getThisWeekMonday,
  getWeekDates,
  parseDateISO,
  shiftWeek,
  type MealPlanEntry,
} from "../types/mealPlan";
import { formatMinutes, type Recipe } from "../types/recipe";

export default function MealPlanPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const thisWeekStart = getThisWeekMonday();
  const nextWeekStart = getNextWeekMonday();

  // Default to planning next week (Monday-Sunday) unless ?week=YYYY-MM-DD is specified
  const paramWeek = searchParams.get("week")?.trim() || "";
  const initialWeekStart = /^\d{4}-\d{2}-\d{2}$/.test(paramWeek)
    ? formatDateISO(getMondayOfWeek(parseDateISO(paramWeek)))
    : nextWeekStart;

  const [weekStart, setWeekStart] = useState<string>(initialWeekStart);
  const [entries, setEntries] = useState<MealPlanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Quick "+ Add meal" picker on a specific day
  const [addingForDate, setAddingForDate] = useState<string | null>(null);
  const [allRecipes, setAllRecipes] = useState<Recipe[]>([]);
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [recipeFilter, setRecipeFilter] = useState("");
  const [savingDate, setSavingDate] = useState<string | null>(null);

  // Add week/days to shopping list modal
  const [showAddToListModal, setShowAddToListModal] = useState(false);
  const [addedNotice, setAddedNotice] = useState<{
    listId: number;
    listName: string;
    addedCount: number;
  } | null>(null);

  const loadWeek = useCallback(async (mondayISO: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMealPlanWeek(mondayISO);
      setEntries(data.entries);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load meal plan.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWeek(weekStart);
  }, [weekStart, loadWeek]);

  // Sync URL ?week= when weekStart changes
  const selectWeek = (mondayISO: string) => {
    setWeekStart(mondayISO);
    setAddingForDate(null);
    if (mondayISO === nextWeekStart) {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ week: mondayISO }, { replace: true });
    }
  };

  const handleJumpDate = (rawISO: string) => {
    if (!rawISO) return;
    const monday = formatDateISO(getMondayOfWeek(parseDateISO(rawISO)));
    selectWeek(monday);
  };

  const openRecipePickerForDay = (iso: string) => {
    if (addingForDate === iso) {
      setAddingForDate(null);
      return;
    }
    setAddingForDate(iso);
    setRecipeFilter("");
    if (allRecipes.length === 0) {
      setLoadingRecipes(true);
      listRecipes()
        .then(setAllRecipes)
        .catch(() => {})
        .finally(() => setLoadingRecipes(false));
    }
  };

  const handleAddRecipeToDay = async (recipe: Recipe, dateISO: string) => {
    setSavingDate(dateISO);
    setError(null);
    try {
      const created = await addMealPlanEntry(recipe.id, dateISO);
      setEntries((prev) => [...prev, created]);
      setAddingForDate(null);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to add meal to plan.",
      );
    } finally {
      setSavingDate(null);
    }
  };

  const handleMoveEntry = async (entry: MealPlanEntry, newDate: string) => {
    if (entry.date === newDate) return;
    setError(null);
    // Optimistic move
    setEntries((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, date: newDate } : e)),
    );
    try {
      await updateMealPlanEntry(entry.id, { date: newDate });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to move meal.");
      void loadWeek(weekStart);
    }
  };

  const handleDeleteEntry = async (entry: MealPlanEntry) => {
    setError(null);
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    try {
      await deleteMealPlanEntry(entry.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to remove meal.");
      void loadWeek(weekStart);
    }
  };

  const weekDates = getWeekDates(weekStart);
  const entriesByDate = new Map<string, MealPlanEntry[]>();
  for (const entry of entries) {
    const bucket = entriesByDate.get(entry.date);
    if (bucket) {
      bucket.push(entry);
    } else {
      entriesByDate.set(entry.date, [entry]);
    }
  }

  const filterLower = recipeFilter.trim().toLowerCase();
  const filteredRecipes = filterLower
    ? allRecipes.filter((r) => r.title.toLowerCase().includes(filterLower))
    : allRecipes;

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
            Meal Plan
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            Plan your week Monday–Sunday and add ingredients straight to a
            shopping list.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAddToListModal(true)}
          disabled={entries.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          + Add Week to Shopping List
          {entries.length > 0 && (
            <span className="rounded-full bg-amber-700/80 px-2 py-0.5 text-xs">
              {entries.length}
            </span>
          )}
        </button>
      </div>

      {/* Week navigation bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => selectWeek(shiftWeek(weekStart, -1))}
            className="rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-50 hover:text-stone-900"
            aria-label="Previous week"
          >
            ← Prev
          </button>
          <span className="px-2 text-sm font-semibold text-stone-900 sm:text-base">
            {formatWeekRange(weekStart)}
          </span>
          <button
            type="button"
            onClick={() => selectWeek(shiftWeek(weekStart, 1))}
            className="rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-50 hover:text-stone-900"
            aria-label="Next week"
          >
            Next →
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => selectWeek(thisWeekStart)}
            className={[
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              weekStart === thisWeekStart
                ? "bg-amber-100 text-amber-900"
                : "bg-stone-100 text-stone-600 hover:bg-stone-200",
            ].join(" ")}
          >
            This Week
          </button>
          <button
            type="button"
            onClick={() => selectWeek(nextWeekStart)}
            className={[
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              weekStart === nextWeekStart
                ? "bg-amber-100 text-amber-900"
                : "bg-stone-100 text-stone-600 hover:bg-stone-200",
            ].join(" ")}
          >
            Next Week
          </button>
          <label className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs text-stone-600 hover:border-stone-300">
            <span>Jump:</span>
            <input
              type="date"
              value={weekStart}
              onChange={(e) => handleJumpDate(e.target.value)}
              aria-label="Jump to any week"
              className="cursor-pointer bg-transparent text-xs font-medium text-stone-800 focus:outline-none"
            />
          </label>
        </div>
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

      {/* 7-day Monday -> Sunday schedule */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4, 5, 6].map((n) => (
            <div
              key={n}
              className="h-20 animate-pulse rounded-2xl border border-stone-200 bg-white"
            />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {weekDates.map((iso) => {
            const day = formatDayLabel(iso);
            const dayEntries = entriesByDate.get(iso) ?? [];
            const isPicking = addingForDate === iso;

            return (
              <div
                key={iso}
                className={[
                  "rounded-2xl border bg-white p-4 shadow-xs transition-colors",
                  day.isToday
                    ? "border-amber-300 ring-1 ring-amber-200"
                    : "border-stone-200",
                ].join(" ")}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-stone-900">
                      {day.weekday}
                    </h2>
                    <span className="text-xs text-stone-500">
                      {day.shortDate}
                    </span>
                    {day.isToday && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                        Today
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => openRecipePickerForDay(iso)}
                    className="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-stone-700 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-900"
                  >
                    {isPicking ? "Close" : "+ Add meal"}
                  </button>
                </div>

                {/* Inline recipe picker for this day */}
                {isPicking && (
                  <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
                    <input
                      type="search"
                      autoFocus
                      placeholder="Search your recipes…"
                      value={recipeFilter}
                      onChange={(e) => setRecipeFilter(e.target.value)}
                      className="w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none"
                    />
                    {loadingRecipes ? (
                      <p className="text-xs text-stone-500">Loading recipes…</p>
                    ) : filteredRecipes.length === 0 ? (
                      <p className="text-xs text-stone-500">
                        {allRecipes.length === 0 ? (
                          <>
                            No saved recipes yet.{" "}
                            <Link
                              to="/recipes"
                              className="font-medium text-amber-700 underline"
                            >
                              Import a recipe first
                            </Link>
                            .
                          </>
                        ) : (
                          `No recipes matching "${recipeFilter}".`
                        )}
                      </p>
                    ) : (
                      <div className="max-h-48 space-y-1 overflow-y-auto">
                        {filteredRecipes.map((recipe) => (
                          <button
                            key={recipe.id}
                            type="button"
                            disabled={savingDate === iso}
                            onClick={() => handleAddRecipeToDay(recipe, iso)}
                            className="flex w-full items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-left text-sm text-stone-800 ring-1 ring-stone-200/80 transition-colors hover:bg-amber-50 hover:ring-amber-300 disabled:opacity-50"
                          >
                            <span className="truncate font-medium">
                              {recipe.title}
                            </span>
                            <span className="shrink-0 text-xs font-medium text-amber-700">
                              + Add
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Planned meals for this day */}
                {dayEntries.length === 0 ? (
                  !isPicking && (
                    <p className="mt-2 text-xs text-stone-400">
                      Nothing planned
                    </p>
                  )
                ) : (
                  <ul className="mt-3 divide-y divide-stone-100">
                    {dayEntries.map((entry) => {
                      const totalMinutes =
                        entry.recipe.prep_minutes + entry.recipe.cook_minutes;
                      return (
                        <li
                          key={entry.id}
                          className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            {entry.recipe.image_url ? (
                              <img
                                src={entry.recipe.image_url}
                                alt=""
                                className="h-11 w-14 shrink-0 rounded-lg object-cover ring-1 ring-stone-200"
                              />
                            ) : (
                              <div className="flex h-11 w-14 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-xs font-medium text-amber-700 ring-1 ring-amber-100">
                                Meal
                              </div>
                            )}
                            <div className="min-w-0">
                              <Link
                                to={`/recipes/${entry.recipe.id}`}
                                className="block truncate text-sm font-semibold text-stone-900 hover:text-amber-700"
                              >
                                {entry.recipe.title}
                              </Link>
                              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                                {totalMinutes > 0 && (
                                  <span>{formatMinutes(totalMinutes)}</span>
                                )}
                                {entry.recipe.servings > 0 && (
                                  <span>
                                    {entry.recipe.servings} serving
                                    {entry.recipe.servings === 1 ? "" : "s"}
                                  </span>
                                )}
                                <Link
                                  to={`/recipes/${entry.recipe.id}/cook`}
                                  className="font-medium text-amber-700 hover:underline"
                                >
                                  Cook Mode
                                </Link>
                              </div>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-1.5">
                            <select
                              value={entry.date}
                              onChange={(e) =>
                                handleMoveEntry(entry, e.target.value)
                              }
                              aria-label={`Move ${entry.recipe.title} to another day`}
                              title="Move to another day this week"
                              className="cursor-pointer rounded-md border border-transparent bg-stone-50 px-2 py-1 text-xs text-stone-600 hover:border-stone-200 hover:bg-white focus:border-amber-400 focus:outline-none"
                            >
                              {weekDates.map((d) => {
                                const info = formatDayLabel(d);
                                return (
                                  <option key={d} value={d}>
                                    {info.weekdayShort} {info.shortDate}
                                  </option>
                                );
                              })}
                            </select>

                            <button
                              type="button"
                              onClick={() => handleDeleteEntry(entry)}
                              className="rounded-md px-2 py-1 text-xs text-stone-400 hover:bg-stone-100 hover:text-red-600"
                              aria-label={`Remove ${entry.recipe.title} from meal plan`}
                            >
                              ✕
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAddToListModal && (
        <AddMealPlanToShoppingListModal
          weekStart={weekStart}
          weekEntries={entries}
          onClose={() => setShowAddToListModal(false)}
          onAdded={(result) => {
            setShowAddToListModal(false);
            setAddedNotice(result);
          }}
        />
      )}
    </section>
  );
}
