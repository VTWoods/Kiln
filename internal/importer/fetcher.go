package importer

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	defaultTimeout      = 15 * time.Second
	defaultMaxHTMLBytes = 5 << 20  // 5 MiB
	defaultMaxImgBytes  = 10 << 20 // 10 MiB
	defaultUserAgent    = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 KilnRecipeImporter/1.0"
)

// FetchResult holds the body, content type, and final URL (after redirects) of an HTTP GET.
type FetchResult struct {
	Body        []byte
	ContentType string
	FinalURL    string
}

// FetcherOption configures a SafeFetcher.
type FetcherOption func(*SafeFetcher)

// WithAllowPrivateNetworks disables loopback/private-IP SSRF checks.
// Intended exclusively for unit tests targeting local httptest servers.
func WithAllowPrivateNetworks(allow bool) FetcherOption {
	return func(f *SafeFetcher) {
		f.allowPrivateNetworks = allow
	}
}

// WithTimeout overrides the HTTP request timeout.
func WithTimeout(d time.Duration) FetcherOption {
	return func(f *SafeFetcher) {
		f.timeout = d
	}
}

// SafeFetcher performs HTTP GET requests with scheme validation, SSRF IP checks,
// redirect limits, and response size caps.
type SafeFetcher struct {
	client               *http.Client
	timeout              time.Duration
	allowPrivateNetworks bool
}

// NewSafeFetcher builds a SafeFetcher with SSRF protection enabled by default.
func NewSafeFetcher(opts ...FetcherOption) *SafeFetcher {
	f := &SafeFetcher{
		timeout: defaultTimeout,
	}
	for _, opt := range opts {
		opt(f)
	}

	dialer := &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
	}

	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		MaxIdleConns:          10,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			if f.allowPrivateNetworks {
				return dialer.DialContext(ctx, network, addr)
			}
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, fmt.Errorf("%w: invalid host %q", ErrInvalidURL, addr)
			}
			ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil {
				return nil, fmt.Errorf("%w: resolve %q: %v", ErrFetchFailed, host, err)
			}
			for _, ipAddr := range ips {
				if isPrivateOrReservedIP(ipAddr.IP) {
					return nil, fmt.Errorf("%w: private or loopback address %q is not allowed", ErrInvalidURL, host)
				}
			}
			if len(ips) == 0 {
				return nil, fmt.Errorf("%w: no IP addresses found for %q", ErrFetchFailed, host)
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
		},
	}

	f.client = &http.Client{
		Timeout:   f.timeout,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("%w: too many redirects", ErrFetchFailed)
			}
			if _, err := ValidateHTTPURL(req.URL.String()); err != nil {
				return err
			}
			return nil
		},
	}

	return f
}

// ValidateHTTPURL parses and verifies that rawURL is a valid http:// or https:// URL.
func ValidateHTTPURL(rawURL string) (*url.URL, error) {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return nil, fmt.Errorf("%w: URL is required", ErrInvalidURL)
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidURL, err)
	}

	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return nil, fmt.Errorf("%w: only http and https URLs are supported", ErrInvalidURL)
	}

	if parsed.Host == "" {
		return nil, fmt.Errorf("%w: URL must include a host", ErrInvalidURL)
	}

	return parsed, nil
}

// Fetch retrieves rawURL up to maxBytes, optionally sending a Referer header.
func (f *SafeFetcher) Fetch(ctx context.Context, rawURL string, maxBytes int64, referer string) (*FetchResult, error) {
	parsed, err := ValidateHTTPURL(rawURL)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidURL, err)
	}

	req.Header.Set("User-Agent", defaultUserAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/*;q=0.8,*/*;q=0.5")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	if referer != "" {
		if refURL, err := ValidateHTTPURL(referer); err == nil {
			req.Header.Set("Referer", refURL.String())
		}
	}

	resp, err := f.client.Do(req)
	if err != nil {
		// Preserve ErrInvalidURL if triggered by our dialer/redirect guard.
		return nil, wrapFetchError(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%w: remote server returned HTTP %d", ErrFetchFailed, resp.StatusCode)
	}

	if maxBytes <= 0 {
		maxBytes = defaultMaxHTMLBytes
	}

	limited := io.LimitReader(resp.Body, maxBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, fmt.Errorf("%w: reading response body: %v", ErrFetchFailed, err)
	}
	if int64(len(body)) > maxBytes {
		return nil, fmt.Errorf("%w: response exceeded %d bytes limit", ErrFetchFailed, maxBytes)
	}

	finalURL := parsed.String()
	if resp.Request != nil && resp.Request.URL != nil {
		finalURL = resp.Request.URL.String()
	}

	return &FetchResult{
		Body:        body,
		ContentType: resp.Header.Get("Content-Type"),
		FinalURL:    finalURL,
	}, nil
}

func wrapFetchError(err error) error {
	if err == nil {
		return nil
	}
	if strings.Contains(err.Error(), ErrInvalidURL.Error()) {
		return fmt.Errorf("%w: %v", ErrInvalidURL, err)
	}
	return fmt.Errorf("%w: %v", ErrFetchFailed, err)
}

func isPrivateOrReservedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}
	// Block carrier-grade NAT (100.64.0.0/10) as well.
	if ip4 := ip.To4(); ip4 != nil {
		if ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
			return true
		}
	}
	return false
}
