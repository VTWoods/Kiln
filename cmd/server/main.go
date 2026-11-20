package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/VTWoods/Kiln/internal/db"
	"github.com/VTWoods/Kiln/internal/importer"
	"github.com/VTWoods/Kiln/internal/server"
)

func main() {
	host := envOrDefault("HOST", "0.0.0.0")
	port := envOrDefault("PORT", "8080")
	dbPath := envOrDefault("DB_PATH", "./data/kiln.db")
	staticDir := envOrDefault("STATIC_DIR", "./web/dist")
	imagesDir := envOrDefault("IMAGES_DIR", filepath.Join(filepath.Dir(dbPath), "images"))
	scraperPython := envOrDefault("SCRAPER_PYTHON", defaultPythonBin())
	scraperScript := envOrDefault("SCRAPER_SCRIPT", "./scripts/scrape_recipe.py")

	conn, err := db.Open(dbPath)
	if err != nil {
		log.Fatalf("failed to initialize database: %v", err)
	}
	defer func() {
		if err := conn.Close(); err != nil {
			log.Printf("error closing database: %v", err)
		}
	}()

	fetcher := importer.NewSafeFetcher()
	recipeImporter := importer.NewRecipeScrapersImporter(fetcher, scraperPython, scraperScript)
	imageStore := importer.NewImageStore(imagesDir, fetcher)

	router := server.NewRouter(server.Config{
		DB:         conn,
		StaticDir:  staticDir,
		Importer:   recipeImporter,
		ImageStore: imageStore,
	})

	addr := host + ":" + port
	srv := &http.Server{
		Addr:              addr,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("Kiln server listening on http://%s (static=%s, db=%s)", addr, staticDir, dbPath)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down Kiln server...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("server forced to shutdown: %v", err)
	}
}

func envOrDefault(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

func defaultPythonBin() string {
	const venvPython = "./.venv/bin/python3"
	if _, err := os.Stat(venvPython); err == nil {
		return venvPython
	}
	return "python3"
}
