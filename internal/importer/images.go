package importer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"github.com/google/uuid"
)

const (
	maxCandidateImages = 12
	localImagePrefix   = "/api/images/"
)

// ExtractCandidateImages collects deduplicated, absolute HTTP(S) image URLs from
// an HTML page, ordered with the primary recipe image first, followed by JSON-LD
// images, OpenGraph/Twitter meta images, and prominent <img> elements.
func ExtractCandidateImages(baseURL string, htmlBytes []byte, primaryImage string) []string {
	parsedBase, err := url.Parse(baseURL)
	if err != nil {
		parsedBase = nil
	}

	seen := make(map[string]bool)
	candidates := make([]string, 0, maxCandidateImages)

	addCandidate := func(raw string) {
		if len(candidates) >= maxCandidateImages {
			return
		}
		resolved := resolveImageURL(parsedBase, raw)
		if resolved == "" || seen[resolved] {
			return
		}
		if looksLikeJunkImageURL(resolved) {
			return
		}
		seen[resolved] = true
		candidates = append(candidates, resolved)
	}

	// 1. Primary image from the recipe scraper goes first.
	addCandidate(primaryImage)

	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(htmlBytes))
	if err != nil {
		return candidates
	}

	// 2. Any additional image URLs inside JSON-LD blocks (arrays / ImageObjects).
	doc.Find(`script[type="application/ld+json"]`).Each(func(_ int, s *goquery.Selection) {
		rawJSON := strings.TrimSpace(s.Text())
		if rawJSON == "" {
			return
		}
		var payload any
		if err := json.Unmarshal([]byte(rawJSON), &payload); err != nil {
			return
		}
		collectJSONLDImages(payload, addCandidate)
	})

	// 3. OpenGraph and Twitter meta images.
	metaSelectors := []string{
		`meta[property="og:image"]`,
		`meta[property="og:image:secure_url"]`,
		`meta[name="twitter:image"]`,
		`meta[name="twitter:image:src"]`,
	}
	for _, sel := range metaSelectors {
		doc.Find(sel).Each(func(_ int, s *goquery.Selection) {
			if content, ok := s.Attr("content"); ok {
				addCandidate(content)
			}
		})
	}

	// 4. Content <img> tags (skipping tiny icons and obvious chrome/avatars).
	doc.Find("img").Each(func(_ int, s *goquery.Selection) {
		if len(candidates) >= maxCandidateImages {
			return
		}
		if isSmallImage(s) {
			return
		}
		for _, attr := range []string{"src", "data-src", "data-lazy-src", "data-original"} {
			if val, ok := s.Attr(attr); ok && strings.TrimSpace(val) != "" {
				addCandidate(val)
				return
			}
		}
		if srcset, ok := s.Attr("srcset"); ok {
			if best := pickBestSrcsetURL(srcset); best != "" {
				addCandidate(best)
			}
		}
	})

	return candidates
}

func collectJSONLDImages(node any, add func(string)) {
	switch v := node.(type) {
	case []any:
		for _, item := range v {
			collectJSONLDImages(item, add)
		}
	case map[string]any:
		if img, exists := v["image"]; exists {
			extractImageField(img, add)
		}
		if graph, exists := v["@graph"]; exists {
			collectJSONLDImages(graph, add)
		}
	}
}

func extractImageField(val any, add func(string)) {
	switch v := val.(type) {
	case string:
		add(v)
	case []any:
		for _, item := range v {
			extractImageField(item, add)
		}
	case map[string]any:
		if u, ok := v["url"].(string); ok {
			add(u)
		}
		if u, ok := v["contentUrl"].(string); ok {
			add(u)
		}
	}
}

func resolveImageURL(base *url.URL, raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || strings.HasPrefix(strings.ToLower(trimmed), "data:") {
		return ""
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return ""
	}
	if base != nil {
		u = base.ResolveReference(u)
	}
	scheme := strings.ToLower(u.Scheme)
	if (scheme != "http" && scheme != "https") || u.Host == "" {
		return ""
	}
	return u.String()
}

func looksLikeJunkImageURL(rawURL string) bool {
	lower := strings.ToLower(rawURL)
	pathOnly := lower
	if idx := strings.IndexAny(pathOnly, "?#"); idx >= 0 {
		pathOnly = pathOnly[:idx]
	}

	if strings.HasSuffix(pathOnly, ".svg") || strings.HasSuffix(pathOnly, ".ico") {
		return true
	}

	junkTokens := []string{
		"favicon", "gravatar.com", "/avatar", "sprite", "pixel.gif",
		"1x1", "spacer", "badge", "logo", "icon-", "/icons/", "doubleclick",
		"adservice", "facebook.com/tr", "pinterest.com/v3",
	}
	for _, token := range junkTokens {
		if strings.Contains(lower, token) {
			return true
		}
	}
	return false
}

func isSmallImage(s *goquery.Selection) bool {
	const minDimension = 120
	if wStr, ok := s.Attr("width"); ok {
		if w, err := parsePixelAttr(wStr); err == nil && w > 0 && w < minDimension {
			return true
		}
	}
	if hStr, ok := s.Attr("height"); ok {
		if h, err := parsePixelAttr(hStr); err == nil && h > 0 && h < minDimension {
			return true
		}
	}
	return false
}

func parsePixelAttr(raw string) (int, error) {
	trimmed := strings.TrimSpace(strings.TrimSuffix(strings.ToLower(raw), "px"))
	return strconv.Atoi(trimmed)
}

func pickBestSrcsetURL(srcset string) string {
	parts := strings.Split(srcset, ",")
	bestURL := ""
	bestWidth := -1
	for _, part := range parts {
		fields := strings.Fields(strings.TrimSpace(part))
		if len(fields) == 0 {
			continue
		}
		candidate := fields[0]
		width := 0
		if len(fields) >= 2 && strings.HasSuffix(fields[1], "w") {
			if w, err := strconv.Atoi(strings.TrimSuffix(fields[1], "w")); err == nil {
				width = w
			}
		}
		if bestURL == "" || width > bestWidth {
			bestURL = candidate
			bestWidth = width
		}
	}
	return bestURL
}

// ImageStore downloads remote recipe photos and persists them locally on disk.
type ImageStore struct {
	dir     string
	fetcher *SafeFetcher
}

// NewImageStore initializes an ImageStore rooted at dir.
func NewImageStore(dir string, fetcher *SafeFetcher) *ImageStore {
	if fetcher == nil {
		fetcher = NewSafeFetcher()
	}
	return &ImageStore{
		dir:     filepath.Clean(dir),
		fetcher: fetcher,
	}
}

// IsLocalImageURL reports whether u refers to a locally cached image served by Kiln.
func IsLocalImageURL(u string) bool {
	return strings.HasPrefix(strings.TrimSpace(u), localImagePrefix)
}

// SaveFromURL downloads an image from rawURL (optionally sending referer) and
// writes it into the store directory, returning its public path (e.g. /api/images/<id>.jpg).
func (s *ImageStore) SaveFromURL(ctx context.Context, rawURL string, referer string) (string, error) {
	res, err := s.fetcher.Fetch(ctx, rawURL, defaultMaxImgBytes, referer)
	if err != nil {
		return "", err
	}
	if len(res.Body) == 0 {
		return "", fmt.Errorf("%w: remote image was empty", ErrFetchFailed)
	}

	ext, ok := detectImageExtension(res.ContentType, res.Body)
	if !ok {
		return "", fmt.Errorf("%w: URL did not return a supported image format", ErrInvalidURL)
	}

	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return "", fmt.Errorf("create image directory: %w", err)
	}

	filename := uuid.NewString() + ext
	destPath := filepath.Join(s.dir, filename)
	if err := os.WriteFile(destPath, res.Body, 0o644); err != nil {
		return "", fmt.Errorf("write cached image: %w", err)
	}

	return localImagePrefix + filename, nil
}

// FilePath resolves a safe filename inside the store directory.
func (s *ImageStore) FilePath(filename string) (string, bool) {
	cleaned := filepath.Base(strings.TrimSpace(filename))
	if cleaned == "" || cleaned == "." || cleaned == ".." || cleaned != filename {
		return "", false
	}
	if strings.ContainsAny(cleaned, `/\`) {
		return "", false
	}
	return filepath.Join(s.dir, cleaned), true
}

// DeleteLocal removes a previously cached local image if imageURL points to one.
func (s *ImageStore) DeleteLocal(imageURL string) {
	if s == nil || !IsLocalImageURL(imageURL) {
		return
	}
	filename := strings.TrimPrefix(strings.TrimSpace(imageURL), localImagePrefix)
	path, ok := s.FilePath(filename)
	if !ok {
		return
	}
	_ = os.Remove(path)
}

func detectImageExtension(headerCT string, data []byte) (string, bool) {
	// Prefer content sniffing first, falling back to Content-Type header for formats
	// like AVIF that net/http.DetectContentType does not always recognize.
	sniffed := strings.ToLower(http.DetectContentType(data))
	if ext, ok := mimeToExt(sniffed); ok {
		return ext, true
	}

	mediaType := strings.ToLower(strings.TrimSpace(strings.Split(headerCT, ";")[0]))
	if ext, ok := mimeToExt(mediaType); ok {
		return ext, true
	}

	return "", false
}

func mimeToExt(mimeType string) (string, bool) {
	switch mimeType {
	case "image/jpeg", "image/jpg":
		return ".jpg", true
	case "image/png":
		return ".png", true
	case "image/webp":
		return ".webp", true
	case "image/gif":
		return ".gif", true
	case "image/avif":
		return ".avif", true
	default:
		return "", false
	}
}
