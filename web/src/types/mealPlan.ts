export type MealPlanRecipeSummary = {
  id: number;
  title: string;
  image_url: string;
  prep_minutes: number;
  cook_minutes: number;
  servings: number;
  ingredient_count: number;
};

export type MealPlanEntry = {
  id: number;
  date: string; // YYYY-MM-DD
  recipe_id: number;
  notes: string;
  sort_order: number;
  created_at: string;
  recipe: MealPlanRecipeSummary;
};

export type MealPlanWeek = {
  week_start: string; // Monday YYYY-MM-DD
  week_end: string; // Sunday YYYY-MM-DD
  entries: MealPlanEntry[];
};

export type MealPlanIngredientItem = {
  key: string;
  entry_id: number;
  date: string;
  recipe_id: number;
  recipe_title: string;
  ingredient_id: number;
  name: string;
  quantity: string;
  unit: string;
  preparation: string;
  is_pantry_staple: boolean;
};

export type MealPlanIngredientsResponse = {
  dates: string[];
  entries: MealPlanEntry[];
  ingredients: MealPlanIngredientItem[];
};

// Local-timezone-safe date helpers (weeks run Monday -> Sunday)

export function formatDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDateISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function getMondayOfWeek(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // JS getDay(): Sun=0, Mon=1, ..., Sat=6 -> offset to Monday
  const diff = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - diff);
  return copy;
}

export function getThisWeekMonday(now = new Date()): string {
  return formatDateISO(getMondayOfWeek(now));
}

export function getNextWeekMonday(now = new Date()): string {
  const mon = getMondayOfWeek(now);
  mon.setDate(mon.getDate() + 7);
  return formatDateISO(mon);
}

export function shiftWeek(weekStartISO: string, deltaWeeks: number): string {
  const d = parseDateISO(weekStartISO);
  d.setDate(d.getDate() + deltaWeeks * 7);
  return formatDateISO(getMondayOfWeek(d));
}

export function getWeekDates(weekStartISO: string): string[] {
  const mon = getMondayOfWeek(parseDateISO(weekStartISO));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
    return formatDateISO(d);
  });
}

export function formatWeekRange(weekStartISO: string): string {
  const dates = getWeekDates(weekStartISO);
  const start = parseDateISO(dates[0]);
  const end = parseDateISO(dates[6]);
  const sameYear = start.getFullYear() === end.getFullYear();
  const startStr = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const endStr = end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${startStr} – ${endStr}`;
}

export function formatDayLabel(iso: string): {
  weekday: string;
  weekdayShort: string;
  shortDate: string;
  isToday: boolean;
} {
  const d = parseDateISO(iso);
  const todayISO = formatDateISO(new Date());
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: "long" }),
    weekdayShort: d.toLocaleDateString(undefined, { weekday: "short" }),
    shortDate: d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    isToday: iso === todayISO,
  };
}
