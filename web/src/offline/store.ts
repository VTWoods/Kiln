import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { PantryStaple } from "../api/pantryStaples";
import type { MealPlanWeek } from "../types/mealPlan";
import type { Recipe } from "../types/recipe";
import type {
  AddShoppingListItemInput,
  ShoppingList,
  ShoppingListItem,
} from "../types/shoppingList";

export type OutboxOp =
  | {
      seq?: number;
      kind: "patch_item";
      listId: number;
      itemId: number;
      patch: Partial<
        Pick<ShoppingListItem, "checked" | "name" | "quantity" | "unit" | "aisle">
      >;
      createdAt: string;
    }
  | {
      seq?: number;
      kind: "add_items";
      listId: number;
      tempItems: { tempId: number; name: string }[];
      items: AddShoppingListItemInput[];
      createdAt: string;
    }
  | {
      seq?: number;
      kind: "delete_item";
      listId: number;
      itemId: number;
      createdAt: string;
    }
  | {
      seq?: number;
      kind: "clear_checked";
      listId: number;
      createdAt: string;
    }
  | {
      seq?: number;
      kind: "delete_list";
      listId: number;
      createdAt: string;
    };

interface KilnOfflineDB extends DBSchema {
  recipes: {
    key: number;
    value: Recipe;
  };
  shoppingLists: {
    key: number;
    value: ShoppingList;
  };
  pantryStaples: {
    key: number;
    value: PantryStaple;
  };
  mealPlanWeeks: {
    key: string;
    value: MealPlanWeek;
  };
  outbox: {
    key: number;
    value: OutboxOp;
  };
  meta: {
    key: string;
    value: { key: string; value: string };
  };
}

const DB_NAME = "kiln-offline-v1";
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<KilnOfflineDB>> | null = null;

function getDb(): Promise<IDBPDatabase<KilnOfflineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<KilnOfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("recipes")) {
          db.createObjectStore("recipes", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("shoppingLists")) {
          db.createObjectStore("shoppingLists", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("pantryStaples")) {
          db.createObjectStore("pantryStaples", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("mealPlanWeeks")) {
          db.createObjectStore("mealPlanWeeks", { keyPath: "week_start" });
        }
        if (!db.objectStoreNames.contains("outbox")) {
          db.createObjectStore("outbox", {
            keyPath: "seq",
            autoIncrement: true,
          });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      },
      blocking(_currentVersion, _blockedVersion, event) {
        // Close stale connection so a newer version upgrade never deadlocks
        const target = event.target as IDBDatabase | null;
        target?.close();
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
      },
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

function resetDb(): void {
  if (dbPromise) {
    void dbPromise.then((db) => db.close()).catch(() => {});
    dbPromise = null;
  }
}

async function withDb<T>(
  fn: (db: IDBPDatabase<KilnOfflineDB>) => Promise<T>,
): Promise<T> {
  try {
    const db = await getDb();
    return await fn(db);
  } catch {
    // Mobile PWAs (especially Android WebAPKs) can invalidate a backgrounded
    // IndexedDB connection without firing `terminated` first; reopen once.
    resetDb();
    const db = await getDb();
    return await fn(db);
  }
}

export class OfflineNetworkError extends Error {
  constructor(message = "You appear to be offline.") {
    super(message);
    this.name = "OfflineNetworkError";
  }
}

export function isOfflineError(err: unknown): boolean {
  if (err instanceof OfflineNetworkError) return true;
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  // Standard browser fetch() network failure throws TypeError
  if (err instanceof TypeError) return true;
  // Fetch timeout via AbortController throws DOMException with name AbortError/TimeoutError
  if (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  ) {
    return true;
  }
  return false;
}

// --- Recipes ---

export async function getCachedRecipes(): Promise<Recipe[]> {
  try {
    const db = await getDb();
    const all = await db.getAll("recipes");
    return all.sort((a, b) => {
      const cmp = (b.created_at || "").localeCompare(a.created_at || "");
      return cmp !== 0 ? cmp : b.id - a.id;
    });
  } catch {
    return [];
  }
}

export async function getCachedRecipe(id: number): Promise<Recipe | null> {
  try {
    const db = await getDb();
    return (await db.get("recipes", id)) ?? null;
  } catch {
    return null;
  }
}

export async function saveCachedRecipe(recipe: Recipe): Promise<void> {
  try {
    const db = await getDb();
    await db.put("recipes", recipe);
  } catch {
    // Ignore storage quota errors gracefully
  }
}

export async function saveCachedRecipesSummary(recipes: Recipe[]): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction("recipes", "readwrite");
    const keepIds = new Set(recipes.map((r) => r.id));
    const existing = await tx.store.getAll();
    const existingById = new Map(existing.map((r) => [r.id, r]));

    for (const old of existing) {
      if (!keepIds.has(old.id)) {
        await tx.store.delete(old.id);
      }
    }
    for (const summary of recipes) {
      const prev = existingById.get(summary.id);
      // Preserve previously cached full ingredients when updating from a summary list
      const merged: Recipe =
        prev?.ingredients && !summary.ingredients
          ? { ...summary, ingredients: prev.ingredients }
          : summary;
      await tx.store.put(merged);
    }
    await tx.done;
  } catch {
    // Ignore storage errors
  }
}

export async function deleteCachedRecipe(id: number): Promise<void> {
  try {
    const db = await getDb();
    await db.delete("recipes", id);
  } catch {
    // Ignore
  }
}

// --- Shopping Lists ---

export async function getCachedShoppingLists(): Promise<ShoppingList[]> {
  try {
    const all = await withDb((db) => db.getAll("shoppingLists"));
    return all.sort((a, b) => {
      const cmp = (a.created_at || "").localeCompare(b.created_at || "");
      return cmp !== 0 ? cmp : a.id - b.id;
    });
  } catch {
    return [];
  }
}

export async function getCachedShoppingList(
  id: number,
): Promise<ShoppingList | null> {
  try {
    return (await withDb((db) => db.get("shoppingLists", id))) ?? null;
  } catch {
    return null;
  }
}

export async function saveCachedShoppingList(list: ShoppingList): Promise<void> {
  try {
    await withDb((db) => db.put("shoppingLists", list));
  } catch {
    // Ignore
  }
}

export async function saveCachedShoppingListsSummary(
  lists: ShoppingList[],
): Promise<void> {
  try {
    await withDb(async (db) => {
      const tx = db.transaction("shoppingLists", "readwrite");
      const keepIds = new Set(lists.map((l) => l.id));
      const existing = await tx.store.getAll();
      const existingById = new Map(existing.map((l) => [l.id, l]));

      for (const old of existing) {
        if (!keepIds.has(old.id)) {
          await tx.store.delete(old.id);
        }
      }
      for (const summary of lists) {
        const prev = existingById.get(summary.id);
        const merged: ShoppingList =
          prev?.items && !summary.items
            ? { ...summary, items: prev.items, aisles: prev.aisles }
            : summary;
        await tx.store.put(merged);
      }
      await tx.done;
    });
  } catch {
    // Ignore
  }
}

export async function deleteCachedShoppingList(id: number): Promise<void> {
  try {
    await withDb((db) => db.delete("shoppingLists", id));
  } catch {
    // Ignore
  }
}

// --- Pantry Staples ---

export async function getCachedPantryStaples(): Promise<PantryStaple[]> {
  try {
    const db = await getDb();
    const all = await db.getAll("pantryStaples");
    return all.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function saveCachedPantryStaples(
  staples: PantryStaple[],
): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction("pantryStaples", "readwrite");
    await tx.store.clear();
    for (const staple of staples) {
      await tx.store.put(staple);
    }
    await tx.done;
  } catch {
    // Ignore
  }
}

// --- Meal Plan Weeks ---

export async function getCachedMealPlanWeek(
  weekStart: string,
): Promise<MealPlanWeek | null> {
  try {
    const db = await getDb();
    return (await db.get("mealPlanWeeks", weekStart)) ?? null;
  } catch {
    return null;
  }
}

export async function saveCachedMealPlanWeek(
  week: MealPlanWeek,
): Promise<void> {
  try {
    const db = await getDb();
    await db.put("mealPlanWeeks", week);
  } catch {
    // Ignore
  }
}

// --- Outbox Queue ---

export async function enqueueOutboxOp(op: OutboxOp): Promise<number> {
  return withDb((db) => db.add("outbox", op));
}

export async function listOutboxOps(): Promise<OutboxOp[]> {
  return withDb((db) => db.getAll("outbox"));
}

export async function deleteOutboxOp(seq: number): Promise<void> {
  await withDb((db) => db.delete("outbox", seq));
}

export async function deleteOutboxOpsForList(listId: number): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction("outbox", "readwrite");
    const all = await tx.store.getAll();
    for (const op of all) {
      if (op.listId === listId && op.seq !== undefined) {
        await tx.store.delete(op.seq);
      }
    }
    await tx.done;
  });
}

export async function countOutboxOps(): Promise<number> {
  try {
    return await withDb((db) => db.count("outbox"));
  } catch {
    return 0;
  }
}

// --- Metadata ---

export async function getLastSyncedAt(): Promise<string | null> {
  try {
    const db = await getDb();
    const row = await db.get("meta", "lastSyncedAt");
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function setLastSyncedAt(iso: string): Promise<void> {
  try {
    const db = await getDb();
    await db.put("meta", { key: "lastSyncedAt", value: iso });
  } catch {
    // Ignore
  }
}
