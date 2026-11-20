package importer

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testRecipeScrapersImporter(t *testing.T) *RecipeScrapersImporter {
	t.Helper()
	repoRoot, err := filepath.Abs("../..")
	if err != nil {
		t.Fatalf("resolve repo root: %v", err)
	}
	pythonBin := filepath.Join(repoRoot, ".venv", "bin", "python3")
	if _, err := os.Stat(pythonBin); err != nil {
		pythonBin = "python3"
	}
	scriptPath := filepath.Join(repoRoot, "scripts", "scrape_recipe.py")
	return NewRecipeScrapersImporter(
		NewSafeFetcher(WithAllowPrivateNetworks(true)),
		pythonBin,
		scriptPath,
	)
}

func TestParseIngredient(t *testing.T) {
	tests := []struct {
		raw      string
		wantQty  string
		wantUnit string
		wantName string
	}{
		{
			raw:      "2 cups all-purpose flour",
			wantQty:  "2",
			wantUnit: "cups",
			wantName: "all-purpose flour",
		},
		{
			raw:      "1½ tbsp olive oil",
			wantQty:  "1 1/2",
			wantUnit: "tbsp",
			wantName: "olive oil",
		},
		{
			raw:      "½ tsp kosher salt",
			wantQty:  "1/2",
			wantUnit: "tsp",
			wantName: "kosher salt",
		},
		{
			raw:      "2-3 cloves of garlic, minced",
			wantQty:  "2-3",
			wantUnit: "cloves",
			wantName: "garlic, minced",
		},
		{
			raw:      "8 fl oz chicken broth",
			wantQty:  "8",
			wantUnit: "fl oz",
			wantName: "chicken broth",
		},
		{
			raw:      "2 large eggs",
			wantQty:  "2",
			wantUnit: "",
			wantName: "large eggs",
		},
		{
			raw:      "Salt &amp; freshly cracked black pepper to taste",
			wantQty:  "",
			wantUnit: "",
			wantName: "Salt & freshly cracked black pepper to taste",
		},
	}

	for _, tc := range tests {
		t.Run(tc.raw, func(t *testing.T) {
			got := ParseIngredient(tc.raw)
			if got.Quantity != tc.wantQty || got.Unit != tc.wantUnit || got.Name != tc.wantName {
				t.Fatalf("ParseIngredient(%q) = {qty:%q unit:%q name:%q}, want {qty:%q unit:%q name:%q}",
					tc.raw, got.Quantity, got.Unit, got.Name, tc.wantQty, tc.wantUnit, tc.wantName)
			}
		})
	}
}

func TestRecipeScrapersImporter_ImportURL(t *testing.T) {
	sampleHTML := `<!doctype html>
<html>
<head>
  <title>Garlic Butter Pasta</title>
  <meta property="og:image" content="/images/og-pasta.jpg" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Recipe",
    "name": "Garlic Butter Pasta",
    "description": "Quick &amp; cozy weeknight pasta.",
    "image": [
      "/images/hero-pasta.jpg",
      "/images/plated-pasta.jpg"
    ],
    "recipeYield": "4 servings",
    "prepTime": "PT10M",
    "cookTime": "PT15M",
    "recipeIngredient": [
      "1 lb spaghetti",
      "4 tbsp unsalted butter",
      "4 cloves garlic, thinly sliced",
      "Salt to taste"
    ],
    "recipeInstructions": [
      {"@type": "HowToStep", "text": "Boil salted water and cook pasta until al dente."},
      {"@type": "HowToStep", "text": "Saute garlic in butter and toss with pasta."}
    ]
  }
  </script>
</head>
<body>
  <img src="/images/step-1.jpg" width="600" height="400" />
  <img src="/images/tiny-icon.png" width="24" height="24" />
  <img src="/images/site-logo.png" width="300" height="300" />
</body>
</html>`

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(sampleHTML))
	}))
	defer srv.Close()

	imp := testRecipeScrapersImporter(t)

	got, err := imp.ImportURL(context.Background(), srv.URL+"/recipes/garlic-pasta")
	if err != nil {
		t.Fatalf("ImportURL failed: %v", err)
	}

	if got.Title != "Garlic Butter Pasta" {
		t.Fatalf("unexpected title: %q", got.Title)
	}
	if got.Description != "Quick & cozy weeknight pasta." {
		t.Fatalf("unexpected description: %q", got.Description)
	}
	if got.Servings != 4 || got.PrepMinutes != 10 || got.CookMinutes != 15 {
		t.Fatalf("unexpected timing/servings: servings=%d prep=%d cook=%d", got.Servings, got.PrepMinutes, got.CookMinutes)
	}
	if got.SourceURL != srv.URL+"/recipes/garlic-pasta" {
		t.Fatalf("unexpected source_url: %q", got.SourceURL)
	}
	if len(got.Ingredients) != 4 {
		t.Fatalf("expected 4 ingredients, got %d: %+v", len(got.Ingredients), got.Ingredients)
	}
	if got.Ingredients[0].Quantity != "1" || got.Ingredients[0].Unit != "lb" || got.Ingredients[0].Name != "spaghetti" {
		t.Fatalf("unexpected first ingredient: %+v", got.Ingredients[0])
	}
	if !strings.Contains(got.Instructions, "Boil salted water") || !strings.Contains(got.Instructions, "Saute garlic") {
		t.Fatalf("unexpected instructions: %q", got.Instructions)
	}

	if got.ImageURL == "" {
		t.Fatalf("expected non-empty primary image")
	}

	// Should include hero, plated, og, and step-1, while filtering tiny-icon and site-logo.
	if len(got.CandidateImages) != 4 {
		t.Fatalf("expected 4 candidate images, got %d: %v", len(got.CandidateImages), got.CandidateImages)
	}
	wantImages := map[string]bool{
		srv.URL + "/images/hero-pasta.jpg":   false,
		srv.URL + "/images/plated-pasta.jpg": false,
		srv.URL + "/images/og-pasta.jpg":     false,
		srv.URL + "/images/step-1.jpg":       false,
	}
	for _, img := range got.CandidateImages {
		if _, ok := wantImages[img]; ok {
			wantImages[img] = true
		}
	}
	for img, found := range wantImages {
		if !found {
			t.Fatalf("expected candidate image %q in %v", img, got.CandidateImages)
		}
	}
}

func TestRecipeScrapersImporter_TopLevelArrayAndMultiTypeJSONLD(t *testing.T) {
	// Matches Serious Eats / Dotdash Meredith style JSON-LD: top-level array + @type array.
	seriousEatsStyleHTML := `<!doctype html>
<html>
<head>
  <script type="application/ld+json">
  [
    {
      "@context": "http://schema.org",
      "@type": ["Recipe", "NewsArticle"],
      "headline": "All-American Beef Stew",
      "name": "All-American Beef Stew",
      "description": "Hearty, deeply savory classic beef stew.",
      "image": {
        "@type": "ImageObject",
        "url": "https://example.com/beef-stew.jpg"
      },
      "recipeYield": ["6", "6 servings"],
      "prepTime": "PT30M",
      "cookTime": "PT180M",
      "recipeIngredient": [
        "3 pounds boneless beef chuck, cut into chunks",
        "2 cups low-sodium chicken stock"
      ],
      "recipeInstructions": [
        {"@type": "HowToStep", "text": "Brown the beef in batches."},
        {"@type": "HowToStep", "text": "Braise in the oven until tender."}
      ]
    }
  ]
  </script>
</head>
<body></body>
</html>`

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(seriousEatsStyleHTML))
	}))
	defer srv.Close()

	imp := testRecipeScrapersImporter(t)
	got, err := imp.ImportURL(context.Background(), srv.URL+"/all-american-beef-stew-recipe")
	if err != nil {
		t.Fatalf("ImportURL failed on Serious Eats style JSON-LD: %v", err)
	}

	if got.Title != "All-American Beef Stew" {
		t.Fatalf("unexpected title: %q", got.Title)
	}
	if got.Servings != 6 || got.PrepMinutes != 30 || got.CookMinutes != 180 {
		t.Fatalf("unexpected servings/times: servings=%d prep=%d cook=%d", got.Servings, got.PrepMinutes, got.CookMinutes)
	}
	if len(got.Ingredients) != 2 {
		t.Fatalf("expected 2 ingredients, got %d", len(got.Ingredients))
	}
	if got.ImageURL != "https://example.com/beef-stew.jpg" {
		t.Fatalf("unexpected image URL: %q", got.ImageURL)
	}
}

func TestRecipeScrapersImporter_NonRecipePageReturnsErrParseFailed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html><body><h1>Just a blog post</h1></body></html>"))
	}))
	defer srv.Close()

	imp := testRecipeScrapersImporter(t)
	_, err := imp.ImportURL(context.Background(), srv.URL)
	if !errors.Is(err, ErrParseFailed) {
		t.Fatalf("expected ErrParseFailed, got %v", err)
	}
}

func TestSafeFetcher_BlocksSSRFAndInvalidSchemes(t *testing.T) {
	fetcher := NewSafeFetcher() // SSRF protection enabled

	if _, err := fetcher.Fetch(context.Background(), "file:///etc/passwd", 1024, ""); !errors.Is(err, ErrInvalidURL) {
		t.Fatalf("expected ErrInvalidURL for file://, got %v", err)
	}

	if _, err := fetcher.Fetch(context.Background(), "http://127.0.0.1:8080/secret", 1024, ""); !errors.Is(err, ErrInvalidURL) {
		t.Fatalf("expected ErrInvalidURL for loopback IP, got %v", err)
	}
}

func TestImageStore_SaveAndDelete(t *testing.T) {
	// 1x1 transparent PNG
	pngBytes, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")
	if err != nil {
		t.Fatalf("decode png fixture: %v", err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ok.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(pngBytes)
		default:
			w.Header().Set("Content-Type", "text/plain")
			_, _ = w.Write([]byte("not an image"))
		}
	}))
	defer srv.Close()

	store := NewImageStore(t.TempDir(), NewSafeFetcher(WithAllowPrivateNetworks(true)))

	localURL, err := store.SaveFromURL(context.Background(), srv.URL+"/ok.png", srv.URL)
	if err != nil {
		t.Fatalf("SaveFromURL failed: %v", err)
	}
	if !strings.HasPrefix(localURL, "/api/images/") || !strings.HasSuffix(localURL, ".png") {
		t.Fatalf("unexpected local image URL: %q", localURL)
	}

	filename := strings.TrimPrefix(localURL, "/api/images/")
	fullPath, ok := store.FilePath(filename)
	if !ok {
		t.Fatalf("FilePath rejected valid filename %q", filename)
	}
	if _, err := os.Stat(fullPath); err != nil {
		t.Fatalf("expected saved file at %q: %v", fullPath, err)
	}

	// Non-image content should be rejected.
	if _, err := store.SaveFromURL(context.Background(), srv.URL+"/not-image.txt", ""); !errors.Is(err, ErrInvalidURL) {
		t.Fatalf("expected ErrInvalidURL for non-image content, got %v", err)
	}

	store.DeleteLocal(localURL)
	if _, err := os.Stat(fullPath); !os.IsNotExist(err) {
		t.Fatalf("expected image file to be deleted, stat err=%v", err)
	}
}
