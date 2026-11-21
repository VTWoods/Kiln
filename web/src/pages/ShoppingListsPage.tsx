import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import ManagePantryStaplesModal from "../components/ManagePantryStaplesModal";
import {
  getCachedShoppingList,
  getCachedShoppingLists,
} from "../offline/store";
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
  const [groupMode, setGroupMode] = useState<"aisle" | "recipe">("aisle");
  const [showStaplesModal, setShowStaplesModal] = useState(false);
  const [openMenuItemId, setOpenMenuItemId] = useState<number | null>(null);
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const listMenuRef = useRef<HTMLDivElement | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(["checked"]),
  );

  useEffect(() => {
    if (!listMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        listMenuRef.current &&
        !listMenuRef.current.contains(e.target as Node)
      ) {
        setListMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setListMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [listMenuOpen]);

  const toggleGroupCollapsed = (groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };
  // Items just checked off: grayed out in place for 5s, then faded out before moving to the bottom
  const [pendingCheckIds, setPendingCheckIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [fadingCheckIds, setFadingCheckIds] = useState<Set<number>>(
    () => new Set(),
  );
  const checkTimersRef = useRef<
    Map<number, { fadeTimer: number; moveTimer: number }>
  >(new Map());

  const clearItemTimers = useCallback((itemId: number) => {
    const existing = checkTimersRef.current.get(itemId);
    if (existing) {
      window.clearTimeout(existing.fadeTimer);
      window.clearTimeout(existing.moveTimer);
      checkTimersRef.current.delete(itemId);
    }
    setPendingCheckIds((prev) => {
      if (!prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
    setFadingCheckIds((prev) => {
      if (!prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
  }, []);

  const clearAllCheckTimers = useCallback(() => {
    for (const timers of checkTimersRef.current.values()) {
      window.clearTimeout(timers.fadeTimer);
      window.clearTimeout(timers.moveTimer);
    }
    checkTimersRef.current.clear();
    setPendingCheckIds(new Set());
    setFadingCheckIds(new Set());
  }, []);

  useEffect(() => {
    return () => {
      for (const timers of checkTimersRef.current.values()) {
        window.clearTimeout(timers.fadeTimer);
        window.clearTimeout(timers.moveTimer);
      }
      checkTimersRef.current.clear();
    };
  }, []);

  const initialListId = Number(searchParams.get("list") || 0);

  const loadActiveList = useCallback(async (id: number) => {
    setError(null);
    const cached = await getCachedShoppingList(id);
    if (cached && cached.items) {
      setActiveList(cached);
      setLoadingDetail(false);
    } else {
      setLoadingDetail(true);
    }
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
      if (!cached) {
        setError(
          err instanceof Error ? err.message : "Failed to load shopping list.",
        );
      }
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setError(null);

    // Hydrate immediately from IndexedDB so switching tabs offline renders instantly
    let hydrated = false;
    void getCachedShoppingLists().then((cachedLists) => {
      if (!active || cachedLists.length === 0) return;
      hydrated = true;
      setLists(cachedLists);
      setLoadingLists(false);
      const preferred =
        cachedLists.find((l) => l.id === initialListId) ?? cachedLists[0];
      if (preferred.items) {
        setActiveList(preferred);
        setLoadingDetail(false);
      }
    });

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
        if (active && !hydrated) {
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
    clearAllCheckTimers();
    setOpenMenuItemId(null);
    setListMenuOpen(false);
    setCollapsedGroups(new Set(["checked"]));
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
      setOpenMenuItemId(null);
      setListMenuOpen(false);
      setCollapsedGroups(new Set(["checked"]));
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
    setListMenuOpen(false);
    setOpenMenuItemId(null);
    try {
      await deleteShoppingList(list.id);
      const remaining = lists.filter((l) => l.id !== list.id);
      setLists(remaining);
      setCollapsedGroups(new Set(["checked"]));
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

    // Manage the 5s gray-out -> 500ms fade -> move-to-bottom transition
    clearItemTimers(item.id);
    if (nextChecked) {
      setPendingCheckIds((prev) => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
      const fadeTimer = window.setTimeout(() => {
        setFadingCheckIds((prev) => {
          const next = new Set(prev);
          next.add(item.id);
          return next;
        });
      }, 5000);
      const moveTimer = window.setTimeout(() => {
        clearItemTimers(item.id);
      }, 5500);
      checkTimersRef.current.set(item.id, { fadeTimer, moveTimer });
    }

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
      clearItemTimers(item.id);
      setError(err instanceof Error ? err.message : "Failed to update item.");
      void loadActiveList(activeList.id);
    }
  };

  const handleDeleteItem = async (item: ShoppingListItem) => {
    if (!activeList) return;
    const targetListId = activeList.id;
    const previousActiveList = activeList;
    const previousLists = lists;

    clearItemTimers(item.id);
    setError(null);

    // Optimistically remove item immediately and update list counts
    setActiveList((prev) => {
      if (!prev || prev.id !== targetListId || !prev.items) return prev;
      const nextItems = prev.items.filter((it) => it.id !== item.id);
      const nextCheckedCount = nextItems.filter((it) => it.checked).length;
      return {
        ...prev,
        items: nextItems,
        item_count: nextItems.length,
        checked_count: nextCheckedCount,
      };
    });
    setLists((prev) =>
      prev.map((l) =>
        l.id === targetListId
          ? {
              ...l,
              item_count: Math.max(0, l.item_count - 1),
              checked_count: item.checked
                ? Math.max(0, l.checked_count - 1)
                : l.checked_count,
            }
          : l,
      ),
    );

    try {
      await deleteShoppingListItem(targetListId, item.id);
    } catch (err: unknown) {
      setActiveList((prev) =>
        prev?.id === targetListId ? previousActiveList : prev,
      );
      setLists(previousLists);
      setError(err instanceof Error ? err.message : "Failed to remove item.");
      void loadActiveList(targetListId);
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
    clearAllCheckTimers();
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
  const remainingCount = items.filter((i) => !i.checked).length;
  const totalCheckedCount = items.length - remainingCount;
  // Keep recently checked items in place during their 5s gray-out + fade transition
  const uncheckedItems = items.filter(
    (i) => !i.checked || pendingCheckIds.has(i.id),
  );
  const checkedItems = items.filter(
    (i) => i.checked && !pendingCheckIds.has(i.id),
  );
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

  const groupedByRecipe = (() => {
    const shared: ShoppingListItem[] = [];
    const byRecipe = new Map<
      number,
      { id: number; title: string; items: ShoppingListItem[] }
    >();
    const manual: ShoppingListItem[] = [];

    for (const item of uncheckedItems) {
      const linked =
        item.recipes && item.recipes.length > 0
          ? item.recipes
          : item.recipe_id && item.recipe_title
            ? [{ id: item.recipe_id, title: item.recipe_title }]
            : [];

      if (linked.length === 0) {
        manual.push(item);
      } else if (linked.length > 1) {
        shared.push(item);
      } else {
        const rec = linked[0];
        const bucket = byRecipe.get(rec.id);
        if (bucket) {
          bucket.items.push(item);
        } else {
          byRecipe.set(rec.id, { id: rec.id, title: rec.title, items: [item] });
        }
      }
    }

    const groups: {
      key: string;
      label: string;
      recipeId?: number;
      showRecipeChips: boolean;
      items: ShoppingListItem[];
    }[] = [];

    if (shared.length > 0) {
      groups.push({
        key: "shared",
        label: "Multiple Recipes",
        showRecipeChips: true,
        items: shared,
      });
    }

    const sortedRecipes = [...byRecipe.values()].sort((a, b) =>
      a.title.localeCompare(b.title),
    );
    for (const rec of sortedRecipes) {
      groups.push({
        key: `recipe-${rec.id}`,
        label: rec.title,
        recipeId: rec.id,
        showRecipeChips: false,
        items: rec.items,
      });
    }

    if (manual.length > 0) {
      groups.push({
        key: "manual",
        label: "Other Items",
        showRecipeChips: false,
        items: manual,
      });
    }

    return groups;
  })();

  const activeGroupKeys =
    groupMode === "aisle"
      ? groupedUnchecked.map((g) => `aisle:${g.aisle}`)
      : groupedByRecipe.map((g) => `recipe:${g.key}`);
  const allGroupsCollapsed =
    activeGroupKeys.length > 0 &&
    activeGroupKeys.every((key) => collapsedGroups.has(key));

  const handleToggleCollapseAll = () => {
    if (activeGroupKeys.length === 0) return;
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (allGroupsCollapsed) {
        for (const key of activeGroupKeys) {
          next.delete(key);
        }
      } else {
        for (const key of activeGroupKeys) {
          next.add(key);
        }
      }
      return next;
    });
  };

  return (
    <section className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
            Shopping Lists
          </h1>
          <p className="mt-1 hidden text-sm text-stone-600 sm:block">
            Plan grocery trips and pull ingredients directly from your recipes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowStaplesModal(true)}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-700 shadow-xs transition-colors hover:bg-stone-50"
          >
            Pantry Staples
          </button>
          <button
            type="button"
            onClick={() =>
              showNewListForm ? setShowNewListForm(false) : openNewListForm()
            }
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-amber-700"
          >
            + New List
          </button>
        </div>
      </div>

      {showNewListForm && (
        <form
          onSubmit={handleCreateList}
          className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white p-3.5 shadow-xs sm:p-4"
        >
          <input
            type="text"
            required
            autoFocus
            placeholder={`List name (e.g., ${defaultShoppingListName()})`}
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            disabled={creatingList}
            className="w-full min-w-0 rounded-lg border border-stone-300 px-3 py-2 text-base text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none sm:w-auto sm:flex-1 sm:text-sm"
          />
          <button
            type="submit"
            disabled={creatingList}
            className="min-h-[40px] rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
          >
            {creatingList ? "Creating…" : "Create"}
          </button>
          <button
            type="button"
            onClick={() => setShowNewListForm(false)}
            className="min-h-[40px] rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"
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
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-6 text-center sm:p-10">
          <p className="text-base font-medium text-stone-800">
            No shopping lists yet
          </p>
          <p className="mt-1 text-sm text-stone-500">
            Create a list here, or open any recipe and click{" "}
            <span className="font-medium text-stone-700">+ List</span>{" "}
            to start one automatically.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={openNewListForm}
              className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-700"
            >
              Create Shopping List
            </button>
            <Link
              to="/recipes"
              className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              Browse Recipes
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4 md:gap-6">
          {/* Mobile horizontal scrollable list switcher */}
          <div
            className="flex min-w-0 gap-2 overflow-x-auto pb-1 md:hidden"
            role="tablist"
            aria-label="Shopping lists"
          >
            {lists.map((list) => {
              const isSelected = activeList?.id === list.id;
              return (
                <button
                  key={list.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => handleSelectList(list.id)}
                  className={[
                    "inline-flex min-h-[40px] max-w-[14rem] shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-left text-sm transition-colors",
                    isSelected
                      ? "bg-amber-100 font-semibold text-amber-950 ring-1 ring-amber-300"
                      : "bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50",
                  ].join(" ")}
                >
                  <span className="min-w-0 truncate">{list.name}</span>
                  <span
                    className={[
                      "shrink-0 rounded-full px-1.5 py-0.5 text-xs",
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
          </div>

          {/* Desktop list sidebar */}
          <aside className="hidden min-w-0 space-y-1.5 md:col-span-1 md:block">
            {lists.map((list) => {
              const isSelected = activeList?.id === list.id;
              return (
                <button
                  key={list.id}
                  type="button"
                  onClick={() => handleSelectList(list.id)}
                  className={[
                    "flex w-full min-w-0 items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm transition-colors",
                    isSelected
                      ? "bg-amber-100 font-semibold text-amber-950"
                      : "bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50",
                  ].join(" ")}
                >
                  <span className="min-w-0 truncate">{list.name}</span>
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
          <div className="min-w-0 space-y-4 md:col-span-3">
            {activeList && (
              <div className="min-w-0 rounded-2xl border border-stone-200 bg-white p-3.5 shadow-xs sm:p-5">
                <div className="flex flex-col gap-3 border-b border-stone-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="break-words text-lg font-semibold text-stone-900">
                      {activeList.name}
                    </h2>
                    <p className="text-xs text-stone-500">
                      {remainingCount} remaining
                      {totalCheckedCount > 0 &&
                        ` · ${totalCheckedCount} checked off`}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
                    <div
                      className="inline-flex rounded-lg border border-stone-200 bg-stone-50 p-0.5 text-xs"
                      role="group"
                      aria-label="List grouping"
                    >
                      <button
                        type="button"
                        onClick={() => setGroupMode("aisle")}
                        className={[
                          "min-h-[36px] rounded-md px-3 py-1.5 font-medium transition-colors",
                          groupMode === "aisle"
                            ? "bg-white text-stone-900 shadow-xs"
                            : "text-stone-500 hover:text-stone-700",
                        ].join(" ")}
                      >
                        By Aisle
                      </button>
                      <button
                        type="button"
                        onClick={() => setGroupMode("recipe")}
                        className={[
                          "min-h-[36px] rounded-md px-3 py-1.5 font-medium transition-colors",
                          groupMode === "recipe"
                            ? "bg-white text-stone-900 shadow-xs"
                            : "text-stone-500 hover:text-stone-700",
                        ].join(" ")}
                      >
                        By Recipe
                      </button>
                    </div>

                    <div className="relative shrink-0" ref={listMenuRef}>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenuItemId(null);
                          setListMenuOpen((prev) => !prev);
                        }}
                        aria-haspopup="menu"
                        aria-expanded={listMenuOpen}
                        aria-label={`Actions for ${activeList.name}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-stone-200 bg-white text-lg font-semibold text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900 active:bg-stone-100"
                      >
                        ⋮
                      </button>

                      {listMenuOpen && (
                        <div
                          role="menu"
                          className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg"
                        >
                          {activeGroupKeys.length > 0 && (
                            <>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  handleToggleCollapseAll();
                                  setListMenuOpen(false);
                                }}
                                className="block min-h-[40px] w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-stone-700 hover:bg-stone-50"
                              >
                                {allGroupsCollapsed
                                  ? "Expand all"
                                  : "Collapse all"}
                              </button>
                              <div className="my-1 border-t border-stone-100" />
                            </>
                          )}
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setListMenuOpen(false);
                              void handleDeleteList(activeList);
                            }}
                            className="block min-h-[40px] w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50"
                          >
                            Delete list
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Add custom item form */}
                <form
                  onSubmit={handleAddManualItem}
                  className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2 sm:order-2">
                    <input
                      type="text"
                      required
                      placeholder="Add an item…"
                      value={itemName}
                      onChange={(e) => setItemName(e.target.value)}
                      disabled={addingItem}
                      className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-base text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none sm:py-1.5 sm:text-sm"
                    />
                    <button
                      type="submit"
                      disabled={addingItem}
                      className="min-h-[40px] shrink-0 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60 sm:min-h-0 sm:px-3.5 sm:py-1.5"
                    >
                      Add
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:order-1 sm:flex sm:shrink-0 sm:items-center">
                    <input
                      type="text"
                      placeholder="Qty"
                      aria-label="Quantity"
                      value={itemQty}
                      onChange={(e) => setItemQty(e.target.value)}
                      disabled={addingItem}
                      className="w-full min-w-0 rounded-lg border border-stone-300 px-2.5 py-2 text-base text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none sm:w-16 sm:py-1.5 sm:text-sm"
                    />
                    <input
                      type="text"
                      placeholder="Unit"
                      aria-label="Unit"
                      value={itemUnit}
                      onChange={(e) => setItemUnit(e.target.value)}
                      disabled={addingItem}
                      className="w-full min-w-0 rounded-lg border border-stone-300 px-2.5 py-2 text-base text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none sm:w-20 sm:py-1.5 sm:text-sm"
                    />
                  </div>
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
                      (groupMode === "aisle" ? (
                        <div className="space-y-3">
                          {groupedUnchecked.map((group) => {
                            const collapseKey = `aisle:${group.aisle}`;
                            const isCollapsed = collapsedGroups.has(collapseKey);
                            return (
                              <div key={group.aisle} className="min-w-0">
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleGroupCollapsed(collapseKey)
                                  }
                                  aria-expanded={!isCollapsed}
                                  className="sticky top-[var(--app-header-h,61px)] z-10 mb-1 flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-lg bg-stone-100/95 px-2.5 py-2.5 text-left shadow-2xs backdrop-blur-xs transition-colors hover:bg-stone-200/90"
                                >
                                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                                    <span
                                      aria-hidden="true"
                                      className="inline-block w-3.5 shrink-0 text-center text-xs text-stone-400"
                                    >
                                      {isCollapsed ? "▸" : "▾"}
                                    </span>
                                    <span className="min-w-0 truncate text-xs font-semibold tracking-wide text-stone-700 uppercase">
                                      {group.aisle}
                                    </span>
                                  </span>
                                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-stone-500">
                                    {group.items.length}
                                  </span>
                                </button>
                                {!isCollapsed && (
                                  <ul className="divide-y divide-stone-100">
                                    {group.items.map((item) => (
                                      <ShoppingListItemRow
                                        key={item.id}
                                        item={item}
                                        aisles={availableAisles}
                                        pendingCheck={pendingCheckIds.has(
                                          item.id,
                                        )}
                                        fadingOut={fadingCheckIds.has(item.id)}
                                        menuOpen={openMenuItemId === item.id}
                                        onToggleMenu={() => {
                                          setListMenuOpen(false);
                                          setOpenMenuItemId((prev) =>
                                            prev === item.id ? null : item.id,
                                          );
                                        }}
                                        onCloseMenu={() =>
                                          setOpenMenuItemId(null)
                                        }
                                        onToggle={handleToggleItem}
                                        onDelete={handleDeleteItem}
                                        onChangeAisle={handleChangeAisle}
                                      />
                                    ))}
                                  </ul>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {groupedByRecipe.map((group) => {
                            const collapseKey = `recipe:${group.key}`;
                            const isCollapsed = collapsedGroups.has(collapseKey);
                            return (
                              <div key={group.key} className="min-w-0">
                                <div className="sticky top-[var(--app-header-h,61px)] z-10 mb-1 flex min-w-0 items-center justify-between gap-1.5 rounded-lg bg-stone-100/95 shadow-2xs backdrop-blur-xs transition-colors hover:bg-stone-200/90">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      toggleGroupCollapsed(collapseKey)
                                    }
                                    aria-expanded={!isCollapsed}
                                    title={group.label}
                                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-2.5 py-2.5 text-left"
                                  >
                                    <span
                                      aria-hidden="true"
                                      className="inline-block w-3.5 shrink-0 text-center text-xs text-stone-400"
                                    >
                                      {isCollapsed ? "▸" : "▾"}
                                    </span>
                                    <span
                                      className={[
                                        "min-w-0 truncate text-xs font-semibold",
                                        group.recipeId
                                          ? "text-amber-900"
                                          : "tracking-wide text-stone-700 uppercase",
                                      ].join(" ")}
                                    >
                                      {group.label}
                                    </span>
                                  </button>
                                  <div className="flex shrink-0 items-center gap-1 pr-2">
                                    {group.recipeId && (
                                      <Link
                                        to={`/recipes/${group.recipeId}`}
                                        title={`Open ${group.label}`}
                                        aria-label={`Open ${group.label}`}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100"
                                      >
                                        ↗
                                      </Link>
                                    )}
                                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-stone-500">
                                      {group.items.length}
                                    </span>
                                  </div>
                                </div>
                                {!isCollapsed && (
                                  <ul className="divide-y divide-stone-100">
                                    {group.items.map((item) => (
                                      <ShoppingListItemRow
                                        key={item.id}
                                        item={item}
                                        aisles={availableAisles}
                                        showRecipeChips={group.showRecipeChips}
                                        showAisleChip
                                        pendingCheck={pendingCheckIds.has(
                                          item.id,
                                        )}
                                        fadingOut={fadingCheckIds.has(item.id)}
                                        menuOpen={openMenuItemId === item.id}
                                        onToggleMenu={() => {
                                          setListMenuOpen(false);
                                          setOpenMenuItemId((prev) =>
                                            prev === item.id ? null : item.id,
                                          );
                                        }}
                                        onCloseMenu={() =>
                                          setOpenMenuItemId(null)
                                        }
                                        onToggle={handleToggleItem}
                                        onDelete={handleDeleteItem}
                                        onChangeAisle={handleChangeAisle}
                                      />
                                    ))}
                                  </ul>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}

                    {checkedItems.length > 0 && (() => {
                      const checkedCollapsed = collapsedGroups.has("checked");
                      return (
                        <div className="border-t border-stone-100 pt-3">
                          <div className="mb-1.5 flex items-center justify-between gap-2 rounded-lg bg-stone-50">
                            <button
                              type="button"
                              onClick={() => toggleGroupCollapsed("checked")}
                              aria-expanded={!checkedCollapsed}
                              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-stone-100"
                            >
                              <span
                                aria-hidden="true"
                                className="inline-block w-3.5 shrink-0 text-center text-xs text-stone-400"
                              >
                                {checkedCollapsed ? "▸" : "▾"}
                              </span>
                              <span className="truncate text-xs font-medium tracking-wide text-stone-500 uppercase">
                                Checked off
                              </span>
                              <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-stone-400">
                                {checkedItems.length}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={handleClearChecked}
                              className="mr-1.5 min-h-[36px] shrink-0 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900"
                            >
                              Clear checked
                            </button>
                          </div>
                          {!checkedCollapsed && (
                            <ul className="divide-y divide-stone-100">
                              {checkedItems.map((item) => (
                                <ShoppingListItemRow
                                  key={item.id}
                                  item={item}
                                  aisles={availableAisles}
                                  showRecipeChips={false}
                                  menuOpen={openMenuItemId === item.id}
                                  onToggleMenu={() => {
                                    setListMenuOpen(false);
                                    setOpenMenuItemId((prev) =>
                                      prev === item.id ? null : item.id,
                                    );
                                  }}
                                  onCloseMenu={() => setOpenMenuItemId(null)}
                                  onToggle={handleToggleItem}
                                  onDelete={handleDeleteItem}
                                  onChangeAisle={handleChangeAisle}
                                />
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })()}
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
  showRecipeChips = true,
  showAisleChip = false,
  pendingCheck = false,
  fadingOut = false,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onToggle,
  onDelete,
  onChangeAisle,
}: {
  item: ShoppingListItem;
  aisles: string[];
  showRecipeChips?: boolean;
  showAisleChip?: boolean;
  pendingCheck?: boolean;
  fadingOut?: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onToggle: (item: ShoppingListItem) => void;
  onDelete: (item: ShoppingListItem) => void;
  onChangeAisle: (item: ShoppingListItem, aisle: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [openUpward, setOpenUpward] = useState(false);
  const amount = [item.quantity, item.unit].filter(Boolean).join(" ");
  const currentAisle = item.aisle || "Other";
  const isSettledChecked = item.checked && !pendingCheck;
  const isGrayed = pendingCheck || isSettledChecked;
  const recipeChips =
    item.recipes && item.recipes.length > 0
      ? item.recipes
      : item.recipe_id && item.recipe_title
        ? [{ id: item.recipe_id, title: item.recipe_title }]
        : [];

  useLayoutEffect(() => {
    if (!menuOpen || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const estimatedMenuHeight = item.checked ? 72 : 176;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setOpenUpward(spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow);
  }, [menuOpen, item.checked]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onCloseMenu();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseMenu();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen, onCloseMenu]);

  return (
    <li
      className={[
        "flex min-w-0 items-start justify-between gap-1 transition-all duration-500",
        menuOpen ? "relative z-20" : "",
        fadingOut
          ? "scale-[0.98] opacity-0"
          : pendingCheck
            ? "opacity-55"
            : "opacity-100",
      ].join(" ")}
    >
      <div className="min-w-0 flex-1">
        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 py-3 active:bg-stone-50">
          <input
            id={`shopping-item-${item.id}`}
            type="checkbox"
            checked={item.checked}
            onChange={() => onToggle(item)}
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-stone-300 accent-amber-600"
          />

          <span
            className={[
              "min-w-0 flex-1 text-[15px] leading-snug break-words transition-colors duration-300 sm:text-sm",
              isSettledChecked
                ? "text-stone-400 line-through"
                : pendingCheck
                  ? "text-stone-400"
                  : "text-stone-900",
            ].join(" ")}
          >
            {amount && (
              <span
                className={[
                  "mr-1.5 font-semibold transition-colors duration-300",
                  isGrayed ? "text-stone-400" : "text-amber-800",
                ].join(" ")}
              >
                {amount}
              </span>
            )}
            {item.name}
          </span>
        </label>

        {((showRecipeChips && recipeChips.length > 0) || showAisleChip) && (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 pb-3 pl-8">
            {showAisleChip && (
              <span
                className={[
                  "inline-block max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-medium",
                  isGrayed
                    ? "bg-stone-100 text-stone-400"
                    : "bg-stone-100 text-stone-600",
                ].join(" ")}
              >
                {currentAisle}
              </span>
            )}
            {showRecipeChips &&
              recipeChips.map((recipe) => (
                <Link
                  key={recipe.id}
                  to={`/recipes/${recipe.id}`}
                  title={recipe.title}
                  className={[
                    "block max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors sm:max-w-xs",
                    isGrayed
                      ? "bg-stone-100 text-stone-400 hover:bg-stone-200"
                      : "bg-amber-50 text-amber-800 hover:bg-amber-100",
                  ].join(" ")}
                >
                  {recipe.title}
                </Link>
              ))}
          </div>
        )}
      </div>

      <div className="relative shrink-0 pt-1" ref={menuRef}>
        <button
          type="button"
          onClick={onToggleMenu}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Actions for ${item.name}`}
          className="-mr-1.5 inline-flex h-10 w-10 items-center justify-center rounded-lg text-lg font-semibold text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 active:bg-stone-100"
        >
          ⋮
        </button>

        {menuOpen && (
          <div
            role="menu"
            className={[
              "absolute right-0 z-20 w-56 rounded-xl border border-stone-200 bg-white p-2 shadow-lg",
              openUpward ? "bottom-full mb-1" : "top-full mt-1",
            ].join(" ")}
          >
            {!item.checked && (
              <div className="border-b border-stone-100 pb-2">
                <label
                  htmlFor={`item-aisle-${item.id}`}
                  className="mb-1 block px-1 text-[11px] font-semibold tracking-wide text-stone-500 uppercase"
                >
                  Move to aisle
                </label>
                <select
                  id={`item-aisle-${item.id}`}
                  value={currentAisle}
                  onChange={(e) => {
                    onChangeAisle(item, e.target.value);
                    onCloseMenu();
                  }}
                  className="w-full cursor-pointer rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-base font-medium text-stone-800 focus:border-amber-500 focus:bg-white focus:outline-none sm:py-1.5 sm:text-xs"
                >
                  {aisles.map((aisle) => (
                    <option key={aisle} value={aisle}>
                      {aisle}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onCloseMenu();
                onDelete(item);
              }}
              className={[
                "block min-h-[40px] w-full rounded-lg px-2.5 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 sm:min-h-0 sm:py-2 sm:text-xs",
                !item.checked ? "mt-1" : "",
              ].join(" ")}
            >
              Remove item
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
