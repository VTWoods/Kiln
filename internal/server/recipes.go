package server

import (
	"errors"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/VTWoods/Kiln/internal/db"
	"github.com/VTWoods/Kiln/internal/importer"
	"github.com/gin-gonic/gin"
)

type importPreviewRequest struct {
	URL string `json:"url"`
}

type saveRecipeRequest struct {
	Title        string               `json:"title"`
	Description  string               `json:"description"`
	Instructions string               `json:"instructions"`
	Servings     int                  `json:"servings"`
	PrepMinutes  int                  `json:"prep_minutes"`
	CookMinutes  int                  `json:"cook_minutes"`
	SourceURL    string               `json:"source_url"`
	ImageURL     string               `json:"image_url"`
	Ingredients  []db.IngredientInput `json:"ingredients"`
}

func registerRecipeRoutes(api *gin.RouterGroup, cfg Config) {
	api.POST("/recipes/import-preview", handleImportPreview(cfg))
	api.GET("/recipes", handleListRecipes(cfg))
	api.POST("/recipes", handleCreateRecipe(cfg))
	api.GET("/recipes/:id", handleGetRecipe(cfg))
	api.PUT("/recipes/:id", handleUpdateRecipe(cfg))
	api.DELETE("/recipes/:id", handleDeleteRecipe(cfg))
	api.GET("/images/:filename", handleServeImage(cfg))
}

func handleImportPreview(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.Importer == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "recipe importer is not configured"})
			return
		}

		var req importPreviewRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}

		preview, err := cfg.Importer.ImportURL(c.Request.Context(), req.URL)
		if err != nil {
			writeImporterError(c, err)
			return
		}

		c.JSON(http.StatusOK, preview)
	}
}

func handleListRecipes(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.DB == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database is not configured"})
			return
		}

		recipes, err := db.ListRecipes(c.Request.Context(), cfg.DB)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list recipes"})
			return
		}

		c.JSON(http.StatusOK, recipes)
	}
}

func handleGetRecipe(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.DB == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database is not configured"})
			return
		}

		id, ok := parseIDParam(c)
		if !ok {
			return
		}

		rec, err := db.GetRecipe(c.Request.Context(), cfg.DB, id)
		if errors.Is(err, db.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "recipe not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load recipe"})
			return
		}

		c.JSON(http.StatusOK, rec)
	}
}

func handleCreateRecipe(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.DB == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database is not configured"})
			return
		}

		var req saveRecipeRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}

		if err := validateRecipeRequest(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		imageURL, newlyCached, err := resolveAndCacheImage(c, cfg.ImageStore, req.ImageURL, req.SourceURL)
		if err != nil {
			writeImporterError(c, err)
			return
		}

		created, err := db.CreateRecipe(c.Request.Context(), cfg.DB, db.RecipeInput{
			Title:        req.Title,
			Description:  req.Description,
			Instructions: req.Instructions,
			Servings:     req.Servings,
			PrepMinutes:  req.PrepMinutes,
			CookMinutes:  req.CookMinutes,
			SourceURL:    req.SourceURL,
			ImageURL:     imageURL,
			Ingredients:  req.Ingredients,
		})
		if err != nil {
			if newlyCached {
				cfg.ImageStore.DeleteLocal(imageURL)
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save recipe"})
			return
		}

		c.JSON(http.StatusCreated, created)
	}
}

func handleUpdateRecipe(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.DB == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database is not configured"})
			return
		}

		id, ok := parseIDParam(c)
		if !ok {
			return
		}

		var req saveRecipeRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}

		if err := validateRecipeRequest(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		existing, err := db.GetRecipe(c.Request.Context(), cfg.DB, id)
		if errors.Is(err, db.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "recipe not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load recipe"})
			return
		}

		imageURL, newlyCached, err := resolveAndCacheImage(c, cfg.ImageStore, req.ImageURL, req.SourceURL)
		if err != nil {
			writeImporterError(c, err)
			return
		}

		updated, err := db.UpdateRecipe(c.Request.Context(), cfg.DB, id, db.RecipeInput{
			Title:        req.Title,
			Description:  req.Description,
			Instructions: req.Instructions,
			Servings:     req.Servings,
			PrepMinutes:  req.PrepMinutes,
			CookMinutes:  req.CookMinutes,
			SourceURL:    req.SourceURL,
			ImageURL:     imageURL,
			Ingredients:  req.Ingredients,
		})
		if err != nil {
			if newlyCached {
				cfg.ImageStore.DeleteLocal(imageURL)
			}
			if errors.Is(err, db.ErrNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "recipe not found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update recipe"})
			return
		}

		if existing.ImageURL != "" && existing.ImageURL != updated.ImageURL {
			cfg.ImageStore.DeleteLocal(existing.ImageURL)
		}

		c.JSON(http.StatusOK, updated)
	}
}

func handleDeleteRecipe(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.DB == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database is not configured"})
			return
		}

		id, ok := parseIDParam(c)
		if !ok {
			return
		}

		prevImageURL, err := db.DeleteRecipe(c.Request.Context(), cfg.DB, id)
		if errors.Is(err, db.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "recipe not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete recipe"})
			return
		}

		cfg.ImageStore.DeleteLocal(prevImageURL)
		c.Status(http.StatusNoContent)
	}
}

func handleServeImage(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.ImageStore == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "image store not configured"})
			return
		}

		filename := c.Param("filename")
		path, ok := cfg.ImageStore.FilePath(filename)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid image filename"})
			return
		}

		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			c.JSON(http.StatusNotFound, gin.H{"error": "image not found"})
			return
		}

		c.Header("Cache-Control", "public, max-age=31536000, immutable")
		c.File(path)
	}
}

func parseIDParam(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid recipe id"})
		return 0, false
	}
	return id, true
}

func validateRecipeRequest(req *saveRecipeRequest) error {
	if strings.TrimSpace(req.Title) == "" {
		return errors.New("recipe title is required")
	}
	if strings.TrimSpace(req.SourceURL) != "" {
		if _, err := importer.ValidateHTTPURL(req.SourceURL); err != nil {
			return err
		}
	}
	return nil
}

func resolveAndCacheImage(c *gin.Context, store *importer.ImageStore, rawImageURL string, sourceURL string) (string, bool, error) {
	trimmed := strings.TrimSpace(rawImageURL)
	if trimmed == "" {
		return "", false, nil
	}
	if importer.IsLocalImageURL(trimmed) {
		return trimmed, false, nil
	}
	if _, err := importer.ValidateHTTPURL(trimmed); err != nil {
		return "", false, err
	}
	if store == nil {
		return "", false, errors.New("image store is not configured")
	}

	localPath, err := store.SaveFromURL(c.Request.Context(), trimmed, sourceURL)
	if err != nil {
		return "", false, err
	}
	return localPath, true, nil
}

func writeImporterError(c *gin.Context, err error) {
	log.Printf("recipe import error: %v", err)
	switch {
	case errors.Is(err, importer.ErrInvalidURL):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, importer.ErrParseFailed):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "Could not extract recipe data from this page. The site may not include supported recipe markup."})
	case errors.Is(err, importer.ErrFetchFailed):
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}
