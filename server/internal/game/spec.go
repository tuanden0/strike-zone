// Package game is the pure, I/O-free match simulation (movement, weapons, hit detection).
package game

import (
	"encoding/json"
	"fmt"
	"math"

	"strikezone/client"
)

// Spec mirrors client/shared/spec.json, the single source of truth for client and server.
type Spec struct {
	TickRate int          `json:"tickRate"`
	Player   PlayerSpec   `json:"player"`
	Match    MatchSpec    `json:"match"`
	Weapons  []WeaponSpec `json:"weapons"`
}

type BoxSpec struct {
	HalfWidth float64 `json:"halfWidth"`
	Y0        float64 `json:"y0"`
	Y1        float64 `json:"y1"`
}

type PlayerSpec struct {
	HalfWidth float64 `json:"halfWidth"`
	Height    float64 `json:"height"`
	EyeHeight float64 `json:"eyeHeight"`
	RunSpeed  float64 `json:"runSpeed"`
	WalkSpeed float64 `json:"walkSpeed"`
	JumpSpeed float64 `json:"jumpSpeed"`
	Gravity   float64 `json:"gravity"`
	MaxHealth int     `json:"maxHealth"`
	Body      BoxSpec `json:"body"`
	Head      BoxSpec `json:"head"`
}

type MatchSpec struct {
	RespawnSeconds      float64 `json:"respawnSeconds"`
	SpawnProtectSeconds float64 `json:"spawnProtectSeconds"`
	IntermissionSeconds float64 `json:"intermissionSeconds"`
	DefaultTimeLimit    int     `json:"defaultTimeLimit"`
	DefaultScoreLimit   int     `json:"defaultScoreLimit"`
	MinTimeLimit        int     `json:"minTimeLimit"`
	MaxTimeLimit        int     `json:"maxTimeLimit"`
	MinScoreLimit       int     `json:"minScoreLimit"`
	MaxScoreLimit       int     `json:"maxScoreLimit"`
	MaxPlayers          int     `json:"maxPlayers"`
}

type WeaponSpec struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Damage        float64 `json:"damage"`
	HeadMult      float64 `json:"headMult"`
	Range         float64 `json:"range"`
	IntervalTicks int     `json:"intervalTicks"`
	Auto          bool    `json:"auto"`
	MagSize       int     `json:"magSize"`
	Reserve       int     `json:"reserve"`
	ReloadTicks   int     `json:"reloadTicks"`
	Spread        float64 `json:"spread"`
	MoveSpread    float64 `json:"moveSpread"`
	Melee         bool    `json:"melee"`
}

// Map mirrors client/shared/map.json.
type Map struct {
	Name   string `json:"name"`
	Bounds struct {
		MinX float64 `json:"minX"`
		MaxX float64 `json:"maxX"`
		MinZ float64 `json:"minZ"`
		MaxZ float64 `json:"maxZ"`
	} `json:"bounds"`
	RawBoxes []struct {
		Min [3]float64 `json:"min"`
		Max [3]float64 `json:"max"`
		Mat string     `json:"mat"`
	} `json:"boxes"`
	Spawns map[string][]Spawn `json:"spawns"`

	Boxes [][6]float64 `json:"-"` // x0,y0,z0,x1,y1,z1
}

type Spawn struct {
	X   float64 `json:"x"`
	Z   float64 `json:"z"`
	Yaw float64 `json:"yaw"`
}

// LoadDefault parses the embedded spec and map and validates them.
func LoadDefault() (*Spec, *Map, error) {
	sb, err := client.FS.ReadFile("shared/spec.json")
	if err != nil {
		return nil, nil, err
	}
	mb, err := client.FS.ReadFile("shared/map.json")
	if err != nil {
		return nil, nil, err
	}
	return Parse(sb, mb)
}

// Parse decodes and validates spec and map JSON.
func Parse(specJSON, mapJSON []byte) (*Spec, *Map, error) {
	var s Spec
	if err := json.Unmarshal(specJSON, &s); err != nil {
		return nil, nil, fmt.Errorf("spec.json: %w", err)
	}
	var m Map
	if err := json.Unmarshal(mapJSON, &m); err != nil {
		return nil, nil, fmt.Errorf("map.json: %w", err)
	}
	for _, b := range m.RawBoxes {
		m.Boxes = append(m.Boxes, [6]float64{b.Min[0], b.Min[1], b.Min[2], b.Max[0], b.Max[1], b.Max[2]})
	}
	if err := validate(&s, &m); err != nil {
		return nil, nil, err
	}
	return &s, &m, nil
}

func validate(s *Spec, m *Map) error {
	p := s.Player
	switch {
	case s.TickRate < 1 || s.TickRate > 120:
		return fmt.Errorf("spec: tickRate %d out of range", s.TickRate)
	case p.HalfWidth <= 0 || p.Height <= 0 || p.EyeHeight <= 0 || p.EyeHeight > p.Height || p.MaxHealth <= 0:
		return fmt.Errorf("spec: bad player dimensions")
	case p.RunSpeed <= 0 || p.WalkSpeed <= 0 || p.JumpSpeed <= 0 || p.Gravity <= 0:
		return fmt.Errorf("spec: bad player motion")
	case len(s.Weapons) < 1 || len(s.Weapons) > 8:
		return fmt.Errorf("spec: need 1..8 weapons")
	case s.Match.MaxPlayers < 2 || s.Match.MinTimeLimit < 1 || s.Match.MaxTimeLimit < s.Match.MinTimeLimit || s.Match.MinScoreLimit < 1 || s.Match.MaxScoreLimit < s.Match.MinScoreLimit:
		return fmt.Errorf("spec: bad match limits")
	}
	for _, w := range s.Weapons {
		if w.IntervalTicks < 1 || w.Range <= 0 || w.Damage <= 0 || w.HeadMult <= 0 || w.MagSize < 0 || w.Reserve < 0 || w.ReloadTicks < 0 {
			return fmt.Errorf("spec: bad weapon %q", w.ID)
		}
	}
	for _, t := range []string{"A", "B"} {
		if len(m.Spawns[t]) == 0 {
			return fmt.Errorf("map: no spawns for team %s", t)
		}
		for _, sp := range m.Spawns[t] {
			if math.IsNaN(sp.X) || math.IsNaN(sp.Z) {
				return fmt.Errorf("map: bad spawn")
			}
			if sp.X < m.Bounds.MinX || sp.X > m.Bounds.MaxX || sp.Z < m.Bounds.MinZ || sp.Z > m.Bounds.MaxZ {
				return fmt.Errorf("map: spawn (%v,%v) out of bounds", sp.X, sp.Z)
			}
			k := Kin{X: sp.X, Z: sp.Z}
			if m.overlaps(s, &k) {
				return fmt.Errorf("map: spawn (%v,%v) inside geometry", sp.X, sp.Z)
			}
		}
	}
	return nil
}
