package game

import "testing"

const knifeSlot = 2

// stabWorld: a (team A) holds the knife, b (team B) stands `dist` metres in front of a, both unprotected.
func stabWorld(t testing.TB, dist float64) (*World, *Player, *Player) {
	t.Helper()
	w, a, b := duel(t)
	b.Kin = Kin{X: a.Kin.X, Z: a.Kin.Z - dist, OnGround: true}
	step(t, w, a, Input{Weapon: knifeSlot})
	for i := 0; i < w.Spec.SwitchTicks+1; i++ {
		step(t, w, a, Input{Weapon: -1})
	}
	return w, a, b
}

var heavySeq = map[int]uint32{}

// step queues one input for p (yaw 0 looks toward -Z) and runs a world tick.
func step(t testing.TB, w *World, p *Player, in Input) {
	t.Helper()
	heavySeq[p.ID]++
	in.Seq = heavySeq[p.ID]
	if err := w.QueueInput(p.ID, in); err != nil {
		t.Fatal(err)
	}
	w.Step()
}

func hasEvent(w *World, e string) bool {
	for _, ev := range w.Events() {
		if ev.E == e {
			return true
		}
	}
	return false
}

func TestHeavyStabLandsAfterTheWindup(t *testing.T) {
	w, a, b := stabWorld(t, 1.6)
	hv := w.Spec.Weapons[knifeSlot].Heavy
	step(t, w, a, Input{Weapon: -1, Heavy: true})
	if !hasEvent(w, EvStab) {
		t.Fatal("no stab cue event when the heavy stab starts")
	}
	for i := 1; i < hv.WindupTicks; i++ {
		step(t, w, a, Input{Weapon: -1, Heavy: true})
		if b.HP != w.Spec.Player.MaxHealth {
			t.Fatalf("tick %d of the windup: victim already hurt (hp %d)", i, b.HP)
		}
	}
	step(t, w, a, Input{Weapon: -1})
	if b.Alive || b.HP != 0 {
		t.Fatalf("the stab should have killed after the windup: alive=%v hp=%d", b.Alive, b.HP)
	}
	var shot, kill bool
	for _, ev := range w.Events() {
		shot = shot || (ev.E == EvShot && ev.Hv && (ev.Hit == HitBody || ev.Hit == HitHead))
		kill = kill || (ev.E == EvKill && ev.By == a.ID && ev.V == b.ID)
	}
	if !shot || !kill {
		t.Fatalf("events on landing: %+v", w.Events())
	}
}

func TestHeavyStabCooldownBlocksEverything(t *testing.T) {
	w, a, b := stabWorld(t, 5) // out of reach: the stab whiffs
	hv := w.Spec.Weapons[knifeSlot].Heavy
	step(t, w, a, Input{Weapon: -1, Heavy: true})
	for i := 1; i < hv.IntervalTicks; i++ {
		step(t, w, a, Input{Weapon: -1, Fire: i%2 == 0, Heavy: i%2 == 1}) // mashing both buttons
		for _, ev := range w.Events() {
			if ev.E == EvStab || (ev.E == EvShot && !ev.Hv) {
				t.Fatalf("attack during the cooldown at tick %d: %+v", i, ev)
			}
		}
	}
	if b.HP != w.Spec.Player.MaxHealth {
		t.Fatal("a stab at 5 m must miss")
	}
	step(t, w, a, Input{Weapon: -1})
	step(t, w, a, Input{Weapon: -1, Heavy: true})
	if !hasEvent(w, EvStab) {
		t.Fatal("a new stab must be possible once the interval has passed")
	}
}

func TestHeavyStabHoldingTheButtonStabsOnce(t *testing.T) {
	w, a, _ := stabWorld(t, 5)
	n := 0
	for i := 0; i < 3*w.Spec.Weapons[knifeSlot].Heavy.IntervalTicks; i++ {
		step(t, w, a, Input{Weapon: -1, Heavy: true})
		if hasEvent(w, EvStab) {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("a held button started %d stabs, want 1 (edge triggered)", n)
	}
}

func TestHeavyStabIsCancelledBySwitchingOrDying(t *testing.T) {
	w, a, b := stabWorld(t, 1.6)
	step(t, w, a, Input{Weapon: -1, Heavy: true})
	step(t, w, a, Input{Weapon: 0}) // pull out the rifle mid-stab
	for i := 0; i < 20; i++ {
		step(t, w, a, Input{Weapon: -1})
	}
	if b.HP != w.Spec.Player.MaxHealth {
		t.Fatal("switching weapons must cancel the stab")
	}
	w2, a2, b2 := stabWorld(t, 1.6)
	step(t, w2, a2, Input{Weapon: -1, Heavy: true})
	w2.kill(b2, a2, false, 0, b2.ID) // the stabber is shot dead during the windup
	for i := 0; i < 20; i++ {
		w2.Step()
	}
	if !b2.Alive || b2.HP != w2.Spec.Player.MaxHealth {
		t.Fatal("a dead stabber must not land the stab")
	}
}

func TestHeavyStabNeedsAKnifeAndRespectsRange(t *testing.T) {
	w, a, b := duel(t)
	b.Kin = Kin{X: a.Kin.X, Z: a.Kin.Z - 1.6, OnGround: true}
	step(t, w, a, Input{Weapon: -1, Heavy: true}) // holding the rifle
	if hasEvent(w, EvStab) {
		t.Fatal("heavy stab started with a rifle in hand")
	}
	w3, a3, b3 := stabWorld(t, 2.9) // beyond the 2.4 m reach
	step(t, w3, a3, Input{Weapon: -1, Heavy: true})
	for i := 0; i < 12; i++ {
		step(t, w3, a3, Input{Weapon: -1})
	}
	if b3.HP != w3.Spec.Player.MaxHealth {
		t.Fatal("stab hit a target beyond its range")
	}
}

func TestHeavySpecValidation(t *testing.T) {
	for name, mut := range map[string]func(*WeaponSpec){
		"heavy on a gun":        func(w *WeaponSpec) { w.Melee = false },
		"no windup":             func(w *WeaponSpec) { w.Heavy.WindupTicks = 0 },
		"interval below windup": func(w *WeaponSpec) { w.Heavy.IntervalTicks = w.Heavy.WindupTicks },
		"zero damage":           func(w *WeaponSpec) { w.Heavy.Damage = 0 },
		"absurd reach":          func(w *WeaponSpec) { w.Heavy.Range = 40 },
	} {
		spec, _ := mustLoad(t)
		s2 := *spec
		s2.Weapons = append([]WeaponSpec(nil), spec.Weapons...)
		k := &s2.Weapons[knifeSlot]
		h := *k.Heavy
		k.Heavy = &h
		mut(k)
		if err := validateSpec(&s2); err == nil {
			t.Errorf("%s: spec accepted", name)
		}
	}
}

func TestHeavyStabDamageDependsOnWhereItLands(t *testing.T) {
	// victim 1.6 m in front, a's eye at 1.62 m: pitch picks the height of the hit
	for _, c := range []struct {
		name  string
		pitch float64
		want  int // damage dealt
	}{
		{"legs: +25%", -0.65, 50},
		{"chest: x2", -0.257, 80},
		{"head: headshot x4", 0, 160},
	} {
		w, a, b := stabWorld(t, 1.6)
		hv := w.Spec.Weapons[knifeSlot].Heavy
		step(t, w, a, Input{Weapon: -1, Heavy: true, Pitch: c.pitch})
		var hit *Event
		for i := 0; i < hv.WindupTicks+1 && hit == nil; i++ {
			step(t, w, a, Input{Weapon: -1, Pitch: c.pitch})
			for j := range w.Events() {
				if ev := w.Events()[j]; ev.E == EvHit {
					hit = &ev
				}
			}
		}
		if hit == nil {
			t.Fatalf("%s: no hit event", c.name)
		}
		if hit.Dmg != c.want || (c.pitch == 0) != hit.Head {
			t.Errorf("%s: damage %d head=%v, want %d head=%v", c.name, hit.Dmg, hit.Head, c.want, c.pitch == 0)
		}
		if got := w.Spec.Player.MaxHealth - b.HP; got != min(c.want, w.Spec.Player.MaxHealth) {
			t.Errorf("%s: victim lost %d hp", c.name, got)
		}
	}
}

func TestKnifeSlashToTheHeadIsAHeadshot(t *testing.T) {
	w, a, b := stabWorld(t, 1.6)
	step(t, w, a, Input{Weapon: -1, Fire: true})
	var head bool
	for _, ev := range w.Events() {
		if ev.E == EvHit {
			head = ev.Head
		}
	}
	if !head || b.Alive {
		t.Fatalf("a slash to the head must be a headshot that kills (alive=%v, head=%v, hp=%d)", b.Alive, head, b.HP)
	}
}
