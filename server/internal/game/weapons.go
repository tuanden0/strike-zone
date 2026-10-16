package game

func (w *World) resetLoadout(p *Player) {
	p.Cur = 0
	p.Mag = make([]int, len(w.Spec.Weapons))
	p.Res = make([]int, len(w.Spec.Weapons))
	for i, ws := range w.Spec.Weapons {
		p.Mag[i], p.Res[i] = ws.MagSize, ws.Reserve
	}
	p.NextFire, p.ReloadDone, p.PrevFire = 0, 0, false
}

func canReload(p *Player, ws *WeaponSpec) bool {
	return ws.MagSize > 0 && p.Mag[p.Cur] < ws.MagSize && p.Res[p.Cur] > 0 && p.ReloadDone == 0
}

// weapons runs the weapon state machine for one input. It mirrors client/js/weapons.js exactly
// (the client predicts ammo/cooldown with it). A shot is queued, not resolved, so that all
// players' movement for the tick is applied before any hit test (see resolveShots).
func (w *World) weapons(p *Player, in Input) {
	ws := &w.Spec.Weapons[p.Cur]
	if p.ReloadDone > 0 && w.Tick >= p.ReloadDone {
		n := min(ws.MagSize-p.Mag[p.Cur], p.Res[p.Cur])
		p.Mag[p.Cur] += n
		p.Res[p.Cur] -= n
		p.ReloadDone = 0
	}
	if in.Weapon >= 0 && in.Weapon != p.Cur {
		p.Cur = in.Weapon
		ws = &w.Spec.Weapons[p.Cur]
		p.ReloadDone = 0
		p.NextFire = max(p.NextFire, w.Tick+w.Spec.SwitchTicks)
	}
	if in.Reload && canReload(p, ws) && w.Tick >= p.NextFire {
		p.ReloadDone = w.Tick + ws.ReloadTicks
	}
	wants := in.Fire && (ws.Auto || !p.PrevFire)
	p.PrevFire = in.Fire
	if wants && w.Tick >= p.NextFire && p.ReloadDone == 0 {
		if ws.MagSize > 0 && p.Mag[p.Cur] == 0 {
			if p.Res[p.Cur] > 0 {
				p.ReloadDone = w.Tick + ws.ReloadTicks
			}
			p.NextFire = w.Tick + ws.IntervalTicks
		} else {
			if ws.MagSize > 0 {
				p.Mag[p.Cur]--
			}
			p.NextFire = w.Tick + ws.IntervalTicks
			p.ProtectUntil = 0 // attacking ends spawn protection
			w.shots = append(w.shots, p)
		}
	}
}
