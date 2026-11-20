import type {
  ImportedRecipe,
  Recipe,
  SaveRecipePayload,
} from "../types/recipe";

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
    throw new Error(errMsg);
  }

  return data as T;
}

export async function listRecipes(): Promise<Recipe[]> {
  const res = await fetch("/api/recipes");
  return parseJsonOrThrow<Recipe[]>(res);
}

export async function getRecipe(id: number): Promise<Recipe> {
  const res = await fetch(`/api/recipes/${id}`);
  return parseJsonOrThrow<Recipe>(res);
}

export async function importRecipePreview(
  url: string,
): Promise<ImportedRecipe> {
  const res = await fetch("/api/recipes/import-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return parseJsonOrThrow<ImportedRecipe>(res);
}

export async function createRecipe(
  payload: SaveRecipePayload,
): Promise<Recipe> {
  const res = await fetch("/api/recipes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<Recipe>(res);
}

export async function deleteRecipe(id: number): Promise<void> {
  const res = await fetch(`/api/recipes/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    await parseJsonOrThrow<never>(res);
  }
}
