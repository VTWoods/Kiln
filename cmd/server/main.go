package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/VTWoods/Kiln/internal/db"
	"github.com/VTWoods/Kiln/internal/server"
)

func main() {
	port := envOrDefault("PORT", "8080")
	dbPath := envOrDefault("DB_PATH", "./data/kiln.db")
	staticDir := envOrDefault("STATIC_DIR", "./web/dist")

	conn, err := db.Open(dbPath)
	if err != nil {
		log.Fatalf("failed to initialize database: %v", err)
	}
	defer func() {
		if err := conn.Close(); err != nil {
			log.Printf("error closing database: %v", err)
		}
	}()

	router := server.NewRouter(server.Config{
		DB:        conn,
		StaticDir: staticDir,
	})

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("Kiln server listening on http://localhost:%s (static=%s, db=%s)", port, staticDir, dbPath)
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
