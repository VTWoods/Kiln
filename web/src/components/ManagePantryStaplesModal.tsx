import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  addPantryStaple,
  deletePantryStaple,
  listPantryStaples,
  type PantryStaple,
} from "../api/pantryStaples";
import ModalSheet from "./ModalSheet";

type Props = {
  onClose: () => void;
};

export default function ManagePantryStaplesModal({ onClose }: Props) {
  const [staples, setStaples] = useState<PantryStaple[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("");
  const [removedStaple, setRemovedStaple] = useState<PantryStaple | null>(null);
  const [undoing, setUndoing] = useState(false);

  const undoTimerRef = useRef<number | null>(null);
  const pendingDeleteRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listPantryStaples()
      .then((data) => {
        if (active) setStaples(data);
      })
      .catch((err: unknown) => {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Failed to load pantry staples.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const clearUndoBanner = () => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setRemovedStaple(null);
  };

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;

    setAdding(true);
    setError(null);
    try {
      const created = await addPantryStaple(trimmed);
      setStaples((prev) => {
        if (prev.some((s) => s.id === created.id)) return prev;
        return [...prev, created].sort((a, b) => a.name.localeCompare(b.name));
      });
      setNewName("");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to add pantry staple.",
      );
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (staple: PantryStaple) => {
    setError(null);
    setStaples((prev) => prev.filter((s) => s.id !== staple.id));

    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    setRemovedStaple(staple);
    undoTimerRef.current = window.setTimeout(() => {
      setRemovedStaple(null);
      undoTimerRef.current = null;
    }, 6000);

    const deletePromise = deletePantryStaple(staple.id)
      .then(() => undefined)
      .catch((err: unknown) => {
        clearUndoBanner();
        setError(
          err instanceof Error
            ? err.message
            : "Failed to remove pantry staple.",
        );
        listPantryStaples()
          .then(setStaples)
          .catch(() => {});
      });

    pendingDeleteRef.current = deletePromise;
    await deletePromise;
    if (pendingDeleteRef.current === deletePromise) {
      pendingDeleteRef.current = null;
    }
  };

  const handleUndoRemove = async () => {
    const target = removedStaple;
    if (!target || undoing) return;

    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndoing(true);
    setError(null);
    try {
      if (pendingDeleteRef.current) {
        await pendingDeleteRef.current;
      }
      const restored = await addPantryStaple(target.name);
      setStaples((prev) => {
        if (prev.some((s) => s.id === restored.id)) return prev;
        return [...prev, restored].sort((a, b) => a.name.localeCompare(b.name));
      });
      setRemovedStaple(null);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to restore pantry staple.",
      );
    } finally {
      setUndoing(false);
    }
  };

  const query = filter.trim().toLowerCase();
  const visibleStaples = query
    ? staples.filter((s) => s.name.toLowerCase().includes(query))
    : staples;

  const footer = (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onClose}
        className="min-h-[40px] w-full rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 sm:w-auto"
      >
        Done
      </button>
    </div>
  );

  return (
    <ModalSheet
      onClose={onClose}
      title={`Pantry Staples (${staples.length})`}
      subtitle={
        <>
          <span className="sm:hidden">
            Unchecked by default when adding recipes to lists.
          </span>
          <span className="hidden sm:inline">
            Items you normally keep on hand. They appear first and unchecked
            when adding a recipe to a shopping list.
          </span>
        </>
      }
      footer={footer}
      maxWidthClass="sm:max-w-lg"
    >
      <div className="space-y-3.5">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleAdd} className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Add staple (e.g., butter, garlic)…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={adding}
            className="min-h-[42px] min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-base text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none sm:min-h-[38px] sm:py-1.5 sm:text-sm"
          />
          <button
            type="submit"
            disabled={adding || !newName.trim()}
            className="min-h-[42px] shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 sm:min-h-[38px] sm:py-1.5"
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </form>

        <input
          type="search"
          placeholder="Filter staples…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="min-h-[40px] w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-base text-stone-800 placeholder:text-stone-400 focus:border-amber-400 focus:bg-white focus:outline-none sm:min-h-[34px] sm:py-1.5 sm:text-xs"
        />

        {removedStaple && (
          <div
            role="status"
            className="flex items-center justify-between gap-2 rounded-lg bg-stone-900 px-3.5 py-2 text-xs text-white"
          >
            <span className="min-w-0 truncate">
              Removed{" "}
              <strong className="font-semibold">{removedStaple.name}</strong>
            </span>
            <button
              type="button"
              onClick={() => void handleUndoRemove()}
              disabled={undoing}
              className="min-h-[32px] shrink-0 rounded-md bg-amber-500 px-3 py-1 text-xs font-semibold text-stone-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {undoing ? "Restoring…" : "Undo"}
            </button>
          </div>
        )}

        <div className="pt-0.5">
          {loading ? (
            <div className="h-32 animate-pulse rounded-xl bg-stone-100" />
          ) : visibleStaples.length === 0 ? (
            <p className="py-8 text-center text-sm text-stone-500">
              {query
                ? `No staples matching "${filter}".`
                : "No pantry staples saved yet."}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {visibleStaples.map((staple) => (
                <span
                  key={staple.id}
                  className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-50 py-0.5 pr-1 pl-3.5 text-sm font-medium text-stone-700 sm:text-xs"
                >
                  <span>{staple.name}</span>
                  <button
                    type="button"
                    onClick={() => void handleRemove(staple)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-stone-200 hover:text-red-600 active:bg-stone-200"
                    aria-label={`Remove ${staple.name} from staples`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </ModalSheet>
  );
}
