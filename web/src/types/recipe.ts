export type RecipeIngredient = {
  id: number;
  recipe_id: number;
  name: string;
  quantity: string;
  unit: string;
  preparation: string;
  sort_order: number;
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
