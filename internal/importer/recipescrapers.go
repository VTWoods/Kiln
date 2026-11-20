package importer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

var firstIntRe = regexp.MustCompile(`\d+`)

// RecipeScrapersImporter implements Importer by fetching HTML via SafeFetcher
// and piping it into Python's recipe-scrapers library via scripts/scrape_recipe.py.
// All recipe-scrapers integration is isolated here behind the Importer interface.
type RecipeScrapersImporter struct {
	fetcher    *SafeFetcher
	pythonBin  string
	scriptPath string
}

var _ Importer = (*RecipeScrapersImporter)(nil)

// NewRecipeScrapersImporter constructs an Importer backed by recipe-scrapers.
func NewRecipeScrapersImporter(fetcher *SafeFetcher, pythonBin string, scriptPath string) *RecipeScrapersImporter {
	if fetcher == nil {
		fetcher = NewSafeFetcher()
	}
	if strings.TrimSpace(pythonBin) == "" {
		pythonBin = "python3"
	}
	if strings.TrimSpace(scriptPath) == "" {
		scriptPath = "./scripts/scrape_recipe.py"
	}
	return &RecipeScrapersImporter{
		fetcher:    fetcher,
		pythonBin:  pythonBin,
		scriptPath: scriptPath,
	}
}

type scrapedPayload struct {
	Title        string   `json:"title"`
	Description  string   `json:"description"`
	Ingredients  []string `json:"ingredients"`
	Instructions []string `json:"instructions"`
	PrepMinutes  int      `json:"prep_minutes"`
	CookMinutes  int      `json:"cook_minutes"`
	Yields       string   `json:"yields"`
	Image        string   `json:"image"`
}

// ImportURL fetches rawURL and runs recipe-scrapers on the HTML to extract recipe fields
// and candidate images.
func (r *RecipeScrapersImporter) ImportURL(ctx context.Context, rawURL string) (*ImportedRecipe, error) {
	fetched, err := r.fetcher.Fetch(ctx, rawURL, defaultMaxHTMLBytes, "")
	if err != nil {
		return nil, err
	}

	cmd := exec.CommandContext(ctx, r.pythonBin, r.scriptPath, fetched.FinalURL)
	cmd.Stdin = bytes.NewReader(fetched.Body)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		errDetail := strings.TrimSpace(stderr.String())
		if errDetail != "" {
			return nil, fmt.Errorf("%w: recipe-scrapers: %s", ErrParseFailed, errDetail)
		}
		return nil, fmt.Errorf("%w: recipe-scrapers execution failed: %v", ErrParseFailed, err)
	}

	var parsed scrapedPayload
	if err := json.Unmarshal(stdout.Bytes(), &parsed); err != nil {
		return nil, fmt.Errorf("%w: invalid scraper output: %v", ErrParseFailed, err)
	}

	title := cleanText(parsed.Title)
	description := cleanText(parsed.Description)

	ingredients := make([]ImportedIngredient, 0, len(parsed.Ingredients))
	for _, raw := range parsed.Ingredients {
		ing := ParseIngredient(raw)
		if ing.Name != "" {
			ingredients = append(ingredients, ing)
		}
	}

	instructionSteps := make([]string, 0, len(parsed.Instructions))
	for _, step := range parsed.Instructions {
		if cleaned := cleanText(step); cleaned != "" {
			instructionSteps = append(instructionSteps, cleaned)
		}
	}

	if title == "" && len(ingredients) == 0 && len(instructionSteps) == 0 {
		return nil, fmt.Errorf("%w: no recipe details found on page", ErrParseFailed)
	}

	servings := parseServings(parsed.Yields)
	if servings <= 0 {
		servings = 1
	}

	candidateImages := ExtractCandidateImages(fetched.FinalURL, fetched.Body, parsed.Image)
	selectedImage := ""
	if len(candidateImages) > 0 {
		selectedImage = candidateImages[0]
	}

	return &ImportedRecipe{
		Title:           title,
		Description:     description,
		Instructions:    strings.Join(instructionSteps, "\n\n"),
		Servings:        servings,
		PrepMinutes:     max(parsed.PrepMinutes, 0),
		CookMinutes:     max(parsed.CookMinutes, 0),
		SourceURL:       fetched.FinalURL,
		ImageURL:        selectedImage,
		CandidateImages: candidateImages,
		Ingredients:     ingredients,
	}, nil
}

func cleanText(s string) string {
	return cleanWhitespace(html.UnescapeString(s))
}

func parseServings(yields string) int {
	match := firstIntRe.FindString(yields)
	if match == "" {
		return 0
	}
	n, err := strconv.Atoi(match)
	if err != nil || n <= 0 {
		return 0
	}
	return n
}
