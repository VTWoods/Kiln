package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ErrNotFound is returned when a requested record does not exist.
var ErrNotFound = errors.New("record not found")

// RecipeIngredient represents one ingredient row for a recipe.
type RecipeIngredient struct {
	ID        int64  `json:"id"`
	RecipeID  int64  `json:"recipe_id"`
	Name      string `json:"name"`
	Quantity  string `json:"quantity"`
	Unit      string `json:"unit"`
	SortOrder int    `json:"sort_order"`
}

// Recipe represents a stored recipe and optionally its ingredients.
type Recipe struct {
	ID              int64              `json:"id"`
	Title           string             `json:"title"`
	Description     string             `json:"description"`
	Instructions    string             `json:"instructions"`
	Servings        int                `json:"servings"`
	PrepMinutes     int                `json:"prep_minutes"`
	CookMinutes     int                `json:"cook_minutes"`
	SourceURL       string             `json:"source_url"`
	ImageURL        string             `json:"image_url"`
	IngredientCount int                `json:"ingredient_count"`
	Ingredients     []RecipeIngredient `json:"ingredients,omitempty"`
	CreatedAt       time.Time          `json:"created_at"`
	UpdatedAt       time.Time          `json:"updated_at"`
}

// IngredientInput holds data for inserting an ingredient row.
type IngredientInput struct {
	Name     string `json:"name"`
	Quantity string `json:"quantity"`
	Unit     string `json:"unit"`
}

// RecipeInput holds data for creating or updating a recipe.
type RecipeInput struct {
	Title        string
	Description  string
	Instructions string
	Servings     int
	PrepMinutes  int
	CookMinutes  int
	SourceURL    string
	ImageURL     string
	Ingredients  []IngredientInput
}

// ListRecipes returns all recipes ordered newest first with ingredient counts.
func ListRecipes(ctx context.Context, conn *sql.DB) ([]Recipe, error) {
	rows, err := conn.QueryContext(ctx, `
		SELECT
			r.id,
			r.title,
			r.description,
			r.instructions,
			r.servings,
			r.prep_minutes,
			r.cook_minutes,
			r.source_url,
			r.image_url,
			COUNT(ri.id) AS ingredient_count,
			r.created_at,
			r.updated_at
		FROM recipes r
		LEFT JOIN recipe_ingredients ri ON ri.recipe_id = r.id
		GROUP BY r.id
		ORDER BY r.created_at DESC, r.id DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list recipes: %w", err)
	}
	defer rows.Close()

	recipes := make([]Recipe, 0)
	for rows.Next() {
		var r Recipe
		if err := rows.Scan(
			&r.ID,
			&r.Title,
			&r.Description,
			&r.Instructions,
			&r.Servings,
			&r.PrepMinutes,
			&r.CookMinutes,
			&r.SourceURL,
			&r.ImageURL,
			&r.IngredientCount,
			&r.CreatedAt,
			&r.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan recipe: %w", err)
		}
		recipes = append(recipes, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate recipes: %w", err)
	}

	return recipes, nil
}

// GetRecipe returns a single recipe with its ordered ingredients.
func GetRecipe(ctx context.Context, conn *sql.DB, id int64) (*Recipe, error) {
	var r Recipe
	err := conn.QueryRowContext(ctx, `
		SELECT
			id,
			title,
			description,
			instructions,
			servings,
			prep_minutes,
			cook_minutes,
			source_url,
			image_url,
			created_at,
			updated_at
		FROM recipes
		WHERE id = ?
	`, id).Scan(
		&r.ID,
		&r.Title,
		&r.Description,
		&r.Instructions,
		&r.Servings,
		&r.PrepMinutes,
		&r.CookMinutes,
		&r.SourceURL,
		&r.ImageURL,
		&r.CreatedAt,
		&r.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get recipe %d: %w", id, err)
	}

	ingRows, err := conn.QueryContext(ctx, `
		SELECT id, recipe_id, name, quantity, unit, sort_order
		FROM recipe_ingredients
		WHERE recipe_id = ?
		ORDER BY sort_order ASC, id ASC
	`, id)
	if err != nil {
		return nil, fmt.Errorf("list ingredients for recipe %d: %w", id, err)
	}
	defer ingRows.Close()

	ingredients := make([]RecipeIngredient, 0)
	for ingRows.Next() {
		var ing RecipeIngredient
		if err := ingRows.Scan(&ing.ID, &ing.RecipeID, &ing.Name, &ing.Quantity, &ing.Unit, &ing.SortOrder); err != nil {
			return nil, fmt.Errorf("scan ingredient for recipe %d: %w", id, err)
		}
		ingredients = append(ingredients, ing)
	}
	if err := ingRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate ingredients for recipe %d: %w", id, err)
	}

	r.Ingredients = ingredients
	r.IngredientCount = len(ingredients)
	return &r, nil
}

// CreateRecipe inserts a recipe and all of its ingredients in a single transaction.
func CreateRecipe(ctx context.Context, conn *sql.DB, in RecipeInput) (*Recipe, error) {
	servings := in.Servings
	if servings <= 0 {
		servings = 1
	}
	prepMinutes := max(in.PrepMinutes, 0)
	cookMinutes := max(in.CookMinutes, 0)

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin create recipe tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	res, err := tx.ExecContext(ctx, `
		INSERT INTO recipes (
			title, description, instructions, servings,
			prep_minutes, cook_minutes, source_url, image_url
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`,
		strings.TrimSpace(in.Title),
		strings.TrimSpace(in.Description),
		strings.TrimSpace(in.Instructions),
		servings,
		prepMinutes,
		cookMinutes,
		strings.TrimSpace(in.SourceURL),
		strings.TrimSpace(in.ImageURL),
	)
	if err != nil {
		return nil, fmt.Errorf("insert recipe: %w", err)
	}

	recipeID, err := res.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("get created recipe id: %w", err)
	}

	if err := insertIngredientsTx(ctx, tx, recipeID, in.Ingredients); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit create recipe tx: %w", err)
	}

	return GetRecipe(ctx, conn, recipeID)
}

// UpdateRecipe updates an existing recipe and replaces its ingredients in a transaction.
func UpdateRecipe(ctx context.Context, conn *sql.DB, id int64, in RecipeInput) (*Recipe, error) {
	servings := in.Servings
	if servings <= 0 {
		servings = 1
	}
	prepMinutes := max(in.PrepMinutes, 0)
	cookMinutes := max(in.CookMinutes, 0)

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin update recipe tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	res, err := tx.ExecContext(ctx, `
		UPDATE recipes
		SET
			title = ?,
			description = ?,
			instructions = ?,
			servings = ?,
			prep_minutes = ?,
			cook_minutes = ?,
			source_url = ?,
			image_url = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`,
		strings.TrimSpace(in.Title),
		strings.TrimSpace(in.Description),
		strings.TrimSpace(in.Instructions),
		servings,
		prepMinutes,
		cookMinutes,
		strings.TrimSpace(in.SourceURL),
		strings.TrimSpace(in.ImageURL),
		id,
	)
	if err != nil {
		return nil, fmt.Errorf("update recipe %d: %w", id, err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return nil, fmt.Errorf("rows affected for recipe %d: %w", id, err)
	}
	if affected == 0 {
		return nil, ErrNotFound
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM recipe_ingredients WHERE recipe_id = ?`, id); err != nil {
		return nil, fmt.Errorf("clear ingredients for recipe %d: %w", id, err)
	}

	if err := insertIngredientsTx(ctx, tx, id, in.Ingredients); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit update recipe tx: %w", err)
	}

	return GetRecipe(ctx, conn, id)
}

// DeleteRecipe removes a recipe (cascading its ingredients) and returns its previous image_url.
func DeleteRecipe(ctx context.Context, conn *sql.DB, id int64) (string, error) {
	var imageURL string
	err := conn.QueryRowContext(ctx, `SELECT image_url FROM recipes WHERE id = ?`, id).Scan(&imageURL)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("lookup recipe %d before delete: %w", id, err)
	}

	if _, err := conn.ExecContext(ctx, `DELETE FROM recipes WHERE id = ?`, id); err != nil {
		return "", fmt.Errorf("delete recipe %d: %w", id, err)
	}

	return imageURL, nil
}

func insertIngredientsTx(ctx context.Context, tx *sql.Tx, recipeID int64, items []IngredientInput) error {
	if len(items) == 0 {
		return nil
	}

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO recipe_ingredients (recipe_id, name, quantity, unit, sort_order)
		VALUES (?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("prepare ingredient insert: %w", err)
	}
	defer stmt.Close()

	order := 0
	for _, ing := range items {
		name := strings.TrimSpace(ing.Name)
		if name == "" {
			continue
		}
		if _, err := stmt.ExecContext(
			ctx,
			recipeID,
			name,
			strings.TrimSpace(ing.Quantity),
			strings.TrimSpace(ing.Unit),
			order,
		); err != nil {
			return fmt.Errorf("insert ingredient %q: %w", name, err)
		}
		order++
	}

	return nil
}
