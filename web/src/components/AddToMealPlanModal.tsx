import { useEffect, useState, type FormEvent } from "react";
import { addMealPlanEntry, getMealPlanWeek } from "../api/mealPlan";
import {
  formatDayLabel,
  formatDateISO,
  formatWeekRange,
  getMondayOfWeek,
  getNextWeekMonday,
  getThisWeekMonday,
  getWeekDates,
  parseDateISO,
  shiftWeek,
  type MealPlanEntry,
} from "../types/mealPlan";

type Props = {
  recipeId: number;
  recipeTitle: string;
  onClose: () => void;
  onAdded: (result: {
    weekStart: string;
    date: string;
    recipeTitle: string;
  }) => void;
};

export default function AddToMealPlanModal({
  recipeId,
  recipeTitle,
  onClose,
  onAdded,
}: Props) {
  const thisWeekStart = getThisWeekMonday();
  const nextWeekStart = getNextWeekMonday();

  // Always default to planning next week (Monday-Sunday)
  const [weekStart, setWeekStart] = useState<string>(nextWeekStart);
  const [selectedDate, setSelectedDate] = useState<string>(nextWeekStart);
  const [entries, setEntries] = useState<MealPlanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    getMealPlanWeek(weekStart)
      .then((week) => {
        if (!active) return;
        setEntries(week.entries);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load meal plan for that week.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [weekStart]);

  const weekDates = getWeekDates(weekStart);

  const changeWeek = (targetMonday: string, pickDate?: string) => {
    setWeekStart(targetMonday);
    const nextDates = getWeekDates(targetMonday);
    setSelectedDate(
      pickDate && nextDates.includes(pickDate) ? pickDate : nextDates[0],
    );
  };

  const handleJumpDate = (rawISO: string) => {
    if (!rawISO) return;
    const monday = formatDateISO(getMondayOfWeek(parseDateISO(rawISO)));
    changeWeek(monday, rawISO);
  };

  const entriesByDate = new Map<string, MealPlanEntry[]>();
  for (const entry of entries) {
    const bucket = entriesByDate.get(entry.date);
    if (bucket) {
      bucket.push(entry);
    } else {
      entriesByDate.set(entry.date, [entry]);
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedDate) return;

    setSubmitting(true);
    setError(null);
    try {
      await addMealPlanEntry(recipeId, selectedDate);
      onAdded({
        weekStart,
        date: selectedDate,
        recipeTitle,
      });
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to add recipe to meal plan.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const selectedDayInfo = formatDayLabel(selectedDate);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-to-meal-plan-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-stone-200">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-6 py-4">
          <div className="min-w-0">
            <h2
              id="add-to-meal-plan-title"
              className="text-lg font-semibold text-stone-900"
            >
              Add to Meal Plan
            </h2>
            <p className="mt-0.5 truncate text-xs text-stone-500">
              {recipeTitle}
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

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Week switcher */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                  Select Week
                </span>
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => changeWeek(thisWeekStart)}
                    className={[
                      "rounded-full px-2.5 py-0.5 font-medium transition-colors",
                      weekStart === thisWeekStart
                        ? "bg-amber-100 text-amber-900"
                        : "bg-stone-100 text-stone-600 hover:bg-stone-200",
                    ].join(" ")}
                  >
                    This week
                  </button>
                  <button
                    type="button"
                    onClick={() => changeWeek(nextWeekStart)}
                    className={[
                      "rounded-full px-2.5 py-0.5 font-medium transition-colors",
                      weekStart === nextWeekStart
                        ? "bg-amber-100 text-amber-900"
                        : "bg-stone-100 text-stone-600 hover:bg-stone-200",
                    ].join(" ")}
                  >
                    Next week
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl border border-stone-200 bg-stone-50/80 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => changeWeek(shiftWeek(weekStart, -1))}
                  className="rounded-lg px-2.5 py-1 text-sm font-medium text-stone-600 hover:bg-white hover:text-stone-900"
                  aria-label="Previous week"
                >
                  ←
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-stone-800">
                    {formatWeekRange(weekStart)}
                  </span>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => handleJumpDate(e.target.value)}
                    aria-label="Jump to any date"
                    title="Jump to any week"
                    className="w-7 cursor-pointer rounded border border-transparent bg-transparent text-xs text-stone-500 hover:border-stone-300"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => changeWeek(shiftWeek(weekStart, 1))}
                  className="rounded-lg px-2.5 py-1 text-sm font-medium text-stone-600 hover:bg-white hover:text-stone-900"
                  aria-label="Next week"
                >
                  →
                </button>
              </div>
            </div>

            {/* 7-day picker (Mon -> Sun) */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                Choose Day
              </p>

              {loading ? (
                <div className="space-y-2">
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                    <div
                      key={n}
                      className="h-11 animate-pulse rounded-xl bg-stone-100"
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {weekDates.map((iso) => {
                    const day = formatDayLabel(iso);
                    const dayEntries = entriesByDate.get(iso) ?? [];
                    const isSelected = selectedDate === iso;

                    return (
                      <button
                        key={iso}
                        type="button"
                        onClick={() => setSelectedDate(iso)}
                        className={[
                          "flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors",
                          isSelected
                            ? "border-amber-500 bg-amber-50/70 ring-1 ring-amber-400"
                            : "border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50",
                        ].join(" ")}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={[
                                "text-sm font-semibold",
                                isSelected
                                  ? "text-amber-950"
                                  : "text-stone-800",
                              ].join(" ")}
                            >
                              {day.weekday}
                            </span>
                            <span className="text-xs text-stone-500">
                              {day.shortDate}
                            </span>
                            {day.isToday && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                                Today
                              </span>
                            )}
                          </div>
                          {dayEntries.length > 0 && (
                            <p className="mt-0.5 truncate text-xs text-stone-500">
                              Planned:{" "}
                              {dayEntries.map((e) => e.recipe.title).join(", ")}
                            </p>
                          )}
                        </div>

                        <span
                          className={[
                            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                            dayEntries.length > 0
                              ? "bg-stone-100 text-stone-600"
                              : "text-stone-400",
                          ].join(" ")}
                        >
                          {dayEntries.length > 0
                            ? `${dayEntries.length} meal${dayEntries.length === 1 ? "" : "s"}`
                            : "Open"}
                        </span>
                      </button>
                    );
                  })}
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
              disabled={submitting || !selectedDate}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting
                ? "Adding…"
                : `Add to ${selectedDayInfo.weekdayShort}, ${selectedDayInfo.shortDate}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
