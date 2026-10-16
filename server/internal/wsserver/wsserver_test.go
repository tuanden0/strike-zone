package wsserver

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"strikezone/server/internal/game"
	"strikezone/server/internal/lobby"
)

func TestCheckOrigin(t *testing.T) {
	cases := []struct {
		name, origin, host string
		allowed            []string
		want               bool
	}{
		{"no origin (non-browser)", "", "localhost:8080", nil, true},
		{"same origin localhost", "http://localhost:8080", "localhost:8080", nil, true},
		{"same origin LAN ip", "http://192.168.1.20:8080", "192.168.1.20:8080", nil, true},
		{"case-insensitive host", "http://GAME.lan:8080", "game.lan:8080", nil, true},
		{"different port", "http://localhost:9999", "localhost:8080", nil, false},
		{"different host", "http://evil.example", "localhost:8080", nil, false},
		{"lan origin vs localhost host", "http://192.168.1.20:8080", "localhost:8080", nil, false},
		{"null origin", "null", "localhost:8080", nil, false},
		{"garbage", "::::", "localhost:8080", nil, false},
		{"non-http scheme", "file://localhost:8080", "localhost:8080", nil, false},
		{"allowed extra", "http://game.lan:8080", "10.0.0.5:8080", []string{"http://game.lan:8080"}, true},
		{"allowed extra mismatch scheme", "https://game.lan:8080", "10.0.0.5:8080", []string{"http://game.lan:8080"}, false},
		{"suffix trick", "http://localhost:8080.evil.com", "localhost:8080", nil, false},
	}
	for _, c := range cases {
		if got := CheckOrigin(c.origin, c.host, c.allowed); got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}

func TestBucket(t *testing.T) {
	b := NewBucket(10, 5)
	now := time.Unix(1000, 0)
	for i := 0; i < 5; i++ {
		if !b.Allow(now) {
			t.Fatalf("burst token %d denied", i)
		}
	}
	if b.Allow(now) {
		t.Fatal("6th immediate event allowed")
	}
	now = now.Add(100 * time.Millisecond) // +1 token at 10/s
	if !b.Allow(now) {
		t.Fatal("refilled token denied")
	}
	if b.Allow(now) {
		t.Fatal("only one token should have refilled")
	}
	now = now.Add(10 * time.Second) // refill is capped at burst
	n := 0
	for b.Allow(now) {
		n++
	}
	if n != 5 {
		t.Fatalf("burst cap: got %d want 5", n)
	}
	// sustained rate: 10/s for 10s => ~100 allowed
	b = NewBucket(10, 5)
	ok := 0
	now = time.Unix(2000, 0)
	for i := 0; i < 1000; i++ { // offered 100/s
		now = now.Add(10 * time.Millisecond)
		if b.Allow(now) {
			ok++
		}
	}
	if ok < 95 || ok > 110 {
		t.Fatalf("sustained allowed %d, want ~105", ok)
	}
}

func TestIPLimiter(t *testing.T) {
	l := NewIPLimiter(2)
	if !l.Acquire("1.1.1.1") || !l.Acquire("1.1.1.1") {
		t.Fatal("first two must pass")
	}
	if l.Acquire("1.1.1.1") {
		t.Fatal("third must fail")
	}
	if !l.Acquire("2.2.2.2") {
		t.Fatal("other IP independent")
	}
	l.Release("1.1.1.1")
	if !l.Acquire("1.1.1.1") {
		t.Fatal("slot not freed")
	}
	l.Release("1.1.1.1")
	l.Release("1.1.1.1")
	l.Release("1.1.1.1") // extra release is harmless
	if len(l.n) != 1 {
		t.Fatalf("map should only hold 2.2.2.2: %v", l.n)
	}
}

// ---- end-to-end over a real socket ----------------------------------------------------------

func startServer(t *testing.T, cfg Config) (*httptest.Server, *Server) {
	t.Helper()
	spec, m, err := game.LoadDefault()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.MaxConnPerIP == 0 {
		cfg.MaxConnPerIP = 20
	}
	s := New(lobby.NewHub(spec, m), cfg)
	mux := http.NewServeMux()
	mux.Handle("/ws", s)
	ts := httptest.NewUnstartedServer(mux)
	// Aggressive http timeouts prove they do not apply to hijacked WebSocket connections.
	ts.Config.ReadTimeout = 300 * time.Millisecond
	ts.Config.WriteTimeout = 300 * time.Millisecond
	ts.Start()
	ctx, cancel := context.WithCancel(context.Background())
	go s.Run(ctx)
	t.Cleanup(func() { cancel(); s.Close(); ts.Close() })
	return ts, s
}

type wsClient struct {
	t *testing.T
	c *websocket.Conn
}

func dial(t *testing.T, ts *httptest.Server, host, origin string) (*wsClient, *http.Response, error) {
	t.Helper()
	h := http.Header{}
	if origin != "" {
		h.Set("Origin", origin)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	c, resp, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", &websocket.DialOptions{HTTPHeader: h, Host: host})
	if err != nil {
		return nil, resp, err
	}
	t.Cleanup(func() { _ = c.CloseNow() })
	return &wsClient{t: t, c: c}, resp, nil
}

func (w *wsClient) send(m map[string]any) {
	w.t.Helper()
	b, _ := json.Marshal(m)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := w.c.Write(ctx, websocket.MessageText, b); err != nil {
		w.t.Fatalf("write: %v", err)
	}
}

// waitFor reads until a message with type typ arrives.
func (w *wsClient) waitFor(typ string) map[string]any {
	w.t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithDeadline(context.Background(), deadline)
		_, b, err := w.c.Read(ctx)
		cancel()
		if err != nil {
			w.t.Fatalf("waiting for %q: %v", typ, err)
		}
		var m map[string]any
		_ = json.Unmarshal(b, &m)
		if m["t"] == typ {
			return m
		}
	}
	w.t.Fatalf("timeout waiting for %q", typ)
	return nil
}

func TestOriginEnforcedOverHTTP(t *testing.T) {
	ts, _ := startServer(t, Config{})
	if _, resp, err := dial(t, ts, "", "http://evil.example"); err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-origin must get 403, err=%v resp=%v", err, resp)
	}
	// Host is a LAN IP, Origin matches it: must be accepted (no config needed).
	if _, _, err := dial(t, ts, "192.168.1.50:8080", "http://192.168.1.50:8080"); err != nil {
		t.Fatalf("LAN-IP same-origin rejected: %v", err)
	}
	// Browser on localhost origin but Host rewritten to LAN IP: mismatch, rejected.
	if _, _, err := dial(t, ts, "192.168.1.50:8080", "http://localhost:8080"); err == nil {
		t.Fatal("mismatched origin accepted")
	}
}

func TestPerIPConnectionLimit(t *testing.T) {
	ts, _ := startServer(t, Config{MaxConnPerIP: 2})
	for i := 0; i < 2; i++ {
		if _, _, err := dial(t, ts, "", ""); err != nil {
			t.Fatal(err)
		}
	}
	if _, resp, err := dial(t, ts, "", ""); err == nil || resp == nil || resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("third connection must get 429, err=%v resp=%v", err, resp)
	}
}

func TestTwoClientsSameRoomSeeEachOther(t *testing.T) {
	ts, _ := startServer(t, Config{})
	a, _, err := dial(t, ts, "10.0.0.7:8080", "http://10.0.0.7:8080")
	if err != nil {
		t.Fatal(err)
	}
	b, _, err := dial(t, ts, "10.0.0.7:8080", "http://10.0.0.7:8080")
	if err != nil {
		t.Fatal(err)
	}
	a.send(map[string]any{"t": "hello", "nick": "alice"})
	a.waitFor("welcome")
	a.send(map[string]any{"t": "create", "name": "Arena", "max": 6, "timeLimit": 300, "scoreLimit": 20, "team": "A"})
	joined := a.waitFor("joined")
	room := joined["room"].(map[string]any)["id"]

	b.send(map[string]any{"t": "hello", "nick": "bob"})
	b.waitFor("welcome")
	b.send(map[string]any{"t": "rooms"})
	if rs := b.waitFor("rooms")["rooms"].([]any); len(rs) != 1 {
		t.Fatalf("rooms: %v", rs)
	}
	b.send(map[string]any{"t": "join", "room": room, "team": "B"})
	b.waitFor("joined")
	if len(b.waitFor("roster")["players"].([]any)) != 2 {
		t.Fatal("roster should list both players")
	}

	// Alice moves; Bob's snapshot must show alice moving (positions sync through the server).
	stop := make(chan struct{})
	finished := make(chan struct{})
	defer func() { close(stop); <-finished }()
	go func() {
		defer close(finished)
		for i := 1; i <= 60; i++ {
			b, _ := json.Marshal(map[string]any{"t": "in", "seq": i, "f": 1, "s": 0, "yaw": 0, "pitch": 0, "weapon": -1})
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			err := a.c.Write(ctx, websocket.MessageText, b)
			cancel()
			if err != nil {
				return // test ended and closed the socket
			}
			select {
			case <-stop:
				return
			case <-time.After(33 * time.Millisecond):
			}
		}
	}()
	var z0, z1 float64
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		snap := b.waitFor("snap")
		for _, p := range snap["ps"].([]any) {
			pm := p.(map[string]any)
			if int(pm["i"].(float64)) == 1 {
				if z0 == 0 {
					z0 = pm["z"].(float64)
				}
				z1 = pm["z"].(float64)
			}
		}
		if z0 != 0 && z0-z1 > 2 {
			break
		}
	}
	if z0-z1 <= 2 {
		t.Fatalf("bob never saw alice move: z0=%v z1=%v", z0, z1)
	}
}

func TestOversizedMessageClosesConnection(t *testing.T) {
	ts, _ := startServer(t, Config{})
	c, _, err := dial(t, ts, "", "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = c.c.Write(ctx, websocket.MessageText, []byte(`{"t":"hello","nick":"`+strings.Repeat("x", ReadLimit*2)+`"}`))
	if _, _, err := c.c.Read(ctx); err == nil {
		t.Fatal("connection should be closed after oversize message")
	}
}

func TestMalformedJSONClosesConnection(t *testing.T) {
	ts, _ := startServer(t, Config{})
	c, _, _ := dial(t, ts, "", "")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = c.c.Write(ctx, websocket.MessageText, []byte(`{{{`))
	if _, _, err := c.c.Read(ctx); websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
		t.Fatalf("want policy violation close, got %v", err)
	}
}

func TestBinaryFramesRejected(t *testing.T) {
	ts, _ := startServer(t, Config{})
	c, _, _ := dial(t, ts, "", "")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = c.c.Write(ctx, websocket.MessageBinary, []byte{1, 2, 3})
	if _, _, err := c.c.Read(ctx); websocket.CloseStatus(err) != websocket.StatusUnsupportedData {
		t.Fatalf("want unsupported data close, got %v", err)
	}
}

func TestConnectionSurvivesHTTPTimeouts(t *testing.T) {
	// startServer sets http ReadTimeout/WriteTimeout to 300ms; a WebSocket must outlive them.
	ts, _ := startServer(t, Config{})
	c, _, _ := dial(t, ts, "", "")
	c.send(map[string]any{"t": "hello", "nick": "x"})
	c.waitFor("welcome")
	time.Sleep(900 * time.Millisecond)
	c.send(map[string]any{"t": "ping", "ts": 1})
	c.waitFor("pong")
}

func TestShutdownClosesClients(t *testing.T) {
	ts, s := startServer(t, Config{})
	c, _, _ := dial(t, ts, "", "")
	c.send(map[string]any{"t": "hello", "nick": "x"})
	c.waitFor("welcome")
	// A real browser answers the close handshake automatically; here a reader goroutine does.
	errc := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _, err := c.c.Read(ctx)
		errc <- err
	}()
	done := make(chan struct{})
	go func() { s.Close(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Close did not return")
	}
	if err := <-errc; websocket.CloseStatus(err) != websocket.StatusGoingAway {
		t.Fatalf("want going-away close, got %v", err)
	}
}
