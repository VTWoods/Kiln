import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ManagePantryStaplesModal from "../components/ManagePantryStaplesModal";
import {
  addShoppingListItems,
  clearCheckedShoppingListItems,
  createShoppingList,
  deleteShoppingList,
  deleteShoppingListItem,
  getShoppingList,
  listShoppingLists,
  updateShoppingListItem,
} from "../api/shoppingLists";
import {
  defaultShoppingListName,
  GROCERY_AISLES,
  type ShoppingList,
  type ShoppingListItem,
} from "../types/shoppingList";

export default function ShoppingListsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [activeList, setActiveList] = useState<ShoppingList | null>(null);
  const [loadingLists, setLoadingLists] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New list form
  const [showNewListForm, setShowNewListForm] = useState(false);
  const [newListName, setNewListName] = useState(() =>
    defaultShoppingListName(),
  );
  const [creatingList, setCreatingList] = useState(false);

  const openNewListForm = () => {
    setNewListName(defaultShoppingListName());
    setShowNewListForm(true);
  };

  // Manual item add form
  const [itemQty, setItemQty] = useState("");
  const [itemUnit, setItemUnit] = useState("");
  const [itemName, setItemName] = useState("");
  const [addingItem, setAddingItem] = useState(false);
  const [groupByAisle, setGroupByAisle] = useState(true);
  const [showStaplesModal, setShowStaplesModal] = useState(false);

  const initialListId = Number(searchParams.get("list") || 0);

  const loadActiveList = useCallback(async (id: number) => {
    setLoadingDetail(true);
    setError(null);
    try {
      const detail = await getShoppingList(id);
      setActiveList(detail);
      setLists((prev) =>
        prev.map((l) =>
          l.id === detail.id
            ? {
                ...l,
                item_count: detail.item_count,
                checked_count: detail.checked_count,
              }
            : l,
        ),
      );
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load shopping list.",
      );
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoadingLists(true);
    setError(null);

    listShoppingLists()
      .then((data) => {
        if (!active) return;
        setLists(data);
        if (data.length === 0) {
          setActiveList(null);
          return;
        }
        const preferred =
          data.find((l) => l.id === initialListId) ?? data[0];
        if (preferred.id !== initialListId) {
          setSearchParams({ list: String(preferred.id) }, { replace: true });
        }
        void loadActiveList(preferred.id);
      })
      .catch((err: unknown) => {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load shopping lists.",
          );
        }
      })
      .finally(() => {
        if (active) setLoadingLists(false);
      });

    return () => {
      active = false;
    };
    // Run only on initial mount; list switches are handled directly in handleSelectList.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload active list automatically after offline outbox changes sync back to server
  useEffect(() => {
    const onSynced = () => {
      if (activeList?.id) {
        void loadActiveList(activeList.id);
      }
    };
    window.addEventListener("kiln:synced", onSynced);
    return () => window.removeEventListener("kiln:synced", onSynced);
  }, [activeList?.id, loadActiveList]);

  const handleSelectList = (id: number) => {
    setSearchParams({ list: String(id) });
    void loadActiveList(id);
  };

  const handleCreateList = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newListName.trim();
    if (!trimmed) return;

    setCreatingList(true);
    setError(null);
    try {
      const created = await createShoppingList(trimmed);
      setLists((prev) => [...prev, created]);
      setActiveList(created);
      setNewListName("");
      setShowNewListForm(false);
      setSearchParams({ list: String(created.id) });
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to create shopping list.",
      );
    } finally {
      setCreatingList(false);
    }
  };

  const handleDeleteList = async (list: ShoppingList) => {
    if (
      !window.confirm(
        `Delete "${list.name}" and all of its items? This cannot be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await deleteShoppingList(list.id);
      const remaining = lists.filter((l) => l.id !== list.id);
      setLists(remaining);
      if (remaining.length > 0) {
        setSearchParams({ list: String(remaining[0].id) }, { replace: true });
        void loadActiveList(remaining[0].id);
      } else {
        setActiveList(null);
        setSearchParams({}, { replace: true });
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to delete shopping list.",
      );
    }
  };

  const handleAddManualItem = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeList || !itemName.trim()) return;

    setAddingItem(true);
    setError(null);
    try {
      const updated = await addShoppingListItems(activeList.id, [
        {
          name: itemName.trim(),
          quantity: itemQty.trim(),
          unit: itemUnit.trim(),
        },
      ]);
      setActiveList(updated);
      setLists((prev) =>
        prev.map((l) =>
          l.id === updated.id
            ? {
                ...l,
                item_count: updated.item_count,
                checked_count: updated.checked_count,
              }
            : l,
        ),
      );
      setItemQty("");
      setItemUnit("");
      setItemName("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add item.");
    } finally {
      setAddingItem(false);
    }
  };

  const handleToggleItem = async (item: ShoppingListItem) => {
    if (!activeList) return;
    const nextChecked = !item.checked;

    // Optimistic update
    setActiveList((prev) => {
      if (!prev || !prev.items) return prev;
      const items = prev.items.map((it) =>
        it.id === item.id ? { ...it, checked: nextChecked } : it,
      );
      const checkedCount = items.filter((it) => it.checked).length;
      return { ...prev, items, checked_count: checkedCount };
    });

    try {
      await updateShoppingListItem(activeList.id, item.id, {
        checked: nextChecked,
      });
      setLists((prev) =>
        prev.map((l) =>
          l.id === activeList.id
            ? {
                ...l,
                checked_count: l.checked_count + (nextChecked ? 1 : -1),
              }
            : l,
        ),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update item.");
      void loadActiveList(activeList.id);
    }
  };

  const handleDeleteItem = async (item: ShoppingListItem) => {
    if (!activeList) return;
    setError(null);
    try {
      await deleteShoppingListItem(activeList.id, item.id);
      void loadActiveList(activeList.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to remove item.");
    }
  };

  const handleChangeAisle = async (item: ShoppingListItem, nextAisle: string) => {
    if (!activeList || item.aisle === nextAisle) return;

    // Optimistic update so the item immediately moves to its new aisle group
    setActiveList((prev) => {
      if (!prev || !prev.items) return prev;
      return {
        ...prev,
        items: prev.items.map((it) =>
          it.id === item.id ? { ...it, aisle: nextAisle } : it,
        ),
      };
    });

    try {
      await updateShoppingListItem(activeList.id, item.id, { aisle: nextAisle });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update aisle.");
      void loadActiveList(activeList.id);
    }
  };

  const handleClearChecked = async () => {
    if (!activeList) return;
    setError(null);
    try {
      const updated = await clearCheckedShoppingListItems(activeList.id);
      setActiveList(updated);
      setLists((prev) =>
        prev.map((l) =>
          l.id === updated.id
            ? {
                ...l,
                item_count: updated.item_count,
                checked_count: updated.checked_count,
              }
            : l,
        ),
      );
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to clear checked items.",
      );
    }
  };

  const items = activeList?.items ?? [];
  const uncheckedItems = items.filter((i) => !i.checked);
  const checkedItems = items.filter((i) => i.checked);
  const availableAisles =
    activeList?.aisles && activeList.aisles.length > 0
      ? activeList.aisles
      : [...GROCERY_AISLES];

  const groupedUnchecked = (() => {
    const byAisle = new Map<string, ShoppingListItem[]>();
    for (const item of uncheckedItems) {
      const aisle = item.aisle || "Other";
      const bucket = byAisle.get(aisle);
      if (bucket) {
        bucket.push(item);
      } else {
        byAisle.set(aisle, [item]);
      }
    }
    const ordered: { aisle: string; items: ShoppingListItem[] }[] = [];
    for (const aisle of availableAisles) {
      const bucket = byAisle.get(aisle);
      if (bucket && bucket.length > 0) {
        ordered.push({ aisle, items: bucket });
        byAisle.delete(aisle);
      }
    }
    for (const [aisle, bucket] of byAisle.entries()) {
      ordered.push({ aisle, items: bucket });
    }
    return ordered;
  })();

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
            Shopping Lists
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            Plan grocery trips and pull ingredients directly from your recipes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowStaplesModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-xs transition-colors hover:bg-stone-50"
          >
            Pantry Staples
          </button>
          <button
            type="button"
            onClick={() =>
              showNewListForm ? setShowNewListForm(false) : openNewListForm()
            }
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-amber-700"
          >
            + New List
          </button>
        </div>
      </div>

      {showNewListForm && (
        <form
          onSubmit={handleCreateList}
          className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white p-4 shadow-xs"
        >
          <input
            type="text"
            required
            autoFocus
            placeholder={`List name (e.g., ${defaultShoppingListName()})`}
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            disabled={creatingList}
            className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none"
          />
          <button
            type="submit"
            disabled={creatingList}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
          >
            {creatingList ? "Creating…" : "Create"}
          </button>
          <button
            type="button"
            onClick={() => setShowNewListForm(false)}
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
          >
            Cancel
          </button>
        </form>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loadingLists ? (
        <div className="h-48 animate-pulse rounded-2xl border border-stone-200 bg-white" />
      ) : lists.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center">
          <p className="text-base font-medium text-stone-800">
            No shopping lists yet
          </p>
          <p className="mt-1 text-sm text-stone-500">
            Create a list here, or open any recipe and click{" "}
            <span className="font-medium text-stone-700">
              + Add to Shopping List
            </span>{" "}
            to start one automatically.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={openNewListForm}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-700"
            >
              Create Shopping List
            </button>
            <Link
              to="/recipes"
              className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              Browse Recipes
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-4">
          {/* List tabs / sidebar */}
          <aside className="space-y-1.5 md:col-span-1">
            {lists.map((list) => {
              const isSelected = activeList?.id === list.id;
              return (
                <button
                  key={list.id}
                  type="button"
                  onClick={() => handleSelectList(list.id)}
                  className={[
                    "flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm transition-colors",
                    isSelected
                      ? "bg-amber-100 font-semibold text-amber-950"
                      : "bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50",
                  ].join(" ")}
                >
                  <span className="truncate">{list.name}</span>
                  <span
                    className={[
                      "ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs",
                      isSelected
                        ? "bg-amber-200/80 text-amber-900"
                        : "bg-stone-100 text-stone-500",
                    ].join(" ")}
                  >
                    {list.item_count - list.checked_count}/{list.item_count}
                  </span>
                </button>
              );
            })}
          </aside>

          {/* Active list detail */}
          <div className="space-y-4 md:col-span-3">
            {activeList && (
              <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 pb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-stone-900">
                      {activeList.name}
                    </h2>
                    <p className="text-xs text-stone-500">
                      {uncheckedItems.length} remaining
                      {checkedItems.length > 0 &&
                        ` · ${checkedItems.length} checked off`}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div
                      className="inline-flex rounded-lg border border-stone-200 bg-stone-50 p-0.5 text-xs"
                      role="group"
                      aria-label="List grouping"
                    >
                      <button
                        type="button"
                        onClick={() => setGroupByAisle(true)}
                        className={[
                          "rounded-md px-2.5 py-1 font-medium transition-colors",
                          groupByAisle
                            ? "bg-white text-stone-900 shadow-xs"
                            : "text-stone-500 hover:text-stone-700",
                        ].join(" ")}
                      >
                        By Aisle
                      </button>
                      <button
                        type="button"
                        onClick={() => setGroupByAisle(false)}
                        className={[
                          "rounded-md px-2.5 py-1 font-medium transition-colors",
                          !groupByAisle
                            ? "bg-white text-stone-900 shadow-xs"
                            : "text-stone-500 hover:text-stone-700",
                        ].join(" ")}
                      >
                        Flat
                      </button>
                    </div>
                    {checkedItems.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearChecked}
                        className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
                      >
                        Clear checked ({checkedItems.length})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteList(activeList)}
                      className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                    >
                      Delete list
                    </button>
                  </div>
                </div>

                {/* Add custom item form */}
                <form
                  onSubmit={handleAddManualItem}
                  className="mt-4 flex flex-wrap items-center gap-2"
                >
                  <input
                    type="text"
                    placeholder="Qty"
                    value={itemQty}
                    onChange={(e) => setItemQty(e.target.value)}
                    disabled={addingItem}
                    className="w-16 rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    placeholder="Unit"
                    value={itemUnit}
                    onChange={(e) => setItemUnit(e.target.value)}
                    disabled={addingItem}
                    className="w-20 rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Add an item…"
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    disabled={addingItem}
                    className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={addingItem}
                    className="rounded-lg bg-stone-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
                  >
                    Add
                  </button>
                </form>

                {/* Items */}
                {loadingDetail ? (
                  <div className="mt-4 space-y-2">
                    {[0, 1, 2].map((n) => (
                      <div
                        key={n}
                        className="h-10 animate-pulse rounded-lg bg-stone-100"
                      />
                    ))}
                  </div>
                ) : items.length === 0 ? (
                  <div className="mt-6 rounded-xl border border-dashed border-stone-200 bg-stone-50/70 p-8 text-center text-sm text-stone-500">
                    This list is empty. Add items above or pull ingredients from
                    any{" "}
                    <Link
                      to="/recipes"
                      className="font-medium text-amber-700 hover:underline"
                    >
                      recipe
                    </Link>
                    .
                  </div>
                ) : (
                  <div className="mt-4 space-y-4">
                    {uncheckedItems.length > 0 &&
                      (groupByAisle ? (
                        <div className="space-y-4">
                          {groupedUnchecked.map((group) => (
                            <div key={group.aisle}>
                              <div className="mb-1 flex items-center justify-between border-b border-stone-100 pb-1">
                                <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                                  {group.aisle}
                                </h3>
                                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-500">
                                  {group.items.length}
                                </span>
                              </div>
                              <ul className="divide-y divide-stone-100">
                                {group.items.map((item) => (
                                  <ShoppingListItemRow
                                    key={item.id}
                                    item={item}
                                    aisles={availableAisles}
                                    onToggle={handleToggleItem}
                                    onDelete={handleDeleteItem}
                                    onChangeAisle={handleChangeAisle}
                                  />
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <ul className="divide-y divide-stone-100">
                          {uncheckedItems.map((item) => (
                            <ShoppingListItemRow
                              key={item.id}
                              item={item}
                              aisles={availableAisles}
                              onToggle={handleToggleItem}
                              onDelete={handleDeleteItem}
                              onChangeAisle={handleChangeAisle}
                            />
                          ))}
                        </ul>
                      ))}

                    {checkedItems.length > 0 && (
                      <div className="border-t border-stone-100 pt-3">
                        <p className="mb-1 text-xs font-medium tracking-wide text-stone-400 uppercase">
                          Checked off ({checkedItems.length})
                        </p>
                        <ul className="divide-y divide-stone-100">
                          {checkedItems.map((item) => (
                            <ShoppingListItemRow
                              key={item.id}
                              item={item}
                              aisles={availableAisles}
                              onToggle={handleToggleItem}
                              onDelete={handleDeleteItem}
                              onChangeAisle={handleChangeAisle}
                            />
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {showStaplesModal && (
        <ManagePantryStaplesModal onClose={() => setShowStaplesModal(false)} />
      )}
    </section>
  );
}

function ShoppingListItemRow({
  item,
  aisles,
  onToggle,
  onDelete,
  onChangeAisle,
}: {
  item: ShoppingListItem;
  aisles: string[];
  onToggle: (item: ShoppingListItem) => void;
  onDelete: (item: ShoppingListItem) => void;
  onChangeAisle: (item: ShoppingListItem, aisle: string) => void;
}) {
  const amount = [item.quantity, item.unit].filter(Boolean).join(" ");
  const currentAisle = item.aisle || "Other";
  const recipeChips =
    item.recipes && item.recipes.length > 0
      ? item.recipes
      : item.recipe_id && item.recipe_title
        ? [{ id: item.recipe_id, title: item.recipe_title }]
        : [];

  return (
    <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <div className="flex min-w-0 items-center gap-3">
        <input
          type="checkbox"
          checked={item.checked}
          onChange={() => onToggle(item)}
          className="h-4 w-4 shrink-0 cursor-pointer rounded border-stone-300 accent-amber-600"
        />
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={[
              "break-words",
              item.checked ? "text-stone-400 line-through" : "text-stone-800",
            ].join(" ")}
          >
            {amount && (
              <span
                className={[
                  "mr-1.5 font-medium",
                  item.checked ? "text-stone-400" : "text-amber-800",
                ].join(" ")}
              >
                {amount}
              </span>
            )}
            {item.name}
          </span>

          {recipeChips.length > 0 && (
            <span className="inline-flex flex-wrap items-center gap-1">
              {recipeChips.map((recipe) => (
                <Link
                  key={recipe.id}
                  to={`/recipes/${recipe.id}`}
                  className="inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
                >
                  {recipe.title}
                </Link>
              ))}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {!item.checked && (
          <select
            value={currentAisle}
            onChange={(e) => onChangeAisle(item, e.target.value)}
            aria-label={`Aisle for ${item.name}`}
            title="Change aisle (remembered for next time)"
            className="max-w-[9.5rem] cursor-pointer rounded-md border border-transparent bg-stone-50 px-1.5 py-1 text-[11px] text-stone-500 transition-colors hover:border-stone-200 hover:bg-white hover:text-stone-700 focus:border-amber-400 focus:bg-white focus:text-stone-800 focus:outline-none"
          >
            {aisles.map((aisle) => (
              <option key={aisle} value={aisle}>
                {aisle}
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          onClick={() => onDelete(item)}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-stone-400 hover:bg-stone-100 hover:text-red-600"
          aria-label={`Remove ${item.name}`}
        >
          ✕
        </button>
      </div>
    </li>
  );
}
