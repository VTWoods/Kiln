import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  ApiError,
  createRecipe,
  importRecipeFromPhotos,
  importRecipePreview,
  parseIngredientLines,
  rotateImage,
  updateRecipe,
  uploadRecipeImage,
} from "../api/recipes";
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
  initialStep?: "source" | "manual";
  editingRecipe?: Recipe | null;
  onClose: () => void;
  onSaved: (recipe: Recipe) => void;
};

type Step = "source" | "preview";
type SourceMode = "url" | "photo" | "html" | "bookmarklet";
type EditableIngredient = IngredientInput & { raw?: string };
type QueuedPhoto = { id: string; file: File; previewUrl: string };

const MAX_IMPORT_PHOTOS = 3;

const EMPTY_INGREDIENT: EditableIngredient = {
  quantity: "",
  unit: "",
  name: "",
  preparation: "",
};

function isBlankIngredient(ing: EditableIngredient): boolean {
  return (
    !ing.quantity.trim() &&
    !ing.unit.trim() &&
    !ing.name.trim() &&
    !(ing.preparation || "").trim()
  );
}

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
  initialStep = "source",
  editingRecipe = null,
  onClose,
  onSaved,
}: Props) {
  const isEditing = Boolean(editingRecipe);
  const [step, setStep] = useState<Step>(
    editingRecipe || initialPreview || initialStep === "manual"
      ? "preview"
      : "source",
  );
  const [isManual, setIsManual] = useState<boolean>(
    !editingRecipe && !initialPreview && initialStep === "manual",
  );
  const [sourceMode, setSourceMode] = useState<SourceMode>("url");
  const [urlInput, setUrlInput] = useState(
    editingRecipe?.source_url || initialPreview?.source_url || initialUrl || "",
  );
  const autoFetchedRef = useRef(false);
  const [htmlInput, setHtmlInput] = useState("");
  const [queuedPhotos, setQueuedPhotos] = useState<QueuedPhoto[]>([]);
  const [photoHint, setPhotoHint] = useState("");
  const [extractedMeta, setExtractedMeta] = useState<{
    modelUsed: string;
    fellBack: boolean;
  } | null>(null);
  const queuedPhotosRef = useRef<QueuedPhoto[]>([]);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showPasteIngredients, setShowPasteIngredients] = useState(false);
  const [pasteIngredientsText, setPasteIngredientsText] = useState("");
  const [parsingIngredients, setParsingIngredients] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasBlocked, setWasBlocked] = useState(false);

  // Bookmarklet helper state
  const [bookmarkletOrigin, setBookmarkletOrigin] = useState(
    () => window.location.origin,
  );
  const [copiedBookmarklet, setCopiedBookmarklet] = useState(false);
  const bookmarkletLinkRef = useRef<HTMLAnchorElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  // Preview / Manual / Edit state
  const [title, setTitle] = useState(
    editingRecipe?.title || initialPreview?.title || "",
  );
  const [description, setDescription] = useState(
    editingRecipe?.description || initialPreview?.description || "",
  );
  const [instructions, setInstructions] = useState(
    editingRecipe?.instructions || initialPreview?.instructions || "",
  );
  const [servings, setServings] = useState(() => {
    if (editingRecipe && editingRecipe.servings > 0) {
      return editingRecipe.servings;
    }
    if (initialPreview && initialPreview.servings > 0) {
      return initialPreview.servings;
    }
    return 1;
  });
  const [prepMinutes, setPrepMinutes] = useState(() => {
    if (editingRecipe && editingRecipe.prep_minutes >= 0) {
      return editingRecipe.prep_minutes;
    }
    if (initialPreview && initialPreview.prep_minutes >= 0) {
      return initialPreview.prep_minutes;
    }
    return 0;
  });
  const [cookMinutes, setCookMinutes] = useState(() => {
    if (editingRecipe && editingRecipe.cook_minutes >= 0) {
      return editingRecipe.cook_minutes;
    }
    if (initialPreview && initialPreview.cook_minutes >= 0) {
      return initialPreview.cook_minutes;
    }
    return 0;
  });
  const [sourceUrl, setSourceUrl] = useState(
    editingRecipe?.source_url || initialPreview?.source_url || "",
  );
  const [selectedImage, setSelectedImage] = useState(
    editingRecipe?.image_url ||
      initialPreview?.image_url ||
      (initialPreview?.candidate_images &&
        initialPreview.candidate_images[0]) ||
      "",
  );
  const [candidateImages, setCandidateImages] = useState<string[]>(
    initialPreview?.candidate_images || [],
  );
  // Pending clockwise rotation (0/90/180/270) of the selected local photo.
  // The rotated copy is previewed via an object URL and only uploaded on save.
  const [photoRotation, setPhotoRotation] = useState(0);
  const [rotatedPhoto, setRotatedPhoto] = useState<{
    file: File;
    previewUrl: string;
  } | null>(null);
  const [rotatingPhoto, setRotatingPhoto] = useState(false);
  const rotationRequestRef = useRef(0);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [ingredients, setIngredients] = useState<EditableIngredient[]>(() => {
    if (editingRecipe?.ingredients && editingRecipe.ingredients.length > 0) {
      return editingRecipe.ingredients.map((i) => ({
        quantity: i.quantity,
        unit: i.unit,
        name: i.name,
        preparation: i.preparation || "",
      }));
    }
    if (initialPreview?.ingredients && initialPreview.ingredients.length > 0) {
      return initialPreview.ingredients.map((i) => ({
        raw: i.raw,
        quantity: i.quantity,
        unit: i.unit,
        name: i.name,
        preparation: i.preparation || "",
      }));
    }
    return [{ ...EMPTY_INGREDIENT }];
  });

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

  useEffect(() => {
    queuedPhotosRef.current = queuedPhotos;
  }, [queuedPhotos]);

  useEffect(() => {
    return () => {
      for (const item of queuedPhotosRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  // Choosing a different photo discards any pending rotation.
  useEffect(() => {
    rotationRequestRef.current += 1;
    setPhotoRotation(0);
    setRotatedPhoto(null);
    setRotatingPhoto(false);
  }, [selectedImage]);

  // Release the rotated preview's object URL when it's replaced or on unmount.
  useEffect(() => {
    if (!rotatedPhoto) return;
    return () => URL.revokeObjectURL(rotatedPhoto.previewUrl);
  }, [rotatedPhoto]);

  const canRotatePhoto = selectedImage.startsWith("/api/images/");

  const handleRotatePhoto = async (delta: 90 | -90) => {
    if (!canRotatePhoto) return;
    const next = (photoRotation + delta + 360) % 360;
    const requestId = ++rotationRequestRef.current;
    setError(null);
    if (next === 0) {
      setPhotoRotation(0);
      setRotatedPhoto(null);
      setRotatingPhoto(false);
      return;
    }
    setRotatingPhoto(true);
    try {
      const file = await rotateImage(selectedImage, next);
      if (requestId !== rotationRequestRef.current) return;
      setPhotoRotation(next);
      setRotatedPhoto({ file, previewUrl: URL.createObjectURL(file) });
    } catch (err: unknown) {
      if (requestId !== rotationRequestRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to rotate photo.");
    } finally {
      if (requestId === rotationRequestRef.current) {
        setRotatingPhoto(false);
      }
    }
  };

  const handleAddImportPhotos = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (picked.length === 0) return;

    setError(null);
    setQueuedPhotos((prev) => {
      const remaining = MAX_IMPORT_PHOTOS - prev.length;
      if (remaining <= 0) {
        setError(`You can attach up to ${MAX_IMPORT_PHOTOS} photos at a time.`);
        return prev;
      }
      const toAdd = picked.slice(0, remaining);
      if (picked.length > remaining) {
        setError(
          `Only the first ${MAX_IMPORT_PHOTOS} photos were kept (maximum ${MAX_IMPORT_PHOTOS} pages).`,
        );
      }
      const next = [
        ...prev,
        ...toAdd.map((file, i) => ({
          id: `${Date.now()}-${i}-${file.name}`,
          file,
          previewUrl: URL.createObjectURL(file),
        })),
      ];
      return next;
    });
  };

  const handleRemoveQueuedPhoto = (id: string) => {
    setQueuedPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((p) => p.id !== id);
    });
  };

  const handleExtractFromPhotos = async (e: FormEvent) => {
    e.preventDefault();
    if (queuedPhotos.length === 0) {
      setError("Take or choose at least one recipe photo first.");
      return;
    }

    setError(null);
    setWasBlocked(false);
    setFetching(true);
    try {
      const preview = await importRecipeFromPhotos(
        queuedPhotos.map((p) => p.file),
        photoHint,
      );
      setExtractedMeta(
        preview.model_used
          ? {
              modelUsed: preview.model_used,
              fellBack: Boolean(preview.fell_back),
            }
          : null,
      );
      applyPreview(preview);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to extract recipe from photo.",
      );
    } finally {
      setFetching(false);
    }
  };

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
    setIsManual(false);
    setStep("preview");
  };

  const openManualEntry = () => {
    setError(null);
    setWasBlocked(false);
    setExtractedMeta(null);
    setIsManual(true);
    setSourceUrl("");
    setCandidateImages([]);
    setFailedImages({});
    if (ingredients.length === 0) {
      setIngredients([{ ...EMPTY_INGREDIENT }]);
    }
    setStep("preview");
  };

  const handlePhotoFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploadingPhoto(true);
    try {
      const localUrl = await uploadRecipeImage(file);
      setFailedImages((prev) => {
        if (!prev[localUrl]) return prev;
        const next = { ...prev };
        delete next[localUrl];
        return next;
      });
      setSelectedImage(localUrl);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to upload recipe photo.",
      );
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) {
        photoInputRef.current.value = "";
      }
    }
  };

  const handleParsePastedIngredients = async () => {
    if (!pasteIngredientsText.trim()) {
      setError("Paste at least one ingredient line to parse.");
      return;
    }
    setError(null);
    setParsingIngredients(true);
    try {
      const parsed = await parseIngredientLines(pasteIngredientsText);
      if (parsed.length === 0) {
        setError("No ingredients could be extracted from those lines.");
        return;
      }
      setIngredients((prev) => {
        const nonBlank = prev.filter((item) => !isBlankIngredient(item));
        return [
          ...nonBlank,
          ...parsed.map((i) => ({
            raw: i.raw,
            quantity: i.quantity,
            unit: i.unit,
            name: i.name,
            preparation: i.preparation || "",
          })),
        ];
      });
      setPasteIngredientsText("");
      setShowPasteIngredients(false);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to parse ingredients.",
      );
    } finally {
      setParsingIngredients(false);
    }
  };

  const fetchRecipePreview = async (targetUrl: string, html?: string) => {
    setError(null);
    setWasBlocked(false);
    setFetching(true);
    try {
      const preview = await importRecipePreview(targetUrl, html);
      setExtractedMeta(null);
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
      let imageUrl = selectedImage.trim();
      if (photoRotation !== 0 && rotatedPhoto) {
        imageUrl = await uploadRecipeImage(rotatedPhoto.file);
      }
      const payload = {
        title: title.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
        servings: servings > 0 ? servings : 1,
        prep_minutes: Math.max(0, prepMinutes),
        cook_minutes: Math.max(0, cookMinutes),
        source_url: sourceUrl.trim(),
        image_url: imageUrl,
        ingredients: ingredients
          .map((ing) => ({
            quantity: ing.quantity.trim(),
            unit: ing.unit.trim(),
            name: ing.name.trim(),
            preparation: (ing.preparation || "").trim(),
          }))
          .filter((ing) => ing.name !== ""),
      };
      const saved = editingRecipe
        ? await updateRecipe(editingRecipe.id, payload)
        : await createRecipe(payload);
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
      "min-h-[40px] rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:min-h-[36px]",
      sourceMode === mode
        ? "bg-amber-100 text-amber-900"
        : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
    ].join(" ");

  const modalTitle = isEditing
    ? "Edit Recipe"
    : step === "source"
      ? "Add Recipe"
      : isManual
        ? "New Recipe"
        : "Preview & Confirm Recipe";
  const modalSubtitle = isEditing
    ? "Update recipe details, photo, ingredients, or instructions."
    : step === "source"
      ? "Import from a URL or photo, enter one manually, paste HTML, or use the bookmarklet."
      : isManual
        ? "Enter your recipe details below — no URL needed."
        : "Review the extracted details and optionally add a dish photo before saving.";

  const formSubmit =
    step === "preview"
      ? handleSave
      : sourceMode === "bookmarklet"
        ? undefined
        : sourceMode === "photo"
          ? handleExtractFromPhotos
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
            disabled={
              fetching || (sourceMode === "photo" && queuedPhotos.length === 0)
            }
            className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-700 disabled:opacity-60 sm:flex-initial"
          >
            {fetching ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                {sourceMode === "photo"
                  ? "Reading recipe with Gemini…"
                  : sourceMode === "html"
                    ? "Parsing HTML…"
                    : "Fetching recipe…"}
              </>
            ) : sourceMode === "photo" ? (
              "Extract Recipe"
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
        {!isEditing ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setIsManual(false);
              setStep("source");
            }}
            disabled={saving || uploadingPhoto}
            className="inline-flex min-h-[40px] items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 disabled:opacity-50 sm:justify-start sm:px-2"
          >
            {isManual ? "← Import Instead" : "← Change Source"}
          </button>
        ) : (
          <div className="hidden sm:block" />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving || uploadingPhoto}
            className="min-h-[40px] flex-1 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 sm:flex-initial"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || uploadingPhoto || rotatingPhoto}
            className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-amber-700 disabled:opacity-60 sm:flex-initial"
          >
            {saving ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                {isEditing
                  ? "Saving changes…"
                  : selectedImage && !selectedImage.startsWith("/api/images/")
                    ? "Saving & caching photo…"
                    : "Saving recipe…"}
              </>
            ) : isEditing ? (
              "Save Changes"
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
      closeDisabled={fetching || saving || uploadingPhoto}
      onSubmit={formSubmit}
    >
      {step === "source" ? (
        <div className="space-y-4">
          {/* Mode Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-stone-200 pb-3 sm:gap-1">
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
                setSourceMode("photo");
                setError(null);
                setWasBlocked(false);
              }}
              className={tabClass("photo")}
            >
              From Photo
            </button>
            <button
              type="button"
              onClick={openManualEntry}
              className="min-h-[40px] rounded-lg px-3 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 sm:min-h-[36px]"
            >
              Manual
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

          {sourceMode === "photo" ? (
            <div className="space-y-4">
              <p className="text-sm text-stone-600">
                Snap or upload up to {MAX_IMPORT_PHOTOS} photos of a cookbook
                page, recipe card, or screenshot. Gemini will extract the title,
                ingredients, and steps for you to review.
              </p>

              <div className="flex flex-wrap gap-2">
                <label
                  className={[
                    "inline-flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-900 shadow-2xs transition-colors hover:bg-amber-100 sm:flex-initial",
                    fetching || queuedPhotos.length >= MAX_IMPORT_PHOTOS
                      ? "pointer-events-none opacity-50"
                      : "",
                  ].join(" ")}
                >
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleAddImportPhotos}
                    disabled={
                      fetching || queuedPhotos.length >= MAX_IMPORT_PHOTOS
                    }
                    className="sr-only"
                  />
                  {queuedPhotos.length === 0 ? "Take Photo" : "+ Take Page"}
                </label>

                <label
                  className={[
                    "inline-flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 shadow-2xs transition-colors hover:bg-stone-50 sm:flex-initial",
                    fetching || queuedPhotos.length >= MAX_IMPORT_PHOTOS
                      ? "pointer-events-none opacity-50"
                      : "",
                  ].join(" ")}
                >
                  <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleAddImportPhotos}
                    disabled={
                      fetching || queuedPhotos.length >= MAX_IMPORT_PHOTOS
                    }
                    className="sr-only"
                  />
                  Choose Photos
                </label>
              </div>

              {queuedPhotos.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  {queuedPhotos.map((photo, idx) => (
                    <div
                      key={photo.id}
                      className="relative overflow-hidden rounded-xl border border-stone-200 bg-stone-100"
                    >
                      <img
                        src={photo.previewUrl}
                        alt={`Recipe page ${idx + 1}`}
                        className="aspect-3/4 w-full object-cover"
                      />
                      <span className="absolute bottom-1.5 left-1.5 rounded-md bg-stone-900/75 px-1.5 py-0.5 text-[11px] font-medium text-white">
                        Page {idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveQueuedPhoto(photo.id)}
                        disabled={fetching}
                        aria-label={`Remove page ${idx + 1}`}
                        className="absolute top-1 right-1 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-stone-900/75 text-xs font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-stone-300 bg-stone-50 px-4 text-center text-sm text-stone-500">
                  No photos selected yet (supports 1–{MAX_IMPORT_PHOTOS} pages)
                </div>
              )}

              <div>
                <label
                  htmlFor="photo-extract-hint"
                  className="block text-xs font-medium text-stone-600"
                >
                  Optional note for Gemini
                </label>
                <input
                  id="photo-extract-hint"
                  type="text"
                  value={photoHint}
                  onChange={(e) => setPhotoHint(e.target.value)}
                  disabled={fetching}
                  placeholder="e.g., Only extract the sauce recipe on the right"
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-base text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none disabled:bg-stone-50 sm:text-sm"
                />
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>
          ) : sourceMode === "bookmarklet" ? (
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

          {extractedMeta && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3.5 py-2 text-xs text-amber-900">
              Extracted from photo{queuedPhotos.length === 1 ? "" : "s"} with{" "}
              <span className="font-semibold">{extractedMeta.modelUsed}</span>
              {extractedMeta.fellBack && " (automatic fallback)"}.
              Review any details before saving.
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
              <div className="relative overflow-hidden rounded-xl border border-stone-200 bg-stone-100">
                <img
                  src={rotatedPhoto?.previewUrl ?? selectedImage}
                  alt={title || "Selected recipe preview"}
                  referrerPolicy="no-referrer"
                  onError={() => {
                    if (!rotatedPhoto) markImageFailed(selectedImage);
                  }}
                  className="h-44 w-full object-cover sm:h-52"
                />
                {canRotatePhoto && (
                  <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
                    {rotatingPhoto && (
                      <span className="mr-1 h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-amber-600" />
                    )}
                    <button
                      type="button"
                      onClick={() => void handleRotatePhoto(-90)}
                      disabled={rotatingPhoto || uploadingPhoto || saving}
                      aria-label="Rotate photo left"
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-lg text-stone-800 shadow-sm ring-1 ring-stone-300 transition-colors hover:bg-white disabled:opacity-60"
                    >
                      ⟲
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRotatePhoto(90)}
                      disabled={rotatingPhoto || uploadingPhoto || saving}
                      aria-label="Rotate photo right"
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-lg text-stone-800 shadow-sm ring-1 ring-stone-300 transition-colors hover:bg-white disabled:opacity-60"
                    >
                      ⟳
                    </button>
                  </div>
                )}
                {photoRotation !== 0 && (
                  <span className="absolute top-2 left-2 rounded-full bg-amber-600/90 px-2.5 py-1 text-[11px] font-medium text-white shadow-sm">
                    Rotated · applies on save
                  </span>
                )}
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-stone-300 bg-stone-50 text-sm text-stone-500">
                No photo selected
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <label
                className={[
                  "inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-xs font-medium text-stone-700 shadow-2xs transition-colors hover:bg-stone-50",
                  uploadingPhoto || saving
                    ? "pointer-events-none opacity-60"
                    : "",
                ].join(" ")}
              >
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handlePhotoFileChange(e)}
                  disabled={uploadingPhoto || saving}
                  className="sr-only"
                />
                {uploadingPhoto ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-stone-300 border-t-amber-600" />
                    Uploading photo…
                  </>
                ) : selectedImage ? (
                  "Upload / Take Different Photo"
                ) : (
                  "Upload / Take Photo"
                )}
              </label>
              {selectedImage && (
                <button
                  type="button"
                  onClick={() => setSelectedImage("")}
                  disabled={uploadingPhoto || saving}
                  className="min-h-[40px] rounded-lg px-3 py-2 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-red-600 disabled:opacity-50"
                >
                  Remove photo
                </button>
              )}
            </div>

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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-medium text-stone-800">
                Ingredients ({ingredients.filter((i) => i.name.trim()).length})
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setShowPasteIngredients((prev) => !prev);
                  }}
                  className="min-h-[36px] rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100"
                >
                  {showPasteIngredients ? "Close paste" : "Paste list"}
                </button>
                <button
                  type="button"
                  onClick={addIngredient}
                  className="min-h-[36px] rounded-lg px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                >
                  + Add
                </button>
              </div>
            </div>

            {showPasteIngredients && (
              <div className="space-y-2.5 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                <label
                  htmlFor="paste-ingredients-text"
                  className="block text-xs font-medium text-stone-700"
                >
                  Paste or type one ingredient per line — quantities &amp; units
                  will be parsed automatically:
                </label>
                <textarea
                  id="paste-ingredients-text"
                  rows={4}
                  value={pasteIngredientsText}
                  onChange={(e) => setPasteIngredientsText(e.target.value)}
                  disabled={parsingIngredients}
                  placeholder={
                    "2 cups all-purpose flour\n3 cloves garlic, minced\n1 tsp kosher salt"
                  }
                  className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 placeholder:text-stone-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-none sm:text-sm"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPasteIngredients(false);
                      setPasteIngredientsText("");
                    }}
                    disabled={parsingIngredients}
                    className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleParsePastedIngredients()}
                    disabled={parsingIngredients || !pasteIngredientsText.trim()}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-medium text-white shadow-xs hover:bg-amber-700 disabled:opacity-60"
                  >
                    {parsingIngredients ? (
                      <>
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                        Parsing…
                      </>
                    ) : (
                      "Parse & Add"
                    )}
                  </button>
                </div>
              </div>
            )}

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
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
              <label
                htmlFor="preview-instructions"
                className="block text-sm font-medium text-stone-700"
              >
                Instructions
              </label>
              <span className="text-xs text-stone-500">
                Separate steps with a blank line for Cook Mode &amp; Nest Hub
              </span>
            </div>
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
