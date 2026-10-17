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
	TickRate    int          `json:"tickRate"`
	SwitchTicks int          `json:"switchTicks"`
	Player      PlayerSpec   `json:"player"`
	Match       MatchSpec    `json:"match"`
	Weapons     []WeaponSpec `json:"weapons"`
	Pickups     PickupSpec   `json:"pickups"`
}

// PickupSpec configures dropped/ground weapons.
type PickupSpec struct {
	Radius              float64 `json:"radius"`              // horizontal pickup range (m)
	RespawnSeconds      float64 `json:"respawnSeconds"`      // map spawn points refill after this long
	DropLifetimeSeconds float64 `json:"dropLifetimeSeconds"` // dropped weapons vanish after this long
	DropForward         float64 `json:"dropForward"`         // dropped weapon lands this far in front of the player
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
	// Scope: ScopeFov > 0 (vertical field of view in degrees) lets the holder zoom with the `scope` input. Scoped shots use
	// ScopedSpread instead of Spread (MoveSpread still applies). PickupOnly weapons are not part of the spawn loadout.
	ScopeFov     float64 `json:"scopeFov"`
	ScopedSpread float64 `json:"scopedSpread"`
	PickupOnly   bool    `json:"pickupOnly"`
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
	// Pickups are weapon spawn points (W = weapon index in spec.weapons).
	Pickups []PickupSpawn `json:"pickups"`

	Boxes [][6]float64 `json:"-"` // x0,y0,z0,x1,y1,z1
}

type PickupSpawn struct {
	W int     `json:"w"`
	X float64 `json:"x"`
	Z float64 `json:"z"`
}

type Spawn struct {
	X   float64 `json:"x"`
	Z   float64 `json:"z"`
	Yaw float64 `json:"yaw"`
}

// MapEntry describes one playable map (shared/maps.json).
type MapEntry struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	File  string `json:"file"`
	Model string `json:"model"`
}

// MapSet is the registry of playable maps; Order[0] is the default.
type MapSet struct {
	Order []string
	Maps  map[string]*Map
	Label map[string]string
}

// OneMap wraps a single map as the default ("yard") registry (tests, simple embedding).
func OneMap(m *Map) *MapSet {
	return &MapSet{Order: []string{"yard"}, Maps: map[string]*Map{"yard": m}, Label: map[string]string{"yard": m.Name}}
}

// Default returns the default map id.
func (ms *MapSet) Default() string { return ms.Order[0] }

// LoadDefault parses the embedded spec and the default (first) map and validates them.
func LoadDefault() (*Spec, *Map, error) {
	s, ms, err := LoadAll()
	if err != nil {
		return nil, nil, err
	}
	return s, ms.Maps[ms.Default()], nil
}

// LoadAll parses the embedded spec and every map listed in shared/maps.json.
func LoadAll() (*Spec, *MapSet, error) {
	sb, err := client.FS.ReadFile("shared/spec.json")
	if err != nil {
		return nil, nil, err
	}
	var s Spec
	if err := json.Unmarshal(sb, &s); err != nil {
		return nil, nil, fmt.Errorf("spec.json: %w", err)
	}
	if err := validateSpec(&s); err != nil {
		return nil, nil, err
	}
	rb, err := client.FS.ReadFile("shared/maps.json")
	if err != nil {
		return nil, nil, err
	}
	var entries []MapEntry
	if err := json.Unmarshal(rb, &entries); err != nil || len(entries) == 0 {
		return nil, nil, fmt.Errorf("maps.json: need a non-empty JSON list (%v)", err)
	}
	ms := &MapSet{Maps: map[string]*Map{}, Label: map[string]string{}}
	for _, e := range entries {
		if e.ID == "" || ms.Maps[e.ID] != nil {
			return nil, nil, fmt.Errorf("maps.json: bad or duplicate id %q", e.ID)
		}
		mb, err := client.FS.ReadFile("shared/" + e.File)
		if err != nil {
			return nil, nil, err
		}
		m, err := parseMap(&s, mb)
		if err != nil {
			return nil, nil, fmt.Errorf("%s: %w", e.File, err)
		}
		ms.Order = append(ms.Order, e.ID)
		ms.Maps[e.ID] = m
		ms.Label[e.ID] = e.Label
	}
	return &s, ms, nil
}

// Parse decodes and validates spec and map JSON.
func Parse(specJSON, mapJSON []byte) (*Spec, *Map, error) {
	var s Spec
	if err := json.Unmarshal(specJSON, &s); err != nil {
		return nil, nil, fmt.Errorf("spec.json: %w", err)
	}
	if err := validateSpec(&s); err != nil {
		return nil, nil, err
	}
	m, err := parseMap(&s, mapJSON)
	if err != nil {
		return nil, nil, err
	}
	return &s, m, nil
}

func parseMap(s *Spec, mapJSON []byte) (*Map, error) {
	var m Map
	if err := json.Unmarshal(mapJSON, &m); err != nil {
		return nil, fmt.Errorf("map json: %w", err)
	}
	for _, b := range m.RawBoxes {
		m.Boxes = append(m.Boxes, [6]float64{b.Min[0], b.Min[1], b.Min[2], b.Max[0], b.Max[1], b.Max[2]})
	}
	if err := validateMap(s, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func validateSpec(s *Spec) error {
	p := s.Player
	switch {
	case s.TickRate < 1 || s.TickRate > 120:
		return fmt.Errorf("spec: tickRate %d out of range", s.TickRate)
	case s.SwitchTicks < 0:
		return fmt.Errorf("spec: switchTicks must be >= 0")
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
		if w.IntervalTicks < 1 || w.Range <= 0 || w.Damage <= 0 || w.HeadMult <= 0 || w.MagSize < 0 || w.Reserve < 0 || w.ReloadTicks < 0 ||
			w.ScopeFov < 0 || (w.ScopeFov > 0 && (w.ScopeFov < 2 || w.ScopeFov > 60)) || w.ScopedSpread < 0 || (w.ScopeFov > 0 && w.Melee) {
			return fmt.Errorf("spec: bad weapon %q", w.ID)
		}
	}
	pk := s.Pickups
	if pk.Radius <= 0 || pk.Radius > 5 || pk.RespawnSeconds < 1 || pk.DropLifetimeSeconds < 1 || pk.DropForward < 0 || pk.DropForward > 3 {
		return fmt.Errorf("spec: bad pickups section")
	}
	return nil
}

func validateMap(s *Spec, m *Map) error {
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
	for i, pk := range m.Pickups {
		if pk.W < 0 || pk.W >= len(s.Weapons) || s.Weapons[pk.W].Melee {
			return fmt.Errorf("map: pickup %d has a bad weapon index", i)
		}
		if pk.X < m.Bounds.MinX || pk.X > m.Bounds.MaxX || pk.Z < m.Bounds.MinZ || pk.Z > m.Bounds.MaxZ {
			return fmt.Errorf("map: pickup %d out of bounds", i)
		}
		k := Kin{X: pk.X, Z: pk.Z}
		if m.overlaps(s, &k) {
			return fmt.Errorf("map: pickup %d at (%v,%v) is inside geometry", i, pk.X, pk.Z)
		}
	}
	return nil
}
