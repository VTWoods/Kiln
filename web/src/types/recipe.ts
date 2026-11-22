export type RecipeIngredient = {
  id: number;
  recipe_id: number;
  name: string;
  quantity: string;
  unit: string;
  preparation: string;
  sort_order: number;
  is_pantry_staple?: boolean;
};

export type Recipe = {
  id: number;
  title: string;
  description: string;
  instructions: string;
  servings: number;
  prep_minutes: number;
  cook_minutes: number;
  source_url: string;
  image_url: string;
  ingredient_count: number;
  ingredient_names?: string[];
  ingredients?: RecipeIngredient[];
  created_at: string;
  updated_at: string;
};

export type ImportedIngredient = {
  raw: string;
  quantity: string;
  unit: string;
  name: string;
  preparation: string;
};

export type ImportedRecipe = {
  title: string;
  description: string;
  instructions: string;
  servings: number;
  prep_minutes: number;
  cook_minutes: number;
  source_url: string;
  image_url: string;
  candidate_images: string[];
  ingredients: ImportedIngredient[];
};

export type IngredientInput = {
  quantity: string;
  unit: string;
  name: string;
  preparation?: string;
};

export type SaveRecipePayload = {
  title: string;
  description: string;
  instructions: string;
  servings: number;
  prep_minutes: number;
  cook_minutes: number;
  source_url: string;
  image_url: string;
  ingredients: IngredientInput[];
};

export function isSafeHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function formatMinutes(minutes: number): string {
  if (!minutes || minutes <= 0) return "";
  if (minutes < 60) return `${minutes} min`;
  const hrs = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hrs} hr` : `${hrs} hr ${rem} min`;
}

export function formatHostname(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return raw;
  }
}

function getSearchableIngredientNames(recipe: Recipe): string[] {
  if (recipe.ingredient_names && recipe.ingredient_names.length > 0) {
    return recipe.ingredient_names;
  }
  if (recipe.ingredients && recipe.ingredients.length > 0) {
    return recipe.ingredients.map((i) => i.name).filter(Boolean);
  }
  return [];
}

/**
 * Multi-word search across recipe title, description, source hostname, and ingredient names.
 * Every whitespace-separated term must match at least one searchable field.
 */
export function matchesRecipeSearch(recipe: Recipe, rawQuery: string): boolean {
  const terms = rawQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = [
    recipe.title,
    recipe.description,
    recipe.source_url ? formatHostname(recipe.source_url) : "",
    ...getSearchableIngredientNames(recipe),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  return terms.every((term) => haystack.includes(term));
}

/**
 * Returns ingredient names on the recipe that match any search term (useful for
 * showing why a recipe matched when searching by ingredient).
 */
export function getMatchingIngredients(
  recipe: Recipe,
  rawQuery: string,
): string[] {
  const terms = rawQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const names = getSearchableIngredientNames(recipe);
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    if (terms.some((term) => lower.includes(term))) {
      seen.add(lower);
      matches.push(name);
    }
  }
  return matches;
}
