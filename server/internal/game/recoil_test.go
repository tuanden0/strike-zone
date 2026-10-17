package game

import (
	"sort"
	"testing"
)

func TestKickGrowsWithDamage(t *testing.T) {
	spec, _ := mustLoad(t)
	var guns []*WeaponSpec
	for i := range spec.Weapons {
		ws := &spec.Weapons[i]
		if ws.Melee {
			if spec.Kick(ws) != 0 {
				t.Errorf("%s: melee must not kick", ws.ID)
			}
			continue
		}
		guns = append(guns, ws)
	}
	sort.Slice(guns, func(i, j int) bool { return guns[i].Damage < guns[j].Damage })
	for i := 1; i < len(guns); i++ {
		lo, hi := guns[i-1], guns[i]
		if hi.Damage > lo.Damage && spec.Kick(hi) <= spec.Kick(lo) {
			t.Errorf("%s (dmg %v, kick %v) must kick harder than %s (dmg %v, kick %v)", hi.ID, hi.Damage, spec.Kick(hi), lo.ID, lo.Damage, spec.Kick(lo))
		}
	}
	// the same rule, quantified: kick per point of damage is the one global constant
	for _, ws := range guns {
		if got, want := spec.Kick(ws)/ws.Damage, spec.Recoil.PerDamage*ws.RecoilScale; got < want*0.999 || got > want*1.001 {
			t.Errorf("%s: kick/damage %v want %v", ws.ID, got, want)
		}
	}
}

func TestBurstCountsAndResets(t *testing.T) {
	w, p := pkWorld(t)
	for i := 1; i <= 8; i++ { // rifle, held trigger: one shot every IntervalTicks
		for k := 0; k < w.Spec.Weapons[0].IntervalTicks; k++ {
			send(t, w, Input{Weapon: -1, Fire: true})
		}
		if p.Burst != i {
			t.Fatalf("after %d shots burst=%d", i, p.Burst)
		}
	}
	// pause longer than interval + grace: the next shot starts a new burst
	send(t, w, Input{Weapon: -1})
	for k := 0; k < w.Spec.Weapons[0].IntervalTicks+w.Spec.Recoil.GraceTicks+2; k++ {
		send(t, w, Input{Weapon: -1})
	}
	send(t, w, Input{Weapon: -1, Fire: true})
	if p.Burst != 1 {
		t.Fatalf("burst after a pause = %d, want 1", p.Burst)
	}
	// switching weapon or starting a reload ends the burst
	send(t, w, Input{Weapon: 1})
	if p.Burst != 0 {
		t.Fatalf("burst after switch = %d", p.Burst)
	}
}

// hitRateByBurst fires many 12-round rifle bursts at a still target 30 m away and returns hits/shots for early
// (burst <= 2) and late (burst >= 10) shots.
func hitRateByBurst(t testing.TB) (early, late float64) {
	t.Helper()
	spec, m := mustLoad(t)
	w := NewWorld(spec, m, MatchConfig{TimeLimitSec: 600, ScoreLimit: 1000}, 11)
	a := add(t, w, 1, TeamA)
	b := add(t, w, 2, TeamB)
	a.Kin = Kin{X: 5, Z: 20, OnGround: true}
	b.Kin = Kin{X: 5, Z: -10, OnGround: true}
	a.ProtectUntil, b.ProtectUntil = 0, 0
	yaw, pitch := aim(w, a, 5, 1.0, -10)
	var eh, en, lh, ln int
	for burst := 0; burst < 200; burst++ {
		for k := 0; k < 20; k++ { // let the burst expire
			send(t, w, Input{Weapon: -1, Yaw: yaw, Pitch: pitch})
		}
		for k := 0; k < 36; k++ { // 12 shots at 3 ticks
			b.HP, b.Alive = 1000000, true
			a.Mag[0] = 30
			send(t, w, Input{Weapon: -1, Yaw: yaw, Pitch: pitch, Fire: true})
			for _, e := range eventsOf(w, EvShot) {
				hit := e.Hit == HitBody || e.Hit == HitHead
				switch {
				case a.Burst <= 2:
					en++
					if hit {
						eh++
					}
				case a.Burst >= 10:
					ln++
					if hit {
						lh++
					}
				}
			}
		}
	}
	if en == 0 || ln == 0 {
		t.Fatalf("no shots counted (%d early, %d late)", en, ln)
	}
	return float64(eh) / float64(en), float64(lh) / float64(ln)
}

func TestSustainedFireLosesAccuracy(t *testing.T) {
	early, late := hitRateByBurst(t)
	t.Logf("hit rate at 30 m: first shots %.2f, shots 10+ of a burst %.2f", early, late)
	if early < 0.9 {
		t.Fatalf("first shots of a burst should be accurate (%.2f); is something in the way?", early)
	}
	if late > early-0.25 {
		t.Fatalf("spraying must cost accuracy: early %.2f late %.2f", early, late)
	}
}

func TestSpecRejectsBadRecoil(t *testing.T) {
	spec, _ := mustLoad(t)
	for name, mut := range map[string]func(*Spec){
		"negative perDamage": func(s *Spec) { s.Recoil.PerDamage = -1 },
		"huge perDamage":     func(s *Spec) { s.Recoil.PerDamage = 5 },
		"zero maxShots":      func(s *Spec) { s.Recoil.MaxShots = 0 },
		"negative scale":     func(s *Spec) { s.Weapons[0].RecoilScale = -1 },
	} {
		s2 := *spec
		s2.Weapons = append([]WeaponSpec(nil), spec.Weapons...)
		mut(&s2)
		if validateSpec(&s2) == nil {
			t.Errorf("%s: spec accepted", name)
		}
	}
}
