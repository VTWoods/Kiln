package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/VTWoods/Kiln/internal/db"
	"github.com/gin-gonic/gin"
)

func TestShoppingListsAndRecipeIngredientFlow(t *testing.T) {
	gin.SetMode(gin.TestMode)

	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open in-memory db: %v", err)
	}
	defer conn.Close()

	router := NewRouter(Config{
		DB:        conn,
		StaticDir: t.TempDir(),
	})

	// 1. Seed a recipe.
	recipePayload := `{"title":"Beef Stew","servings":6,"ingredients":[{"quantity":"3","unit":"lbs","name":"beef chuck"},{"quantity":"2","unit":"cups","name":"chicken stock"}]}`
	recReq := httptest.NewRequest(http.MethodPost, "/api/recipes", strings.NewReader(recipePayload))
	recReq.Header.Set("Content-Type", "application/json")
	recRes := httptest.NewRecorder()
	router.ServeHTTP(recRes, recReq)
	if recRes.Code != http.StatusCreated {
		t.Fatalf("create recipe status=%d body=%s", recRes.Code, recRes.Body.String())
	}
	var createdRecipe db.Recipe
	if err := json.Unmarshal(recRes.Body.Bytes(), &createdRecipe); err != nil {
		t.Fatalf("unmarshal recipe: %v", err)
	}

	// 2. Create a shopping list.
	listReq := httptest.NewRequest(http.MethodPost, "/api/shopping-lists", strings.NewReader(`{"name":"Weekly Groceries"}`))
	listReq.Header.Set("Content-Type", "application/json")
	listRes := httptest.NewRecorder()
	router.ServeHTTP(listRes, listReq)
	if listRes.Code != http.StatusCreated {
		t.Fatalf("create shopping list status=%d body=%s", listRes.Code, listRes.Body.String())
	}
	var list db.ShoppingList
	if err := json.Unmarshal(listRes.Body.Bytes(), &list); err != nil {
		t.Fatalf("unmarshal list: %v", err)
	}

	// 3. Add only one filtered ingredient from the recipe (simulating user removing one they already have).
	addBody, _ := json.Marshal(map[string]any{
		"items": []map[string]any{
			{
				"quantity":  "3",
				"unit":      "lbs",
				"name":      "beef chuck",
				"recipe_id": createdRecipe.ID,
			},
		},
	})
	addReq := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/shopping-lists/%d/items", list.ID), bytes.NewReader(addBody))
	addReq.Header.Set("Content-Type", "application/json")
	addRes := httptest.NewRecorder()
	router.ServeHTTP(addRes, addReq)
	if addRes.Code != http.StatusCreated {
		t.Fatalf("add items status=%d body=%s", addRes.Code, addRes.Body.String())
	}

	var updatedList db.ShoppingList
	if err := json.Unmarshal(addRes.Body.Bytes(), &updatedList); err != nil {
		t.Fatalf("unmarshal updated list: %v", err)
	}
	if len(updatedList.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(updatedList.Items))
	}
	if updatedList.Items[0].RecipeTitle != "Beef Stew" || updatedList.Items[0].RecipeID == nil || *updatedList.Items[0].RecipeID != createdRecipe.ID {
		t.Fatalf("expected recipe metadata on item, got %+v", updatedList.Items[0])
	}

	// 4. Check off the item via PATCH.
	itemID := updatedList.Items[0].ID
	patchReq := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/shopping-lists/%d/items/%d", list.ID, itemID), strings.NewReader(`{"checked":true}`))
	patchReq.Header.Set("Content-Type", "application/json")
	patchRes := httptest.NewRecorder()
	router.ServeHTTP(patchRes, patchReq)
	if patchRes.Code != http.StatusOK {
		t.Fatalf("patch item status=%d body=%s", patchRes.Code, patchRes.Body.String())
	}

	// 5. Clear checked items.
	clearReq := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/shopping-lists/%d/checked", list.ID), nil)
	clearRes := httptest.NewRecorder()
	router.ServeHTTP(clearRes, clearReq)
	if clearRes.Code != http.StatusOK {
		t.Fatalf("clear checked status=%d body=%s", clearRes.Code, clearRes.Body.String())
	}
	var clearedList db.ShoppingList
	if err := json.Unmarshal(clearRes.Body.Bytes(), &clearedList); err != nil {
		t.Fatalf("unmarshal cleared list: %v", err)
	}
	if len(clearedList.Items) != 0 {
		t.Fatalf("expected 0 items after clearing checked, got %d", len(clearedList.Items))
	}

	// 6. Delete shopping list.
	delReq := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/shopping-lists/%d", list.ID), nil)
	delRes := httptest.NewRecorder()
	router.ServeHTTP(delRes, delReq)
	if delRes.Code != http.StatusNoContent {
		t.Fatalf("delete list status=%d body=%s", delRes.Code, delRes.Body.String())
	}
}
