package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"strikezone/server/internal/config"
	"strikezone/server/internal/game"
)

// Open arena: no cover, so line of sight between the two spawns is always clear.
const arenaMap = `{"name":"arena","bounds":{"minX":-24,"maxX":24,"minZ":-24,"maxZ":24},
"boxes":[{"min":[-25,0,-25],"max":[25,6,-24],"mat":"outer"},{"min":[-25,0,24],"max":[25,6,25],"mat":"outer"},
{"min":[-25,0,-24],"max":[-24,6,24],"mat":"outer"},{"min":[24,0,-24],"max":[25,6,24],"mat":"outer"}],
"spawns":{"A":[{"x":0,"z":20,"yaw":0}],"B":[{"x":0,"z":-10,"yaw":3.14159}]}}`

const lanHost = "192.168.1.77:8080"

type wsClient struct {
	t    *testing.T
	c    *websocket.Conn
	id   int
	last map[string]any // latest snapshot
	evs  []map[string]any
}

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	spec, _, err := game.LoadDefault()
	if err != nil {
		t.Fatal(err)
	}
	s2 := *spec
	s2.Weapons = append([]game.WeaponSpec(nil), spec.Weapons...)
	for i := range s2.Weapons {
		s2.Weapons[i].Spread, s2.Weapons[i].MoveSpread = 0, 0 // deterministic aim
	}
	_, m, err := game.Parse(mustSpecJSON(t), []byte(arenaMap))
	if err != nil {
		t.Fatal(err)
	}
	a := NewWith(config.Config{MaxConnPerIP: 20}, &s2, m)
	ts := httptest.NewServer(a.Handler)
	ctx, cancel := context.WithCancel(context.Background())
	go a.Run(ctx)
	t.Cleanup(func() { cancel(); a.Close(); ts.Close() })
	return ts
}

func mustSpecJSON(t *testing.T) []byte {
	t.Helper()
	b, err := readSpec()
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func connect(t *testing.T, ts *httptest.Server, nick string) *wsClient {
	t.Helper()
	h := http.Header{}
	h.Set("Origin", "http://"+lanHost) // browser opened http://<LAN IP>:8080
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", &websocket.DialOptions{HTTPHeader: h, Host: lanHost})
	if err != nil {
		t.Fatalf("dial with LAN Host/Origin failed: %v", err)
	}
	t.Cleanup(func() { _ = c.CloseNow() })
	cl := &wsClient{t: t, c: c}
	cl.send(map[string]any{"t": "hello", "nick": nick})
	cl.id = int(cl.waitFor("welcome")["id"].(float64))
	return cl
}

func (c *wsClient) send(m map[string]any) {
	b, _ := json.Marshal(m)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := c.c.Write(ctx, websocket.MessageText, b); err != nil {
		c.t.Fatalf("write: %v", err)
	}
}

// pump reads one message, recording snapshots and events. Returns it.
func (c *wsClient) pump(deadline time.Time) map[string]any {
	ctx, cancel := context.WithDeadline(context.Background(), deadline)
	defer cancel()
	_, b, err := c.c.Read(ctx)
	if err != nil {
		c.t.Fatalf("read: %v", err)
	}
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	if m["t"] == "snap" {
		c.last = m
		if evs, ok := m["ev"].([]any); ok {
			for _, e := range evs {
				c.evs = append(c.evs, e.(map[string]any))
			}
		}
	}
	return m
}

func (c *wsClient) waitFor(typ string) map[string]any {
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		if m := c.pump(deadline); m["t"] == typ {
			return m
		}
	}
	c.t.Fatalf("timeout waiting for %q", typ)
	return nil
}

func (c *wsClient) waitSnap(cond func(you map[string]any) bool, d time.Duration) bool {
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		c.pump(deadline)
		if c.last != nil && cond(c.last["you"].(map[string]any)) {
			return true
		}
	}
	return false
}

func (c *wsClient) hasEvent(kind string, match func(map[string]any) bool) bool {
	for _, e := range c.evs {
		if e["e"] == kind && match(e) {
			return true
		}
	}
	return false
}

func setup(t *testing.T) (a, b *wsClient) {
	ts := newTestServer(t)
	a = connect(t, ts, "alice")
	b = connect(t, ts, "bob")
	a.send(map[string]any{"t": "create", "name": "Duel", "max": 4, "timeLimit": 600, "scoreLimit": 50, "team": "A"})
	room := a.waitFor("joined")["room"].(map[string]any)["id"]
	b.send(map[string]any{"t": "join", "room": room, "team": "B"})
	b.waitFor("joined")
	return a, b
}

func TestKillOverWebSocketsHeadshotAndScore(t *testing.T) {
	a, b := setup(t)
	if !a.waitSnap(func(y map[string]any) bool { return y["a"] == true }, 2*time.Second) || !b.waitSnap(func(y map[string]any) bool { return y["a"] == true }, 2*time.Second) {
		t.Fatal("players never spawned")
	}
	// Spawn protection blocks damage for 1.5 s; wait it out (and prove it works).
	pos := func(c *wsClient, id int) (x, y, z float64) {
		for _, p := range c.last["ps"].([]any) {
			pm := p.(map[string]any)
			if int(pm["i"].(float64)) == id {
				return pm["x"].(float64), pm["y"].(float64), pm["z"].(float64)
			}
		}
		t.Fatalf("player %d not in snapshot", id)
		return
	}
	ax, ay, az := pos(a, a.id)
	bx, by, bz := pos(a, b.id)
	_ = ay
	_ = by
	// aim from alice's eye to bob's head centre
	dx, dy, dz := bx-ax, 1.62-1.62, bz-az
	yaw := atan2(-dx, -dz)
	pitch := atan2(dy, hypot(dx, dz))

	seq := 0
	fire := func(n int) {
		for i := 0; i < n; i++ {
			seq++
			a.send(map[string]any{"t": "in", "seq": seq, "f": 0, "s": 0, "yaw": yaw, "pitch": pitch, "fire": true, "weapon": -1})
			time.Sleep(34 * time.Millisecond)
		}
	}
	fire(5) // inside spawn protection: no damage
	b.waitSnap(func(y map[string]any) bool { return true }, 200*time.Millisecond)
	if hp := b.last["you"].(map[string]any)["hp"].(float64); hp != 100 {
		t.Fatalf("damage during spawn protection: hp=%v", hp)
	}
	time.Sleep(1500 * time.Millisecond)
	// seq must keep increasing; semi-auto not relevant for rifle (auto)
	fire(6)
	if !b.waitSnap(func(y map[string]any) bool { return y["a"] == false }, 2*time.Second) {
		t.Fatalf("bob was not killed; last=%v", b.last["you"])
	}
	if !b.hasEvent("kill", func(e map[string]any) bool {
		return int(e["by"].(float64)) == a.id && int(e["v"].(float64)) == b.id && e["head"] == true
	}) {
		t.Fatalf("bob missing headshot kill event: %v", b.evs)
	}
	isHead := func(e map[string]any) bool { return e["head"] == true && e["dmg"].(float64) == 120 }
	for end := time.Now().Add(2 * time.Second); time.Now().Before(end) && !a.hasEvent("hit", isHead); {
		a.pump(end) // alice's socket has buffered everything since she started firing
	}
	if !a.hasEvent("hit", isHead) {
		t.Fatalf("alice missing hit event: %v", a.evs)
	}

	// roster + score reflect the kill for both clients
	r := a.waitFor("roster")
	var ak, bd float64
	for _, p := range r["players"].([]any) {
		pm := p.(map[string]any)
		if int(pm["id"].(float64)) == a.id {
			ak = pm["kills"].(float64)
		}
		if int(pm["id"].(float64)) == b.id {
			bd = pm["deaths"].(float64)
		}
	}
	if ak != 1 || bd != 1 {
		t.Fatalf("roster kills=%v deaths=%v: %v", ak, bd, r)
	}
	if sc := r["sc"].([]any); sc[0].(float64) != 1 || sc[1].(float64) != 0 {
		t.Fatalf("score %v", sc)
	}
	if sc := a.last["sc"].([]any); sc[0].(float64) != 1 {
		t.Fatalf("snapshot score %v", sc)
	}

	// respawn ~3 s later, full health
	if !b.waitSnap(func(y map[string]any) bool { return y["a"] == true && y["hp"].(float64) == 100 }, 5*time.Second) {
		t.Fatal("bob did not respawn")
	}
}

func TestBodyShotsAccumulateDamage(t *testing.T) {
	a, b := setup(t)
	a.waitSnap(func(y map[string]any) bool { return y["a"] == true }, 2*time.Second)
	b.waitSnap(func(y map[string]any) bool { return y["a"] == true }, 2*time.Second)
	time.Sleep(1600 * time.Millisecond) // spawn protection
	a.waitSnap(func(y map[string]any) bool { return true }, 200*time.Millisecond)
	var ax, az, bx, bz float64
	for _, p := range a.last["ps"].([]any) {
		pm := p.(map[string]any)
		if int(pm["i"].(float64)) == a.id {
			ax, az = pm["x"].(float64), pm["z"].(float64)
		} else {
			bx, bz = pm["x"].(float64), pm["z"].(float64)
		}
	}
	yaw := atan2(-(bx - ax), -(bz - az))
	pitch := atan2(1.0-1.62, hypot(bx-ax, bz-az)) // chest
	seq := 0
	minHP := 100.0
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && minHP > 0 {
		seq++
		a.send(map[string]any{"t": "in", "seq": seq, "yaw": yaw, "pitch": pitch, "fire": true, "weapon": -1})
		time.Sleep(34 * time.Millisecond)
		b.waitSnap(func(y map[string]any) bool { return true }, 50*time.Millisecond)
		if hp := b.last["you"].(map[string]any)["hp"].(float64); hp < minHP {
			minHP = hp
		}
	}
	if minHP != 0 {
		t.Fatalf("4 body shots (30 each) should kill: min hp %v", minHP)
	}
	if b.hasEvent("kill", func(e map[string]any) bool { return e["head"] == true }) {
		t.Fatal("chest shots reported as headshot")
	}
	if !b.hasEvent("hit", func(e map[string]any) bool { return e["dmg"].(float64) == 30 }) {
		t.Fatalf("no 30-damage hit events: %v", b.evs)
	}
}

func TestCrossOriginRejectedOnRealServer(t *testing.T) {
	ts := newTestServer(t)
	h := http.Header{}
	h.Set("Origin", "http://evil.example")
	_, resp, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws", &websocket.DialOptions{HTTPHeader: h, Host: lanHost})
	if err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("want 403, err=%v resp=%v", err, resp)
	}
}

func TestStaticClientServedWithSecurityHeaders(t *testing.T) {
	ts := newTestServer(t)
	for path, want := range map[string]string{"/": "Strike Zone", "/js/main.js": "import", "/shared/spec.json": "tickRate", "/assets/models/map.glb": "glTF", "/assets/models/character_a.glb": "glTF", "/vendor/GLTFLoader.js": "GLTFLoader"} {
		resp, err := http.Get(ts.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		var sb strings.Builder
		buf := make([]byte, 4096)
		for {
			n, e := resp.Body.Read(buf)
			sb.Write(buf[:n])
			if e != nil {
				break
			}
		}
		resp.Body.Close()
		if resp.StatusCode != 200 || !strings.Contains(sb.String(), want) {
			t.Fatalf("%s: status %d, missing %q", path, resp.StatusCode, want)
		}
		if resp.Header.Get("Content-Security-Policy") == "" || resp.Header.Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("%s: missing security headers", path)
		}
	}
	if resp, _ := http.Get(ts.URL + "/healthz"); resp.StatusCode != 200 {
		t.Fatal("healthz")
	}
	if resp, _ := http.Get(ts.URL + "/admin/stats"); resp.StatusCode != 404 {
		t.Fatalf("admin must be disabled without token, got %d", resp.StatusCode)
	}
}

func TestAdminStatsToken(t *testing.T) {
	spec, m, _ := game.LoadDefault()
	tok := strings.Repeat("tk", 10) // built at runtime: a throwaway test value, not a credential
	a := NewWith(config.Config{MaxConnPerIP: 5, AdminToken: tok}, spec, m)
	ts := httptest.NewServer(a.Handler)
	defer ts.Close()
	defer a.Close()
	get := func(auth string) int {
		req, _ := http.NewRequest("GET", ts.URL+"/admin/stats", nil)
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if get("") != 401 || get("Bearer nope") != 401 || get("Bearer "+tok+"X") != 401 {
		t.Fatal("bad tokens must be 401")
	}
	if get("Bearer "+tok) != 200 {
		t.Fatal("good token rejected")
	}
}
