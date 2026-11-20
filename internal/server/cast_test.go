package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/VTWoods/Kiln/internal/caster"
	"github.com/VTWoods/Kiln/internal/db"
	"github.com/gin-gonic/gin"
)

type stubCaster struct {
	devices     []caster.Device
	lastCastURL string
	lastHost    string
	stopped     bool
}

func (s *stubCaster) Discover(_ context.Context, _ time.Duration) ([]caster.Device, error) {
	return s.devices, nil
}

func (s *stubCaster) CastURL(_ context.Context, host string, _ int, pageURL string) (string, error) {
	s.lastHost = host
	s.lastCastURL = pageURL
	return pageURL, nil
}

func (s *stubCaster) Stop(_ context.Context, host string, _ int) error {
	s.lastHost = host
	s.stopped = true
	return nil
}

func TestCastRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)

	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open in-memory db: %v", err)
	}
	defer conn.Close()

	stub := &stubCaster{
		devices: []caster.Device{
			{Name: "Kitchen Display", Model: "Google Nest Hub", Host: "10.0.0.42", Port: 8009, UUID: "hub-1"},
		},
	}

	router := NewRouter(Config{
		DB:        conn,
		StaticDir: t.TempDir(),
		Caster:    stub,
	})

	// Seed a recipe.
	rec, err := db.CreateRecipe(context.Background(), conn, db.RecipeInput{
		Title:        "Pancakes",
		Instructions: "Mix batter.\n\nCook on griddle.",
		Servings:     4,
	})
	if err != nil {
		t.Fatalf("create recipe: %v", err)
	}

	// 1. Discover devices.
	devReq := httptest.NewRequest(http.MethodGet, "/api/cast/devices", nil)
	devRec := httptest.NewRecorder()
	router.ServeHTTP(devRec, devReq)
	if devRec.Code != http.StatusOK {
		t.Fatalf("discover status=%d body=%s", devRec.Code, devRec.Body.String())
	}
	var devResp struct {
		Devices []caster.Device `json:"devices"`
	}
	if err := json.Unmarshal(devRec.Body.Bytes(), &devResp); err != nil || len(devResp.Devices) != 1 {
		t.Fatalf("unexpected devices response: %s", devRec.Body.String())
	}

	// 2. Cast recipe to Nest Hub.
	castBody := `{"host":"10.0.0.42","port":8009,"base_url":"http://10.0.0.176:8090"}`
	castReq := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/cast/recipes/%d", rec.ID), strings.NewReader(castBody))
	castReq.Header.Set("Content-Type", "application/json")
	castRec := httptest.NewRecorder()
	router.ServeHTTP(castRec, castReq)
	if castRec.Code != http.StatusOK {
		t.Fatalf("cast recipe status=%d body=%s", castRec.Code, castRec.Body.String())
	}
	wantURL := fmt.Sprintf("http://10.0.0.176:8090/api/cast/recipes/%d/view", rec.ID)
	if stub.lastCastURL != wantURL || stub.lastHost != "10.0.0.42" {
		t.Fatalf("unexpected cast call: host=%q url=%q", stub.lastHost, stub.lastCastURL)
	}

	// 2b. Verify server-rendered Nest Hub view renders recipe title, instructions, and keep-alive timeout.
	viewReq := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/cast/recipes/%d/view", rec.ID), nil)
	viewRec := httptest.NewRecorder()
	router.ServeHTTP(viewRec, viewReq)
	body := viewRec.Body.String()
	if viewRec.Code != http.StatusOK ||
		!strings.Contains(body, "Pancakes") ||
		!strings.Contains(body, "Mix batter.") ||
		!strings.Contains(body, "disableIdleTimeout = true") {
		t.Fatalf("unexpected cast view response: status=%d body=%q", viewRec.Code, body)
	}

	// 3. Stop casting.
	stopReq := httptest.NewRequest(http.MethodPost, "/api/cast/stop", strings.NewReader(`{"host":"10.0.0.42","port":8009}`))
	stopReq.Header.Set("Content-Type", "application/json")
	stopRec := httptest.NewRecorder()
	router.ServeHTTP(stopRec, stopReq)
	if stopRec.Code != http.StatusOK || !stub.stopped {
		t.Fatalf("stop cast failed: status=%d stopped=%v", stopRec.Code, stub.stopped)
	}
}
