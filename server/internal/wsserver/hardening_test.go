package wsserver

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"

	"strikezone/server/internal/game"
	"strikezone/server/internal/lobby"
)

// faultyHub wraps a real hub and panics on demand.
type faultyHub struct {
	*lobby.Hub
	panicOnHandle atomic.Bool
	panicOnTick   atomic.Bool
	ticks         atomic.Int64
}

func (f *faultyHub) Handle(s *lobby.Session, raw []byte) error {
	if f.panicOnHandle.Load() {
		panic("boom in Handle")
	}
	return f.Hub.Handle(s, raw)
}

func (f *faultyHub) Tick() {
	f.ticks.Add(1)
	if f.panicOnTick.Load() {
		panic("boom in Tick")
	}
	f.Hub.Tick()
}

func startFaulty(t *testing.T, cfg Config) (*httptest.Server, *faultyHub) {
	t.Helper()
	spec, m, err := game.LoadDefault()
	if err != nil {
		t.Fatal(err)
	}
	fh := &faultyHub{Hub: lobby.NewHub(spec, m)}
	if cfg.MaxConnPerIP == 0 {
		cfg.MaxConnPerIP = 20
	}
	s := New(fh, cfg)
	mux := http.NewServeMux()
	mux.Handle("/ws", s)
	ts := httptest.NewServer(mux)
	ctx, cancel := context.WithCancel(context.Background())
	go s.Run(ctx)
	t.Cleanup(func() { cancel(); s.Close(); ts.Close() })
	return ts, fh
}

func TestPanicInHandleKillsOnlyThatConnection(t *testing.T) {
	ts, fh := startFaulty(t, Config{})
	victim, _, _ := dial(t, ts, "", "")
	healthy, _, _ := dial(t, ts, "", "")
	healthy.send(map[string]any{"t": "hello", "nick": "ok"})
	healthy.waitFor("welcome")

	fh.panicOnHandle.Store(true)
	victim.send(map[string]any{"t": "hello", "nick": "x"})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, _, err := victim.c.Read(ctx); websocket.CloseStatus(err) != websocket.StatusInternalError {
		t.Fatalf("panicking connection should close with internal error, got %v", err)
	}
	fh.panicOnHandle.Store(false)
	// the server and the other connection are unaffected
	healthy.send(map[string]any{"t": "ping", "ts": 5})
	healthy.waitFor("pong")
	if c2, _, err := dial(t, ts, "", ""); err != nil || c2 == nil {
		t.Fatalf("server stopped accepting after panic: %v", err)
	}
}

func TestPanicInTickDoesNotStopLoop(t *testing.T) {
	_, fh := startFaulty(t, Config{})
	fh.panicOnTick.Store(true)
	before := fh.ticks.Load()
	time.Sleep(200 * time.Millisecond)
	if fh.ticks.Load()-before < 3 {
		t.Fatalf("tick loop died after panic: %d ticks", fh.ticks.Load()-before)
	}
}

func TestMessageFloodIsRateLimitedThenDisconnected(t *testing.T) {
	ts, _ := startFaulty(t, Config{})
	c, _, _ := dial(t, ts, "", "")
	c.send(map[string]any{"t": "hello", "nick": "flood"})
	c.waitFor("welcome")
	c.send(map[string]any{"t": "create", "name": "F", "max": 2, "timeLimit": 300, "scoreLimit": 10, "team": "A"})
	c.waitFor("joined")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var writeErr error
	// Valid, increasing inputs: they draw no reply, so only the rate limiter can cut this off.
	for i := 1; i <= 5000 && writeErr == nil; i++ { // far above MsgBurst + refill
		writeErr = c.c.Write(ctx, websocket.MessageText, []byte(fmt.Sprintf(`{"t":"in","seq":%d,"f":0,"s":0,"yaw":0,"pitch":0,"weapon":-1}`, i)))
	}
	// The server must hang up. Ideally we see the policy-violation close frame, but the server may reset
	// the TCP connection while we are still blasting data, which discards that frame: both prove a disconnect.
	var closeErr error
	for {
		if _, _, closeErr = c.c.Read(ctx); closeErr != nil {
			break
		}
	}
	if st := websocket.CloseStatus(closeErr); st != websocket.StatusPolicyViolation && ctx.Err() != nil {
		t.Fatalf("flooding client was not disconnected in time: %v", closeErr)
	}
	_ = writeErr // writes may all succeed into kernel buffers; the disconnect is what matters
}

func TestIdleConnectionTimesOut(t *testing.T) {
	ts, _ := startFaulty(t, Config{IdleTimeout: 300 * time.Millisecond})
	c, _, _ := dial(t, ts, "", "")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	start := time.Now()
	if _, _, err := c.c.Read(ctx); err == nil {
		t.Fatal("idle connection should be closed")
	}
	if d := time.Since(start); d > 2*time.Second {
		t.Fatalf("idle close took %v", d)
	}
}

func TestSlowClientIsDropped(t *testing.T) {
	cancelled := false
	c := &wsConn{out: make(chan []byte, 2), cancel: func() { cancelled = true }}
	for i := 0; i < 2; i++ {
		if !c.Send(map[string]int{"n": i}) {
			t.Fatal("queue should accept up to its capacity")
		}
	}
	if c.Send(map[string]int{"n": 3}) || !cancelled {
		t.Fatal("full queue must report failure and cancel the connection")
	}
}

func TestServerFullClosesNewConnection(t *testing.T) {
	spec, m, _ := game.LoadDefault()
	hub := lobby.NewHub(spec, m)
	for i := 0; i < lobby.MaxSessions; i++ {
		if _, err := hub.Register(nopConn{}); err != nil {
			t.Fatal(err)
		}
	}
	s := New(hub, Config{MaxConnPerIP: 5})
	mux := http.NewServeMux()
	mux.Handle("/ws", s)
	ts := httptest.NewServer(mux)
	defer ts.Close()
	defer s.Close()
	c, _, err := dial(t, ts, "", "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, _, err := c.c.Read(ctx); websocket.CloseStatus(err) != websocket.StatusTryAgainLater {
		t.Fatalf("want try-again-later close, got %v", err)
	}
}

type nopConn struct{}

func (nopConn) Send(any) bool { return true }
