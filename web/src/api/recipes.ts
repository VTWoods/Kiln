import { apiFetch } from "../offline/fetch";
import {
  deleteCachedRecipe,
  getCachedRecipe,
  getCachedRecipes,
  isOfflineError,
  saveCachedRecipe,
  saveCachedRecipesSummary,
} from "../offline/store";
import type {
  ImportedIngredient,
  ImportedRecipe,
  Recipe,
  SaveRecipePayload,
} from "../types/recipe";

export class ApiError extends Error {
  blocked: boolean;
  constructor(message: string, blocked = false) {
    super(message);
    this.name = "ApiError";
    this.blocked = blocked;
  }
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Non-JSON error body
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
    const blocked = Boolean(
      data &&
        typeof data === "object" &&
        "blocked" in data &&
        (data as { blocked: unknown }).blocked === true,
    );
    throw new ApiError(errMsg, blocked);
  }

  return data as T;
}

export async function listRecipes(): Promise<Recipe[]> {
  try {
    const res = await apiFetch("/api/recipes");
    const recipes = await parseJsonOrThrow<Recipe[]>(res);
    void saveCachedRecipesSummary(recipes);
    return recipes;
  } catch (err) {
    if (isOfflineError(err)) {
      return getCachedRecipes();
    }
    throw err;
  }
}

export async function getRecipe(id: number): Promise<Recipe> {
  try {
    const res = await apiFetch(`/api/recipes/${id}`);
    const recipe = await parseJsonOrThrow<Recipe>(res);
    void saveCachedRecipe(recipe);
    return recipe;
  } catch (err) {
    if (isOfflineError(err)) {
      const cached = await getCachedRecipe(id);
      if (cached) return cached;
      throw new Error("This recipe has not been synced for offline viewing yet.");
    }
    throw err;
  }
}

export async function importRecipePreview(
  url: string,
  html?: string,
): Promise<ImportedRecipe> {
  const body: { url: string; html?: string } = { url };
  if (html && html.trim()) {
    body.html = html;
  }
  try {
    const res = await apiFetch(
      "/api/recipes/import-preview",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { timeoutMs: 25_000, allow502AppError: true, bypassCircuitBreaker: true },
    );
    return parseJsonOrThrow<ImportedRecipe>(res);
  } catch (err) {
    if (isOfflineError(err)) {
      throw new Error(
        "Importing recipes requires a connection to your Kiln server.",
      );
    }
    throw err;
  }
}

export async function getImportDraft(token: string): Promise<ImportedRecipe> {
  const res = await apiFetch(
    `/api/recipes/import-draft/${encodeURIComponent(token)}`,
    undefined,
    { bypassCircuitBreaker: true },
  );
  return parseJsonOrThrow<ImportedRecipe>(res);
}

export async function createRecipe(
  payload: SaveRecipePayload,
): Promise<Recipe> {
  const res = await apiFetch(
    "/api/recipes",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { timeoutMs: 20_000, bypassCircuitBreaker: true },
  );
  const created = await parseJsonOrThrow<Recipe>(res);
  void saveCachedRecipe(created);
  return created;
}

export async function updateRecipe(
  id: number,
  payload: SaveRecipePayload,
): Promise<Recipe> {
  const res = await apiFetch(
    `/api/recipes/${id}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    { timeoutMs: 20_000, bypassCircuitBreaker: true },
  );
  const updated = await parseJsonOrThrow<Recipe>(res);
  void saveCachedRecipe(updated);
  return updated;
}

export async function parseIngredientLines(
  text: string,
): Promise<ImportedIngredient[]> {
  try {
    const res = await apiFetch(
      "/api/ingredients/parse",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      },
      { timeoutMs: 15_000, bypassCircuitBreaker: true },
    );
    const data = await parseJsonOrThrow<{ ingredients: ImportedIngredient[] }>(
      res,
    );
    return data.ingredients ?? [];
  } catch (err) {
    if (isOfflineError(err)) {
      throw new Error(
        "Parsing ingredients requires a connection to your Kiln server.",
      );
    }
    throw err;
  }
}

export type PhotoImportedRecipe = ImportedRecipe & {
  model_used?: string;
  fell_back?: boolean;
};

async function compressPhotoForExtraction(
  file: File,
  maxDim = 1600,
): Promise<File> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return file;
  }
  // Skip tiny files that are already lightweight
  if (file.size > 0 && file.size <= 350_000) {
    return file;
  }

  let objectUrl: string | null = null;
  try {
    objectUrl = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image decode failed"));
      el.src = objectUrl!;
    });

    const { naturalWidth: w, naturalHeight: h } = img;
    if (!w || !h) return file;

    const scale = Math.min(1, maxDim / Math.max(w, h));
    const targetW = Math.max(1, Math.round(w * scale));
    const targetH = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(img, 0, 0, targetW, targetH);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    if (!blob || blob.size === 0 || (scale === 1 && blob.size >= file.size)) {
      return file;
    }
    const baseName = file.name.replace(/\.[^.]+$/, "") || "recipe-photo";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

export async function importRecipeFromPhotos(
  files: File[],
  hint?: string,
): Promise<PhotoImportedRecipe> {
  const prepared = await Promise.all(
    files.map((file) => compressPhotoForExtraction(file)),
  );
  const form = new FormData();
  for (const file of prepared) {
    form.append("images", file);
  }
  if (hint && hint.trim()) {
    form.append("hint", hint.trim());
  }

  try {
    const res = await apiFetch(
      "/api/recipes/import-photo",
      {
        method: "POST",
        body: form,
      },
      { timeoutMs: 115_000, allow502AppError: true, bypassCircuitBreaker: true },
    );
    return parseJsonOrThrow<PhotoImportedRecipe>(res);
  } catch (err) {
    if (isOfflineError(err)) {
      throw new Error(
        "Extracting recipes from photos requires a connection to your Kiln server.",
      );
    }
    throw err;
  }
}

const MAX_ROTATED_IMAGE_DIM = 2400;

/**
 * Fetches a locally stored recipe photo (`/api/images/...`, same-origin so the
 * canvas stays untainted) and returns a copy rotated clockwise by `degrees`
 * (a multiple of 90). Browsers apply EXIF orientation when decoding, so the
 * output matches what the user sees on screen.
 */
export async function rotateImage(src: string, degrees: number): Promise<File> {
  const turns = (((Math.round(degrees / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;

  let res: Response;
  try {
    res = await fetch(src, { credentials: "same-origin" });
  } catch {
    throw new Error("Could not load the photo to rotate it.");
  }
  if (!res.ok) {
    throw new Error("Could not load the photo to rotate it.");
  }
  const sourceBlob = await res.blob();

  const objectUrl = URL.createObjectURL(sourceBlob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("This photo format can't be rotated in your browser."));
      el.src = objectUrl;
    });

    const { naturalWidth: w, naturalHeight: h } = img;
    if (!w || !h) {
      throw new Error("This photo format can't be rotated in your browser.");
    }

    const scale = Math.min(1, MAX_ROTATED_IMAGE_DIM / Math.max(w, h));
    const drawW = Math.max(1, Math.round(w * scale));
    const drawH = Math.max(1, Math.round(h * scale));
    const sideways = turns % 2 === 1;

    const canvas = document.createElement("canvas");
    canvas.width = sideways ? drawH : drawW;
    canvas.height = sideways ? drawW : drawH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Rotating photos isn't supported in this browser.");
    }

    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((turns * Math.PI) / 2);
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);

    const keepPng = sourceBlob.type === "image/png" || sourceBlob.type === "image/gif";
    const outType = keepPng ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outType, 0.9),
    );
    if (!blob || blob.size === 0) {
      throw new Error("Failed to rotate photo.");
    }
    return new File([blob], `recipe-photo${keepPng ? ".png" : ".jpg"}`, {
      type: outType,
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function uploadRecipeImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("image", file);
  try {
    const res = await apiFetch(
      "/api/images/upload",
      {
        method: "POST",
        body: form,
      },
      { timeoutMs: 25_000, bypassCircuitBreaker: true },
    );
    const data = await parseJsonOrThrow<{ image_url: string }>(res);
    return data.image_url;
  } catch (err) {
    if (isOfflineError(err)) {
      throw new Error(
        "Uploading photos requires a connection to your Kiln server.",
      );
    }
    throw err;
  }
}

export async function deleteRecipe(id: number): Promise<void> {
  const res = await apiFetch(`/api/recipes/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    await parseJsonOrThrow<never>(res);
  }
  void deleteCachedRecipe(id);
}
