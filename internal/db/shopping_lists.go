package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ShoppingListItem represents one grocery item on a shopping list.
type ShoppingListItem struct {
	ID             int64  `json:"id"`
	ShoppingListID int64  `json:"shopping_list_id"`
	Name           string `json:"name"`
	Quantity       string `json:"quantity"`
	Unit           string `json:"unit"`
	Checked        bool   `json:"checked"`
	RecipeID       *int64 `json:"recipe_id,omitempty"`
	RecipeTitle    string `json:"recipe_title,omitempty"`
}

// ShoppingList represents a shopping list summary and optionally its items.
type ShoppingList struct {
	ID           int64              `json:"id"`
	Name         string             `json:"name"`
	ItemCount    int                `json:"item_count"`
	CheckedCount int                `json:"checked_count"`
	Items        []ShoppingListItem `json:"items,omitempty"`
	CreatedAt    time.Time          `json:"created_at"`
	UpdatedAt    time.Time          `json:"updated_at"`
}

// ShoppingListItemInput holds data for inserting a shopping list item.
type ShoppingListItemInput struct {
	Name     string `json:"name"`
	Quantity string `json:"quantity"`
	Unit     string `json:"unit"`
	RecipeID *int64 `json:"recipe_id,omitempty"`
}

// ShoppingListItemUpdate holds optional fields for updating a shopping list item.
type ShoppingListItemUpdate struct {
	Name     *string `json:"name,omitempty"`
	Quantity *string `json:"quantity,omitempty"`
	Unit     *string `json:"unit,omitempty"`
	Checked  *bool   `json:"checked,omitempty"`
}

// ListShoppingLists returns all shopping lists with total and checked item counts.
func ListShoppingLists(ctx context.Context, conn *sql.DB) ([]ShoppingList, error) {
	rows, err := conn.QueryContext(ctx, `
		SELECT
			sl.id,
			sl.name,
			COUNT(sli.id) AS item_count,
			COALESCE(SUM(CASE WHEN sli.checked = 1 THEN 1 ELSE 0 END), 0) AS checked_count,
			sl.created_at,
			sl.updated_at
		FROM shopping_lists sl
		LEFT JOIN shopping_list_items sli ON sli.shopping_list_id = sl.id
		GROUP BY sl.id
		ORDER BY sl.created_at ASC, sl.id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list shopping lists: %w", err)
	}
	defer rows.Close()

	lists := make([]ShoppingList, 0)
	for rows.Next() {
		var l ShoppingList
		if err := rows.Scan(
			&l.ID,
			&l.Name,
			&l.ItemCount,
			&l.CheckedCount,
			&l.CreatedAt,
			&l.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan shopping list: %w", err)
		}
		lists = append(lists, l)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate shopping lists: %w", err)
	}

	return lists, nil
}

// GetShoppingList returns a shopping list and all of its items.
func GetShoppingList(ctx context.Context, conn *sql.DB, id int64) (*ShoppingList, error) {
	var l ShoppingList
	err := conn.QueryRowContext(ctx, `
		SELECT id, name, created_at, updated_at
		FROM shopping_lists
		WHERE id = ?
	`, id).Scan(&l.ID, &l.Name, &l.CreatedAt, &l.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get shopping list %d: %w", id, err)
	}

	rows, err := conn.QueryContext(ctx, `
		SELECT
			sli.id,
			sli.shopping_list_id,
			sli.name,
			sli.quantity,
			sli.unit,
			sli.checked,
			sli.recipe_id,
			COALESCE(r.title, '') AS recipe_title
		FROM shopping_list_items sli
		LEFT JOIN recipes r ON r.id = sli.recipe_id
		WHERE sli.shopping_list_id = ?
		ORDER BY sli.checked ASC, sli.id ASC
	`, id)
	if err != nil {
		return nil, fmt.Errorf("list items for shopping list %d: %w", id, err)
	}
	defer rows.Close()

	items := make([]ShoppingListItem, 0)
	checkedCount := 0
	for rows.Next() {
		var (
			item     ShoppingListItem
			recipeID sql.NullInt64
		)
		if err := rows.Scan(
			&item.ID,
			&item.ShoppingListID,
			&item.Name,
			&item.Quantity,
			&item.Unit,
			&item.Checked,
			&recipeID,
			&item.RecipeTitle,
		); err != nil {
			return nil, fmt.Errorf("scan shopping list item: %w", err)
		}
		if recipeID.Valid {
			val := recipeID.Int64
			item.RecipeID = &val
		}
		if item.Checked {
			checkedCount++
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate shopping list items: %w", err)
	}

	l.Items = items
	l.ItemCount = len(items)
	l.CheckedCount = checkedCount
	return &l, nil
}

// CreateShoppingList creates a new shopping list.
func CreateShoppingList(ctx context.Context, conn *sql.DB, name string) (*ShoppingList, error) {
	res, err := conn.ExecContext(ctx, `
		INSERT INTO shopping_lists (name) VALUES (?)
	`, strings.TrimSpace(name))
	if err != nil {
		return nil, fmt.Errorf("create shopping list: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("get created shopping list id: %w", err)
	}
	return GetShoppingList(ctx, conn, id)
}

// DeleteShoppingList deletes a shopping list and its cascaded items.
func DeleteShoppingList(ctx context.Context, conn *sql.DB, id int64) error {
	res, err := conn.ExecContext(ctx, `DELETE FROM shopping_lists WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete shopping list %d: %w", id, err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected deleting shopping list %d: %w", id, err)
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

// AddShoppingListItems appends items to an existing shopping list in a transaction.
func AddShoppingListItems(ctx context.Context, conn *sql.DB, listID int64, items []ShoppingListItemInput) (*ShoppingList, error) {
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin add shopping list items tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT 1 FROM shopping_lists WHERE id = ?`, listID).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, fmt.Errorf("verify shopping list %d: %w", listID, err)
	}

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO shopping_list_items (shopping_list_id, name, quantity, unit, checked, recipe_id)
		VALUES (?, ?, ?, ?, 0, ?)
	`)
	if err != nil {
		return nil, fmt.Errorf("prepare shopping list item insert: %w", err)
	}
	defer stmt.Close()

	for _, item := range items {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		var recipeID any
		if item.RecipeID != nil && *item.RecipeID > 0 {
			recipeID = *item.RecipeID
		}
		if _, err := stmt.ExecContext(
			ctx,
			listID,
			name,
			strings.TrimSpace(item.Quantity),
			strings.TrimSpace(item.Unit),
			recipeID,
		); err != nil {
			return nil, fmt.Errorf("insert shopping list item %q: %w", name, err)
		}
	}

	if _, err := tx.ExecContext(ctx, `UPDATE shopping_lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, listID); err != nil {
		return nil, fmt.Errorf("touch shopping list %d: %w", listID, err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit add shopping list items tx: %w", err)
	}

	return GetShoppingList(ctx, conn, listID)
}

// UpdateShoppingListItem updates fields on a single shopping list item.
func UpdateShoppingListItem(ctx context.Context, conn *sql.DB, listID, itemID int64, upd ShoppingListItemUpdate) (*ShoppingListItem, error) {
	var (
		current  ShoppingListItem
		recipeID sql.NullInt64
	)
	err := conn.QueryRowContext(ctx, `
		SELECT
			sli.id,
			sli.shopping_list_id,
			sli.name,
			sli.quantity,
			sli.unit,
			sli.checked,
			sli.recipe_id,
			COALESCE(r.title, '') AS recipe_title
		FROM shopping_list_items sli
		LEFT JOIN recipes r ON r.id = sli.recipe_id
		WHERE sli.id = ? AND sli.shopping_list_id = ?
	`, itemID, listID).Scan(
		&current.ID,
		&current.ShoppingListID,
		&current.Name,
		&current.Quantity,
		&current.Unit,
		&current.Checked,
		&recipeID,
		&current.RecipeTitle,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load shopping list item %d: %w", itemID, err)
	}
	if recipeID.Valid {
		val := recipeID.Int64
		current.RecipeID = &val
	}

	if upd.Name != nil {
		if trimmed := strings.TrimSpace(*upd.Name); trimmed != "" {
			current.Name = trimmed
		}
	}
	if upd.Quantity != nil {
		current.Quantity = strings.TrimSpace(*upd.Quantity)
	}
	if upd.Unit != nil {
		current.Unit = strings.TrimSpace(*upd.Unit)
	}
	if upd.Checked != nil {
		current.Checked = *upd.Checked
	}

	if _, err := conn.ExecContext(ctx, `
		UPDATE shopping_list_items
		SET name = ?, quantity = ?, unit = ?, checked = ?
		WHERE id = ? AND shopping_list_id = ?
	`, current.Name, current.Quantity, current.Unit, current.Checked, itemID, listID); err != nil {
		return nil, fmt.Errorf("update shopping list item %d: %w", itemID, err)
	}

	_, _ = conn.ExecContext(ctx, `UPDATE shopping_lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, listID)
	return &current, nil
}

// DeleteShoppingListItem deletes one item from a shopping list.
func DeleteShoppingListItem(ctx context.Context, conn *sql.DB, listID, itemID int64) error {
	res, err := conn.ExecContext(ctx, `
		DELETE FROM shopping_list_items WHERE id = ? AND shopping_list_id = ?
	`, itemID, listID)
	if err != nil {
		return fmt.Errorf("delete shopping list item %d: %w", itemID, err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected deleting shopping list item %d: %w", itemID, err)
	}
	if affected == 0 {
		return ErrNotFound
	}
	_, _ = conn.ExecContext(ctx, `UPDATE shopping_lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, listID)
	return nil
}

// ClearCheckedShoppingListItems removes all checked items from a shopping list.
func ClearCheckedShoppingListItems(ctx context.Context, conn *sql.DB, listID int64) (*ShoppingList, error) {
	var exists int
	if err := conn.QueryRowContext(ctx, `SELECT 1 FROM shopping_lists WHERE id = ?`, listID).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, fmt.Errorf("verify shopping list %d: %w", listID, err)
	}

	if _, err := conn.ExecContext(ctx, `
		DELETE FROM shopping_list_items WHERE shopping_list_id = ? AND checked = 1
	`, listID); err != nil {
		return nil, fmt.Errorf("clear checked items for shopping list %d: %w", listID, err)
	}
	_, _ = conn.ExecContext(ctx, `UPDATE shopping_lists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, listID)

	return GetShoppingList(ctx, conn, listID)
}
