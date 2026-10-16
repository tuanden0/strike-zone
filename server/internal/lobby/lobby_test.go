package lobby

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"strikezone/server/internal/game"
)

type fakeConn struct{ msgs []map[string]any }

func (f *fakeConn) Send(v any) bool {
	b, _ := json.Marshal(v)
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	f.msgs = append(f.msgs, m)
	return true
}

func (f *fakeConn) last(t string) map[string]any {
	for i := len(f.msgs) - 1; i >= 0; i-- {
		if f.msgs[i]["t"] == t {
			return f.msgs[i]
		}
	}
	return nil
}

func (f *fakeConn) lastErr() string {
	if m := f.last("error"); m != nil {
		return m["code"].(string)
	}
	return ""
}

func newHub(t *testing.T) *Hub {
	t.Helper()
	spec, m, err := game.LoadDefault()
	if err != nil {
		t.Fatal(err)
	}
	return NewHub(spec, m)
}

func client(t *testing.T, h *Hub, nick string) (*Session, *fakeConn) {
	t.Helper()
	fc := &fakeConn{}
	s, err := h.Register(fc)
	if err != nil {
		t.Fatal(err)
	}
	send(t, h, s, map[string]any{"t": "hello", "nick": nick})
	return s, fc
}

func send(t *testing.T, h *Hub, s *Session, m map[string]any) error {
	t.Helper()
	b, _ := json.Marshal(m)
	return h.Handle(s, b)
}

func create(t *testing.T, h *Hub, s *Session, name, pw string, max int) {
	t.Helper()
	if err := send(t, h, s, map[string]any{"t": "create", "name": name, "password": pw, "max": max, "timeLimit": 300, "scoreLimit": 20, "team": "auto"}); err != nil {
		t.Fatal(err)
	}
}

func TestSanitizeName(t *testing.T) {
	cases := []struct{ in, want string }{
		{"  Bob  ", "Bob"},
		{"a\x00b\x1b[31mc", "ab[31mc"},
		{"evil‮gpj", "evilgpj"}, // bidi override removed
		{"tab\there\nnl", "tabherenl"},
		{strings.Repeat("x", 100), strings.Repeat("x", 16)},
		{"日本語の名前", "日本語の名前"},
		{"​‍", ""},               // zero-width only
		{"<b>x</b>", "<b>x</b>"}, // markup is kept; the client renders via textContent
	}
	for _, c := range cases {
		if got := SanitizeName(c.in, 16); got != c.want {
			t.Errorf("SanitizeName(%q)=%q want %q", c.in, got, c.want)
		}
	}
}

func TestHelloAndRoomsRequireOrder(t *testing.T) {
	h := newHub(t)
	fc := &fakeConn{}
	s, _ := h.Register(fc)
	if err := send(t, h, s, map[string]any{"t": "rooms"}); err != nil {
		t.Fatal(err)
	}
	if fc.lastErr() != CodeNotReady {
		t.Fatalf("want not_ready, got %v", fc.msgs)
	}
	send(t, h, s, map[string]any{"t": "hello", "nick": "\x00\x01"})
	w := fc.last("welcome")
	if w == nil || !strings.HasPrefix(w["nick"].(string), "Player") {
		t.Fatalf("empty nick should get default: %v", w)
	}
	if err := send(t, h, s, map[string]any{"t": "hello", "nick": "x"}); err != nil || fc.lastErr() != CodeBadRequest {
		t.Fatal("second hello must be rejected")
	}
}

func TestCreateJoinLeave(t *testing.T) {
	h := newHub(t)
	a, ac := client(t, h, "alice")
	b, bc := client(t, h, "bob")
	create(t, h, a, "Arena", "", 4)
	j := ac.last("joined")
	if j == nil {
		t.Fatalf("no joined: %v", ac.msgs)
	}
	room := int(j["room"].(map[string]any)["id"].(float64))
	send(t, h, b, map[string]any{"t": "rooms"})
	rooms := bc.last("rooms")["rooms"].([]any)
	if len(rooms) != 1 || rooms[0].(map[string]any)["name"] != "Arena" || rooms[0].(map[string]any)["locked"] != false {
		t.Fatalf("rooms: %v", rooms)
	}
	send(t, h, b, map[string]any{"t": "join", "room": room, "team": "auto"})
	jb := bc.last("joined")
	if jb == nil || jb["team"] == j["team"] {
		t.Fatalf("auto team should balance: a=%v b=%v", j["team"], jb)
	}
	if r := ac.last("roster"); r == nil || len(r["players"].([]any)) != 2 {
		t.Fatalf("roster to existing member: %v", r)
	}
	// cannot join twice / create while inside
	send(t, h, b, map[string]any{"t": "join", "room": room})
	if bc.lastErr() != CodeInRoom {
		t.Fatal("double join must fail")
	}
	// leave: roster updates, last leave deletes room
	send(t, h, b, map[string]any{"t": "leave"})
	if bc.last("left") == nil || len(ac.last("roster")["players"].([]any)) != 1 {
		t.Fatal("leave not reflected")
	}
	h.Unregister(a)
	if st := h.Stats(); len(st.Rooms) != 0 || st.Sessions != 1 {
		t.Fatalf("room should be gone: %+v", st)
	}
}

func TestRoomFullAndTeamFull(t *testing.T) {
	h := newHub(t)
	host, hc := client(t, h, "host")
	create(t, h, host, "Tiny", "", 2) // team cap = 1
	room := int(hc.last("joined")["room"].(map[string]any)["id"].(float64))
	hostTeam := hc.last("joined")["team"].(string)

	b, bc := client(t, h, "b")
	send(t, h, b, map[string]any{"t": "join", "room": room, "team": hostTeam})
	if bc.lastErr() != CodeTeamFull {
		t.Fatalf("want team_full, got %v", bc.msgs)
	}
	send(t, h, b, map[string]any{"t": "join", "room": room, "team": "auto"})
	if bc.last("joined") == nil {
		t.Fatalf("other team should be open: %v", bc.msgs)
	}
	c, cc := client(t, h, "c")
	send(t, h, c, map[string]any{"t": "join", "room": room, "team": "auto"})
	if cc.lastErr() != CodeRoomFull {
		t.Fatalf("want room_full, got %v", cc.msgs)
	}
	// team switch into a full team is refused, state unchanged
	send(t, h, b, map[string]any{"t": "team", "team": hostTeam})
	if bc.lastErr() != CodeTeamFull {
		t.Fatal("switch into full team must fail")
	}
	send(t, h, c, map[string]any{"t": "join", "room": 999})
	if cc.lastErr() != CodeNoRoom {
		t.Fatal("unknown room")
	}
}

func TestPasswordRoom(t *testing.T) {
	h := newHub(t)
	host, hc := client(t, h, "host")
	create(t, h, host, "Secret", "hunter2", 6)
	room := int(hc.last("joined")["room"].(map[string]any)["id"].(float64))
	if !h.rooms[room].Info().Locked {
		t.Fatal("room should be locked")
	}
	g, gc := client(t, h, "guest")
	for _, pw := range []string{"", "wrong", "hunter", "hunter22", "HUNTER2"} {
		send(t, h, g, map[string]any{"t": "join", "room": room, "password": pw})
		if gc.lastErr() != CodeBadPassword || gc.last("joined") != nil {
			t.Fatalf("password %q accepted", pw)
		}
	}
	send(t, h, g, map[string]any{"t": "join", "room": room, "password": "hunter2"})
	if gc.last("joined") == nil {
		t.Fatalf("correct password rejected: %v", gc.msgs)
	}
	// no message may echo the password
	for _, m := range append(gc.msgs, hc.msgs...) {
		b, _ := json.Marshal(m)
		if strings.Contains(string(b), "hunter2") {
			t.Fatalf("password leaked in %s", b)
		}
	}
}

func TestPasswordBruteForceDisconnects(t *testing.T) {
	h := newHub(t)
	host, hc := client(t, h, "host")
	create(t, h, host, "Secret", "pw", 4)
	room := int(hc.last("joined")["room"].(map[string]any)["id"].(float64))
	g, _ := client(t, h, "g")
	var err error
	for i := 0; i < maxBadPass && err == nil; i++ {
		err = send(t, h, g, map[string]any{"t": "join", "room": room, "password": fmt.Sprint(i)})
	}
	if err == nil {
		t.Fatal("expected disconnect error after repeated wrong passwords")
	}
}

func TestCreateValidation(t *testing.T) {
	h := newHub(t)
	s, sc := client(t, h, "x")
	bad := []map[string]any{
		{"t": "create", "name": "", "max": 4, "timeLimit": 300, "scoreLimit": 20},
		{"t": "create", "name": "\x00\x01", "max": 4, "timeLimit": 300, "scoreLimit": 20},
		{"t": "create", "name": "ok", "max": 1, "timeLimit": 300, "scoreLimit": 20},
		{"t": "create", "name": "ok", "max": 11, "timeLimit": 300, "scoreLimit": 20},
		{"t": "create", "name": "ok", "max": 4, "timeLimit": 5, "scoreLimit": 20},
		{"t": "create", "name": "ok", "max": 4, "timeLimit": 300, "scoreLimit": 0},
		{"t": "create", "name": "ok", "max": 4, "timeLimit": 300, "scoreLimit": 20, "password": strings.Repeat("p", 33)},
	}
	for i, m := range bad {
		if err := send(t, h, s, m); err != nil {
			t.Fatalf("case %d: unexpected fatal %v", i, err)
		}
		if sc.lastErr() != CodeBadRequest || sc.last("joined") != nil {
			t.Fatalf("case %d accepted: %v", i, m)
		}
	}
	// long name truncated, not rejected
	create(t, h, s, strings.Repeat("n", 80), "", 4)
	if name := sc.last("joined")["room"].(map[string]any)["name"].(string); len([]rune(name)) != MaxRoomRunes {
		t.Fatalf("name %q", name)
	}
}

func TestRoomLimit(t *testing.T) {
	h := newHub(t)
	for i := 0; i < MaxRooms; i++ {
		s, _ := client(t, h, "p")
		create(t, h, s, "r", "", 2)
	}
	s, sc := client(t, h, "late")
	create(t, h, s, "r", "", 2)
	if sc.lastErr() != CodeTooManyRoom {
		t.Fatalf("want too_many_rooms: %v", sc.msgs)
	}
}

func TestSessionLimit(t *testing.T) {
	h := newHub(t)
	for i := 0; i < MaxSessions; i++ {
		if _, err := h.Register(&fakeConn{}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := h.Register(&fakeConn{}); err != ErrServerFull {
		t.Fatalf("want ErrServerFull, got %v", err)
	}
}

func TestMalformedAndUnknownMessages(t *testing.T) {
	h := newHub(t)
	s, sc := client(t, h, "x")
	if err := h.Handle(s, []byte("{not json")); err == nil {
		t.Fatal("malformed JSON must close the connection")
	}
	var err error
	for i := 0; i < maxBadMsgs && err == nil; i++ {
		err = send(t, h, s, map[string]any{"t": "nope"})
	}
	if err == nil || sc.lastErr() != CodeBadRequest {
		t.Fatal("repeated unknown messages must eventually disconnect")
	}
}

func TestInputRoutingAndTickSnapshot(t *testing.T) {
	h := newHub(t)
	a, ac := client(t, h, "a")
	create(t, h, a, "R", "", 4)
	// input before joining a room is a violation; valid input moves the player
	b, bc := client(t, h, "b")
	send(t, h, b, map[string]any{"t": "in", "seq": 1, "f": 1, "s": 0, "yaw": 0, "pitch": 0})
	if bc.lastErr() != CodeNotInRoom {
		t.Fatal("input outside room")
	}
	z0 := h.rooms[1].World.Player(a.ID).Kin.Z
	for i := 1; i <= 15; i++ {
		send(t, h, a, map[string]any{"t": "in", "seq": i, "f": 1, "s": 0, "yaw": 0, "pitch": 0, "jump": false, "walk": false, "fire": false, "reload": false, "weapon": -1})
		h.Tick()
	}
	snap := ac.last("snap")
	if snap == nil {
		t.Fatal("no snapshot")
	}
	you := snap["you"].(map[string]any)
	if you["ack"].(float64) != 15 || you["z"].(float64) >= z0-1 {
		t.Fatalf("player did not advance/ack: z0=%v you=%v", z0, you)
	}
	// invalid input is rejected and not applied
	send(t, h, a, map[string]any{"t": "in", "seq": 99, "f": 5, "yaw": 0, "pitch": 0})
	if ac.lastErr() != CodeBadRequest {
		t.Fatal("out-of-range axis must be rejected")
	}
	// stale seq rejected
	send(t, h, a, map[string]any{"t": "in", "seq": 3, "f": 1, "yaw": 0, "pitch": 0})
	if ac.lastErr() != CodeBadRequest {
		t.Fatal("stale seq must be rejected")
	}
}

func TestPing(t *testing.T) {
	h := newHub(t)
	_, fc := client(t, h, "p")
	s := h.sessions[1]
	send(t, h, s, map[string]any{"t": "ping", "ts": 123.5})
	if p := fc.last("pong"); p == nil || p["ts"].(float64) != 123.5 {
		t.Fatalf("pong: %v", fc.msgs)
	}
}
