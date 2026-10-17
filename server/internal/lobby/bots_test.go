package lobby

import (
	"testing"

	"strikezone/server/internal/game"
)

func rosterOf(c *fakeConn) []any { return c.last("roster")["players"].([]any) }

func botsIn(c *fakeConn) int {
	n := 0
	for _, p := range rosterOf(c) {
		if b, _ := p.(map[string]any)["bot"].(bool); b {
			n++
		}
	}
	return n
}

func TestCreateRoomWithBotsFillsBothTeams(t *testing.T) {
	h, _ := hubAllMaps(t)
	a, ac := client(t, h, "a")
	if err := send(t, h, a, map[string]any{"t": "create", "name": "R", "max": 8, "timeLimit": 300, "scoreLimit": 20, "team": "A", "bots": 5, "skill": "hard"}); err != nil {
		t.Fatal(err)
	}
	if ac.lastErr() != "" {
		t.Fatalf("create failed: %v", ac.lastErr())
	}
	if len(rosterOf(ac)) != 6 || botsIn(ac) != 5 {
		t.Fatalf("roster %v", rosterOf(ac))
	}
	w := h.rooms[1].World
	if abs(w.TeamCount(game.TeamA)-w.TeamCount(game.TeamB)) > 1 {
		t.Fatalf("teams unbalanced: A=%d B=%d", w.TeamCount(game.TeamA), w.TeamCount(game.TeamB))
	}
	if ac.last("joined")["room"].(map[string]any)["bots"].(float64) != 5 {
		t.Fatalf("room info must carry the bot count: %v", ac.last("joined"))
	}
	ids := map[float64]bool{}
	for _, p := range rosterOf(ac) {
		id := p.(map[string]any)["id"].(float64)
		if ids[id] {
			t.Fatalf("duplicate id %v", id)
		}
		ids[id] = true
	}
	// the world ticks with bots in it and snapshots keep flowing
	for i := 0; i < 60; i++ {
		h.Tick()
	}
	if ac.last("snap") == nil {
		t.Fatal("no snapshots")
	}
}

func abs(a int) int {
	if a < 0 {
		return -a
	}
	return a
}

func TestCreateRejectsBadBotRequests(t *testing.T) {
	h, _ := hubAllMaps(t)
	for name, m := range map[string]map[string]any{
		"too many":    {"bots": 4, "max": 4},
		"negative":    {"bots": -1, "max": 4},
		"bad skill":   {"bots": 1, "max": 4, "skill": "godlike"},
		"huge number": {"bots": 1 << 30, "max": 4},
	} {
		a, ac := client(t, h, "x")
		req := map[string]any{"t": "create", "name": "R", "timeLimit": 300, "scoreLimit": 20, "team": "A"}
		for k, v := range m {
			req[k] = v
		}
		send(t, h, a, req)
		if ac.lastErr() != CodeBadRequest || ac.last("joined") != nil {
			t.Errorf("%s accepted: %v", name, ac.msgs)
		}
	}
	if len(h.rooms) != 0 {
		t.Fatal("rejected creates must not leave rooms behind")
	}
}

func TestAddAndRemoveBotsInARoom(t *testing.T) {
	h, _ := hubAllMaps(t)
	a, ac := client(t, h, "a")
	createOn(t, h, a, "")
	send(t, h, a, map[string]any{"t": "addbot", "team": "B", "skill": "easy"})
	send(t, h, a, map[string]any{"t": "addbot"})
	if ac.lastErr() != "" || botsIn(ac) != 2 {
		t.Fatalf("after two addbot: bots=%d err=%q", botsIn(ac), ac.lastErr())
	}
	send(t, h, a, map[string]any{"t": "addbot", "skill": "nope"})
	if ac.lastErr() != CodeBadRequest {
		t.Fatal("bad skill must be rejected")
	}
	// room max is 4: one human + 2 bots -> one more fits, then full
	send(t, h, a, map[string]any{"t": "addbot"})
	send(t, h, a, map[string]any{"t": "addbot"})
	if ac.lastErr() != CodeRoomFull {
		t.Fatalf("a full room must refuse another bot: %q", ac.lastErr())
	}
	send(t, h, a, map[string]any{"t": "rmbot"})
	if botsIn(ac) != 2 {
		t.Fatalf("rmbot: bots=%d", botsIn(ac))
	}
	send(t, h, a, map[string]any{"t": "rmbot"})
	send(t, h, a, map[string]any{"t": "rmbot"})
	send(t, h, a, map[string]any{"t": "rmbot"})
	if ac.lastErr() != CodeNoBots {
		t.Fatalf("removing from an empty bot list: %q", ac.lastErr())
	}
	// outside a room: protocol violations
	b, bc := client(t, h, "b")
	send(t, h, b, map[string]any{"t": "addbot"})
	if bc.lastErr() != CodeNotInRoom {
		t.Fatal("addbot outside a room")
	}
}

func TestHumanReplacesABotWhenTheRoomIsFull(t *testing.T) {
	h, _ := hubAllMaps(t)
	a, ac := client(t, h, "a")
	send(t, h, a, map[string]any{"t": "create", "name": "R", "max": 4, "timeLimit": 300, "scoreLimit": 20, "team": "A", "bots": 3})
	if botsIn(ac) != 3 {
		t.Fatal("setup")
	}
	b, bc := client(t, h, "b")
	send(t, h, b, map[string]any{"t": "join", "room": 1, "team": "B"})
	if bc.lastErr() != "" || bc.last("joined") == nil {
		t.Fatalf("join a bot-full room: %v", bc.msgs)
	}
	if botsIn(bc) != 2 || len(rosterOf(bc)) != 4 {
		t.Fatalf("a bot should have made room: %v", rosterOf(bc))
	}
}

func TestLastHumanLeavingRemovesTheRoomWithItsBots(t *testing.T) {
	h, _ := hubAllMaps(t)
	a, _ := client(t, h, "a")
	send(t, h, a, map[string]any{"t": "create", "name": "R", "max": 6, "timeLimit": 300, "scoreLimit": 20, "team": "A", "bots": 4})
	if len(h.rooms) != 1 {
		t.Fatal("setup")
	}
	send(t, h, a, map[string]any{"t": "leave"})
	if len(h.rooms) != 0 {
		t.Fatal("bots must not keep an empty room alive")
	}
}
