import { apiFetch } from "../offline/fetch";
import {
  getCachedMealPlanWeek,
  isOfflineError,
  saveCachedMealPlanWeek,
} from "../offline/store";
import {
  formatDateISO,
  getMondayOfWeek,
  parseDateISO,
  type MealPlanEntry,
  type MealPlanIngredientsResponse,
  type MealPlanWeek,
} from "../types/mealPlan";

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Non-JSON response
    }
  }

  if (!res.ok) {
    const errMsg =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (HTTP ${res.status})`;
    throw new Error(errMsg);
  }

  return data as T;
}

export async function getMealPlanWeek(
  weekStart?: string,
): Promise<MealPlanWeek> {
  const qs = weekStart ? `?week_start=${encodeURIComponent(weekStart)}` : "";
  try {
    const res = await apiFetch(`/api/meal-plan${qs}`);
    const data = await parseJsonOrThrow<MealPlanWeek>(res);
    void saveCachedMealPlanWeek(data);
    return data;
  } catch (err) {
    if (isOfflineError(err) && weekStart) {
      const cached = await getCachedMealPlanWeek(weekStart);
      if (cached) return cached;
      return { week_start: weekStart, week_end: weekStart, entries: [] };
    }
    throw err;
  }
}

export async function addMealPlanEntry(
  recipeId: number,
  date: string,
  notes = "",
): Promise<MealPlanEntry> {
  try {
    const res = await apiFetch("/api/meal-plan/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipe_id: recipeId, date, notes }),
    });
    const created = await parseJsonOrThrow<MealPlanEntry>(res);
    const weekStart = formatDateISO(getMondayOfWeek(parseDateISO(created.date)));
    const cached = await getCachedMealPlanWeek(weekStart);
    if (cached) {
      void saveCachedMealPlanWeek({
        ...cached,
        entries: [...cached.entries, created],
      });
    }
    return created;
  } catch (err) {
    if (isOfflineError(err)) {
      throw new Error(
        "Updating your meal plan requires a connection to your Kiln server.",
      );
    }
    throw err;
  }
}

export async function updateMealPlanEntry(
  entryId: number,
  patch: { date?: string; notes?: string },
): Promise<MealPlanEntry> {
  try {
    const res = await apiFetch(`/api/meal-plan/entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const updated = await parseJsonOrThrow<MealPlanEntry>(res);
    const weekStart = formatDateISO(getMondayOfWeek(parseDateISO(updated.date)));
    const cached = await getCachedMealPlanWeek(weekStart);
    if (cached) {
      const exists = cached.entries.some((e) => e.id === updated.id);
      void saveCachedMealPlanWeek({
        ...cached,
        entries: exists
          ? cached.entries.map((e) => (e.id === updated.id ? updated : e))
          : [...cached.entries, updated],
      });
    }
    return updated;
  } catch (err) {
    if (isOfflineError(err)) {
      throw new Error(
        "Moving meals requires a connection to your Kiln server.",
      );
    }
    throw err;
  }
}

export async function deleteMealPlanEntry(entryId: number): Promise<void> {
  try {
    const res = await apiFetch(`/api/meal-plan/entries/${entryId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      await parseJsonOrThrow<never>(res);
    }
  } catch (err) {
    if (isOfflineError(err)) {
      throw new Error(
        "Removing meals requires a connection to your Kiln server.",
      );
    }
    throw err;
  }
}

export async function getMealPlanIngredients(
  dates: string[],
): Promise<MealPlanIngredientsResponse> {
  const qs = `?dates=${encodeURIComponent(dates.join(","))}`;
  const res = await apiFetch(`/api/meal-plan/ingredients${qs}`);
  return parseJsonOrThrow<MealPlanIngredientsResponse>(res);
}
