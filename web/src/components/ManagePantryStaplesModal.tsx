import { useEffect, useState, type FormEvent } from "react";
import {
  addPantryStaple,
  deletePantryStaple,
  listPantryStaples,
  type PantryStaple,
} from "../api/pantryStaples";

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
    try {
      await deletePantryStaple(staple.id);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to remove pantry staple.",
      );
      listPantryStaples()
        .then(setStaples)
        .catch(() => {});
    }
  };

  const query = filter.trim().toLowerCase();
  const visibleStaples = query
    ? staples.filter((s) => s.name.toLowerCase().includes(query))
    : staples;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pantry-staples-title"
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-stone-200">
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-6 py-4">
          <div>
            <h2
              id="pantry-staples-title"
              className="text-lg font-semibold text-stone-900"
            >
              Pantry Staples ({staples.length})
            </h2>
            <p className="mt-0.5 text-xs text-stone-500">
              Items you normally keep on hand. They appear first and unchecked
              when adding a recipe to a shopping list.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 border-b border-stone-100 px-6 py-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleAdd} className="flex gap-2">
            <input
              type="text"
              placeholder="Add staple (e.g., butter, garlic, eggs)…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={adding}
              className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none"
            />
            <button
              type="submit"
              disabled={adding || !newName.trim()}
              className="rounded-lg bg-amber-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {adding ? "Adding…" : "Add"}
            </button>
          </form>

          <input
            type="search"
            placeholder="Filter staples…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs text-stone-800 placeholder:text-stone-400 focus:border-amber-400 focus:bg-white focus:outline-none"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
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
                  className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 py-1 pr-1.5 pl-3 text-xs font-medium text-stone-700"
                >
                  {staple.name}
                  <button
                    type="button"
                    onClick={() => handleRemove(staple)}
                    className="rounded-full p-0.5 text-stone-400 hover:bg-stone-200 hover:text-red-600"
                    aria-label={`Remove ${staple.name} from staples`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-stone-200 bg-stone-50 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-stone-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-stone-800"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
