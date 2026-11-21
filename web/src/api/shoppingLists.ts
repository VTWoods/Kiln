import type {
  AddShoppingListItemInput,
  ShoppingList,
  ShoppingListItem,
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
  const res = await fetch("/api/shopping-lists");
  return parseJsonOrThrow<ShoppingList[]>(res);
}

export async function getShoppingList(id: number): Promise<ShoppingList> {
  const res = await fetch(`/api/shopping-lists/${id}`);
  return parseJsonOrThrow<ShoppingList>(res);
}

export async function createShoppingList(name: string): Promise<ShoppingList> {
  const res = await fetch("/api/shopping-lists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return parseJsonOrThrow<ShoppingList>(res);
}

export async function deleteShoppingList(id: number): Promise<void> {
  const res = await fetch(`/api/shopping-lists/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    await parseJsonOrThrow<never>(res);
  }
}

export async function addShoppingListItems(
  listId: number,
  items: AddShoppingListItemInput[],
): Promise<ShoppingList> {
  const res = await fetch(`/api/shopping-lists/${listId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  return parseJsonOrThrow<ShoppingList>(res);
}

export async function updateShoppingListItem(
  listId: number,
  itemId: number,
  patch: Partial<
    Pick<ShoppingListItem, "checked" | "name" | "quantity" | "unit" | "aisle">
  >,
): Promise<ShoppingListItem> {
  const res = await fetch(`/api/shopping-lists/${listId}/items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return parseJsonOrThrow<ShoppingListItem>(res);
}

export async function deleteShoppingListItem(
  listId: number,
  itemId: number,
): Promise<void> {
  const res = await fetch(`/api/shopping-lists/${listId}/items/${itemId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    await parseJsonOrThrow<never>(res);
  }
}

export async function clearCheckedShoppingListItems(
  listId: number,
): Promise<ShoppingList> {
  const res = await fetch(`/api/shopping-lists/${listId}/checked`, {
    method: "DELETE",
  });
  return parseJsonOrThrow<ShoppingList>(res);
}
