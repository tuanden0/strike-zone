package game

import "math"

func r3(v float64) float64 { return math.Round(v*1000) / 1000 }

// PlayerState is the public per-tick view of a player.
type PlayerState struct {
	ID    int     `json:"i"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Z     float64 `json:"z"`
	Yaw   float64 `json:"yw"`
	Pitch float64 `json:"pt"`
	Alive bool    `json:"a"`
	W     int     `json:"w"`
}

// Self is the private extra state sent only to the owning client (used for reconciliation + HUD).
type Self struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Z    float64 `json:"z"`
	Vy   float64 `json:"vy"`
	G    bool    `json:"g"`
	Yaw  float64 `json:"yw"`
	HP   int     `json:"hp"`
	A    bool    `json:"a"`
	W    int     `json:"w"`
	Mag  []int   `json:"mag"`
	Res  []int   `json:"res"`
	RL   int     `json:"rl"`   // ticks until reload completes (0 = not reloading)
	CD   int     `json:"cd"`   // ticks until the weapon may fire again
	PF   bool    `json:"pf"`   // fire was held on the last processed input (semi-auto edge detect)
	Resp int     `json:"resp"` // ticks until respawn (0 = alive)
	Prot bool    `json:"prot"`
	Seq  uint32  `json:"ack"`
}

// Snapshot is the per-tick broadcast; You is filled per recipient by the network layer.
type Snapshot struct {
	T       string        `json:"t"`
	Tick    int           `json:"k"`
	State   string        `json:"st"`
	Winner  string        `json:"win,omitempty"`
	Left    int           `json:"tl"`
	Score   [2]int        `json:"sc"`
	Players []PlayerState `json:"ps"`
	You     *Self         `json:"you,omitempty"`
	Events  []Event       `json:"ev,omitempty"`
}

// Snapshot builds the shared part of this tick's broadcast.
func (w *World) Snapshot() Snapshot {
	s := Snapshot{
		T: "snap", Tick: w.Tick, State: w.State, Winner: w.Winner, Left: w.SecondsLeft(), Score: w.Score,
		Players: make([]PlayerState, 0, len(w.order)),
		Events:  append([]Event(nil), w.events...),
	}
	for _, id := range w.order {
		p := w.players[id]
		s.Players = append(s.Players, PlayerState{
			ID: p.ID, X: r3(p.Kin.X), Y: r3(p.Kin.Y), Z: r3(p.Kin.Z),
			Yaw: r3(p.Yaw), Pitch: r3(p.Pitch), Alive: p.Alive, W: p.Cur,
		})
	}
	return s
}

// SelfFor builds the private state for a player.
func (w *World) SelfFor(id int) *Self {
	p := w.players[id]
	if p == nil {
		return nil
	}
	s := &Self{
		X: r3(p.Kin.X), Y: r3(p.Kin.Y), Z: r3(p.Kin.Z), Vy: r3(p.Kin.Vy), G: p.Kin.OnGround,
		Yaw: r3(p.Yaw), HP: p.HP, A: p.Alive, W: p.Cur,
		Mag: append([]int(nil), p.Mag...), Res: append([]int(nil), p.Res...),
		Prot: w.Tick < p.ProtectUntil, Seq: p.LastSeq,
	}
	if p.ReloadDone > w.Tick {
		s.RL = p.ReloadDone - w.Tick
	}
	if p.NextFire > w.Tick {
		s.CD = p.NextFire - w.Tick
	}
	s.PF = p.PrevFire
	if !p.Alive && p.RespawnAt > w.Tick {
		s.Resp = p.RespawnAt - w.Tick
	}
	return s
}
