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

export async function deleteRecipe(id: number): Promise<void> {
  const res = await apiFetch(`/api/recipes/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    await parseJsonOrThrow<never>(res);
  }
  void deleteCachedRecipe(id);
}
