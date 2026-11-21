export const GROCERY_AISLES = [
  "Produce",
  "Meat & Seafood",
  "Dairy & Eggs",
  "Bakery",
  "Frozen",
  "Canned & Broths",
  "Condiments & Oils",
  "Spices & Seasonings",
  "Pantry & Baking",
  "Beverages",
  "Other",
] as const;

export type ShoppingListItemRecipe = {
  id: number;
  title: string;
};

export type ShoppingListItem = {
  id: number;
  shopping_list_id: number;
  name: string;
  quantity: string;
  unit: string;
  aisle?: string;
  checked: boolean;
  recipe_id?: number;
  recipe_title?: string;
  recipes?: ShoppingListItemRecipe[];
};

export type ShoppingList = {
  id: number;
  name: string;
  item_count: number;
  checked_count: number;
  items?: ShoppingListItem[];
  aisles?: string[];
  created_at: string;
  updated_at: string;
};

export type AddShoppingListItemInput = {
  name: string;
  quantity: string;
  unit: string;
  recipe_id?: number;
};

export function defaultShoppingListName(date = new Date()): string {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}
