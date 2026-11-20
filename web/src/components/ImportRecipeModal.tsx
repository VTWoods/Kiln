import { useEffect, useState, type FormEvent } from "react";
import { createRecipe, importRecipePreview } from "../api/recipes";
import {
  formatHostname,
  isSafeHttpUrl,
  type ImportedRecipe,
  type IngredientInput,
  type Recipe,
} from "../types/recipe";

type Props = {
  onClose: () => void;
  onSaved: (recipe: Recipe) => void;
};

type Step = "url" | "preview";

export default function ImportRecipeModal({ onClose, onSaved }: Props) {
  const [step, setStep] = useState<Step>("url");
  const [urlInput, setUrlInput] = useState("");
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview editable state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [servings, setServings] = useState(1);
  const [prepMinutes, setPrepMinutes] = useState(0);
  const [cookMinutes, setCookMinutes] = useState(0);
  const [sourceUrl, setSourceUrl] = useState("");
  const [selectedImage, setSelectedImage] = useState("");
  const [candidateImages, setCandidateImages] = useState<string[]>([]);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [ingredients, setIngredients] = useState<IngredientInput[]>([]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !fetching && !saving) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fetching, saving, onClose]);

  const applyPreview = (preview: ImportedRecipe) => {
    setTitle(preview.title || "");
    setDescription(preview.description || "");
    setInstructions(preview.instructions || "");
    setServings(preview.servings > 0 ? preview.servings : 1);
    setPrepMinutes(preview.prep_minutes >= 0 ? preview.prep_minutes : 0);
    setCookMinutes(preview.cook_minutes >= 0 ? preview.cook_minutes : 0);
    setSourceUrl(preview.source_url || urlInput.trim());
    setCandidateImages(preview.candidate_images || []);
    setSelectedImage(
      preview.image_url ||
        (preview.candidate_images && preview.candidate_images[0]) ||
        "",
    );
    setFailedImages({});
    setIngredients(
      preview.ingredients && preview.ingredients.length > 0
        ? preview.ingredients.map((i) => ({
            quantity: i.quantity,
            unit: i.unit,
            name: i.name,
          }))
        : [{ quantity: "", unit: "", name: "" }],
    );
    setStep("preview");
  };

  const handleFetch = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setError("Please enter a recipe URL.");
      return;
    }

    setError(null);
    setFetching(true);
    try {
      const preview = await importRecipePreview(trimmed);
      applyPreview(preview);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch recipe preview.",
      );
    } finally {
      setFetching(false);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Recipe title is required.");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const saved = await createRecipe({
        title: title.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
        servings: servings > 0 ? servings : 1,
        prep_minutes: Math.max(0, prepMinutes),
        cook_minutes: Math.max(0, cookMinutes),
        source_url: sourceUrl.trim(),
        image_url: selectedImage.trim(),
        ingredients: ingredients
          .map((ing) => ({
            quantity: ing.quantity.trim(),
            unit: ing.unit.trim(),
            name: ing.name.trim(),
          }))
          .filter((ing) => ing.name !== ""),
      });
      onSaved(saved);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save recipe.");
    } finally {
      setSaving(false);
    }
  };

  const updateIngredient = (
    idx: number,
    field: keyof IngredientInput,
    value: string,
  ) => {
    setIngredients((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)),
    );
  };

  const removeIngredient = (idx: number) => {
    setIngredients((prev) => prev.filter((_, i) => i !== idx));
  };

  const addIngredient = () => {
    setIngredients((prev) => [...prev, { quantity: "", unit: "", name: "" }]);
  };

  const markImageFailed = (imgUrl: string) => {
    setFailedImages((prev) => ({ ...prev, [imgUrl]: true }));
    setSelectedImage((current) => {
      if (current !== imgUrl) return current;
      const fallback = candidateImages.find(
        (candidate) => candidate !== imgUrl && !failedImages[candidate],
      );
      return fallback ?? "";
    });
  };

  const visibleCandidates = candidateImages.filter((u) => !failedImages[u]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-stone-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
          <div>
            <h2
              id="import-modal-title"
              className="text-lg font-semibold text-stone-900"
            >
              {step === "url"
                ? "Import Recipe from URL"
                : "Preview & Confirm Recipe"}
            </h2>
            <p className="text-xs text-stone-500">
              {step === "url"
                ? "Paste a recipe link to extract ingredients, instructions, and photos."
                : "Pick a photo and review the extracted details before saving."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={fetching || saving}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-50"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        {step === "url" ? (
          <form onSubmit={handleFetch} className="space-y-4 p-6">
            <div>
              <label
                htmlFor="recipe-url"
                className="block text-sm font-medium text-stone-700"
              >
                Recipe URL
              </label>
              <input
                id="recipe-url"
                type="url"
                required
                autoFocus
                placeholder="https://www.example.com/recipes/roasted-tomato-soup"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                disabled={fetching}
                className="mt-1.5 w-full rounded-lg border border-stone-300 px-3.5 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none disabled:bg-stone-50"
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={fetching}
                className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={fetching}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-700 disabled:opacity-60"
              >
                {fetching ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Fetching recipe…
                  </>
                ) : (
                  "Fetch Preview"
                )}
              </button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={handleSave}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex-1 space-y-6 overflow-y-auto p-6">
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                  {error}
                </div>
              )}

              {/* Source URL */}
              {sourceUrl && isSafeHttpUrl(sourceUrl) && (
                <div className="flex items-center justify-between gap-3 rounded-lg bg-stone-50 px-3.5 py-2 text-xs text-stone-600 ring-1 ring-stone-200">
                  <span className="truncate">
                    Source:{" "}
                    <span className="font-medium text-stone-800">
                      {formatHostname(sourceUrl)}
                    </span>
                  </span>
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 font-medium text-amber-700 hover:text-amber-800 hover:underline"
                  >
                    Open Original ↗
                  </a>
                </div>
              )}

              {/* Photo Picker */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-stone-800">
                    Recipe Photo
                  </label>
                  <span className="text-xs text-stone-500">
                    Selected photo will be saved locally
                  </span>
                </div>

                {selectedImage ? (
                  <div className="overflow-hidden rounded-xl border border-stone-200 bg-stone-100">
                    <img
                      src={selectedImage}
                      alt={title || "Selected recipe preview"}
                      referrerPolicy="no-referrer"
                      onError={() => markImageFailed(selectedImage)}
                      className="h-52 w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-stone-300 bg-stone-50 text-sm text-stone-500">
                    No photo selected
                  </div>
                )}

                {visibleCandidates.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-stone-600">
                      Choose from {visibleCandidates.length} image
                      {visibleCandidates.length === 1 ? "" : "s"} found on the
                      page:
                    </p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {visibleCandidates.map((imgUrl) => {
                        const active = selectedImage === imgUrl;
                        return (
                          <button
                            key={imgUrl}
                            type="button"
                            onClick={() => setSelectedImage(imgUrl)}
                            className={[
                              "relative h-16 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-all",
                              active
                                ? "border-amber-600 ring-2 ring-amber-200"
                                : "border-stone-200 opacity-80 hover:opacity-100",
                            ].join(" ")}
                            title="Use this photo"
                          >
                            <img
                              src={imgUrl}
                              alt="Candidate recipe photo"
                              referrerPolicy="no-referrer"
                              onError={() => markImageFailed(imgUrl)}
                              className="h-full w-full object-cover"
                            />
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setSelectedImage("")}
                        className={[
                          "flex h-16 w-20 shrink-0 items-center justify-center rounded-lg border-2 text-xs font-medium transition-all",
                          selectedImage === ""
                            ? "border-amber-600 bg-amber-50 text-amber-900"
                            : "border-dashed border-stone-300 text-stone-500 hover:bg-stone-50",
                        ].join(" ")}
                      >
                        No photo
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Title & Description */}
              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="preview-title"
                    className="block text-sm font-medium text-stone-700"
                  >
                    Title
                  </label>
                  <input
                    id="preview-title"
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="preview-description"
                    className="block text-sm font-medium text-stone-700"
                  >
                    Description
                  </label>
                  <textarea
                    id="preview-description"
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none"
                  />
                </div>
              </div>

              {/* Servings & Times */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="preview-servings"
                    className="block text-xs font-medium text-stone-700"
                  >
                    Servings
                  </label>
                  <input
                    id="preview-servings"
                    type="number"
                    min={1}
                    value={servings}
                    onChange={(e) =>
                      setServings(Math.max(1, Number(e.target.value) || 1))
                    }
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="preview-prep"
                    className="block text-xs font-medium text-stone-700"
                  >
                    Prep (min)
                  </label>
                  <input
                    id="preview-prep"
                    type="number"
                    min={0}
                    value={prepMinutes}
                    onChange={(e) =>
                      setPrepMinutes(Math.max(0, Number(e.target.value) || 0))
                    }
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="preview-cook"
                    className="block text-xs font-medium text-stone-700"
                  >
                    Cook (min)
                  </label>
                  <input
                    id="preview-cook"
                    type="number"
                    min={0}
                    value={cookMinutes}
                    onChange={(e) =>
                      setCookMinutes(Math.max(0, Number(e.target.value) || 0))
                    }
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none"
                  />
                </div>
              </div>

              {/* Ingredients */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-stone-800">
                    Ingredients ({ingredients.filter((i) => i.name.trim()).length})
                  </label>
                  <button
                    type="button"
                    onClick={addIngredient}
                    className="text-xs font-medium text-amber-700 hover:text-amber-800"
                  >
                    + Add ingredient
                  </button>
                </div>

                <div className="space-y-2">
                  {ingredients.map((ing, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Qty"
                        value={ing.quantity}
                        onChange={(e) =>
                          updateIngredient(idx, "quantity", e.target.value)
                        }
                        className="w-20 rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none"
                      />
                      <input
                        type="text"
                        placeholder="Unit"
                        value={ing.unit}
                        onChange={(e) =>
                          updateIngredient(idx, "unit", e.target.value)
                        }
                        className="w-24 rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none"
                      />
                      <input
                        type="text"
                        placeholder="Ingredient name"
                        value={ing.name}
                        onChange={(e) =>
                          updateIngredient(idx, "name", e.target.value)
                        }
                        className="min-w-0 flex-1 rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => removeIngredient(idx)}
                        className="rounded-md px-2 py-1 text-stone-400 hover:bg-stone-100 hover:text-red-600"
                        aria-label="Remove ingredient"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Instructions */}
              <div>
                <label
                  htmlFor="preview-instructions"
                  className="block text-sm font-medium text-stone-700"
                >
                  Instructions
                </label>
                <textarea
                  id="preview-instructions"
                  rows={6}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm leading-relaxed text-stone-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-stone-200 bg-stone-50 px-6 py-3.5">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep("url");
                }}
                disabled={saving}
                className="text-sm font-medium text-stone-600 hover:text-stone-900 disabled:opacity-50"
              >
                ← Change URL
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-700 disabled:opacity-60"
                >
                  {saving ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      {selectedImage
                        ? "Saving & caching photo…"
                        : "Saving recipe…"}
                    </>
                  ) : (
                    "Save Recipe"
                  )}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
