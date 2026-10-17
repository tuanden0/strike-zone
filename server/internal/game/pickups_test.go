package game

import "testing"

func pkWorld(t testing.TB) (*World, *Player) {
	t.Helper()
	w := combatWorld(t)
	p := add(t, w, 1, TeamA)
	return w, p
}

var pkSeq uint32

func send(t testing.TB, w *World, in Input) {
	t.Helper()
	pkSeq++
	in.Seq = pkSeq
	if err := w.QueueInput(1, in); err != nil {
		t.Fatal(err)
	}
	w.Step()
}

func idle() Input { return Input{Weapon: -1} }

func TestMapSpawnPickupsExist(t *testing.T) {
	w, _ := pkWorld(t)
	if got, want := len(w.Pickups()), len(w.Map.Pickups); got != want || got == 0 {
		t.Fatalf("map spawn pickups: %d want %d (>0)", got, want)
	}
	pk := w.Pickups()
	for i := 1; i < len(pk); i++ {
		if pk[i].ID <= pk[i-1].ID {
			t.Fatal("pickups must be ordered by id")
		}
	}
	if pk[0].Mag != w.Spec.Weapons[pk[0].W].MagSize || pk[0].Spawn != -0 && pk[0].Spawn < 0 {
		t.Fatalf("spawn pickup not full: %+v", pk[0])
	}
}

func TestDropRifleThenCannotUseIt(t *testing.T) {
	w, p := pkWorld(t)
	p.Mag[0] = 17
	p.Res[0] = 40
	before := len(w.Pickups())
	send(t, w, Input{Weapon: -1, Drop: true})
	if p.Has[0] || p.Mag[0] != 0 || p.Cur != 1 {
		t.Fatalf("after drop: has=%v mag=%v cur=%d (want rifle gone, pistol selected)", p.Has, p.Mag, p.Cur)
	}
	if !w.PickupsDirty || len(w.Pickups()) != before+1 {
		t.Fatalf("dropped weapon not on the ground (%d -> %d)", before, len(w.Pickups()))
	}
	var dropped Pickup
	for _, pk := range w.Pickups() {
		if pk.Spawn < 0 {
			dropped = pk
		}
	}
	if dropped.W != 0 || dropped.Mag != 17 || dropped.Res != 40 {
		t.Fatalf("dropped keeps ammo: %+v", dropped)
	}
	// forward of a player facing -Z (yaw 0 at spawn A) is toward smaller z
	if d := p.Kin.Z - dropped.Z; d < 0.5 || d > 1.2 {
		t.Fatalf("dropped %.2f m in front, want ~0.9 (z %v vs %v)", d, dropped.Z, p.Kin.Z)
	}
	// switching to the dropped slot is ignored
	send(t, w, Input{Weapon: 0})
	if p.Cur != 1 {
		t.Fatalf("switched to a weapon not owned: cur=%d", p.Cur)
	}
	// firing with the pistol still works once the weapon-switch delay has passed
	for i := 0; i < w.Spec.SwitchTicks; i++ {
		send(t, w, Input{Weapon: -1})
	}
	send(t, w, Input{Weapon: -1, Fire: true})
	if p.Mag[1] != 11 {
		t.Fatalf("pistol should fire after the rifle is dropped: mag=%d", p.Mag[1])
	}
}

func TestKnifeCannotBeDropped(t *testing.T) {
	w, p := pkWorld(t)
	send(t, w, Input{Weapon: 2})
	send(t, w, Input{Weapon: -1, Drop: true})
	if !p.Has[2] || len(w.Pickups()) != len(w.Map.Pickups) {
		t.Fatal("knife must stay in hand")
	}
}

func TestPickUpWithinRangeOnlyAndSwapsAmmo(t *testing.T) {
	w, p := pkWorld(t)
	send(t, w, Input{Weapon: -1, Drop: true})
	send(t, w, Input{Weapon: -1}) // release the drop button
	// walk away beyond the pickup radius: use does nothing
	p.Kin.Z -= w.Spec.Pickups.Radius + 1
	send(t, w, Input{Weapon: -1, Use: true})
	if p.Has[0] {
		t.Fatal("picked up from out of range")
	}
	send(t, w, Input{Weapon: -1})
	// back in range: picks up with the dropped ammo
	p.Kin.Z += w.Spec.Pickups.Radius + 1 - 0.3
	send(t, w, Input{Weapon: -1, Use: true})
	if !p.Has[0] || p.Mag[0] != 30 || p.Res[0] != 90 || p.Cur != 0 {
		t.Fatalf("pickup: has=%v mag=%d res=%d cur=%d", p.Has, p.Mag[0], p.Res[0], p.Cur)
	}
	// a second weapon of the same slot swaps: ground rifle appears with the old magazine
	p.Mag[0], p.Res[0] = 3, 7
	nearest := nearestSpawn(w, p, 0)
	p.Kin.X, p.Kin.Z = nearest.X, nearest.Z
	send(t, w, Input{Weapon: -1})
	send(t, w, Input{Weapon: -1, Use: true})
	if p.Mag[0] != 30 || p.Res[0] != 90 {
		t.Fatalf("swapped in the fresh spawn rifle: mag=%d res=%d", p.Mag[0], p.Res[0])
	}
	found := false
	for _, pk := range w.Pickups() {
		if pk.W == 0 && pk.Mag == 3 && pk.Res == 7 {
			found = true
		}
	}
	if !found {
		t.Fatal("the old rifle (3/7) should lie where the new one was")
	}
}

func nearestSpawn(w *World, p *Player, weapon int) Pickup {
	for _, pk := range w.Pickups() {
		if pk.W == weapon && pk.Spawn >= 0 {
			return pk
		}
	}
	panic("no spawn pickup")
}

func TestHeldUseButtonActsOnce(t *testing.T) {
	w, p := pkWorld(t)
	// stand on a map spawn rifle while owning one: first use swaps, holding must not swap back
	sp := nearestSpawn(w, p, 0)
	p.Kin.X, p.Kin.Z = sp.X, sp.Z
	p.Mag[0] = 5
	send(t, w, Input{Weapon: -1, Use: true})
	send(t, w, Input{Weapon: -1, Use: true})
	send(t, w, Input{Weapon: -1, Use: true})
	if p.Mag[0] != 30 {
		t.Fatalf("held button swapped repeatedly: mag=%d", p.Mag[0])
	}
}

func TestSpawnPickupRespawnsAndDroppedExpire(t *testing.T) {
	w, p := pkWorld(t)
	spawns := len(w.Map.Pickups)
	sp := nearestSpawn(w, p, 1)
	p.Kin.X, p.Kin.Z = sp.X, sp.Z
	send(t, w, Input{Weapon: -1, Use: true})
	if len(w.Pickups()) != spawns { // taken one replaced by the swapped-out pistol
		t.Fatalf("count %d want %d", len(w.Pickups()), spawns)
	}
	// the swapped-out pistol is a dropped weapon: it expires, the spawn point refills after 20 s
	for i := 0; i < int(w.Spec.Pickups.RespawnSeconds)*w.Spec.TickRate+2; i++ {
		w.Step()
	}
	nSpawn := 0
	for _, pk := range w.Pickups() {
		if pk.Spawn >= 0 {
			nSpawn++
		}
	}
	if nSpawn != spawns {
		t.Fatalf("map spawn pickups after respawn delay: %d want %d", nSpawn, spawns)
	}
	for i := 0; i < int(w.Spec.Pickups.DropLifetimeSeconds)*w.Spec.TickRate; i++ {
		w.Step()
	}
	if len(w.Pickups()) != spawns {
		t.Fatalf("dropped weapon should have expired: %d pickups", len(w.Pickups()))
	}
}

func TestRestartResetsPickups(t *testing.T) {
	w, p := pkWorld(t)
	send(t, w, Input{Weapon: -1, Drop: true})
	sp := nearestSpawn(w, p, 0)
	p.Kin.X, p.Kin.Z = sp.X, sp.Z
	send(t, w, Input{Weapon: -1})
	send(t, w, Input{Weapon: -1, Use: true})
	w.endMatch()
	for i := 0; i < w.ticks(w.Spec.Match.IntermissionSeconds)+2 && w.State == StateEnded; i++ {
		w.Step()
	}
	if len(w.Pickups()) != len(w.Map.Pickups) {
		t.Fatalf("pickups after restart: %d", len(w.Pickups()))
	}
	for _, pk := range w.Pickups() {
		if pk.Spawn < 0 {
			t.Fatal("dropped weapon survived restart")
		}
	}
	if !p.Has[0] || !p.Has[1] || !p.Has[2] {
		t.Fatal("respawn gives the full loadout")
	}
}

func TestSnapshotReportsOwnedWeapons(t *testing.T) {
	w, _ := pkWorld(t)
	send(t, w, Input{Weapon: -1, Drop: true})
	y := w.SelfFor(1)
	if len(y.Has) != 4 || y.Has[0] || !y.Has[1] || !y.Has[2] || y.Has[3] {
		t.Fatalf("self.has = %v", y.Has)
	}
}
