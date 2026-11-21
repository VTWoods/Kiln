import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  addMealPlanEntry,
  deleteMealPlanEntry,
  getMealPlanWeek,
  updateMealPlanEntry,
} from "../api/mealPlan";
import { listRecipes } from "../api/recipes";
import AddMealPlanToShoppingListModal from "../components/AddMealPlanToShoppingListModal";
import CastRecipeModal from "../components/CastRecipeModal";
import ModalSheet from "../components/ModalSheet";
import {
  getCachedMealPlanWeek,
  saveCachedMealPlanWeek,
} from "../offline/store";
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

const DAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"] as const;
const UNDO_TIMEOUT_MS = 6000;

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

  // "+ Add meal" recipe picker modal for a specific day
  const [addingForDate, setAddingForDate] = useState<string | null>(null);
  const [allRecipes, setAllRecipes] = useState<Recipe[]>([]);
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [recipeFilter, setRecipeFilter] = useState("");
  const [savingRecipeId, setSavingRecipeId] = useState<number | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const pickerSearchRef = useRef<HTMLInputElement | null>(null);

  // Mobile ⋮ overflow menu on meal entries
  const [openMenuEntryId, setOpenMenuEntryId] = useState<number | null>(null);

  // Undo toast after removing a meal entry
  const [undoEntry, setUndoEntry] = useState<MealPlanEntry | null>(null);
  const [restoringUndo, setRestoringUndo] = useState(false);
  const undoTimerRef = useRef<number | null>(null);

  // Add week/days to shopping list modal
  const [showAddToListModal, setShowAddToListModal] = useState(false);
  const [castingRecipe, setCastingRecipe] = useState<{
    id: number;
    title: string;
  } | null>(null);
  const [addedNotice, setAddedNotice] = useState<{
    listId: number;
    listName: string;
    addedCount: number;
  } | null>(null);

  const loadWeek = useCallback(async (mondayISO: string) => {
    setError(null);
    const cached = await getCachedMealPlanWeek(mondayISO);
    if (cached) {
      setEntries(cached.entries);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const data = await getMealPlanWeek(mondayISO);
      setEntries(data.entries);
    } catch (err: unknown) {
      if (!cached) {
        setError(
          err instanceof Error ? err.message : "Failed to load meal plan.",
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWeek(weekStart);
  }, [weekStart, loadWeek]);

  // Clean up undo auto-dismiss timer on unmount
  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

  // Auto-focus picker search only on fine-pointer devices (avoid mobile keyboard ambush)
  useEffect(() => {
    if (!addingForDate) return;
    const isFinePointer =
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: fine)").matches;
    if (isFinePointer) {
      pickerSearchRef.current?.focus();
    }
  }, [addingForDate]);

  // Close mobile entry ⋮ menu on outside pointerdown or Escape
  useEffect(() => {
    if (openMenuEntryId === null) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest?.(`[data-entry-menu="${openMenuEntryId}"]`)) {
        setOpenMenuEntryId(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMenuEntryId(null);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenuEntryId]);

  const dismissUndo = () => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndoEntry(null);
  };

  // Sync URL ?week= when weekStart changes
  const selectWeek = (mondayISO: string) => {
    setWeekStart(mondayISO);
    setAddingForDate(null);
    setOpenMenuEntryId(null);
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

  const scrollToDay = (iso: string) => {
    const el = document.getElementById(`meal-day-${iso}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const openRecipePickerForDay = (iso: string) => {
    setAddingForDate(iso);
    setRecipeFilter("");
    setPickerError(null);
    if (allRecipes.length === 0) {
      setLoadingRecipes(true);
      listRecipes()
        .then(setAllRecipes)
        .catch(() => {})
        .finally(() => setLoadingRecipes(false));
    }
  };

  const handleAddRecipeToDay = async (recipe: Recipe, dateISO: string) => {
    setSavingRecipeId(recipe.id);
    setPickerError(null);
    setError(null);
    try {
      const created = await addMealPlanEntry(recipe.id, dateISO);
      setEntries((prev) => [...prev, created]);
    } catch (err: unknown) {
      setPickerError(
        err instanceof Error ? err.message : "Failed to add meal to plan.",
      );
    } finally {
      setSavingRecipeId(null);
    }
  };

  const handleMoveEntry = async (entry: MealPlanEntry, newDate: string) => {
    if (entry.date === newDate) return;
    setError(null);
    setOpenMenuEntryId(null);
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
    setOpenMenuEntryId(null);
    const remaining = entries.filter((e) => e.id !== entry.id);
    setEntries(remaining);

    // Show brief undo toast
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    setUndoEntry(entry);
    undoTimerRef.current = window.setTimeout(() => {
      setUndoEntry(null);
      undoTimerRef.current = null;
    }, UNDO_TIMEOUT_MS);

    try {
      await deleteMealPlanEntry(entry.id);
      const cached = await getCachedMealPlanWeek(weekStart);
      if (cached) {
        void saveCachedMealPlanWeek({
          ...cached,
          entries: cached.entries.filter((e) => e.id !== entry.id),
        });
      } else {
        const dates = getWeekDates(weekStart);
        void saveCachedMealPlanWeek({
          week_start: dates[0],
          week_end: dates[6],
          entries: remaining,
        });
      }
    } catch (err: unknown) {
      setUndoEntry((current) => (current?.id === entry.id ? null : current));
      setError(err instanceof Error ? err.message : "Failed to remove meal.");
      void loadWeek(weekStart);
    }
  };

  const handleUndoDelete = async () => {
    const toRestore = undoEntry;
    if (!toRestore || restoringUndo) return;
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setRestoringUndo(true);
    setError(null);
    try {
      const restored = await addMealPlanEntry(
        toRestore.recipe_id,
        toRestore.date,
        toRestore.notes,
      );
      if (getWeekDates(weekStart).includes(restored.date)) {
        setEntries((prev) => [...prev, restored]);
      }
      setUndoEntry(null);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to restore meal.",
      );
      setUndoEntry(null);
    } finally {
      setRestoringUndo(false);
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

  const pickingDay = addingForDate ? formatDayLabel(addingForDate) : null;
  const pickingDayEntries = addingForDate
    ? (entriesByDate.get(addingForDate) ?? [])
    : [];
  const pickingRecipeCounts = new Map<number, number>();
  for (const entry of pickingDayEntries) {
    pickingRecipeCounts.set(
      entry.recipe_id,
      (pickingRecipeCounts.get(entry.recipe_id) ?? 0) + 1,
    );
  }

  return (
    <section className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
            Meal Plan
          </h1>
          <p className="mt-1 hidden text-sm text-stone-600 sm:block">
            Plan your week Monday–Sunday and add ingredients straight to a
            shopping list.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAddToListModal(true)}
          disabled={entries.length === 0}
          title="Add week's meals to Shopping List"
          className="inline-flex min-h-[40px] shrink-0 items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4"
        >
          + List
          {entries.length > 0 && (
            <span className="rounded-full bg-amber-700/80 px-2 py-0.5 text-xs">
              {entries.length}
            </span>
          )}
        </button>
      </div>

      {/* Week navigation bar */}
      <div className="space-y-2.5 rounded-2xl border border-stone-200 bg-white px-3 py-2.5 shadow-xs sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:space-y-0 sm:px-4 sm:py-3">
        {/* Row 1: Prev / Week range / Next */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => selectWeek(shiftWeek(weekStart, -1))}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-stone-200 text-lg font-medium text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900 active:bg-stone-100"
            aria-label="Previous week"
          >
            <span aria-hidden="true">‹</span>
          </button>
          <span className="min-w-0 flex-1 truncate px-1 text-center text-sm font-semibold text-stone-900 sm:flex-initial sm:text-base">
            {formatWeekRange(weekStart)}
          </span>
          <button
            type="button"
            onClick={() => selectWeek(shiftWeek(weekStart, 1))}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-stone-200 text-lg font-medium text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900 active:bg-stone-100"
            aria-label="Next week"
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>

        {/* Row 2: Quick week pills + compact date picker */}
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => selectWeek(thisWeekStart)}
              className={[
                "inline-flex min-h-[36px] shrink-0 items-center rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
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
                "inline-flex min-h-[36px] shrink-0 items-center rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                weekStart === nextWeekStart
                  ? "bg-amber-100 text-amber-900"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200",
              ].join(" ")}
            >
              Next Week
            </button>
          </div>

          <label className="relative inline-flex min-h-[36px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-100 focus-within:border-amber-400 focus-within:ring-2 focus-within:ring-amber-200">
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4 text-stone-500 sm:hidden"
            >
              <path
                fillRule="evenodd"
                d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z"
                clipRule="evenodd"
              />
            </svg>
            <span className="sm:hidden">Jump</span>
            <span className="hidden sm:inline">Jump:</span>
            <input
              type="date"
              value={weekStart}
              onChange={(e) => handleJumpDate(e.target.value)}
              aria-label="Jump to any week"
              className="absolute inset-0 h-full w-full cursor-pointer text-base opacity-0 sm:static sm:h-auto sm:w-auto sm:bg-transparent sm:text-xs sm:font-medium sm:text-stone-800 sm:opacity-100 sm:focus:outline-none"
            />
          </label>
        </div>
      </div>

      {/* Mobile sticky 7-pill day jump strip */}
      <nav
        aria-label="Jump to day of week"
        className="sticky top-[var(--app-header-h,61px)] z-20 -mx-3.5 border-y border-stone-200/80 bg-stone-50/95 px-3.5 py-2 backdrop-blur-xs sm:-mx-6 sm:px-6 md:hidden"
      >
        <div className="grid grid-cols-7 gap-1">
          {weekDates.map((iso, idx) => {
            const day = formatDayLabel(iso);
            const dayEntries = entriesByDate.get(iso) ?? [];
            const hasMeals = dayEntries.length > 0;
            const dayNum = parseDateISO(iso).getDate();

            return (
              <button
                key={iso}
                type="button"
                onClick={() => scrollToDay(iso)}
                aria-label={`${day.weekday}, ${day.shortDate}${hasMeals ? ` (${dayEntries.length} planned)` : ""}`}
                className={[
                  "flex min-h-[42px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 transition-colors",
                  day.isToday
                    ? "bg-amber-600 text-white shadow-xs"
                    : hasMeals
                      ? "bg-white text-stone-900 ring-1 ring-stone-200/90 hover:bg-amber-50 active:bg-amber-100"
                      : "bg-stone-100/80 text-stone-500 hover:bg-stone-200/70 active:bg-stone-200",
                ].join(" ")}
              >
                <span className="text-xs leading-none font-semibold">
                  {DAY_INITIALS[idx]}
                </span>
                <span
                  className={[
                    "text-[10px] leading-none",
                    day.isToday ? "text-amber-100" : "text-stone-400",
                  ].join(" ")}
                >
                  {dayNum}
                </span>
                <span
                  aria-hidden="true"
                  className={[
                    "h-1.5 w-1.5 rounded-full",
                    hasMeals
                      ? day.isToday
                        ? "bg-amber-200"
                        : "bg-amber-500"
                      : "bg-transparent",
                  ].join(" ")}
                />
              </button>
            );
          })}
        </div>
      </nav>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {addedNotice && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <span className="min-w-0">
            Added <strong>{addedNotice.addedCount}</strong> ingredient
            {addedNotice.addedCount === 1 ? "" : "s"} to{" "}
            <strong>{addedNotice.listName}</strong>.
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              to={`/shopping-lists?list=${addedNotice.listId}`}
              className="inline-flex min-h-[36px] items-center font-medium text-emerald-900 underline hover:text-emerald-700"
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

      {/* 7-day Monday -> Sunday schedule */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4, 5, 6].map((n) => (
            <div
              key={n}
              className="h-14 animate-pulse rounded-2xl border border-stone-200 bg-white sm:h-20"
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2.5 sm:space-y-3">
          {weekDates.map((iso, dayIdx) => {
            const day = formatDayLabel(iso);
            const dayEntries = entriesByDate.get(iso) ?? [];
            const isEmpty = dayEntries.length === 0;
            const flipMenuUp = dayIdx >= 5;

            return (
              <div
                key={iso}
                id={`meal-day-${iso}`}
                className={[
                  "scroll-mt-32 rounded-2xl border bg-white shadow-xs transition-colors",
                  isEmpty ? "px-3.5 py-2.5 sm:p-4" : "p-3.5 sm:p-4",
                  day.isToday
                    ? "border-amber-300 ring-1 ring-amber-200"
                    : "border-stone-200",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
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
                    className="inline-flex min-h-[36px] shrink-0 items-center rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-900 active:bg-amber-100"
                  >
                    + Add meal
                  </button>
                </div>

                {/* Planned meals for this day */}
                {isEmpty ? (
                  <p className="mt-2 hidden text-xs text-stone-400 sm:block">
                    Nothing planned
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-stone-100">
                    {dayEntries.map((entry) => {
                      const totalMinutes =
                        entry.recipe.prep_minutes + entry.recipe.cook_minutes;
                      const isMenuOpen = openMenuEntryId === entry.id;

                      return (
                        <li
                          key={entry.id}
                          className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                        >
                          <Link
                            to={`/recipes/${entry.recipe.id}`}
                            className="shrink-0"
                            tabIndex={-1}
                            aria-hidden="true"
                          >
                            {entry.recipe.image_url ? (
                              <img
                                src={entry.recipe.image_url}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                className="h-12 w-14 rounded-lg object-cover ring-1 ring-stone-200"
                              />
                            ) : (
                              <div className="flex h-12 w-14 items-center justify-center rounded-lg bg-amber-50 text-xs font-medium text-amber-700 ring-1 ring-amber-100">
                                Meal
                              </div>
                            )}
                          </Link>

                          <div className="min-w-0 flex-1">
                            <Link
                              to={`/recipes/${entry.recipe.id}`}
                              className="line-clamp-2 text-sm leading-snug font-semibold text-stone-900 hover:text-amber-700"
                            >
                              {entry.recipe.title}
                            </Link>
                            {(totalMinutes > 0 ||
                              entry.recipe.servings > 0) && (
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-stone-500">
                                {totalMinutes > 0 && (
                                  <span>{formatMinutes(totalMinutes)}</span>
                                )}
                                {entry.recipe.servings > 0 && (
                                  <span>
                                    {entry.recipe.servings} serving
                                    {entry.recipe.servings === 1 ? "" : "s"}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Desktop inline actions */}
                          <div className="hidden shrink-0 items-center gap-2 sm:flex">
                            <button
                              type="button"
                              onClick={() =>
                                setCastingRecipe({
                                  id: entry.recipe.id,
                                  title: entry.recipe.title,
                                })
                              }
                              className="inline-flex min-h-[36px] items-center rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
                            >
                              Cast
                            </button>

                            <select
                              value={entry.date}
                              onChange={(e) =>
                                void handleMoveEntry(entry, e.target.value)
                              }
                              aria-label={`Move ${entry.recipe.title} to another day`}
                              title="Move to another day this week"
                              className="min-h-[36px] cursor-pointer rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:border-stone-300 hover:bg-white focus:border-amber-400 focus:outline-none"
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
                              onClick={() => void handleDeleteEntry(entry)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600"
                              aria-label={`Remove ${entry.recipe.title} from meal plan`}
                            >
                              ✕
                            </button>
                          </div>

                          {/* Mobile 40x40 ⋮ overflow menu */}
                          <div
                            className="relative shrink-0 sm:hidden"
                            data-entry-menu={entry.id}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setOpenMenuEntryId((prev) =>
                                  prev === entry.id ? null : entry.id,
                                )
                              }
                              aria-label={`Actions for ${entry.recipe.title}`}
                              aria-expanded={isMenuOpen}
                              aria-haspopup="menu"
                              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-lg leading-none text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 active:bg-stone-200"
                            >
                              ⋮
                            </button>

                            {isMenuOpen && (
                              <div
                                role="menu"
                                className={[
                                  "absolute right-0 z-30 w-56 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg ring-1 ring-stone-900/5",
                                  flipMenuUp
                                    ? "bottom-full mb-1"
                                    : "top-full mt-1",
                                ].join(" ")}
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setOpenMenuEntryId(null);
                                    setCastingRecipe({
                                      id: entry.recipe.id,
                                      title: entry.recipe.title,
                                    });
                                  }}
                                  className="flex min-h-[44px] w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm font-medium text-stone-800 hover:bg-amber-50 hover:text-amber-900"
                                >
                                  Cast
                                </button>

                                <div className="border-t border-stone-100 px-3.5 py-2.5">
                                  <label className="block">
                                    <span className="text-[11px] font-medium tracking-wide text-stone-400 uppercase">
                                      Move to day
                                    </span>
                                    <select
                                      value={entry.date}
                                      onChange={(e) =>
                                        void handleMoveEntry(
                                          entry,
                                          e.target.value,
                                        )
                                      }
                                      aria-label={`Move ${entry.recipe.title} to another day`}
                                      className="mt-1.5 min-h-[40px] w-full rounded-lg border border-stone-300 bg-stone-50 px-2.5 py-1.5 text-base font-medium text-stone-800 focus:border-amber-500 focus:bg-white focus:outline-none sm:text-xs"
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
                                  </label>
                                </div>

                                <div className="border-t border-stone-100">
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => void handleDeleteEntry(entry)}
                                    className="flex min-h-[44px] w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50"
                                  >
                                    Remove from plan
                                  </button>
                                </div>
                              </div>
                            )}
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

      {/* Mobile bottom-sheet / desktop modal recipe picker for "+ Add meal" */}
      {addingForDate && pickingDay && (
        <ModalSheet
          onClose={() => setAddingForDate(null)}
          title={`Add meal · ${pickingDay.weekday}`}
          subtitle={
            pickingDayEntries.length > 0
              ? `${pickingDay.shortDate} · ${pickingDayEntries.length} planned`
              : pickingDay.shortDate
          }
          bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
          footer={
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-stone-500">
                {pickingDayEntries.length === 0
                  ? "Tap any recipe to add it"
                  : `${pickingDayEntries.length} meal${pickingDayEntries.length === 1 ? "" : "s"} planned for ${pickingDay.weekdayShort}`}
              </span>
              <button
                type="button"
                onClick={() => setAddingForDate(null)}
                className="min-h-[44px] shrink-0 rounded-xl bg-amber-600 px-5 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-amber-700"
              >
                Done
              </button>
            </div>
          }
        >
          {/* Sticky search bar */}
          <div className="shrink-0 border-b border-stone-100 bg-white px-4 py-3 sm:px-6">
            <input
              ref={pickerSearchRef}
              type="search"
              placeholder="Search your recipes…"
              value={recipeFilter}
              onChange={(e) => setRecipeFilter(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-stone-300 bg-stone-50 px-3.5 py-2 text-base text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:bg-white focus:outline-none sm:text-sm"
            />
            {pickerError && (
              <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {pickerError}
              </p>
            )}
          </div>

          {/* Scrollable recipe rows */}
          <div className="min-h-[14rem] flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-6">
            {loadingRecipes ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="h-14 animate-pulse rounded-xl bg-stone-100"
                  />
                ))}
              </div>
            ) : filteredRecipes.length === 0 ? (
              <p className="py-6 text-center text-sm text-stone-500">
                {allRecipes.length === 0 ? (
                  <>
                    No saved recipes yet.{" "}
                    <Link
                      to="/recipes"
                      onClick={() => setAddingForDate(null)}
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
              <div className="space-y-2">
                {filteredRecipes.map((recipe) => {
                  const plannedCount = pickingRecipeCounts.get(recipe.id) ?? 0;
                  const isAdding = savingRecipeId === recipe.id;
                  const totalMinutes =
                    recipe.prep_minutes + recipe.cook_minutes;

                  return (
                    <button
                      key={recipe.id}
                      type="button"
                      disabled={savingRecipeId !== null}
                      onClick={() =>
                        void handleAddRecipeToDay(recipe, addingForDate)
                      }
                      className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2 text-left transition-colors hover:border-amber-300 hover:bg-amber-50/60 active:bg-amber-50 disabled:opacity-50"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        {recipe.image_url ? (
                          <img
                            src={recipe.image_url}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-stone-200"
                          />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-[11px] font-medium text-amber-700 ring-1 ring-amber-100">
                            Meal
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-sm leading-snug font-medium text-stone-900">
                            {recipe.title}
                          </span>
                          {totalMinutes > 0 && (
                            <span className="mt-0.5 block text-xs text-stone-500">
                              {formatMinutes(totalMinutes)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {plannedCount > 0 && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                            {plannedCount === 1
                              ? "Added"
                              : `Added ×${plannedCount}`}
                          </span>
                        )}
                        <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200/80">
                          {isAdding ? "Adding…" : "+ Add"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </ModalSheet>
      )}

      {/* Undo toast after removing a meal entry */}
      {undoEntry && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-3.5 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-stone-900 px-4 py-2.5 text-sm text-stone-100 shadow-lg sm:inset-x-auto sm:right-6 sm:w-96"
        >
          <span className="min-w-0 truncate">
            Removed{" "}
            <strong className="font-semibold text-white">
              {undoEntry.recipe.title}
            </strong>
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={restoringUndo}
              onClick={() => void handleUndoDelete()}
              className="min-h-[36px] rounded-lg px-3 py-1.5 text-sm font-semibold text-amber-400 transition-colors hover:bg-stone-800 hover:text-amber-300 disabled:opacity-50"
            >
              {restoringUndo ? "Restoring…" : "Undo"}
            </button>
            <button
              type="button"
              onClick={dismissUndo}
              aria-label="Dismiss"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-800 hover:text-white"
            >
              ✕
            </button>
          </div>
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

      {castingRecipe && (
        <CastRecipeModal
          recipeId={castingRecipe.id}
          recipeTitle={castingRecipe.title}
          onClose={() => setCastingRecipe(null)}
        />
      )}
    </section>
  );
}
