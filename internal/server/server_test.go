package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/VTWoods/Kiln/internal/db"
	"github.com/VTWoods/Kiln/internal/importer"
	"github.com/gin-gonic/gin"
)

func TestHealthEndpoint(t *testing.T) {
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

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if body["status"] != "ok" || body["database"] != "ok" || body["service"] != "kiln" {
		t.Fatalf("unexpected health response: %+v", body)
	}
}

func TestUnknownAPIRouteReturns404JSON(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := NewRouter(Config{StaticDir: t.TempDir()})

	req := httptest.NewRequest(http.MethodGet, "/api/does-not-exist", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("expected json content-type, got %q", ct)
	}
}

func TestStaticAndSPAFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)

	staticDir := t.TempDir()
	assetsDir := filepath.Join(staticDir, "assets")
	if err := os.MkdirAll(assetsDir, 0o755); err != nil {
		t.Fatalf("mkdir assets: %v", err)
	}

	indexContent := "<!doctype html><html><body>Kiln SPA</body></html>"
	jsContent := "console.log('kiln');"

	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte(indexContent), 0o644); err != nil {
		t.Fatalf("write index.html: %v", err)
	}
	if err := os.WriteFile(filepath.Join(assetsDir, "app.js"), []byte(jsContent), 0o644); err != nil {
		t.Fatalf("write app.js: %v", err)
	}

	router := NewRouter(Config{StaticDir: staticDir})

	t.Run("serves root index.html", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK || rec.Body.String() != indexContent {
			t.Fatalf("unexpected response (%d): %q", rec.Code, rec.Body.String())
		}
	})

	t.Run("serves static asset directly", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK || rec.Body.String() != jsContent {
			t.Fatalf("unexpected response (%d): %q", rec.Code, rec.Body.String())
		}
	})

	t.Run("falls back to index.html for client-side route", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/shopping-lists/42", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK || rec.Body.String() != indexContent {
			t.Fatalf("unexpected response (%d): %q", rec.Code, rec.Body.String())
		}
	})
}

type stubImporter struct {
	preview *importer.ImportedRecipe
	err     error
}

func (s stubImporter) ImportURL(_ context.Context, _ string) (*importer.ImportedRecipe, error) {
	return s.preview, s.err
}

func TestRecipeImportPreviewAndCRUDWithLocalImageCache(t *testing.T) {
	gin.SetMode(gin.TestMode)

	pngBytes, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")
	if err != nil {
		t.Fatalf("decode png: %v", err)
	}
	imgServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(pngBytes)
	}))
	defer imgServer.Close()

	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open in-memory db: %v", err)
	}
	defer conn.Close()

	imagesDir := t.TempDir()
	imgStore := importer.NewImageStore(imagesDir, importer.NewSafeFetcher(importer.WithAllowPrivateNetworks(true)))
	stub := stubImporter{
		preview: &importer.ImportedRecipe{
			Title:           "Roasted Tomato Soup",
			Description:     "Rich roasted tomato soup.",
			Instructions:    "Roast tomatoes.\n\nBlend until smooth.",
			Servings:        4,
			PrepMinutes:     15,
			CookMinutes:     40,
			SourceURL:       "https://example.com/tomato-soup",
			ImageURL:        imgServer.URL + "/soup.png",
			CandidateImages: []string{imgServer.URL + "/soup.png", imgServer.URL + "/bowl.png"},
			Ingredients: []importer.ImportedIngredient{
				{Raw: "2 lbs tomatoes", Quantity: "2", Unit: "lbs", Name: "tomatoes"},
				{Raw: "3 cloves garlic", Quantity: "3", Unit: "cloves", Name: "garlic"},
			},
		},
	}

	router := NewRouter(Config{
		DB:         conn,
		StaticDir:  t.TempDir(),
		Importer:   stub,
		ImageStore: imgStore,
	})

	// 1. Preview import via stubbed Importer interface.
	previewReq := httptest.NewRequest(http.MethodPost, "/api/recipes/import-preview", strings.NewReader(`{"url":"https://example.com/tomato-soup"}`))
	previewReq.Header.Set("Content-Type", "application/json")
	previewRec := httptest.NewRecorder()
	router.ServeHTTP(previewRec, previewReq)

	if previewRec.Code != http.StatusOK {
		t.Fatalf("import-preview status=%d body=%s", previewRec.Code, previewRec.Body.String())
	}

	var preview importer.ImportedRecipe
	if err := json.Unmarshal(previewRec.Body.Bytes(), &preview); err != nil {
		t.Fatalf("unmarshal preview: %v", err)
	}
	if preview.Title != "Roasted Tomato Soup" || len(preview.CandidateImages) != 2 {
		t.Fatalf("unexpected preview: %+v", preview)
	}

	// 2. Save previewed recipe — backend should download & cache the chosen photo locally.
	createPayload, _ := json.Marshal(map[string]any{
		"title":        preview.Title,
		"description":  preview.Description,
		"instructions": preview.Instructions,
		"servings":     preview.Servings,
		"prep_minutes": preview.PrepMinutes,
		"cook_minutes": preview.CookMinutes,
		"source_url":   preview.SourceURL,
		"image_url":    preview.CandidateImages[1],
		"ingredients": []map[string]string{
			{"quantity": "2", "unit": "lbs", "name": "tomatoes"},
			{"quantity": "3", "unit": "cloves", "name": "garlic"},
		},
	})
	createReq := httptest.NewRequest(http.MethodPost, "/api/recipes", bytes.NewReader(createPayload))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	router.ServeHTTP(createRec, createReq)

	if createRec.Code != http.StatusCreated {
		t.Fatalf("create recipe status=%d body=%s", createRec.Code, createRec.Body.String())
	}

	var created db.Recipe
	if err := json.Unmarshal(createRec.Body.Bytes(), &created); err != nil {
		t.Fatalf("unmarshal created recipe: %v", err)
	}
	if !strings.HasPrefix(created.ImageURL, "/api/images/") {
		t.Fatalf("expected locally cached image URL, got %q", created.ImageURL)
	}
	if created.SourceURL != "https://example.com/tomato-soup" {
		t.Fatalf("unexpected source_url: %q", created.SourceURL)
	}
	if len(created.Ingredients) != 2 {
		t.Fatalf("expected 2 ingredients, got %d", len(created.Ingredients))
	}

	// 3. Cached image is served by /api/images/:filename.
	imgReq := httptest.NewRequest(http.MethodGet, created.ImageURL, nil)
	imgRec := httptest.NewRecorder()
	router.ServeHTTP(imgRec, imgReq)
	if imgRec.Code != http.StatusOK || !bytes.Equal(imgRec.Body.Bytes(), pngBytes) {
		t.Fatalf("expected cached image bytes, got status=%d len=%d", imgRec.Code, imgRec.Body.Len())
	}

	// 4. List & Get recipe.
	listReq := httptest.NewRequest(http.MethodGet, "/api/recipes", nil)
	listRec := httptest.NewRecorder()
	router.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("list recipes status=%d", listRec.Code)
	}
	var listed []db.Recipe
	if err := json.Unmarshal(listRec.Body.Bytes(), &listed); err != nil || len(listed) != 1 {
		t.Fatalf("expected 1 listed recipe, got len=%d err=%v", len(listed), err)
	}

	// 5. Delete recipe and confirm cached image is removed.
	delReq := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/recipes/%d", created.ID), nil)
	delRec := httptest.NewRecorder()
	router.ServeHTTP(delRec, delReq)
	if delRec.Code != http.StatusNoContent {
		t.Fatalf("delete recipe status=%d body=%s", delRec.Code, delRec.Body.String())
	}

	imgAfterDelReq := httptest.NewRequest(http.MethodGet, created.ImageURL, nil)
	imgAfterDelRec := httptest.NewRecorder()
	router.ServeHTTP(imgAfterDelRec, imgAfterDelReq)
	if imgAfterDelRec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 after deleting recipe image, got %d", imgAfterDelRec.Code)
	}
}
