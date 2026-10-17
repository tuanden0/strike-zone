package game

import (
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"sort"
)

// Team identifiers.
const (
	TeamA = "A"
	TeamB = "B"
)

// Match states.
const (
	StatePlaying = "playing"
	StateEnded   = "ended"
)

const (
	maxQueue         = 8 // buffered inputs per player; oldest dropped beyond this
	maxInputsPerTick = 2 // catch-up allowance after network jitter
	maxBudget        = 3 // saved-up input allowance; sustained rate is exactly 1 input per tick
)

var (
	ErrNoPlayer   = errors.New("no such player")
	ErrBadInput   = errors.New("invalid input")
	ErrStaleInput = errors.New("stale input sequence")
	ErrBadTeam    = errors.New("invalid team")
)

// Input is one client command for one fixed tick. The client never sends positions.
type Input struct {
	Seq    uint32  `json:"seq"`
	F      float64 `json:"f"`
	S      float64 `json:"s"`
	Yaw    float64 `json:"yaw"`
	Pitch  float64 `json:"pitch"`
	Jump   bool    `json:"jump"`
	Walk   bool    `json:"walk"`
	Fire   bool    `json:"fire"`
	Reload bool    `json:"reload"`
	Weapon int     `json:"weapon"` // -1 = keep current; decode into Input{Weapon: -1}
	Drop   bool    `json:"drop"`   // edge-detected server side: drop the current weapon
	Use    bool    `json:"use"`    // edge-detected server side: pick up the nearest weapon
	Scope  bool    `json:"scope"`  // zoom held; only has an effect with a scoped weapon (see WeaponSpec.ScopeFov)
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

// Validate rejects NaN/Inf and out-of-range fields.
func (in *Input) Validate(nWeapons int) error {
	switch {
	case !finite(in.F) || !finite(in.S) || !finite(in.Yaw) || !finite(in.Pitch):
		return fmt.Errorf("%w: non-finite number", ErrBadInput)
	case in.F < -1 || in.F > 1 || in.S < -1 || in.S > 1:
		return fmt.Errorf("%w: move axis out of [-1,1]", ErrBadInput)
	case math.Abs(in.Yaw) > 1e4:
		return fmt.Errorf("%w: yaw out of range", ErrBadInput)
	case in.Pitch < -1.6 || in.Pitch > 1.6:
		return fmt.Errorf("%w: pitch out of range", ErrBadInput)
	case in.Weapon < -1 || in.Weapon >= nWeapons:
		return fmt.Errorf("%w: weapon index", ErrBadInput)
	}
	return nil
}

// Player is a participant in a World.
type Player struct {
	ID   int
	Nick string
	Team string

	Kin          Kin
	Yaw, Pitch   float64
	Speed        float64 // horizontal speed of the last move (m/s)
	HP           int
	Alive        bool
	RespawnAt    int // tick
	ProtectUntil int // tick
	Kills        int
	Deaths       int

	Cur        int
	Has        []bool // weapon slots the player owns (drop/pickup change this)
	PrevDrop   bool
	PrevUse    bool
	Burst      int  // consecutive shots in the current burst (0 = none); drives spread bloom, mirrored in client/js/weapons.js
	BurstUntil int  // last tick at which the next shot still continues the burst
	Scoped     bool // scope held with a scoped weapon and not reloading, as of the last input
	Mag, Res   []int
	NextFire   int
	ReloadDone int // tick when reload completes; 0 = not reloading
	PrevFire   bool

	budget     int    // inputs this player may still process (refills 1/tick) - stops speed hacks by input flooding
	LastSeq    uint32 // last processed input
	lastQueued uint32
	queue      []Input
}

// MatchConfig is set per room.
type MatchConfig struct {
	TimeLimitSec int
	ScoreLimit   int
}

// World is one match. Not safe for concurrent use; the owner serializes access.
type World struct {
	Spec *Spec
	Map  *Map
	Cfg  MatchConfig

	Tick      int
	State     string
	Winner    string // "A", "B", "draw" once ended
	Score     [2]int
	endsAt    int
	restartAt int

	players    map[int]*Player
	order      []int
	events     []Event
	pickups    map[int]*Pickup
	respawns   []pickupRespawn
	nextPickup int
	shots      []*Player // shooters queued this tick, resolved after all movement
	rng        *rand.Rand
	spawnN     int
	// Dirty is set when roster-visible data (score, kills, teams) changed; owner clears it.
	Dirty bool
	// PickupsDirty is set when the ground weapons changed; the owner broadcasts them and clears it.
	PickupsDirty bool
}

// NewWorld creates a match. seed makes spread deterministic for tests.
func NewWorld(spec *Spec, m *Map, cfg MatchConfig, seed uint64) *World {
	w := &World{
		Spec: spec, Map: m, Cfg: cfg,
		players: map[int]*Player{},
		rng:     rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15)),
		State:   StatePlaying,
	}
	w.endsAt = w.ticks(float64(cfg.TimeLimitSec))
	w.pickups = map[int]*Pickup{}
	w.resetPickups()
	return w
}

func (w *World) ticks(sec float64) int { return int(math.Round(sec * float64(w.Spec.TickRate))) }

// Player returns the player or nil.
func (w *World) Player(id int) *Player { return w.players[id] }

// Players returns players ordered by id.
func (w *World) Players() []*Player {
	out := make([]*Player, 0, len(w.order))
	for _, id := range w.order {
		out = append(out, w.players[id])
	}
	return out
}

// TeamCount counts players on a team.
func (w *World) TeamCount(team string) int {
	n := 0
	for _, p := range w.players {
		if p.Team == team {
			n++
		}
	}
	return n
}

// Len is the number of players.
func (w *World) Len() int { return len(w.players) }

// AddPlayer inserts and spawns a player.
func (w *World) AddPlayer(id int, nick, team string) (*Player, error) {
	if team != TeamA && team != TeamB {
		return nil, ErrBadTeam
	}
	if _, ok := w.players[id]; ok {
		return nil, fmt.Errorf("player %d already present", id)
	}
	p := &Player{ID: id, Nick: nick, Team: team, budget: maxBudget}
	w.players[id] = p
	w.order = append(w.order, id)
	sort.Ints(w.order)
	w.respawn(p)
	w.Dirty = true
	return p, nil
}

// RemovePlayer deletes a player (no-op if absent).
func (w *World) RemovePlayer(id int) {
	if _, ok := w.players[id]; !ok {
		return
	}
	delete(w.players, id)
	for i, v := range w.order {
		if v == id {
			w.order = append(w.order[:i], w.order[i+1:]...)
			break
		}
	}
	w.Dirty = true
}

// SetTeam moves a player to another team and respawns them there.
func (w *World) SetTeam(id int, team string) error {
	p := w.players[id]
	if p == nil {
		return ErrNoPlayer
	}
	if team != TeamA && team != TeamB {
		return ErrBadTeam
	}
	if p.Team == team {
		return nil
	}
	p.Team = team
	if p.Alive { // a dead player keeps waiting for the respawn timer (no instant-respawn trick)
		w.respawn(p)
	}
	w.Dirty = true
	return nil
}

// QueueInput validates and buffers an input for the next tick(s).
func (w *World) QueueInput(id int, in Input) error {
	p := w.players[id]
	if p == nil {
		return ErrNoPlayer
	}
	if err := in.Validate(len(w.Spec.Weapons)); err != nil {
		return err
	}
	if in.Seq <= p.lastQueued {
		return ErrStaleInput
	}
	p.lastQueued = in.Seq
	if len(p.queue) >= maxQueue {
		p.queue = p.queue[1:]
	}
	p.queue = append(p.queue, in)
	return nil
}

func (w *World) pickSpawn(p *Player) Spawn {
	list := w.Map.Spawns[p.Team]
	best, bestD := 0, -1.0
	for i, sp := range list {
		d := math.MaxFloat64
		for _, o := range w.players {
			if o == p || !o.Alive {
				continue
			}
			if dd := math.Hypot(o.Kin.X-sp.X, o.Kin.Z-sp.Z); dd < d {
				d = dd
			}
		}
		if d == math.MaxFloat64 { // nobody around: rotate through spawns
			d = float64((i + w.spawnN) % len(list))
		}
		if d > bestD {
			best, bestD = i, d
		}
	}
	w.spawnN++
	return list[best]
}

func (w *World) respawn(p *Player) {
	sp := w.pickSpawn(p)
	p.Kin = Kin{X: sp.X, Y: 0, Z: sp.Z, OnGround: true}
	p.Yaw, p.Pitch, p.Speed = sp.Yaw, 0, 0
	p.HP = w.Spec.Player.MaxHealth
	p.Alive = true
	p.ProtectUntil = w.Tick + w.ticks(w.Spec.Match.SpawnProtectSeconds)
	p.queue = nil
	p.LastSeq = p.lastQueued
	w.resetLoadout(p)
}

// Step advances the world by one tick.
func (w *World) Step() {
	w.Tick++
	w.events = w.events[:0]
	if w.State == StateEnded {
		for _, p := range w.players {
			p.queue = nil
			p.LastSeq = p.lastQueued
		}
		if w.Tick >= w.restartAt {
			w.restart()
		}
		return
	}
	for _, id := range w.order {
		p := w.players[id]
		if !p.Alive {
			p.queue = nil
			p.LastSeq = p.lastQueued
			if w.Tick >= p.RespawnAt {
				w.respawn(p)
			}
			continue
		}
		if p.budget < maxBudget {
			p.budget++
		}
		n := len(p.queue)
		if n > maxInputsPerTick {
			n = maxInputsPerTick
		}
		if n > p.budget {
			n = p.budget
		}
		p.budget -= n
		for i := 0; i < n && p.Alive && w.State == StatePlaying; i++ {
			w.apply(p, p.queue[i])
		}
		if n > 0 {
			p.queue = p.queue[n:]
		}
	}
	w.resolveShots()
	w.stepPickups()
	if w.State == StatePlaying && w.Tick >= w.endsAt {
		w.endMatch()
	}
}

func (w *World) apply(p *Player, in Input) {
	p.Yaw, p.Pitch = in.Yaw, in.Pitch
	p.Speed = Step(w.Spec, w.Map, &p.Kin, MoveCmd{F: in.F, S: in.S, Yaw: in.Yaw, Jump: in.Jump, Walk: in.Walk})
	p.LastSeq = in.Seq
	w.weapons(p, in)
}

func (w *World) endMatch() {
	w.State = StateEnded
	switch {
	case w.Score[0] > w.Score[1]:
		w.Winner = TeamA
	case w.Score[1] > w.Score[0]:
		w.Winner = TeamB
	default:
		w.Winner = "draw"
	}
	w.restartAt = w.Tick + w.ticks(w.Spec.Match.IntermissionSeconds)
	w.Dirty = true
}

func (w *World) restart() {
	w.State = StatePlaying
	w.Winner = ""
	w.Score = [2]int{}
	w.endsAt = w.Tick + w.ticks(float64(w.Cfg.TimeLimitSec))
	w.resetPickups()
	for _, id := range w.order {
		p := w.players[id]
		p.Kills, p.Deaths = 0, 0
		w.respawn(p)
	}
	w.Dirty = true
}

// SecondsLeft is time remaining in the current phase (match, or intermission).
func (w *World) SecondsLeft() int {
	end := w.endsAt
	if w.State == StateEnded {
		end = w.restartAt
	}
	left := end - w.Tick
	if left < 0 {
		left = 0
	}
	return (left + w.Spec.TickRate - 1) / w.Spec.TickRate
}
