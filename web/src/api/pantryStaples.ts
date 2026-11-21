import {
  getCachedPantryStaples,
  isOfflineError,
  saveCachedPantryStaples,
} from "../offline/store";

export type PantryStaple = {
  id: number;
  name: string;
  ingredient_key: string;
  created_at: string;
};

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Non-JSON response
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

export async function listPantryStaples(): Promise<PantryStaple[]> {
  try {
    const res = await fetch("/api/pantry-staples");
    const staples = await parseJsonOrThrow<PantryStaple[]>(res);
    void saveCachedPantryStaples(staples);
    return staples;
  } catch (err) {
    if (isOfflineError(err)) {
      return getCachedPantryStaples();
    }
    throw err;
  }
}

export async function addPantryStaple(name: string): Promise<PantryStaple> {
  const res = await fetch("/api/pantry-staples", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return parseJsonOrThrow<PantryStaple>(res);
}

export async function deletePantryStaple(id: number): Promise<void> {
  const res = await fetch(`/api/pantry-staples/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    await parseJsonOrThrow<never>(res);
  }
}

export async function togglePantryStaple(
  name: string,
): Promise<{ is_pantry_staple: boolean; staple: PantryStaple | null }> {
  const res = await fetch("/api/pantry-staples/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return parseJsonOrThrow<{
    is_pantry_staple: boolean;
    staple: PantryStaple | null;
  }>(res);
}
