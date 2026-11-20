export type ShoppingListItem = {
  id: number;
  shopping_list_id: number;
  name: string;
  quantity: string;
  unit: string;
  checked: boolean;
  recipe_id?: number;
  recipe_title?: string;
};

export type ShoppingList = {
  id: number;
  name: string;
  item_count: number;
  checked_count: number;
  items?: ShoppingListItem[];
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
