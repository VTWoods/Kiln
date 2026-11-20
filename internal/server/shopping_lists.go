package server

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/VTWoods/Kiln/internal/db"
	"github.com/gin-gonic/gin"
)

type createShoppingListRequest struct {
	Name string `json:"name"`
}

type addShoppingListItemsRequest struct {
	Items []db.ShoppingListItemInput `json:"items"`
}

func registerShoppingListRoutes(api *gin.RouterGroup, cfg Config) {
	api.GET("/shopping-lists", handleListShoppingLists(cfg))
	api.POST("/shopping-lists", handleCreateShoppingList(cfg))
	api.GET("/shopping-lists/:id", handleGetShoppingList(cfg))
	api.DELETE("/shopping-lists/:id", handleDeleteShoppingList(cfg))
	api.POST("/shopping-lists/:id/items", handleAddShoppingListItems(cfg))
	api.PATCH("/shopping-lists/:id/items/:itemId", handleUpdateShoppingListItem(cfg))
	api.DELETE("/shopping-lists/:id/items/:itemId", handleDeleteShoppingListItem(cfg))
	api.DELETE("/shopping-lists/:id/checked", handleClearCheckedShoppingListItems(cfg))
}

func handleListShoppingLists(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.DB == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database is not configured"})
			return
		}

		lists, err := db.ListShoppingLists(c.Request.Context(), cfg.DB)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list shopping lists"})
			return
		}
		c.JSON(http.StatusOK, lists)
	}
}

func handleCreateShoppingList(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.DB == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database is not configured"})
			return
		}

		var req createShoppingListRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}
		if strings.TrimSpace(req.Name) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "shopping list name is required"})
			return
		}

		created, err := db.CreateShoppingList(c.Request.Context(), cfg.DB, req.Name)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create shopping list"})
			return
		}
		c.JSON(http.StatusCreated, created)
	}
}

func handleGetShoppingList(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.DB == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database is not configured"})
			return
		}

		id, ok := parseNamedIDParam(c, "id", "shopping list id")
		if !ok {
			return
		}

		list, err := db.GetShoppingList(c.Request.Context(), cfg.DB, id)
		if errors.Is(err, db.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "shopping list not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load shopping list"})
			return
		}
		c.JSON(http.StatusOK, list)
	}
}

func handleDeleteShoppingList(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.DB == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database is not configured"})
			return
		}

		id, ok := parseNamedIDParam(c, "id", "shopping list id")
		if !ok {
			return
		}

		err := db.DeleteShoppingList(c.Request.Context(), cfg.DB, id)
		if errors.Is(err, db.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "shopping list not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete shopping list"})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

func handleAddShoppingListItems(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.DB == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database is not configured"})
			return
		}

		listID, ok := parseNamedIDParam(c, "id", "shopping list id")
		if !ok {
			return
		}

		var req addShoppingListItemsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}

		validCount := 0
		for _, item := range req.Items {
			if strings.TrimSpace(item.Name) != "" {
				validCount++
			}
		}
		if validCount == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "at least one item with a name is required"})
			return
		}

		updated, err := db.AddShoppingListItems(c.Request.Context(), cfg.DB, listID, req.Items)
		if errors.Is(err, db.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "shopping list not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to add items to shopping list"})
			return
		}
		c.JSON(http.StatusCreated, updated)
	}
}

func handleUpdateShoppingListItem(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.DB == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database is not configured"})
			return
		}

		listID, ok := parseNamedIDParam(c, "id", "shopping list id")
		if !ok {
			return
		}
		itemID, ok := parseNamedIDParam(c, "itemId", "shopping list item id")
		if !ok {
			return
		}

		var req db.ShoppingListItemUpdate
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}

		item, err := db.UpdateShoppingListItem(c.Request.Context(), cfg.DB, listID, itemID, req)
		if errors.Is(err, db.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "shopping list item not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update shopping list item"})
			return
		}
		c.JSON(http.StatusOK, item)
	}
}

func handleDeleteShoppingListItem(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.DB == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database is not configured"})
			return
		}

		listID, ok := parseNamedIDParam(c, "id", "shopping list id")
		if !ok {
			return
		}
		itemID, ok := parseNamedIDParam(c, "itemId", "shopping list item id")
		if !ok {
			return
		}

		err := db.DeleteShoppingListItem(c.Request.Context(), cfg.DB, listID, itemID)
		if errors.Is(err, db.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "shopping list item not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete shopping list item"})
			return
		}
		c.Status(http.StatusNoContent)
	}
}

func handleClearCheckedShoppingListItems(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.DB == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database is not configured"})
			return
		}

		listID, ok := parseNamedIDParam(c, "id", "shopping list id")
		if !ok {
			return
		}

		updated, err := db.ClearCheckedShoppingListItems(c.Request.Context(), cfg.DB, listID)
		if errors.Is(err, db.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "shopping list not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to clear checked items"})
			return
		}
		c.JSON(http.StatusOK, updated)
	}
}

func parseNamedIDParam(c *gin.Context, paramName, label string) (int64, bool) {
	id, err := strconv.ParseInt(c.Param(paramName), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid " + label})
		return 0, false
	}
	return id, true
}
