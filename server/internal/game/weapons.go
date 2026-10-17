package game

func (w *World) resetLoadout(p *Player) {
	p.Cur = 0
	p.Has = make([]bool, len(w.Spec.Weapons))
	p.Mag = make([]int, len(w.Spec.Weapons))
	p.Res = make([]int, len(w.Spec.Weapons))
	for i, ws := range w.Spec.Weapons {
		p.Has[i] = !ws.PickupOnly
		if p.Has[i] {
			p.Mag[i], p.Res[i] = ws.MagSize, ws.Reserve
		}
	}
	p.NextFire, p.ReloadDone, p.PrevFire, p.Scoped = 0, 0, false, false
	p.Burst, p.BurstUntil = 0, 0
	p.Nades = make([]int, len(w.Spec.Grenades))
	for i, g := range w.Spec.Grenades {
		p.Nades[i] = g.Count
	}
	p.NextThrow, p.FlashUntil = 0, 0
	p.HeavyAt, p.PrevHeavy = 0, false
}

func canReload(p *Player, ws *WeaponSpec) bool {
	return ws.MagSize > 0 && p.Mag[p.Cur] < ws.MagSize && p.Res[p.Cur] > 0 && p.ReloadDone == 0
}

// weapons runs the weapon state machine for one input. It mirrors client/js/weapons.js exactly
// (the client predicts ammo/cooldown with it). A shot is queued, not resolved, so that all
// players' movement for the tick is applied before any hit test (see resolveShots).
func (w *World) weapons(p *Player, in Input) {
	// drop / pick up on the rising edge of the button
	drop, use := in.Drop && !p.PrevDrop, in.Use && !p.PrevUse
	p.PrevDrop, p.PrevUse = in.Drop, in.Use
	if drop {
		w.dropWeapon(p)
	} else if use {
		w.usePickup(p)
	}
	if in.Nade > 0 {
		w.throwNade(p, in.Nade-1, in.NP)
	}
	ws := &w.Spec.Weapons[p.Cur]
	if p.ReloadDone > 0 && w.Tick >= p.ReloadDone {
		n := min(ws.MagSize-p.Mag[p.Cur], p.Res[p.Cur])
		p.Mag[p.Cur] += n
		p.Res[p.Cur] -= n
		p.ReloadDone = 0
	}
	if in.Weapon >= 0 && in.Weapon != p.Cur && p.Has[in.Weapon] {
		p.Cur = in.Weapon
		ws = &w.Spec.Weapons[p.Cur]
		p.ReloadDone = 0
		p.Burst = 0
		p.HeavyAt = 0 // putting the knife away cancels a stab in progress
		p.NextFire = max(p.NextFire, w.Tick+w.Spec.SwitchTicks)
	}
	if in.Reload && canReload(p, ws) && w.Tick >= p.NextFire {
		p.ReloadDone = w.Tick + ws.ReloadTicks
		p.Burst = 0
	}
	p.Scoped = in.Scope && ws.ScopeFov > 0 && p.ReloadDone == 0
	heavy := in.Heavy && !p.PrevHeavy
	p.PrevHeavy = in.Heavy
	if heavy && ws.Heavy != nil && w.Tick >= p.NextFire && p.ReloadDone == 0 {
		p.NextFire = w.Tick + ws.Heavy.IntervalTicks
		p.HeavyAt = w.Tick + ws.Heavy.WindupTicks
		p.Burst = 0
		p.ProtectUntil = 0
		w.events = append(w.events, Event{E: EvStab, By: p.ID, W: p.Cur})
	}
	wants := in.Fire && (ws.Auto || !p.PrevFire)
	p.PrevFire = in.Fire
	if wants && w.Tick >= p.NextFire && p.ReloadDone == 0 {
		if ws.MagSize > 0 && p.Mag[p.Cur] == 0 {
			if p.Res[p.Cur] > 0 {
				p.ReloadDone = w.Tick + ws.ReloadTicks
			}
			p.Burst = 0
			p.NextFire = w.Tick + ws.IntervalTicks
		} else {
			if ws.MagSize > 0 {
				p.Mag[p.Cur]--
			}
			p.NextFire = w.Tick + ws.IntervalTicks
			if p.Burst > 0 && w.Tick <= p.BurstUntil {
				p.Burst++
			} else {
				p.Burst = 1
			}
			p.BurstUntil = w.Tick + ws.IntervalTicks + w.Spec.Recoil.GraceTicks
			p.ProtectUntil = 0 // attacking ends spawn protection
			w.shots = append(w.shots, shotReq{p: p, weapon: p.Cur, yaw: p.Yaw, pitch: p.Pitch, burst: p.Burst, scoped: p.Scoped, speed: p.Speed})
		}
	}
}
