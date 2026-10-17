package lobby

import "testing"

func TestSupersededSessionCannotActAfterResume(t *testing.T) {
	h := newHub(t)
	a, ac := connect(t, h, "A")
	create(t, h, a, "R", "", 4)
	tok := tokenOf(ac)
	a2, _ := freshConn(t, h)
	send(t, h, a2, map[string]any{"t": "resume", "token": tok})
	rooms := len(h.rooms)
	// the old socket's goroutine was already waiting on the hub lock with a `create`: it must be refused, not create a zombie room
	if err := send(t, h, a, map[string]any{"t": "create", "name": "Zombie", "max": 4, "timeLimit": 300, "scoreLimit": 20, "team": "A"}); err == nil {
		t.Fatal("a superseded session was still served")
	}
	if len(h.rooms) != rooms {
		t.Fatalf("the superseded session created a room: %d -> %d", rooms, len(h.rooms))
	}
}

func TestFailedJoinDoesNotEvictABot(t *testing.T) {
	h, _ := hubAllMaps(t)
	a, _ := client(t, h, "A")
	send(t, h, a, map[string]any{"t": "create", "name": "R", "max": 4, "timeLimit": 300, "scoreLimit": 20, "team": "A"})
	r := h.rooms[1]
	b, _ := client(t, h, "B")
	send(t, h, b, map[string]any{"t": "join", "room": 1, "team": "A"}) // team A: 2 humans = full (cap 2)
	send(t, h, a, map[string]any{"t": "addbot", "team": "B", "skill": "easy"})
	send(t, h, a, map[string]any{"t": "addbot", "team": "B", "skill": "easy"})
	if r.World.Len() != 4 {
		t.Fatalf("setup: %d players", r.World.Len())
	}
	c, cc := client(t, h, "C")
	send(t, h, c, map[string]any{"t": "join", "room": 1, "team": "A"})
	if cc.lastErr() != CodeTeamFull {
		t.Fatalf("join into a full human team: %q", cc.lastErr())
	}
	if len(r.bots) != 2 || r.World.Len() != 4 {
		t.Fatalf("the failed join removed a bot: bots=%d players=%d", len(r.bots), r.World.Len())
	}
}

func TestTeamSwitchHasACooldown(t *testing.T) {
	h := newHub(t)
	a, ac := connect(t, h, "A")
	create(t, h, a, "R", "", 6)
	send(t, h, a, map[string]any{"t": "team", "team": "B"})
	if ac.lastErr() != "" {
		t.Fatalf("first switch refused: %q", ac.lastErr())
	}
	send(t, h, a, map[string]any{"t": "team", "team": "A"})
	if ac.lastErr() != CodeCooldown {
		t.Fatalf("an immediate second switch must be refused with %q, got %q", CodeCooldown, ac.lastErr())
	}
	for i := 0; i < teamSwitchCooldownTicks; i++ {
		h.Tick()
	}
	ac.msgs = nil
	send(t, h, a, map[string]any{"t": "team", "team": "A"})
	if ac.lastErr() != "" {
		t.Fatalf("switch after the cooldown refused: %q", ac.lastErr())
	}
}

func TestClosingARoomSendsItsMembersBackToTheLobby(t *testing.T) {
	h := newHub(t)
	a, ac := connect(t, h, "A")
	create(t, h, a, "R", "", 4)
	h.mu.Lock()
	h.closeRoomLocked(h.rooms[1])
	h.mu.Unlock()
	if len(h.rooms) != 0 || a.room != nil || ac.lastErr() != CodeNoRoom {
		t.Fatalf("room not closed cleanly: rooms=%d room=%v err=%q", len(h.rooms), a.room, ac.lastErr())
	}
}
