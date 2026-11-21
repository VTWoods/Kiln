import { useSyncExternalStore } from "react";
import type { PantryStaple } from "../api/pantryStaples";
import {
  getNextWeekMonday,
  getThisWeekMonday,
  type MealPlanWeek,
} from "../types/mealPlan";
import type { Recipe } from "../types/recipe";
import type { ShoppingList } from "../types/shoppingList";
import {
  countOutboxOps,
  deleteOutboxOp,
  getLastSyncedAt,
  isOfflineError,
  listOutboxOps,
  OfflineNetworkError,
  saveCachedMealPlanWeek,
  saveCachedPantryStaples,
  saveCachedRecipe,
  saveCachedRecipesSummary,
  saveCachedShoppingList,
  saveCachedShoppingListsSummary,
  setLastSyncedAt,
} from "./store";

export type OfflineStatus = {
  online: boolean;
  pendingCount: number;
  syncing: boolean;
  lastSyncedAt: string | null;
  syncError: string | null;
};

let status: OfflineStatus = {
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
  pendingCount: 0,
  syncing: false,
  lastSyncedAt: null,
  syncError: null,
};

const CIRCUIT_BREAKER_COOLDOWN_MS = 15_000;
let lastOfflineAt = 0;

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function updateStatus(patch: Partial<OfflineStatus>) {
  status = { ...status, ...patch };
  emit();
}

export function getOfflineStatus(): OfflineStatus {
  return status;
}

export function subscribeOfflineStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useOfflineStatus(): OfflineStatus {
  return useSyncExternalStore(subscribeOfflineStatus, getOfflineStatus);
}

export function isOfflineCircuitOpen(): boolean {
  if (status.online) return false;
  return Date.now() - lastOfflineAt < CIRCUIT_BREAKER_COOLDOWN_MS;
}

export function markApiReachable() {
  lastOfflineAt = 0;
  if (!status.online) {
    updateStatus({ online: true, syncError: null });
  }
}

export function markApiOffline() {
  lastOfflineAt = Date.now();
  if (status.online) {
    updateStatus({ online: false });
  }
}

export async function refreshPendingCount(): Promise<number> {
  const count = await countOutboxOps();
  if (count !== status.pendingCount) {
    updateStatus({ pendingCount: count });
  }
  return count;
}

async function syncFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 3500,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

let activeFlush: Promise<boolean> | null = null;

/**
 * Replay queued offline shopping-list mutations against the server in FIFO order.
 * Returns true if the outbox is completely empty afterward, false if still offline/failed.
 */
export function flushOutbox(): Promise<boolean> {
  if (activeFlush) return activeFlush;

  activeFlush = (async () => {
    const ops = await listOutboxOps();
    if (ops.length === 0) {
      await refreshPendingCount();
      return true;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      markApiOffline();
      return false;
    }

    updateStatus({ syncing: true, syncError: null });
    const tempIdMap = new Map<number, number>();
    let flushedAny = false;

    try {
      for (const op of ops) {
        if (op.seq === undefined) continue;

        if (op.kind === "add_items") {
          const res = await syncFetch(`/api/shopping-lists/${op.listId}/items`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: op.items }),
          });
          if (res.status >= 500) {
            throw new OfflineNetworkError(`Server returned HTTP ${res.status}`);
          }
          if (res.ok) {
            const updated = (await res.json()) as ShoppingList;
            await saveCachedShoppingList(updated);
            // Map offline temporary IDs to newly created server item IDs by name
            const serverItems = updated.items ?? [];
            for (const temp of op.tempItems) {
              const lower = temp.name.trim().toLowerCase();
              const match = [...serverItems]
                .reverse()
                .find((it) => it.name.trim().toLowerCase() === lower);
              if (match) {
                tempIdMap.set(temp.tempId, match.id);
              }
            }
          }
          // Delete op on success or unrecoverable 4xx (e.g., list deleted on server)
          await deleteOutboxOp(op.seq);
          flushedAny = true;
        } else if (op.kind === "patch_item") {
          const resolvedId =
            op.itemId < 0 ? tempIdMap.get(op.itemId) : op.itemId;
          if (!resolvedId) {
            await deleteOutboxOp(op.seq);
            continue;
          }
          const res = await syncFetch(
            `/api/shopping-lists/${op.listId}/items/${resolvedId}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(op.patch),
            },
          );
          if (res.status >= 500) {
            throw new OfflineNetworkError(`Server returned HTTP ${res.status}`);
          }
          await deleteOutboxOp(op.seq);
          flushedAny = true;
        } else if (op.kind === "delete_item") {
          const resolvedId =
            op.itemId < 0 ? tempIdMap.get(op.itemId) : op.itemId;
          if (!resolvedId) {
            await deleteOutboxOp(op.seq);
            continue;
          }
          const res = await syncFetch(
            `/api/shopping-lists/${op.listId}/items/${resolvedId}`,
            { method: "DELETE" },
          );
          if (res.status >= 500) {
            throw new OfflineNetworkError(`Server returned HTTP ${res.status}`);
          }
          await deleteOutboxOp(op.seq);
          flushedAny = true;
        } else if (op.kind === "clear_checked") {
          const res = await syncFetch(`/api/shopping-lists/${op.listId}/checked`, {
            method: "DELETE",
          });
          if (res.status >= 500) {
            throw new OfflineNetworkError(`Server returned HTTP ${res.status}`);
          }
          if (res.ok) {
            const updated = (await res.json()) as ShoppingList;
            await saveCachedShoppingList(updated);
          }
          await deleteOutboxOp(op.seq);
          flushedAny = true;
        }
      }

      markApiReachable();
      await refreshPendingCount();
      if (flushedAny && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("kiln:synced"));
      }
      return true;
    } catch (err: unknown) {
      if (isOfflineError(err)) {
        markApiOffline();
      } else {
        updateStatus({
          syncError:
            err instanceof Error ? err.message : "Failed to sync changes",
        });
      }
      await refreshPendingCount();
      return false;
    } finally {
      updateStatus({ syncing: false });
      activeFlush = null;
    }
  })();

  return activeFlush;
}

async function warmImageCache(imageUrls: string[]): Promise<void> {
  if (typeof caches === "undefined" || imageUrls.length === 0) return;
  try {
    const cache = await caches.open("kiln-recipe-images");
    const unique = [...new Set(imageUrls)].filter((u) =>
      u.startsWith("/api/images/"),
    );
    await Promise.all(
      unique.map(async (url) => {
        const existing = await cache.match(url);
        if (!existing) {
          const res = await fetch(url);
          if (res.ok) {
            await cache.put(url, res);
          }
        }
      }),
    );
  } catch {
    // Non-fatal: SW runtime caching also handles images on view
  }
}

let activeFullSync: Promise<boolean> | null = null;

/**
 * Flush pending offline edits, then prefetch all recipes (with full ingredients &
 * instructions), cached photos, shopping lists, and pantry staples into IndexedDB.
 */
export function syncAllForOffline(): Promise<boolean> {
  if (activeFullSync) return activeFullSync;

  activeFullSync = (async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      markApiOffline();
      return false;
    }

    updateStatus({ syncing: true, syncError: null });
    try {
      const flushed = await flushOutbox();
      if (!flushed) return false;

      // 1. Recipes summary + full detail for every recipe (so Cook Mode works offline!)
      const recipesRes = await syncFetch("/api/recipes");
      if (!recipesRes.ok) {
        throw new OfflineNetworkError(`HTTP ${recipesRes.status}`);
      }
      const recipes = (await recipesRes.json()) as Recipe[];
      await saveCachedRecipesSummary(recipes);

      const imageUrls: string[] = [];
      await Promise.all(
        recipes.map(async (r) => {
          if (r.image_url) imageUrls.push(r.image_url);
          try {
            const detailRes = await syncFetch(`/api/recipes/${r.id}`);
            if (detailRes.ok) {
              const full = (await detailRes.json()) as Recipe;
              await saveCachedRecipe(full);
              if (full.image_url) imageUrls.push(full.image_url);
            }
          } catch {
            // Skip individual failures; keep syncing the rest
          }
        }),
      );
      void warmImageCache(imageUrls);

      // 2. Shopping lists summary + full items for every list
      const listsRes = await syncFetch("/api/shopping-lists");
      if (listsRes.ok) {
        const lists = (await listsRes.json()) as ShoppingList[];
        await saveCachedShoppingListsSummary(lists);
        await Promise.all(
          lists.map(async (sl) => {
            try {
              const detailRes = await syncFetch(`/api/shopping-lists/${sl.id}`);
              if (detailRes.ok) {
                const full = (await detailRes.json()) as ShoppingList;
                await saveCachedShoppingList(full);
              }
            } catch {
              // Skip individual failures
            }
          }),
        );
      }

      // 3. Pantry staples
      const staplesRes = await syncFetch("/api/pantry-staples");
      if (staplesRes.ok) {
        const staples = (await staplesRes.json()) as PantryStaple[];
        await saveCachedPantryStaples(staples);
      }

      // 4. Meal plans for this week & next week
      await Promise.all(
        [getThisWeekMonday(), getNextWeekMonday()].map(async (weekStart) => {
          try {
            const mpRes = await syncFetch(
              `/api/meal-plan?week_start=${encodeURIComponent(weekStart)}`,
            );
            if (mpRes.ok) {
              const week = (await mpRes.json()) as MealPlanWeek;
              await saveCachedMealPlanWeek(week);
            }
          } catch {
            // Skip individual failures
          }
        }),
      );

      const syncedIso = new Date().toISOString();
      await setLastSyncedAt(syncedIso);
      const pending = await countOutboxOps();
      lastOfflineAt = 0;
      updateStatus({
        online: true,
        pendingCount: pending,
        lastSyncedAt: syncedIso,
        syncError: null,
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("kiln:synced"));
      }
      return true;
    } catch (err: unknown) {
      if (isOfflineError(err)) {
        markApiOffline();
      } else {
        updateStatus({
          syncError: err instanceof Error ? err.message : "Sync failed",
        });
      }
      return false;
    } finally {
      updateStatus({ syncing: false });
      activeFullSync = null;
    }
  })();

  return activeFullSync;
}

async function probeKilnHealth(): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    markApiOffline();
    return false;
  }
  try {
    const res = await syncFetch("/api/health", undefined, 2000);
    if (res.ok) {
      markApiReachable();
      return true;
    }
  } catch {
    // Still unreachable
  }
  markApiOffline();
  return false;
}

let initialized = false;

export function initOfflineSync(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  void Promise.all([countOutboxOps(), getLastSyncedAt()]).then(
    ([pendingCount, lastSyncedAt]) => {
      updateStatus({ pendingCount, lastSyncedAt });
    },
  );

  window.addEventListener("online", () => {
    lastOfflineAt = 0;
    void probeKilnHealth().then((ok) => {
      if (ok) void syncAllForOffline();
    });
  });

  window.addEventListener("offline", () => {
    markApiOffline();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      if (!status.online) {
        void probeKilnHealth().then((ok) => {
          if (ok) void syncAllForOffline();
        });
      } else {
        void flushOutbox();
      }
    }
  });

  // When offline while on cellular (navigator.onLine is true), periodically probe
  // so rejoining home Wi-Fi reconnects and syncs automatically without manual reload.
  window.setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      navigator.onLine &&
      !status.online &&
      !status.syncing
    ) {
      void probeKilnHealth().then((ok) => {
        if (ok) void syncAllForOffline();
      });
    }
  }, CIRCUIT_BREAKER_COOLDOWN_MS);
}
