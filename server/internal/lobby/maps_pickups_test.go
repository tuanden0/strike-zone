package lobby

import (
	"testing"

	"strikezone/server/internal/game"
)

func hubAllMaps(t *testing.T) (*Hub, *game.MapSet) {
	t.Helper()
	spec, ms, err := game.LoadAll()
	if err != nil {
		t.Fatal(err)
	}
	return NewHubMaps(spec, ms), ms
}

func createOn(t *testing.T, h *Hub, s *Session, mapID string) {
	t.Helper()
	m := map[string]any{"t": "create", "name": "R", "max": 4, "timeLimit": 300, "scoreLimit": 20, "team": "A"}
	if mapID != "" {
		m["map"] = mapID
	}
	if err := send(t, h, s, m); err != nil {
		t.Fatal(err)
	}
}

func TestCreateRoomOnChosenMap(t *testing.T) {
	h, ms := hubAllMaps(t)
	a, ac := client(t, h, "a")
	createOn(t, h, a, "crossroads")
	j := ac.last("joined")
	if j == nil || j["room"].(map[string]any)["map"] != "crossroads" {
		t.Fatalf("joined: %v", ac.msgs)
	}
	if w := h.rooms[1].World; w.Map != ms.Maps["crossroads"] {
		t.Fatal("room world must use the crossroads collision data")
	}
	b, bc := client(t, h, "b")
	createOn(t, h, b, "") // default
	if bc.last("joined")["room"].(map[string]any)["map"] != ms.Default() {
		t.Fatalf("default map: %v", bc.last("joined"))
	}
	c, cc := client(t, h, "c")
	createOn(t, h, c, "../../etc/passwd")
	if cc.lastErr() != CodeBadRequest || cc.last("joined") != nil {
		t.Fatal("unknown map ids must be rejected")
	}
	send(t, h, c, map[string]any{"t": "rooms"})
	rooms := cc.last("rooms")["rooms"].([]any)
	if len(rooms) != 2 || rooms[0].(map[string]any)["map"] != "crossroads" {
		t.Fatalf("room list must carry the map id: %v", rooms)
	}
}

func TestPickupsSentOnJoinAndWhenTheyChange(t *testing.T) {
	h, ms := hubAllMaps(t)
	a, ac := client(t, h, "a")
	createOn(t, h, a, "crossroads")
	pk := ac.last("pk")
	if pk == nil || len(pk["list"].([]any)) != len(ms.Maps["crossroads"].Pickups) {
		t.Fatalf("pk on join: %v", pk)
	}
	n0 := len(pk["list"].([]any))
	// drop the rifle: the next tick broadcasts the longer list and the snapshot reports the lost slot
	send(t, h, a, map[string]any{"t": "in", "seq": 1, "f": 0, "s": 0, "yaw": 0, "pitch": 0, "drop": true, "weapon": -1})
	h.Tick()
	pk = ac.last("pk")
	if len(pk["list"].([]any)) != n0+1 {
		t.Fatalf("pk after drop: %d entries, want %d", len(pk["list"].([]any)), n0+1)
	}
	has := ac.last("snap")["you"].(map[string]any)["has"].([]any)
	if has[0] != false || has[1] != true || has[2] != true {
		t.Fatalf("snapshot has = %v", has)
	}
	// nothing changed on the next tick: no pk spam
	before := len(ac.msgs)
	h.Tick()
	for _, m := range ac.msgs[before:] {
		if m["t"] == "pk" {
			t.Fatal("pk must only be sent when the ground weapons change")
		}
	}
}
