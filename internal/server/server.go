package server

import (
	"context"
	"database/sql"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/VTWoods/Kiln/internal/importer"
	"github.com/gin-gonic/gin"
)

// Config holds dependencies for the HTTP server.
type Config struct {
	DB         *sql.DB
	StaticDir  string
	Importer   importer.Importer
	ImageStore *importer.ImageStore
}

// NewRouter builds the Gin engine with API routes and static React SPA serving.
func NewRouter(cfg Config) *gin.Engine {
	r := gin.Default()

	api := r.Group("/api")
	{
		api.GET("/health", func(c *gin.Context) {
			dbStatus := "unconfigured"
			if cfg.DB != nil {
				ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
				defer cancel()
				if err := cfg.DB.PingContext(ctx); err != nil {
					c.JSON(http.StatusServiceUnavailable, gin.H{
						"status":   "degraded",
						"service":  "kiln",
						"database": "error",
						"error":    err.Error(),
					})
					return
				}
				dbStatus = "ok"
			}

			c.JSON(http.StatusOK, gin.H{
				"status":   "ok",
				"service":  "kiln",
				"database": dbStatus,
			})
		})

		registerRecipeRoutes(api, cfg)
	}

	// Serve built React static files and fall back to index.html for client-side routes.
	r.NoRoute(staticSPAHandler(cfg.StaticDir))

	return r
}

func staticSPAHandler(staticDir string) gin.HandlerFunc {
	cleanRoot := filepath.Clean(staticDir)

	return func(c *gin.Context) {
		reqPath := c.Request.URL.Path

		// Never serve index.html for unknown API endpoints.
		if reqPath == "/api" || strings.HasPrefix(reqPath, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "endpoint not found"})
			return
		}

		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			c.Status(http.StatusMethodNotAllowed)
			return
		}

		// Clean and resolve requested file inside staticDir without escaping cleanRoot.
		relPath := strings.TrimPrefix(filepath.Clean("/"+reqPath), "/")
		candidate := filepath.Join(cleanRoot, relPath)

		if relPath != "" && isWithinDir(cleanRoot, candidate) {
			if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
				c.File(candidate)
				return
			}
		}

		indexPath := filepath.Join(cleanRoot, "index.html")
		if _, err := os.Stat(indexPath); err != nil {
			c.String(
				http.StatusServiceUnavailable,
				"Frontend assets not found in %q. Build the React app first (e.g. `make build-web`).\n",
				staticDir,
			)
			return
		}

		c.File(indexPath)
	}
}

func isWithinDir(base, target string) bool {
	rel, err := filepath.Rel(base, target)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}
