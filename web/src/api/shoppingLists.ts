import { apiFetch } from "../offline/fetch";
import {
  deleteCachedShoppingList,
  enqueueOutboxOp,
  getCachedShoppingList,
  getCachedShoppingLists,
  isOfflineError,
  saveCachedShoppingList,
  saveCachedShoppingListsSummary,
} from "../offline/store";
import {
  flushOutbox,
  isOfflineCircuitOpen,
  refreshPendingCount,
} from "../offline/sync";
import {
  GROCERY_AISLES,
  type AddShoppingListItemInput,
  type ShoppingList,
  type ShoppingListItem,
} from "../types/shoppingList";

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

export async function listShoppingLists(): Promise<ShoppingList[]> {
  try {
    if (!isOfflineCircuitOpen()) {
      await flushOutbox();
    }
    const res = await apiFetch("/api/shopping-lists");
    const lists = await parseJsonOrThrow<ShoppingList[]>(res);
    void saveCachedShoppingListsSummary(lists);
    return lists;
  } catch (err) {
    if (isOfflineError(err)) {
      return getCachedShoppingLists();
    }
    throw err;
  }
}

export async function getShoppingList(id: number): Promise<ShoppingList> {
  try {
    if (!isOfflineCircuitOpen()) {
      await flushOutbox();
    }
    const res = await apiFetch(`/api/shopping-lists/${id}`);
    const list = await parseJsonOrThrow<ShoppingList>(res);
    void saveCachedShoppingList(list);
    return list;
  } catch (err) {
    if (isOfflineError(err)) {
      const cached = await getCachedShoppingList(id);
      if (cached) return cached;
      throw new Error(
        "This shopping list has not been synced for offline use yet.",
      );
    }
    throw err;
  }
}

export async function createShoppingList(name: string): Promise<ShoppingList> {
  try {
    const res = await apiFetch("/api/shopping-lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const created = await parseJsonOrThrow<ShoppingList>(res);
    void saveCachedShoppingList(created);
    return created;
  } catch (err) {
    if (isOfflineError(err)) {
      throw new Error(
        "Creating a new shopping list requires a connection to your Kiln server.",
      );
    }
    throw err;
  }
}

export async function deleteShoppingList(id: number): Promise<void> {
  try {
    const res = await apiFetch(`/api/shopping-lists/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      await parseJsonOrThrow<never>(res);
    }
    void deleteCachedShoppingList(id);
  } catch (err) {
    if (isOfflineError(err)) {
      throw new Error(
        "Deleting a shopping list requires a connection to your Kiln server.",
      );
    }
    throw err;
  }
}

export async function addShoppingListItems(
  listId: number,
  items: AddShoppingListItemInput[],
): Promise<ShoppingList> {
  try {
    const res = await apiFetch(`/api/shopping-lists/${listId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const updated = await parseJsonOrThrow<ShoppingList>(res);
    void saveCachedShoppingList(updated);
    return updated;
  } catch (err) {
    if (!isOfflineError(err)) throw err;

    const cached = await getCachedShoppingList(listId);
    if (!cached) {
      throw new Error("Cannot add items while offline — list is not cached.");
    }

    const now = Date.now();
    const added: ShoppingListItem[] = items
      .filter((it) => it.name.trim())
      .map((it, idx) => ({
        id: -(now + idx + 1),
        shopping_list_id: listId,
        name: it.name.trim(),
        quantity: it.quantity.trim(),
        unit: it.unit.trim(),
        aisle: "Other",
        checked: false,
        ...(it.recipe_id ? { recipe_id: it.recipe_id } : {}),
      }));

    const nextItems = [...(cached.items ?? []), ...added];
    const updatedList: ShoppingList = {
      ...cached,
      items: nextItems,
      aisles: cached.aisles ?? [...GROCERY_AISLES],
      item_count: nextItems.length,
      checked_count: nextItems.filter((i) => i.checked).length,
      updated_at: new Date().toISOString(),
    };

    await saveCachedShoppingList(updatedList);
    await enqueueOutboxOp({
      kind: "add_items",
      listId,
      tempItems: added.map((a) => ({ tempId: a.id, name: a.name })),
      items,
      createdAt: new Date().toISOString(),
    });
    await refreshPendingCount();
    return updatedList;
  }
}

export async function updateShoppingListItem(
  listId: number,
  itemId: number,
  patch: Partial<
    Pick<ShoppingListItem, "checked" | "name" | "quantity" | "unit" | "aisle">
  >,
): Promise<ShoppingListItem> {
  try {
    const res = await apiFetch(
      `/api/shopping-lists/${listId}/items/${itemId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    );
    const updatedItem = await parseJsonOrThrow<ShoppingListItem>(res);

    // Keep cached list in sync with the updated item
    const cached = await getCachedShoppingList(listId);
    if (cached && cached.items) {
      const nextItems = cached.items.map((it) =>
        it.id === itemId ? updatedItem : it,
      );
      void saveCachedShoppingList({
        ...cached,
        items: nextItems,
        item_count: nextItems.length,
        checked_count: nextItems.filter((i) => i.checked).length,
      });
    }
    return updatedItem;
  } catch (err) {
    if (!isOfflineError(err)) throw err;

    const cached = await getCachedShoppingList(listId);
    const existing = cached?.items?.find((it) => it.id === itemId);
    if (!cached || !cached.items || !existing) {
      throw new Error("Item not found in offline cache.");
    }

    const updatedItem: ShoppingListItem = { ...existing, ...patch };
    const nextItems = cached.items.map((it) =>
      it.id === itemId ? updatedItem : it,
    );
    await saveCachedShoppingList({
      ...cached,
      items: nextItems,
      item_count: nextItems.length,
      checked_count: nextItems.filter((i) => i.checked).length,
      updated_at: new Date().toISOString(),
    });
    await enqueueOutboxOp({
      kind: "patch_item",
      listId,
      itemId,
      patch,
      createdAt: new Date().toISOString(),
    });
    await refreshPendingCount();
    return updatedItem;
  }
}

export async function deleteShoppingListItem(
  listId: number,
  itemId: number,
): Promise<void> {
  try {
    const res = await apiFetch(
      `/api/shopping-lists/${listId}/items/${itemId}`,
      {
        method: "DELETE",
      },
    );
    if (!res.ok) {
      await parseJsonOrThrow<never>(res);
    }
    const cached = await getCachedShoppingList(listId);
    if (cached && cached.items) {
      const nextItems = cached.items.filter((it) => it.id !== itemId);
      void saveCachedShoppingList({
        ...cached,
        items: nextItems,
        item_count: nextItems.length,
        checked_count: nextItems.filter((i) => i.checked).length,
      });
    }
  } catch (err) {
    if (!isOfflineError(err)) throw err;

    const cached = await getCachedShoppingList(listId);
    if (cached && cached.items) {
      const nextItems = cached.items.filter((it) => it.id !== itemId);
      await saveCachedShoppingList({
        ...cached,
        items: nextItems,
        item_count: nextItems.length,
        checked_count: nextItems.filter((i) => i.checked).length,
        updated_at: new Date().toISOString(),
      });
    }
    await enqueueOutboxOp({
      kind: "delete_item",
      listId,
      itemId,
      createdAt: new Date().toISOString(),
    });
    await refreshPendingCount();
  }
}

export async function clearCheckedShoppingListItems(
  listId: number,
): Promise<ShoppingList> {
  try {
    const res = await apiFetch(`/api/shopping-lists/${listId}/checked`, {
      method: "DELETE",
    });
    const updated = await parseJsonOrThrow<ShoppingList>(res);
    void saveCachedShoppingList(updated);
    return updated;
  } catch (err) {
    if (!isOfflineError(err)) throw err;

    const cached = await getCachedShoppingList(listId);
    if (!cached) {
      throw new Error("List not found in offline cache.");
    }
    const nextItems = (cached.items ?? []).filter((it) => !it.checked);
    const updatedList: ShoppingList = {
      ...cached,
      items: nextItems,
      item_count: nextItems.length,
      checked_count: 0,
      updated_at: new Date().toISOString(),
    };
    await saveCachedShoppingList(updatedList);
    await enqueueOutboxOp({
      kind: "clear_checked",
      listId,
      createdAt: new Date().toISOString(),
    });
    await refreshPendingCount();
    return updatedList;
  }
}
