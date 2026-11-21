import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, createRecipe, importRecipePreview } from "../api/recipes";
import {
  formatHostname,
  isSafeHttpUrl,
  type ImportedRecipe,
  type IngredientInput,
  type Recipe,
} from "../types/recipe";
import ModalSheet from "./ModalSheet";

type Props = {
  initialPreview?: ImportedRecipe | null;
  initialUrl?: string;
  autoFetch?: boolean;
  onClose: () => void;
  onSaved: (recipe: Recipe) => void;
};

type Step = "source" | "preview";
type SourceMode = "url" | "html" | "bookmarklet";
type EditableIngredient = IngredientInput & { raw?: string };

function buildBookmarkletCode(origin: string): string {
  const cleanOrigin = origin.trim().replace(/\/+$/, "");
  const endpoint = `${cleanOrigin}/api/recipes/bookmarklet`;
  return (
    "javascript:(function(){" +
    "var f=document.createElement('form');" +
    "f.method='POST';" +
    `f.action=${JSON.stringify(endpoint)};` +
    "f.target='_blank';" +
    "f.style.display='none';" +
    "var u=document.createElement('input');" +
    "u.type='hidden';u.name='url';u.value=location.href;" +
    "var h=document.createElement('textarea');" +
    "h.name='html';h.value=document.documentElement.outerHTML;" +
    "f.appendChild(u);f.appendChild(h);" +
    "document.body.appendChild(f);f.submit();f.remove();" +
    "})();"
  );
}

export default function ImportRecipeModal({
  initialPreview,
  initialUrl,
  autoFetch = false,
  onClose,
  onSaved,
}: Props) {
  const [step, setStep] = useState<Step>(initialPreview ? "preview" : "source");
  const [sourceMode, setSourceMode] = useState<SourceMode>("url");
  const [urlInput, setUrlInput] = useState(
    initialPreview?.source_url || initialUrl || "",
  );
  const autoFetchedRef = useRef(false);
  const [htmlInput, setHtmlInput] = useState("");
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasBlocked, setWasBlocked] = useState(false);

  // Bookmarklet helper state
  const [bookmarkletOrigin, setBookmarkletOrigin] = useState(
    () => window.location.origin,
  );
  const [copiedBookmarklet, setCopiedBookmarklet] = useState(false);
  const bookmarkletLinkRef = useRef<HTMLAnchorElement | null>(null);

  // Preview editable state
  const [title, setTitle] = useState(initialPreview?.title || "");
  const [description, setDescription] = useState(
    initialPreview?.description || "",
  );
  const [instructions, setInstructions] = useState(
    initialPreview?.instructions || "",
  );
  const [servings, setServings] = useState(
    initialPreview && initialPreview.servings > 0 ? initialPreview.servings : 1,
  );
  const [prepMinutes, setPrepMinutes] = useState(
    initialPreview && initialPreview.prep_minutes >= 0
      ? initialPreview.prep_minutes
      : 0,
  );
  const [cookMinutes, setCookMinutes] = useState(
    initialPreview && initialPreview.cook_minutes >= 0
      ? initialPreview.cook_minutes
      : 0,
  );
  const [sourceUrl, setSourceUrl] = useState(initialPreview?.source_url || "");
  const [selectedImage, setSelectedImage] = useState(
    initialPreview?.image_url ||
      (initialPreview?.candidate_images &&
        initialPreview.candidate_images[0]) ||
      "",
  );
  const [candidateImages, setCandidateImages] = useState<string[]>(
    initialPreview?.candidate_images || [],
  );
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [ingredients, setIngredients] = useState<EditableIngredient[]>(() =>
    initialPreview?.ingredients && initialPreview.ingredients.length > 0
      ? initialPreview.ingredients.map((i) => ({
          raw: i.raw,
          quantity: i.quantity,
          unit: i.unit,
          name: i.name,
          preparation: i.preparation || "",
        }))
      : [],
  );

  const [isFinePointer] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: fine)").matches,
  );

  const bookmarkletCode = buildBookmarkletCode(bookmarkletOrigin);

  useEffect(() => {
    const el = bookmarkletLinkRef.current;
    if (el) {
      el.setAttribute("href", bookmarkletCode);
    }
  }, [bookmarkletCode, sourceMode, step]);

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
            raw: i.raw,
            quantity: i.quantity,
            unit: i.unit,
            name: i.name,
            preparation: i.preparation || "",
          }))
        : [{ quantity: "", unit: "", name: "", preparation: "" }],
    );
    setStep("preview");
  };

  const fetchRecipePreview = async (targetUrl: string, html?: string) => {
    setError(null);
    setWasBlocked(false);
    setFetching(true);
    try {
      const preview = await importRecipePreview(targetUrl, html);
      applyPreview(preview);
    } catch (err: unknown) {
      setWasBlocked(err instanceof ApiError && err.blocked);
      setError(
        err instanceof Error ? err.message : "Failed to fetch recipe preview.",
      );
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (!autoFetch || initialPreview || !initialUrl?.trim()) return;
    if (autoFetchedRef.current) return;
    autoFetchedRef.current = true;
    void fetchRecipePreview(initialUrl.trim());
    // Trigger once on mount when opened from Android Web Share Target
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFetch = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedUrl = urlInput.trim();
    if (!trimmedUrl) {
      setError("Please enter a recipe URL.");
      return;
    }
    if (sourceMode === "html" && !htmlInput.trim()) {
      setError("Please paste the recipe page HTML.");
      return;
    }

    await fetchRecipePreview(
      trimmedUrl,
      sourceMode === "html" ? htmlInput : undefined,
    );
  };

  const handleCopyBookmarklet = async () => {
    try {
      await navigator.clipboard.writeText(bookmarkletCode);
      setCopiedBookmarklet(true);
      setTimeout(() => setCopiedBookmarklet(false), 2000);
    } catch {
      setError("Could not copy to clipboard. Drag the Save to Kiln button to your bookmarks bar instead.");
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
            preparation: (ing.preparation || "").trim(),
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
    setIngredients((prev) => [
      ...prev,
      { quantity: "", unit: "", name: "", preparation: "" },
    ]);
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

  const tabClass = (mode: SourceMode) =>
    [
      "min-h-[40px] flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:flex-initial sm:min-h-[36px]",
      sourceMode === mode
        ? "bg-amber-100 text-amber-900"
        : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
    ].join(" ");

  const modalTitle =
    step === "source" ? "Import Recipe" : "Preview & Confirm Recipe";
  const modalSubtitle =
    step === "source"
      ? "Import by URL, paste HTML for sites that block bots, or use the browser bookmarklet."
      : "Pick a photo and review the extracted details before saving.";

  const formSubmit =
    step === "preview"
      ? handleSave
      : sourceMode === "bookmarklet"
        ? undefined
        : handleFetch;

  const modalFooter =
    step === "source" ? (
      sourceMode === "bookmarklet" ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] w-full rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 sm:w-auto"
          >
            Done
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={fetching}
            className="min-h-[40px] flex-1 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 sm:flex-initial"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={fetching}
            className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-700 disabled:opacity-60 sm:flex-initial"
          >
            {fetching ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                {sourceMode === "html" ? "Parsing HTML…" : "Fetching recipe…"}
              </>
            ) : sourceMode === "html" ? (
              "Parse HTML Preview"
            ) : (
              "Fetch Preview"
            )}
          </button>
        </div>
      )
    ) : (
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setStep("source");
          }}
          disabled={saving}
          className="inline-flex min-h-[40px] items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 disabled:opacity-50 sm:justify-start sm:px-2"
        >
          ← Change Source
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-[40px] flex-1 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 sm:flex-initial"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-700 disabled:opacity-60 sm:flex-initial"
          >
            {saving ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                {selectedImage ? "Saving & caching photo…" : "Saving recipe…"}
              </>
            ) : (
              "Save Recipe"
            )}
          </button>
        </div>
      </div>
    );

  return (
    <ModalSheet
      onClose={onClose}
      title={modalTitle}
      subtitle={modalSubtitle}
      footer={modalFooter}
      maxWidthClass="sm:max-w-3xl"
      closeDisabled={fetching || saving}
      onSubmit={formSubmit}
    >
      {step === "source" ? (
        <div className="space-y-4">
          {/* Mode Tabs */}
          <div className="flex items-center gap-1 border-b border-stone-200 pb-3">
            <button
              type="button"
              onClick={() => {
                setSourceMode("url");
                setError(null);
                setWasBlocked(false);
              }}
              className={tabClass("url")}
            >
              From URL
            </button>
            <button
              type="button"
              onClick={() => {
                setSourceMode("html");
                setError(null);
                setWasBlocked(false);
              }}
              className={tabClass("html")}
            >
              Paste HTML
            </button>
            <button
              type="button"
              onClick={() => {
                setSourceMode("bookmarklet");
                setError(null);
                setWasBlocked(false);
              }}
              className={tabClass("bookmarklet")}
            >
              Bookmarklet
            </button>
          </div>

          {sourceMode === "bookmarklet" ? (
            <div className="space-y-4">
              <p className="text-sm text-stone-600">
                Drag the button below onto your browser&apos;s bookmarks bar.
                Whenever you&apos;re viewing any recipe (including sites behind
                Cloudflare or a login), click{" "}
                <strong className="text-stone-900">Save to Kiln</strong> to send
                the page straight to this preview window.
              </p>

              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                <a
                  ref={bookmarkletLinkRef}
                  href="#save-to-kiln"
                  onClick={(e) => e.preventDefault()}
                  draggable
                  className="inline-flex min-h-[40px] cursor-grab items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-amber-700 active:cursor-grabbing"
                  title="Drag this button to your bookmarks bar"
                >
                  Save to Kiln
                </a>
                <button
                  type="button"
                  onClick={() => void handleCopyBookmarklet()}
                  className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50"
                >
                  {copiedBookmarklet ? "Copied!" : "Copy Bookmarklet URL"}
                </button>
              </div>

              <div>
                <label
                  htmlFor="bookmarklet-origin"
                  className="block text-xs font-medium text-stone-600"
                >
                  Kiln Server Address (used by the bookmarklet)
                </label>
                <input
                  id="bookmarklet-origin"
                  type="url"
                  value={bookmarkletOrigin}
                  onChange={(e) => setBookmarkletOrigin(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-base text-stone-900 focus:border-amber-500 focus:outline-none sm:py-1.5 sm:text-sm"
                />
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
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
                  autoFocus={isFinePointer}
                  placeholder="https://www.seriouseats.com/perfect-pot-roast-recipe-pioneer-woman"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  disabled={fetching}
                  className="mt-1.5 w-full rounded-lg border border-stone-300 px-3.5 py-2.5 text-base text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none disabled:bg-stone-50 sm:text-sm"
                />
              </div>

              {sourceMode === "html" && (
                <div>
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                    <label
                      htmlFor="recipe-html"
                      className="block text-sm font-medium text-stone-700"
                    >
                      Page HTML
                    </label>
                    <span className="text-xs text-stone-500">
                      In your browser: View Source (Ctrl+U / ⌘⌥U) → Select All →
                      Copy
                    </span>
                  </div>
                  <textarea
                    id="recipe-html"
                    required
                    rows={6}
                    placeholder="<!doctype html>..."
                    value={htmlInput}
                    onChange={(e) => setHtmlInput(e.target.value)}
                    disabled={fetching}
                    className="mt-1.5 w-full rounded-lg border border-stone-300 px-3.5 py-2 font-mono text-base text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none disabled:bg-stone-50 sm:text-xs"
                  />
                </div>
              )}

              {error && (
                <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                  <p>{error}</p>
                  {wasBlocked && sourceMode === "url" && (
                    <div className="flex flex-wrap gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setSourceMode("html");
                          setError(null);
                          setWasBlocked(false);
                        }}
                        className="min-h-[36px] rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800"
                      >
                        Switch to Paste HTML →
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSourceMode("bookmarklet");
                          setError(null);
                          setWasBlocked(false);
                        }}
                        className="min-h-[36px] rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
                      >
                        Use Bookmarklet →
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
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
                className="shrink-0 py-1 font-medium text-amber-700 hover:text-amber-800 hover:underline"
              >
                Open Original ↗
              </a>
            </div>
          )}

          {/* Photo Picker */}
          <div className="space-y-3">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
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
                  className="h-44 w-full object-cover sm:h-52"
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
                  {visibleCandidates.length === 1 ? "" : "s"} found on the page:
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
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-base text-stone-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none sm:text-sm"
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
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-base text-stone-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none sm:text-sm"
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
                inputMode="numeric"
                min={1}
                value={servings}
                onChange={(e) =>
                  setServings(Math.max(1, Number(e.target.value) || 1))
                }
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-base text-stone-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none sm:py-1.5 sm:text-sm"
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
                inputMode="numeric"
                min={0}
                value={prepMinutes}
                onChange={(e) =>
                  setPrepMinutes(Math.max(0, Number(e.target.value) || 0))
                }
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-base text-stone-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none sm:py-1.5 sm:text-sm"
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
                inputMode="numeric"
                min={0}
                value={cookMinutes}
                onChange={(e) =>
                  setCookMinutes(Math.max(0, Number(e.target.value) || 0))
                }
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-base text-stone-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none sm:py-1.5 sm:text-sm"
              />
            </div>
          </div>

          {/* Ingredients */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium text-stone-800">
                Ingredients ({ingredients.filter((i) => i.name.trim()).length})
              </label>
              <button
                type="button"
                onClick={addIngredient}
                className="min-h-[36px] rounded-lg px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 hover:text-amber-800"
              >
                + Add ingredient
              </button>
            </div>

            <div className="space-y-2.5 sm:space-y-2">
              {ingredients.map((ing, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[5rem_1fr_2.5rem] items-center gap-2 rounded-xl border border-stone-200 bg-stone-50/50 p-2.5 sm:flex sm:flex-nowrap sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0"
                  title={ing.raw ? `Original: ${ing.raw}` : undefined}
                >
                  <input
                    type="text"
                    placeholder="Qty"
                    aria-label="Quantity"
                    value={ing.quantity}
                    onChange={(e) =>
                      updateIngredient(idx, "quantity", e.target.value)
                    }
                    className="order-3 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-base text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none sm:order-1 sm:w-16 sm:py-1.5 sm:text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Unit"
                    aria-label="Unit"
                    value={ing.unit}
                    onChange={(e) =>
                      updateIngredient(idx, "unit", e.target.value)
                    }
                    className="order-4 col-span-2 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-base text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none sm:order-2 sm:w-28 sm:py-1.5 sm:text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Ingredient"
                    aria-label="Ingredient name"
                    value={ing.name}
                    onChange={(e) =>
                      updateIngredient(idx, "name", e.target.value)
                    }
                    className="order-1 col-span-2 min-w-0 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-base text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:outline-none sm:order-3 sm:flex-1 sm:py-1.5 sm:text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Prep / notes"
                    aria-label="Preparation notes"
                    value={ing.preparation || ""}
                    onChange={(e) =>
                      updateIngredient(idx, "preparation", e.target.value)
                    }
                    className="order-5 col-span-3 w-full rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-base text-stone-700 placeholder:text-stone-400 focus:border-amber-500 focus:bg-white focus:outline-none sm:order-4 sm:w-44 sm:bg-stone-50/70 sm:py-1.5 sm:text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => removeIngredient(idx)}
                    className="order-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-red-600 sm:order-5 sm:h-8 sm:w-8"
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
              className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-base leading-relaxed text-stone-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none sm:text-sm"
            />
          </div>
        </div>
      )}
    </ModalSheet>
  );
}
