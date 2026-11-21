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
import ModalSheet from "./ModalSheet";

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

  const footer = (
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
        disabled={submitting || !selectedDate}
        className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-initial"
      >
        {submitting
          ? "Adding…"
          : `Add to ${selectedDayInfo.weekdayShort}, ${selectedDayInfo.shortDate}`}
      </button>
    </div>
  );

  return (
    <ModalSheet
      onClose={onClose}
      title="Add to Meal Plan"
      subtitle={<span className="block truncate">{recipeTitle}</span>}
      footer={footer}
      maxWidthClass="sm:max-w-lg"
      closeDisabled={submitting}
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
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
                  "min-h-[36px] rounded-full px-3 py-1.5 font-medium transition-colors",
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
                  "min-h-[36px] rounded-full px-3 py-1.5 font-medium transition-colors",
                  weekStart === nextWeekStart
                    ? "bg-amber-100 text-amber-900"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200",
                ].join(" ")}
              >
                Next week
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-1.5 rounded-xl border border-stone-200 bg-stone-50/80 px-1.5 py-1.5">
            <button
              type="button"
              onClick={() => changeWeek(shiftWeek(weekStart, -1))}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base font-medium text-stone-600 hover:bg-white hover:text-stone-900 active:bg-stone-200/70"
              aria-label="Previous week"
            >
              ←
            </button>
            <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
              <span className="truncate text-sm font-semibold text-stone-800">
                {formatWeekRange(weekStart)}
              </span>
              <span
                className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-900"
                title="Jump to any week"
              >
                <svg
                  className="pointer-events-none h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => handleJumpDate(e.target.value)}
                  onClick={(e) => {
                    try {
                      (
                        e.currentTarget as HTMLInputElement & {
                          showPicker?: () => void;
                        }
                      ).showPicker?.();
                    } catch {
                      // Native click/tap behavior still handles picker open
                    }
                  }}
                  aria-label="Jump to any date"
                  title="Jump to any week"
                  className="absolute inset-0 h-full w-full cursor-pointer text-base opacity-0"
                />
              </span>
            </div>
            <button
              type="button"
              onClick={() => changeWeek(shiftWeek(weekStart, 1))}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base font-medium text-stone-600 hover:bg-white hover:text-stone-900 active:bg-stone-200/70"
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
                      "flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors",
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
                            isSelected ? "text-amber-950" : "text-stone-800",
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
    </ModalSheet>
  );
}
