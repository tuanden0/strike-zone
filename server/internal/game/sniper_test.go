package game

import "testing"

func sniperIdx(t testing.TB, w *World) int {
	t.Helper()
	for i, ws := range w.Spec.Weapons {
		if ws.ID == "sniper" {
			return i
		}
	}
	t.Fatal("spec has no sniper")
	return -1
}

// giveSniper puts a full sniper in the player's hands and waits out the switch delay.
func giveSniper(t testing.TB, w *World, p *Player) int {
	t.Helper()
	si := sniperIdx(t, w)
	p.Has[si], p.Mag[si], p.Res[si] = true, w.Spec.Weapons[si].MagSize, w.Spec.Weapons[si].Reserve
	send(t, w, Input{Weapon: si})
	for i := 0; i <= w.Spec.SwitchTicks; i++ {
		send(t, w, idle())
	}
	if p.Cur != si {
		t.Fatalf("sniper not selected: cur=%d", p.Cur)
	}
	return si
}

func TestSniperIsPickupOnly(t *testing.T) {
	w, p := pkWorld(t)
	si := sniperIdx(t, w)
	if p.Has[si] || p.Mag[si] != 0 || p.Res[si] != 0 {
		t.Fatalf("sniper must not be in the spawn loadout: has=%v mag=%v", p.Has, p.Mag)
	}
	send(t, w, Input{Weapon: si})
	if p.Cur == si {
		t.Fatal("selected a weapon the player does not own")
	}
	// ... but both maps place sniper spawns on the ground
	n := 0
	for _, pk := range w.Pickups() {
		if pk.W == si {
			n++
		}
	}
	if n == 0 {
		t.Fatal("no sniper pickup on the default map")
	}
}

func TestSniperKillsInOneShot(t *testing.T) {
	for _, tc := range []struct {
		name string
		y    float64
	}{{"body", 1.0}, {"head", 1.65}} {
		t.Run(tc.name, func(t *testing.T) {
			w, a, b := duel(t)
			giveSniper(t, w, a)
			fireAt(t, w, a, b.Kin.X, tc.y, b.Kin.Z, -1)
			if b.Alive || len(eventsOf(w, EvKill)) != 1 {
				t.Fatalf("one sniper %s shot should kill: hp=%d alive=%v", tc.name, b.HP, b.Alive)
			}
		})
	}
}

func TestSniperIsBoltAction(t *testing.T) {
	w, a, b := duel(t)
	b.HP = 10000
	si := giveSniper(t, w, a)
	fireAt(t, w, a, b.Kin.X, 1.0, b.Kin.Z, -1)
	first := a.Mag[si]
	for i := 0; i < w.Spec.Weapons[si].IntervalTicks-2; i++ {
		fireAt(t, w, a, b.Kin.X, 1.0, b.Kin.Z, -1) // held trigger, not auto, and inside the cycle time
	}
	if a.Mag[si] != first {
		t.Fatalf("fired again during the bolt cycle: mag %d -> %d", first, a.Mag[si])
	}
}

// shotsHitting fires n sniper shots at a still target 10 m away and counts the ones that hit it.
func shotsHitting(t testing.TB, scope bool, n int) int {
	t.Helper()
	spec, m := mustLoad(t)
	w := NewWorld(spec, m, MatchConfig{TimeLimitSec: 600, ScoreLimit: 1000}, 3)
	a := add(t, w, 1, TeamA)
	b := add(t, w, 2, TeamB)
	a.Kin = Kin{X: 5, Z: 12, OnGround: true}
	b.Kin = Kin{X: 5, Z: 2, OnGround: true}
	a.ProtectUntil, b.ProtectUntil = 0, 0
	si := giveSniper(t, w, a)
	yaw, pitch := aim(w, a, 5, 1.0, 2)
	hits := 0
	for i := 0; i < n; i++ {
		b.HP, b.Alive = 1000000, true
		a.Mag[si] = 5
		for k := 0; k < w.Spec.Weapons[si].IntervalTicks; k++ {
			send(t, w, Input{Weapon: -1, Yaw: yaw, Pitch: pitch, Scope: scope})
		}
		send(t, w, Input{Weapon: -1, Yaw: yaw, Pitch: pitch, Scope: scope, Fire: true})
		for _, e := range eventsOf(w, EvShot) {
			if e.Hit == HitBody || e.Hit == HitHead {
				hits++
			}
		}
		send(t, w, Input{Weapon: -1, Yaw: yaw, Pitch: pitch, Scope: scope}) // release so the next press is an edge
	}
	return hits
}

func TestScopedShotsAreAccurateUnscopedAreNot(t *testing.T) {
	const n = 60
	scoped, hip := shotsHitting(t, true, n), shotsHitting(t, false, n)
	if scoped != n {
		t.Fatalf("scoped and standing still: %d/%d hits, want all", scoped, n)
	}
	if hip >= n-3 {
		t.Fatalf("hip-fired sniper should miss at 10 m sometimes: %d/%d hits", hip, n)
	}
}

func TestScopeOnlyAppliesToScopedWeaponsAndNotWhileReloading(t *testing.T) {
	w, p := pkWorld(t)
	send(t, w, Input{Weapon: -1, Scope: true})
	if p.Scoped {
		t.Fatal("rifle has no scope")
	}
	si := giveSniper(t, w, p)
	send(t, w, Input{Weapon: -1, Scope: true})
	if !p.Scoped {
		t.Fatal("sniper + scope held should be scoped")
	}
	send(t, w, Input{Weapon: -1})
	if p.Scoped {
		t.Fatal("scope released")
	}
	p.Mag[si] = 1
	send(t, w, Input{Weapon: -1, Scope: true, Reload: true})
	send(t, w, Input{Weapon: -1, Scope: true, Reload: true})
	if p.ReloadDone == 0 || p.Scoped {
		t.Fatalf("reloading must drop the scope: reload=%d scoped=%v", p.ReloadDone, p.Scoped)
	}
}

func TestSpecRejectsBadScope(t *testing.T) {
	spec, _ := mustLoad(t)
	for name, mut := range map[string]func(*WeaponSpec){
		"fov too wide": func(w *WeaponSpec) { w.ScopeFov = 120 },
		"fov negative": func(w *WeaponSpec) { w.ScopeFov = -5 },
		"negative sp":  func(w *WeaponSpec) { w.ScopedSpread = -1 },
		"scoped knife": func(w *WeaponSpec) { w.Melee, w.ScopeFov = true, 10 },
	} {
		s2 := *spec
		s2.Weapons = append([]WeaponSpec(nil), spec.Weapons...)
		mut(&s2.Weapons[len(s2.Weapons)-1])
		if err := validateSpec(&s2); err == nil {
			t.Errorf("%s: spec accepted", name)
		}
	}
}
