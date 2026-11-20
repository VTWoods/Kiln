package server

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/VTWoods/Kiln/internal/caster"
	"github.com/VTWoods/Kiln/internal/db"
	"github.com/gin-gonic/gin"
)

type castRecipeRequest struct {
	Host    string `json:"host"`
	Port    int    `json:"port"`
	BaseURL string `json:"base_url"`
}

type stopCastRequest struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}

func registerCastRoutes(api *gin.RouterGroup, cfg Config) {
	api.GET("/cast/devices", handleDiscoverCastDevices(cfg))
	api.POST("/cast/recipes/:id", handleCastRecipe(cfg))
	api.GET("/cast/recipes/:id/view", handleCastRecipeView(cfg))
	api.POST("/cast/stop", handleStopCast(cfg))
}

func handleDiscoverCastDevices(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.Caster == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "casting is not configured"})
			return
		}

		devices, err := cfg.Caster.Discover(c.Request.Context(), 3*time.Second)
		if err != nil {
			log.Printf("cast device discovery error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scan for Cast devices"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"devices": devices})
	}
}

func handleCastRecipe(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.DB == nil || cfg.Caster == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "casting is not configured"})
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

		var req castRecipeRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}
		if strings.TrimSpace(req.Host) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "device host IP is required"})
			return
		}

		baseURL := strings.TrimRight(strings.TrimSpace(req.BaseURL), "/")
		if baseURL == "" {
			scheme := "http"
			if c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
				scheme = "https"
			}
			baseURL = fmt.Sprintf("%s://%s", scheme, c.Request.Host)
		} else {
			parsed, err := url.Parse(baseURL)
			if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid base_url"})
				return
			}
			baseURL = fmt.Sprintf("%s://%s", parsed.Scheme, parsed.Host)
		}

		cookURL := fmt.Sprintf("%s/api/cast/recipes/%d/view", baseURL, rec.ID)
		resolvedURL, err := cfg.Caster.CastURL(c.Request.Context(), req.Host, req.Port, cookURL)
		if err != nil {
			log.Printf("cast recipe %d to %s:%d failed: %v", rec.ID, req.Host, req.Port, err)
			if errors.Is(err, caster.ErrInvalidTarget) {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Could not cast to %s: %v", req.Host, err)})
			return
		}
		log.Printf("cast recipe %d to %s:%d -> %s", rec.ID, req.Host, req.Port, resolvedURL)

		c.JSON(http.StatusOK, gin.H{
			"status": "ok",
			"url":    resolvedURL,
			"host":   req.Host,
		})
	}
}

func handleStopCast(cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.Caster == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "casting is not configured"})
			return
		}

		var req stopCastRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}
		if strings.TrimSpace(req.Host) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "device host IP is required"})
			return
		}

		if err := cfg.Caster.Stop(c.Request.Context(), req.Host, req.Port); err != nil {
			log.Printf("stop cast on %s:%d failed: %v", req.Host, req.Port, err)
			c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Could not stop casting on %s: %v", req.Host, err)})
			return
		}

		c.JSON(http.StatusOK, gin.H{"status": "stopped"})
	}
}
