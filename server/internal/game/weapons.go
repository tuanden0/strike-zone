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

// weapons runs the weapon state machine for one input (mirrors client/js/weapons.js).
func (w *World) weapons(p *Player, in Input) {}
