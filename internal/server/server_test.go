package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/VTWoods/Kiln/internal/db"
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
