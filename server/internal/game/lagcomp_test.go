package game

import "testing"

// runner strafes along +x at run speed (yaw 0, S=1) on open floor; the shooter stands still 10 m away facing the lane.
func lagWorld(t testing.TB) (*World, *Player, *Player) {
	t.Helper()
	w, a, b := duel(t) // a (shooter) at (5,12) looks -z; b at (5,2)
	a.Kin = Kin{X: 5, Z: 12, OnGround: true}
	b.Kin = Kin{X: -4, Z: 2, OnGround: true}
	return w, a, b
}

var lagSeq = map[int]uint32{}

func lagStep(t testing.TB, w *World, shooter, runner *Player, fire bool, vt int, yaw, pitch float64) {
	t.Helper()
	lagSeq[1]++
	lagSeq[2]++
	if err := w.QueueInput(runner.ID, Input{Seq: lagSeq[2], S: 1, Weapon: -1}); err != nil {
		t.Fatal(err)
	}
	if err := w.QueueInput(shooter.ID, Input{Seq: lagSeq[1], Weapon: -1, Fire: fire, Yaw: yaw, Pitch: pitch, VT: vt}); err != nil {
		t.Fatal(err)
	}
	w.Step()
}

// shotResult plays 20 ticks of running, then the shooter fires at where the runner was `ago` ticks earlier, declaring view tick vtAgo.
func shotResult(t testing.TB, ago, declared int) (hit bool) {
	w, a, b := lagWorld(t)
	lagSeq = map[int]uint32{}
	pos := map[int][3]float64{}
	for i := 0; i < 20; i++ {
		lagStep(t, w, a, b, false, 0, 0, 0)
		pos[w.Tick] = [3]float64{b.Kin.X, 1.0, b.Kin.Z}
	}
	target := pos[w.Tick+1-ago] // position at the tick the shot will be tested against (w.Tick+1 is the shot's tick)
	if ago == 0 {
		// fire at the position the runner will have after this very step
		target = [3]float64{b.Kin.X + w.Spec.Player.RunSpeed/float64(w.Spec.TickRate), 1.0, b.Kin.Z}
	}
	yaw, pitch := aim(w, a, target[0], target[1], target[2])
	vt := 0
	if declared >= 0 {
		vt = w.Tick + 1 - declared
	}
	lagStep(t, w, a, b, true, vt, yaw, pitch)
	return len(eventsOf(w, EvHit)) == 1
}

func TestLagCompensationHitsWhereTheTargetWasOnTheShootersScreen(t *testing.T) {
	// the runner moves 0.18 m per tick (5.5 m/s); 6 ticks = 1.1 m, more than the body half-width
	if !shotResult(t, 0, -1) {
		t.Fatal("setup: aiming at the current position with no lag must hit")
	}
	if shotResult(t, 6, -1) {
		t.Fatal("setup: aiming 6 ticks behind with no view tick must miss (the runner has moved on)")
	}
	if !shotResult(t, 6, 6) {
		t.Fatal("aiming at where the target was 6 ticks ago with vt = 6 ticks ago must hit")
	}
}

func TestLagCompensationIsCappedAndNeverLooksForward(t *testing.T) {
	spec, _ := mustLoad(t)
	limit := spec.LagComp.MaxRewindTicks
	if !shotResult(t, limit, limit) {
		t.Fatalf("a rewind of exactly the allowance (%d ticks) must work", limit)
	}
	if shotResult(t, limit+8, limit+8) {
		t.Fatalf("a claimed view %d ticks back must be clamped to %d and miss", limit+8, limit)
	}
	// a vt in the future means no rewind: aiming at the current position still hits
	w, a, b := lagWorld(t)
	lagSeq = map[int]uint32{}
	for i := 0; i < 5; i++ {
		lagStep(t, w, a, b, false, 0, 0, 0)
	}
	yaw, pitch := aim(w, a, b.Kin.X+w.Spec.Player.RunSpeed/float64(w.Spec.TickRate), 1.0, b.Kin.Z)
	lagStep(t, w, a, b, true, w.Tick+50, yaw, pitch)
	if len(eventsOf(w, EvHit)) != 1 {
		t.Fatal("a future view tick should be treated as 'no lag'")
	}
}

func TestLagCompensationDoesNotResurrectTheDead(t *testing.T) {
	w, a, b := lagWorld(t)
	lagSeq = map[int]uint32{}
	for i := 0; i < 12; i++ {
		lagStep(t, w, a, b, false, 0, 0, 0)
	}
	past := [3]float64{b.Kin.X, 1.0, b.Kin.Z}
	b.Alive = false // dies, then respawns far away
	lagStep(t, w, a, b, false, 0, 0, 0)
	b.Alive, b.HP = true, 100
	b.Kin = Kin{X: -20, Z: -20, OnGround: true}
	yaw, pitch := aim(w, a, past[0], past[1], past[2])
	lagStep(t, w, a, b, true, w.Tick+1-8, yaw, pitch)
	if len(eventsOf(w, EvHit)) != 0 {
		t.Fatal("hit a player at the place where their previous life was (they were dead on the shooter's screen)")
	}
}

func TestViewTickIsValidated(t *testing.T) {
	w, _ := pkWorld(t)
	if err := w.QueueInput(1, Input{Seq: 1, Weapon: -1, VT: -5}); err == nil {
		t.Fatal("negative vt accepted")
	}
	if err := w.QueueInput(1, Input{Seq: 2, Weapon: -1, VT: 1 << 40}); err == nil {
		t.Fatal("huge vt accepted")
	}
}

func TestSpecRejectsBadLagComp(t *testing.T) {
	spec, _ := mustLoad(t)
	for _, v := range []int{-1, histLen, 1000} {
		s2 := *spec
		s2.LagComp.MaxRewindTicks = v
		if validateSpec(&s2) == nil {
			t.Errorf("maxRewindTicks %d accepted", v)
		}
	}
}
