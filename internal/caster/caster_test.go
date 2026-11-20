package caster

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/vishen/go-chromecast/cast"
	pb "github.com/vishen/go-chromecast/cast/proto"
)

func TestResolveCastURL(t *testing.T) {
	tests := []struct {
		name          string
		pageURL       string
		publicBaseURL string
		localIP       string
		want          string
	}{
		{
			name:    "rewrites localhost to detected LAN IP keeping port",
			pageURL: "http://localhost:8090/recipes/4/cook",
			localIP: "10.0.0.176",
			want:    "http://10.0.0.176:8090/recipes/4/cook",
		},
		{
			name:    "keeps existing LAN IP intact",
			pageURL: "http://192.168.1.25:8090/recipes/4/cook",
			localIP: "10.0.0.176",
			want:    "http://192.168.1.25:8090/recipes/4/cook",
		},
		{
			name:          "publicBaseURL overrides origin",
			pageURL:       "http://localhost:8090/recipes/4/cook",
			publicBaseURL: "https://kiln.home.arpa",
			localIP:       "10.0.0.176",
			want:          "https://kiln.home.arpa/recipes/4/cook",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveCastURL(tc.pageURL, tc.publicBaseURL, tc.localIP)
			if err != nil {
				t.Fatalf("resolveCastURL failed: %v", err)
			}
			if got != tc.want {
				t.Fatalf("resolveCastURL = %q, want %q", got, tc.want)
			}
		})
	}
}

type sentMessage struct {
	requestID int
	payload   string
	sourceID  string
	destID    string
	namespace string
}

type fakeCastConn struct {
	msgCh   chan *pb.CastMessage
	sent    []sentMessage
	localIP string
	closed  bool
}

func (f *fakeCastConn) Start(_ string, _ int) error     { return nil }
func (f *fakeCastConn) MsgChan() chan *pb.CastMessage   { return f.msgCh }
func (f *fakeCastConn) Close() error                    { f.closed = true; return nil }
func (f *fakeCastConn) SetDebug(_ bool)                 {}
func (f *fakeCastConn) LocalAddr() (string, error)      { return f.localIP, nil }
func (f *fakeCastConn) RemoteAddr() (string, error)     { return "10.0.0.50", nil }
func (f *fakeCastConn) RemotePort() (string, error)     { return "8009", nil }

func (f *fakeCastConn) Send(requestID int, payload cast.Payload, sourceID, destinationID, namespace string) error {
	raw, _ := json.Marshal(payload)
	f.sent = append(f.sent, sentMessage{
		requestID: requestID,
		payload:   string(raw),
		sourceID:  sourceID,
		destID:    destinationID,
		namespace: namespace,
	})

	// Simulate Nest Hub responses to GET_STATUS and LAUNCH.
	var hdr struct {
		Type      string `json:"type"`
		RequestId int    `json:"requestId"`
		AppId     string `json:"appId"`
	}
	_ = json.Unmarshal(raw, &hdr)

	switch hdr.Type {
	case "GET_STATUS":
		resp := `{"type":"RECEIVER_STATUS","requestId":` + jsonInt(hdr.RequestId) + `,"status":{"applications":[]}}`
		f.msgCh <- &pb.CastMessage{PayloadUtf8: &resp}
	case "LAUNCH":
		resp := `{"type":"RECEIVER_STATUS","requestId":` + jsonInt(hdr.RequestId) + `,"status":{"applications":[{"appId":"` + hdr.AppId + `","sessionId":"sess-1","transportId":"web-transport-1"}]}}`
		f.msgCh <- &pb.CastMessage{PayloadUtf8: &resp}
	}

	return nil
}

func jsonInt(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}

func TestGoChromecastCaster_CastURL_DashCastHandshake(t *testing.T) {
	fake := &fakeCastConn{
		msgCh:   make(chan *pb.CastMessage, 10),
		localIP: "10.0.0.176",
	}

	c := NewGoChromecastCaster("")
	c.connFactory = func() cast.Conn { return fake }

	resolved, err := c.CastURL(context.Background(), "10.0.0.50", 8009, "http://localhost:8090/recipes/7/cook")
	if err != nil {
		t.Fatalf("CastURL failed: %v", err)
	}
	if resolved != "http://10.0.0.176:8090/recipes/7/cook" {
		t.Fatalf("unexpected resolved URL: %q", resolved)
	}
	if !fake.closed {
		t.Fatalf("expected cast connection to be closed")
	}

	// Verify final DashCast message was sent to the launched transport with force:true.
	if len(fake.sent) == 0 {
		t.Fatalf("expected cast messages to be sent")
	}
	last := fake.sent[len(fake.sent)-1]
	if last.namespace != nsDashCast || last.destID != "web-transport-1" {
		t.Fatalf("unexpected last message target: %+v", last)
	}

	var dcPayload dashCastPayload
	if err := json.Unmarshal([]byte(last.payload), &dcPayload); err != nil {
		t.Fatalf("unmarshal dashcast payload: %v", err)
	}
	if dcPayload.URL != "http://10.0.0.176:8090/recipes/7/cook" || !dcPayload.Force {
		t.Fatalf("unexpected dashcast payload: %+v", dcPayload)
	}
}
