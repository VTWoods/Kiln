// Package importer defines a provider-agnostic interface for extracting recipes
// from web URLs, along with supporting utilities for safe HTTP fetching,
// ingredient parsing, candidate image extraction, and local image caching.
//
// Recipe parsing backends (currently RecipeScrapersImporter backed by Python's
// recipe-scrapers) are isolated behind the Importer interface so another
// extractor can be swapped in without modifying the HTTP handlers, database
// layer, or frontend.
package importer

import (
	"context"
	"errors"
)

var (
	// ErrInvalidURL indicates the caller supplied a malformed or disallowed URL.
	ErrInvalidURL = errors.New("invalid recipe URL")
	// ErrFetchFailed indicates the remote page or asset could not be fetched.
	ErrFetchFailed = errors.New("failed to fetch remote URL")
	// ErrParseFailed indicates the page was fetched but no recipe could be extracted.
	ErrParseFailed = errors.New("could not extract recipe from page")
)

// Importer extracts structured recipe data and candidate images from a URL.
// Implementations (e.g., RecipeScrapersImporter, or another custom adapter)
// are interchangeable behind this interface.
type Importer interface {
	ImportURL(ctx context.Context, rawURL string) (*ImportedRecipe, error)
}

// ImportedIngredient holds both the original raw ingredient string and its
// best-effort parsed quantity, unit, and name.
type ImportedIngredient struct {
	Raw      string `json:"raw"`
	Quantity string `json:"quantity"`
	Unit     string `json:"unit"`
	Name     string `json:"name"`
}

// ImportedRecipe is the normalized preview payload returned by any Importer.
type ImportedRecipe struct {
	Title           string               `json:"title"`
	Description     string               `json:"description"`
	Instructions    string               `json:"instructions"`
	Servings        int                  `json:"servings"`
	PrepMinutes     int                  `json:"prep_minutes"`
	CookMinutes     int                  `json:"cook_minutes"`
	SourceURL       string               `json:"source_url"`
	ImageURL        string               `json:"image_url"`
	CandidateImages []string             `json:"candidate_images"`
	Ingredients     []ImportedIngredient `json:"ingredients"`
}
