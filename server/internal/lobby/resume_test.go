package lobby

import (
	"regexp"
	"testing"
)

var hex32 = regexp.MustCompile(`^[0-9a-f]{32}$`)

// closeConn is a fakeConn that records Close (the hub force-closes a half-open socket when a resume takes it over).
type closeConn struct {
	fakeConn
	closed bool
}

func (c *closeConn) Close() { c.closed = true }

func connect(t *testing.T, h *Hub, nick string) (*Session, *closeConn) {
	t.Helper()
	cc := &closeConn{}
	s, err := h.Register(cc)
	if err != nil {
		t.Fatal(err)
	}
	send(t, h, s, map[string]any{"t": "hello", "nick": nick})
	return s, cc
}

func tokenOf(c *closeConn) string { return c.last("welcome")["token"].(string) }

// freshConn is a new connection that has not said hello (what a reconnecting client has).
func freshConn(t *testing.T, h *Hub) (*Session, *closeConn) {
	t.Helper()
	cc := &closeConn{}
	s, err := h.Register(cc)
	if err != nil {
		t.Fatal(err)
	}
	return s, cc
}

func TestWelcomeCarriesAnUnguessableToken(t *testing.T) {
	h := newHub(t)
	_, c1 := connect(t, h, "a")
	_, c2 := connect(t, h, "b")
	t1, t2 := tokenOf(c1), tokenOf(c2)
	if !hex32.MatchString(t1) || !hex32.MatchString(t2) || t1 == t2 {
		t.Fatalf("tokens %q %q: want distinct 32-hex secrets", t1, t2)
	}
}

func TestDroppedPlayerKeepsTheirSeatAndResumesWithTheSameIdentity(t *testing.T) {
	h := newHub(t)
	a, ac := connect(t, h, "Alice")
	create(t, h, a, "R", "", 4)
	b, bc := connect(t, h, "Bob")
	send(t, h, b, map[string]any{"t": "join", "room": 1, "team": "B"})
	oldTok, oldID := tokenOf(ac), a.ID
	// a few inputs so the player has a state worth preserving
	for i := 1; i <= 5; i++ {
		send(t, h, a, map[string]any{"t": "in", "seq": i, "f": 1, "s": 0, "yaw": 0, "pitch": 0, "weapon": -1})
		h.Tick()
	}
	pl := h.rooms[1].World.Player(oldID)

	h.Unregister(a) // connection lost
	rosterRows := bc.last("roster")["players"].([]any)
	if len(rosterRows) != 2 {
		t.Fatalf("Alice must stay in the match while away: %v", rosterRows)
	}
	for i := 0; i < 90; i++ { // 3 s offline: she stands still and stays alive
		h.Tick()
	}
	if !pl.Away {
		t.Fatal("player should be flagged away")
	}
	// reconnect: a new socket sends resume with the token instead of hello
	a2, a2c := freshConn(t, h)
	if err := send(t, h, a2, map[string]any{"t": "resume", "token": oldTok}); err != nil {
		t.Fatal(err)
	}
	if a2c.lastErr() != "" {
		t.Fatalf("resume refused: %v", a2c.lastErr())
	}
	res := a2c.last("resumed")
	if res == nil || int(res["id"].(float64)) != oldID || res["nick"] != "Alice" || res["room"] == nil || res["team"] == nil {
		t.Fatalf("resumed: %v", res)
	}
	if !hex32.MatchString(res["token"].(string)) || res["token"] == oldTok {
		t.Fatal("the token must be rotated on resume")
	}
	if a2c.last("pk") == nil || a2c.last("roster") == nil {
		t.Fatal("the resumed client needs the pickups and the roster again")
	}
	if pl.Away {
		t.Fatal("away flag not cleared")
	}
	// the match went on: same player object, inputs keep working (seq continues), snapshots reach the new socket
	send(t, h, a2, map[string]any{"t": "in", "seq": 6, "f": 0, "s": 0, "yaw": 0, "pitch": 0, "weapon": -1})
	h.Tick()
	snap := a2c.last("snap")
	if snap == nil || snap["you"] == nil {
		t.Fatalf("no snapshot with a `you` block on the resumed socket: %v", snap)
	}
	if h.rooms[1].World.Player(oldID) != pl {
		t.Fatal("the player object must survive")
	}
	// the old token is dead (single use)
	a3, a3c := freshConn(t, h)
	send(t, h, a3, map[string]any{"t": "resume", "token": oldTok})
	if a3c.lastErr() != CodeBadToken {
		t.Fatalf("a used token must be rejected, got %q", a3c.lastErr())
	}
	// and the grace timer is gone: ticking past it does not remove the resumed player
	for i := 0; i < LimboTicks+10; i++ {
		h.Tick()
	}
	if len(h.rooms) != 1 || h.rooms[1].World.Player(oldID) == nil {
		t.Fatal("resumed player was removed by the old grace timer")
	}
}

func TestResumeFailsAfterTheGracePeriodAndOnGarbage(t *testing.T) {
	h := newHub(t)
	a, ac := connect(t, h, "A")
	create(t, h, a, "R", "", 4)
	tok := tokenOf(ac)
	h.Unregister(a)
	for i := 0; i < LimboTicks; i++ {
		h.Tick()
	}
	if len(h.rooms) != 0 {
		t.Fatal("room should be gone")
	}
	s, sc := freshConn(t, h)
	send(t, h, s, map[string]any{"t": "resume", "token": tok})
	if sc.lastErr() != CodeBadToken {
		t.Fatalf("expired token accepted: %q", sc.lastErr())
	}
	for _, bad := range []string{"", "xyz", "0123456789abcdef0123456789abcdeg", "0123456789abcdef0123456789abcdef", string(make([]byte, 5000))} {
		s2, c2 := freshConn(t, h)
		send(t, h, s2, map[string]any{"t": "resume", "token": bad})
		if c2.lastErr() != CodeBadToken {
			t.Errorf("garbage token %q accepted: %q", bad[:min(8, len(bad))], c2.lastErr())
		}
	}
	// repeated guessing gets the connection dropped
	s3, _ := freshConn(t, h)
	var err error
	for i := 0; i < 20 && err == nil; i++ {
		err = send(t, h, s3, map[string]any{"t": "resume", "token": "0123456789abcdef0123456789abcdef"})
	}
	if err == nil {
		t.Fatal("token guessing must end in a disconnect")
	}
}

func TestResumeTakesOverAnOldSocketThatWasNeverNoticedDead(t *testing.T) {
	h := newHub(t)
	a, ac := connect(t, h, "A")
	create(t, h, a, "R", "", 4)
	b, _ := connect(t, h, "B")
	send(t, h, b, map[string]any{"t": "join", "room": 1})
	tok := tokenOf(ac)
	a2, a2c := freshConn(t, h)
	send(t, h, a2, map[string]any{"t": "resume", "token": tok}) // old socket still "open"
	if a2c.last("resumed") == nil {
		t.Fatalf("takeover refused: %v", a2c.lastErr())
	}
	if !ac.closed {
		t.Fatal("the old socket must be force-closed")
	}
	h.Unregister(a) // the old transport finally notices: it must not remove the player the new socket owns
	if h.rooms[1].World.Player(a2.ID) == nil || len(h.rooms[1].members) != 2 {
		t.Fatal("old transport's cleanup removed the resumed player")
	}
	for i := 0; i < 5; i++ {
		h.Tick()
	}
	if a2c.last("snap") == nil {
		t.Fatal("snapshots must flow to the new socket only")
	}
}

func TestResumeRulesForSessionsThatAlreadyIntroducedThemselves(t *testing.T) {
	h := newHub(t)
	a, ac := connect(t, h, "A")
	if err := send(t, h, a, map[string]any{"t": "resume", "token": tokenOf(ac)}); err != nil || ac.lastErr() == "" {
		t.Fatalf("a session that said hello cannot resume: err=%v last=%q", err, ac.lastErr())
	}
	// a player not in any room resumes into the lobby
	b, bc := connect(t, h, "B")
	tok := tokenOf(bc)
	h.Unregister(b) // no room: dropped for good (nothing to hold a seat for)
	s, sc := freshConn(t, h)
	send(t, h, s, map[string]any{"t": "resume", "token": tok})
	if sc.lastErr() != CodeBadToken {
		t.Fatalf("a lobby-only session has no seat to resume: %q", sc.lastErr())
	}
}

func TestRoomWithBotsSurvivesItsOnlyHumanDropping(t *testing.T) {
	h := newHub(t)
	a, ac := connect(t, h, "A")
	send(t, h, a, map[string]any{"t": "create", "name": "R", "max": 6, "timeLimit": 300, "scoreLimit": 20, "team": "A", "bots": 3})
	tok := tokenOf(ac)
	h.Unregister(a)
	for i := 0; i < 300; i++ {
		h.Tick() // the match keeps running with the bots
	}
	if len(h.rooms) != 1 {
		t.Fatal("room vanished while its human was away")
	}
	a2, a2c := freshConn(t, h)
	send(t, h, a2, map[string]any{"t": "resume", "token": tok})
	if a2c.last("resumed") == nil || botsIn(&a2c.fakeConn) != 3 { // botsIn reads the roster the resumed client received
		t.Fatalf("resume into a bot match: %v %v", a2c.lastErr(), a2c.last("roster"))
	}
}

func TestLimboSessionsCountAgainstTheServerCap(t *testing.T) {
	h := newHub(t)
	a, _ := connect(t, h, "A")
	create(t, h, a, "R", "", 4)
	h.Unregister(a)
	if st := h.Stats(); st.Sessions != 1 {
		t.Fatalf("a limbo session is still a session: %+v", st)
	}
	for i := 0; i < LimboTicks; i++ {
		h.Tick()
	}
	if st := h.Stats(); st.Sessions != 0 {
		t.Fatalf("expired limbo session leaked: %+v", st)
	}
}
