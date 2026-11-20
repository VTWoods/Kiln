package caster

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"github.com/vishen/go-chromecast/cast"
	pb "github.com/vishen/go-chromecast/cast/proto"
	"github.com/vishen/go-chromecast/dns"
)

const (
	// DashCastAppID is the DashCast receiver App ID (matching pychromecast's APP_DASHCAST),
	// which loads arbitrary web URLs (including local LAN http:// URLs) on Nest Hub displays.
	DashCastAppID = "84912283"

	defaultCastPort  = 8009
	defaultSenderID  = "sender-0"
	defaultRecvID    = "receiver-0"
	nsConnection     = "urn:x-cast:com.google.cast.tp.connection"
	nsHeartbeat      = "urn:x-cast:com.google.cast.tp.heartbeat"
	nsReceiver       = "urn:x-cast:com.google.cast.receiver"
	nsDashCast       = "urn:x-cast:com.madmod.dashcast"
	defaultScanTime  = 3 * time.Second
	castOpTimeout    = 15 * time.Second
	postStopWaitDur  = 500 * time.Millisecond
	postLoadFlushDur = 1200 * time.Millisecond
)

var (
	// ErrInvalidTarget indicates a missing or malformed Cast device host or URL.
	ErrInvalidTarget = errors.New("invalid cast target")
)

// Device describes a Google Cast / Nest Hub device discovered on the local network.
type Device struct {
	Name  string `json:"name"`
	Model string `json:"model"`
	Host  string `json:"host"`
	Port  int    `json:"port"`
	UUID  string `json:"uuid"`
}

// Caster discovers Cast devices and casts web pages to them.
type Caster interface {
	Discover(ctx context.Context, timeout time.Duration) ([]Device, error)
	CastURL(ctx context.Context, host string, port int, pageURL string) (string, error)
	Stop(ctx context.Context, host string, port int) error
}

// GoChromecastCaster implements Caster using github.com/vishen/go-chromecast.
type GoChromecastCaster struct {
	publicBaseURL string
	connFactory   func() cast.Conn
	reqSeq        atomic.Int64
}

var _ Caster = (*GoChromecastCaster)(nil)

// NewGoChromecastCaster creates a Caster backed by go-chromecast.
// If publicBaseURL is non-empty (e.g. "http://10.0.0.176:8090"), cast page URLs
// use its scheme and host instead of auto-detecting the local LAN IP.
func NewGoChromecastCaster(publicBaseURL string) *GoChromecastCaster {
	return &GoChromecastCaster{
		publicBaseURL: strings.TrimRight(strings.TrimSpace(publicBaseURL), "/"),
		connFactory: func() cast.Conn {
			return cast.NewConnection()
		},
	}
}

// Discover scans the local network via mDNS for Google Cast devices.
func (c *GoChromecastCaster) Discover(ctx context.Context, timeout time.Duration) ([]Device, error) {
	if timeout <= 0 {
		timeout = defaultScanTime
	}

	scanCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	entries, err := dns.DiscoverCastDNSEntries(scanCtx, nil)
	if err != nil {
		return nil, fmt.Errorf("discover cast devices: %w", err)
	}

	seen := make(map[string]bool)
	devices := make([]Device, 0)
	for entry := range entries {
		addr := strings.TrimSpace(entry.GetAddr())
		if addr == "" {
			continue
		}
		port := entry.GetPort()
		if port <= 0 {
			port = defaultCastPort
		}

		key := entry.GetUUID()
		if key == "" {
			key = fmt.Sprintf("%s:%d", addr, port)
		}
		if seen[key] {
			continue
		}
		seen[key] = true

		name := strings.TrimSpace(entry.GetName())
		if name == "" {
			name = addr
		}

		devices = append(devices, Device{
			Name:  name,
			Model: strings.TrimSpace(entry.Device),
			Host:  addr,
			Port:  port,
			UUID:  entry.GetUUID(),
		})
	}

	// Put display devices (Nest Hub / Smart Display) first, then sort by name.
	sort.Slice(devices, func(i, j int) bool {
		iHub := isLikelyDisplay(devices[i].Model)
		jHub := isLikelyDisplay(devices[j].Model)
		if iHub != jHub {
			return iHub
		}
		return strings.ToLower(devices[i].Name) < strings.ToLower(devices[j].Name)
	})

	return devices, nil
}

// CastURL launches DashCast on the target Cast device and loads pageURL.
// If pageURL uses localhost/127.0.0.1, the hostname is automatically rewritten
// to the local LAN IP that connected to the device (or publicBaseURL if set).
func (c *GoChromecastCaster) CastURL(ctx context.Context, host string, port int, pageURL string) (string, error) {
	host = strings.TrimSpace(host)
	if host == "" {
		return "", fmt.Errorf("%w: device host is required", ErrInvalidTarget)
	}
	if port <= 0 {
		port = defaultCastPort
	}
	if _, err := url.ParseRequestURI(pageURL); err != nil {
		return "", fmt.Errorf("%w: invalid page URL: %v", ErrInvalidTarget, err)
	}

	opCtx, cancel := context.WithTimeout(ctx, castOpTimeout)
	defer cancel()

	conn := c.connFactory()
	if err := conn.Start(host, port); err != nil {
		return "", fmt.Errorf("connect to cast device %s:%d: %w", host, port, err)
	}
	defer func() { _ = conn.Close() }()

	localIP, _ := conn.LocalAddr()
	resolvedURL, err := resolveCastURL(pageURL, c.publicBaseURL, localIP)
	if err != nil {
		return "", err
	}

	// Connect to default receiver.
	if err := conn.Send(0, &cast.ConnectHeader, defaultSenderID, defaultRecvID, nsConnection); err != nil {
		return "", fmt.Errorf("connect receiver channel: %w", err)
	}

	// Check if DashCast is already running; because force:true navigates away from
	// the receiver script, stopping an existing DashCast session ensures a clean reload.
	if status, err := c.getReceiverStatus(opCtx, conn); err == nil {
		for _, app := range status.Status.Applications {
			if app.AppId == DashCastAppID && app.SessionId != "" {
				_ = c.stopSession(opCtx, conn, app.SessionId)
				select {
				case <-opCtx.Done():
					return "", opCtx.Err()
				case <-time.After(postStopWaitDur):
				}
				break
			}
		}
	}

	// Launch DashCast and wait for its TransportId.
	app, err := c.launchApp(opCtx, conn, DashCastAppID)
	if err != nil {
		return "", fmt.Errorf("launch DashCast receiver: %w", err)
	}

	// Connect to DashCast's transport channel and load the recipe cook-mode URL.
	if err := conn.Send(0, &cast.ConnectHeader, defaultSenderID, app.TransportId, nsConnection); err != nil {
		return "", fmt.Errorf("connect DashCast channel: %w", err)
	}

	loadReqID := c.nextReqID()
	payload := &dashCastPayload{
		RequestID:  loadReqID,
		SessionID:  app.SessionId,
		URL:        resolvedURL,
		Force:      true,
		Reload:     false,
		ReloadTime: 0,
	}
	if err := conn.Send(loadReqID, payload, defaultSenderID, app.TransportId, nsDashCast); err != nil {
		return "", fmt.Errorf("send DashCast load URL: %w", err)
	}

	// Give the Cast device a brief moment to process and navigate before closing the socket.
	select {
	case <-opCtx.Done():
	case <-time.After(postLoadFlushDur):
	}

	return resolvedURL, nil
}

// Stop dismisses the currently running Cast application on the target device.
func (c *GoChromecastCaster) Stop(ctx context.Context, host string, port int) error {
	host = strings.TrimSpace(host)
	if host == "" {
		return fmt.Errorf("%w: device host is required", ErrInvalidTarget)
	}
	if port <= 0 {
		port = defaultCastPort
	}

	opCtx, cancel := context.WithTimeout(ctx, castOpTimeout)
	defer cancel()

	conn := c.connFactory()
	if err := conn.Start(host, port); err != nil {
		return fmt.Errorf("connect to cast device %s:%d: %w", host, port, err)
	}
	defer func() { _ = conn.Close() }()

	if err := conn.Send(0, &cast.ConnectHeader, defaultSenderID, defaultRecvID, nsConnection); err != nil {
		return fmt.Errorf("connect receiver channel: %w", err)
	}

	status, err := c.getReceiverStatus(opCtx, conn)
	if err != nil {
		return err
	}

	for _, app := range status.Status.Applications {
		if app.IsIdleScreen || app.SessionId == "" {
			continue
		}
		if err := c.stopSession(opCtx, conn, app.SessionId); err != nil {
			return err
		}
	}

	return nil
}

type stopRequest struct {
	cast.PayloadHeader
	SessionID string `json:"sessionId"`
}

type dashCastPayload struct {
	RequestID  int    `json:"requestId"`
	SessionID  string `json:"sessionId,omitempty"`
	URL        string `json:"url"`
	Force      bool   `json:"force"`
	Reload     bool   `json:"reload"`
	ReloadTime int    `json:"reload_time"`
}

func (p *dashCastPayload) SetRequestId(id int) {
	p.RequestID = id
}

func (c *GoChromecastCaster) nextReqID() int {
	return int(c.reqSeq.Add(1))
}

func (c *GoChromecastCaster) getReceiverStatus(ctx context.Context, conn cast.Conn) (*cast.ReceiverStatusResponse, error) {
	reqID := c.nextReqID()
	hdr := cast.GetStatusHeader
	hdr.SetRequestId(reqID)
	if err := conn.Send(reqID, &hdr, defaultSenderID, defaultRecvID, nsReceiver); err != nil {
		return nil, fmt.Errorf("send GET_STATUS: %w", err)
	}

	return waitForReceiverStatus(ctx, conn, func(resp *cast.ReceiverStatusResponse) bool {
		return resp.RequestId == reqID
	})
}

func (c *GoChromecastCaster) stopSession(ctx context.Context, conn cast.Conn, sessionID string) error {
	reqID := c.nextReqID()
	req := &stopRequest{
		PayloadHeader: cast.StopHeader,
		SessionID:     sessionID,
	}
	req.SetRequestId(reqID)
	if err := conn.Send(reqID, req, defaultSenderID, defaultRecvID, nsReceiver); err != nil {
		return fmt.Errorf("send STOP: %w", err)
	}

	_, err := waitForReceiverStatus(ctx, conn, func(resp *cast.ReceiverStatusResponse) bool {
		return resp.RequestId == reqID
	})
	return err
}

func (c *GoChromecastCaster) launchApp(ctx context.Context, conn cast.Conn, appID string) (*cast.Application, error) {
	reqID := c.nextReqID()
	req := &cast.LaunchRequest{
		PayloadHeader: cast.LaunchHeader,
		AppId:         appID,
	}
	req.SetRequestId(reqID)
	if err := conn.Send(reqID, req, defaultSenderID, defaultRecvID, nsReceiver); err != nil {
		return nil, fmt.Errorf("send LAUNCH: %w", err)
	}

	resp, err := waitForReceiverStatus(ctx, conn, func(r *cast.ReceiverStatusResponse) bool {
		for _, app := range r.Status.Applications {
			if app.AppId == appID && app.TransportId != "" {
				return true
			}
		}
		return false
	})
	if err != nil {
		return nil, err
	}

	for _, app := range resp.Status.Applications {
		if app.AppId == appID && app.TransportId != "" {
			matched := app
			return &matched, nil
		}
	}
	return nil, fmt.Errorf("launched app %s did not return a transportId", appID)
}

func waitForReceiverStatus(
	ctx context.Context,
	conn cast.Conn,
	match func(*cast.ReceiverStatusResponse) bool,
) (*cast.ReceiverStatusResponse, error) {
	for {
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("timed out waiting for cast device response: %w", ctx.Err())
		case msg, ok := <-conn.MsgChan():
			if !ok {
				return nil, errors.New("cast connection closed unexpectedly")
			}
			if msg == nil || msg.PayloadUtf8 == nil {
				continue
			}

			raw := []byte(*msg.PayloadUtf8)
			var header struct {
				Type   string `json:"type"`
				Reason string `json:"reason"`
			}
			if err := json.Unmarshal(raw, &header); err != nil {
				continue
			}

			switch header.Type {
			case "PING":
				_ = conn.Send(0, &cast.PongHeader, defaultSenderID, defaultRecvID, nsHeartbeat)
			case "LAUNCH_ERROR":
				return nil, fmt.Errorf("cast device launch error: %s", header.Reason)
			case "RECEIVER_STATUS":
				var resp cast.ReceiverStatusResponse
				if err := json.Unmarshal(raw, &resp); err == nil && match(&resp) {
					return &resp, nil
				}
			}
		}
	}
}

func resolveCastURL(pageURL, publicBaseURL, localIP string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(pageURL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("%w: invalid cast URL %q", ErrInvalidTarget, pageURL)
	}

	if publicBaseURL != "" {
		base, err := url.Parse(publicBaseURL)
		if err == nil && base.Scheme != "" && base.Host != "" {
			parsed.Scheme = base.Scheme
			parsed.Host = base.Host
			return parsed.String(), nil
		}
	}

	hostname := parsed.Hostname()
	if isLoopbackHost(hostname) && localIP != "" {
		port := parsed.Port()
		if port != "" {
			parsed.Host = net.JoinHostPort(localIP, port)
		} else {
			parsed.Host = localIP
		}
	}

	return parsed.String(), nil
}

func isLoopbackHost(host string) bool {
	lower := strings.ToLower(strings.TrimSpace(host))
	if lower == "localhost" || lower == "127.0.0.1" || lower == "::1" || lower == "0.0.0.0" {
		return true
	}
	if ip := net.ParseIP(lower); ip != nil {
		return ip.IsLoopback() || ip.IsUnspecified()
	}
	return false
}

func isLikelyDisplay(model string) bool {
	lower := strings.ToLower(model)
	return strings.Contains(lower, "hub") ||
		strings.Contains(lower, "display") ||
		strings.Contains(lower, "tv") ||
		strings.Contains(lower, "chromecast")
}

// ensure unused import check doesn't complain if pb is only referenced via MsgChan
var _ *pb.CastMessage
