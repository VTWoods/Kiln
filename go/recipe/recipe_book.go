package recipe

import (
	"database/sql"

	recipepb "github.com/VTWoods/kiln/proto"
	"github.com/google/uuid"
)

type RecipeBook struct {
	db *sql.DB
}

func (b *RecipeBook) AddRecipe(newRecipe *recipepb.Recipe) (string, error) {
	insertStatement := `
	INSERT INTO recipes (id, title, content_blob)
	VALUES ($1, $2, $3)
	`
	id := uuid.New().String()
	if _, err := b.db.Exec(insertStatement, id, newRecipe.Title, ""); err != nil {
		return "", err
	}
	return id, nil
}

func (b *RecipeBook) ListRecipes() ([]*recipepb.Recipe, error) {
	listStatement := `
	SELECT title FROM recipes
	`
	rows, err := b.db.Query(listStatement)
	if err != nil {
		return nil, err
	}
	var recipes []*recipepb.Recipe
	for rows.Next() {
		title := ""
		rows.Scan(&title)
		recipes = append(recipes, &recipepb.Recipe{Title: title})
	}
	return recipes, nil
}

func NewRecipeBook(db *sql.DB) *RecipeBook {
	return &RecipeBook{db: db}
}
