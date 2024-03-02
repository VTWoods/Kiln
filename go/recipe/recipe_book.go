package recipe

import (
	"database/sql"

	recipepb "github.com/VTWoods/kiln/proto"
)

type RecipeBook struct {
	db *sql.DB
}

func (b *RecipeBook) AddRecipe(newRecipe *recipepb.Recipe) (int, error) {
	insertStatement := `
	INSERT INTO recipes (title, content_blob)
	VALUES ($1, $2)
	RETURNING id;
	`
	id := 0
	if err := b.db.QueryRow(insertStatement, newRecipe.Title, "").Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}

func (b *RecipeBook) ListRecipes() ([]*recipepb.Recipe, error) {
	listStatement := `
	SELECT id, title FROM recipes
	`
	rows, err := b.db.Query(listStatement)
	if err != nil {
		return nil, err
	}
	var recipes []*recipepb.Recipe
	for rows.Next() {
		title := ""
		id := 0
		rows.Scan(&id, &title)
		recipes = append(recipes, &recipepb.Recipe{Id: int32(id), Title: title})
	}
	return recipes, nil
}

func NewRecipeBook(db *sql.DB) *RecipeBook {
	return &RecipeBook{db: db}
}
