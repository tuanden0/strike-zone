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
	TickRate    int           `json:"tickRate"`
	SwitchTicks int           `json:"switchTicks"`
	Player      PlayerSpec    `json:"player"`
	Match       MatchSpec     `json:"match"`
	Weapons     []WeaponSpec  `json:"weapons"`
	Pickups     PickupSpec    `json:"pickups"`
	Recoil      RecoilSpec    `json:"recoil"`
	Nades       NadeSpec      `json:"nades"`
	Grenades    []GrenadeSpec `json:"grenades"`
}

// NadeSpec is the shared grenade physics.
type NadeSpec struct {
	CooldownTicks int     `json:"cooldownTicks"` // between two throws by one player
	Gravity       float64 `json:"gravity"`
	Restitution   float64 `json:"restitution"` // bounce energy kept
	Radius        float64 `json:"radius"`      // collision sphere
}

// GrenadeSpec describes one throwable (Kind: frag | smoke | flash). Radius is the damage radius (frag), cloud radius (smoke) or
// blind range (flash); Damage is the damage at the centre (frag); Duration is seconds of smoke or maximum blindness.
type GrenadeSpec struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Kind      string  `json:"kind"`
	FuseTicks int     `json:"fuseTicks"`
	Speed     float64 `json:"speed"`
	UpBias    float64 `json:"upBias"` // extra upward m/s so a flat aim lobs
	Radius    float64 `json:"radius"`
	Damage    float64 `json:"damage"`
	Duration  float64 `json:"duration"`
	Count     int     `json:"count"` // carried at spawn
}

// RecoilSpec derives recoil from damage: one shot kicks the view PerDamage*Damage*RecoilScale radians (so a harder-hitting
// weapon kicks harder). Consecutive shots (each within the weapon's interval + GraceTicks of the previous) ramp the kick by
// RampPerShot per shot and widen the spread by BloomRatio*kick*BloomScale per extra shot, both capped at MaxShots shots.
type RecoilSpec struct {
	PerDamage   float64 `json:"perDamage"`
	YawRatio    float64 `json:"yawRatio"`
	BloomRatio  float64 `json:"bloomRatio"`
	RampPerShot float64 `json:"rampPerShot"`
	MaxShots    int     `json:"maxShots"`
	GraceTicks  int     `json:"graceTicks"`
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
	HalfWidth float64    `json:"halfWidth"`
	Height    float64    `json:"height"`
	EyeHeight float64    `json:"eyeHeight"`
	RunSpeed  float64    `json:"runSpeed"`
	WalkSpeed float64    `json:"walkSpeed"`
	JumpSpeed float64    `json:"jumpSpeed"`
	Gravity   float64    `json:"gravity"`
	MaxHealth int        `json:"maxHealth"`
	Body      BoxSpec    `json:"body"`
	Head      BoxSpec    `json:"head"`
	Crouch    CrouchSpec `json:"crouch"`
}

// CrouchSpec is the lowered stance (Shift): smaller body and hitboxes, slower, no jumping. Standing up needs headroom.
type CrouchSpec struct {
	Height    float64 `json:"height"`
	EyeHeight float64 `json:"eyeHeight"`
	Speed     float64 `json:"speed"`
	Body      BoxSpec `json:"body"`
	Head      BoxSpec `json:"head"`
}

// HeightOf is the body height of a kinematic state (standing or crouched).
func (s *Spec) HeightOf(k *Kin) float64 {
	if k.Crouch {
		return s.Player.Crouch.Height
	}
	return s.Player.Height
}

// EyeOf is the eye height above the feet.
func (s *Spec) EyeOf(k *Kin) float64 {
	if k.Crouch {
		return s.Player.Crouch.EyeHeight
	}
	return s.Player.EyeHeight
}

// Boxes returns the body and head hitbox shapes for a stance.
func (s *Spec) Boxes(crouch bool) (body, head BoxSpec) {
	if crouch {
		return s.Player.Crouch.Body, s.Player.Crouch.Head
	}
	return s.Player.Body, s.Player.Head
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
	RecoilScale  float64 `json:"recoilScale"` // multiplies the damage-derived kick (0 = none, e.g. the knife)
	BloomScale   float64 `json:"bloomScale"`  // multiplies the spread added by sustained fire (0 = none)
}

// Kick is the view kick (radians of pitch) of the first shot of a burst.
func (s *Spec) Kick(ws *WeaponSpec) float64 { return s.Recoil.PerDamage * ws.Damage * ws.RecoilScale }

// Bloom is the extra spread (radians) when this is the burst-th consecutive shot (1 = first shot: none).
func (s *Spec) Bloom(ws *WeaponSpec, burst int) float64 {
	if burst < 2 {
		return 0
	}
	return s.Recoil.BloomRatio * s.Kick(ws) * ws.BloomScale * float64(min(burst, s.Recoil.MaxShots)-1)
}

// Spread is the half-angle (radians) of the random cone a shot is fired in. moveFrac is 0 standing .. 1 running/airborne.
func (s *Spec) Spread(ws *WeaponSpec, scoped bool, moveFrac float64, burst int) float64 {
	base := ws.Spread
	if scoped {
		base = ws.ScopedSpread
	}
	return base + ws.MoveSpread*moveFrac + s.Bloom(ws, burst)
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
	case p.Crouch.Height <= 0 || p.Crouch.Height >= p.Height || p.Crouch.EyeHeight <= 0 || p.Crouch.EyeHeight > p.Crouch.Height || p.Crouch.Speed <= 0 || p.Crouch.Speed > p.WalkSpeed ||
		p.Crouch.Body.Y1 <= p.Crouch.Body.Y0 || p.Crouch.Head.Y1 <= p.Crouch.Head.Y0 || p.Crouch.Head.Y1 > p.Crouch.Height+1e-9 || p.Crouch.Body.HalfWidth > p.HalfWidth+1e-9:
		return fmt.Errorf("spec: bad crouch stance")
	case len(s.Weapons) < 1 || len(s.Weapons) > 8:
		return fmt.Errorf("spec: need 1..8 weapons")
	case s.Match.MaxPlayers < 2 || s.Match.MinTimeLimit < 1 || s.Match.MaxTimeLimit < s.Match.MinTimeLimit || s.Match.MinScoreLimit < 1 || s.Match.MaxScoreLimit < s.Match.MinScoreLimit:
		return fmt.Errorf("spec: bad match limits")
	}
	for _, w := range s.Weapons {
		if w.IntervalTicks < 1 || w.Range <= 0 || w.Damage <= 0 || w.HeadMult <= 0 || w.MagSize < 0 || w.Reserve < 0 || w.ReloadTicks < 0 ||
			w.ScopeFov < 0 || (w.ScopeFov > 0 && (w.ScopeFov < 2 || w.ScopeFov > 60)) || w.ScopedSpread < 0 || (w.ScopeFov > 0 && w.Melee) || w.RecoilScale < 0 || w.BloomScale < 0 {
			return fmt.Errorf("spec: bad weapon %q", w.ID)
		}
	}
	n := s.Nades
	if n.CooldownTicks < 1 || n.CooldownTicks > 600 || n.Gravity < 0 || n.Gravity > 100 || n.Restitution < 0 || n.Restitution > 1 || n.Radius < 0.02 || n.Radius > 0.5 {
		return fmt.Errorf("spec: bad nades section")
	}
	if len(s.Grenades) > 6 {
		return fmt.Errorf("spec: at most 6 grenade types")
	}
	for _, g := range s.Grenades {
		switch {
		case g.Kind != KindFrag && g.Kind != KindSmoke && g.Kind != KindFlash:
			return fmt.Errorf("spec: grenade %q has unknown kind %q", g.ID, g.Kind)
		case g.FuseTicks < 1 || g.FuseTicks > 300 || g.Speed < 1 || g.Speed > 40 || g.UpBias < 0 || g.UpBias > 20 || g.Radius <= 0 || g.Radius > 60 || g.Count < 0 || g.Count > 9:
			return fmt.Errorf("spec: bad grenade %q", g.ID)
		case g.Kind == KindFrag && g.Damage <= 0:
			return fmt.Errorf("spec: frag grenade %q needs damage", g.ID)
		case g.Kind != KindFrag && (g.Duration <= 0 || g.Duration > 60):
			return fmt.Errorf("spec: grenade %q needs a duration 0..60 s", g.ID)
		}
	}
	r := s.Recoil
	if r.PerDamage < 0 || r.PerDamage > 0.01 || r.YawRatio < 0 || r.YawRatio > 2 || r.BloomRatio < 0 || r.BloomRatio > 2 || r.RampPerShot < 0 || r.RampPerShot > 1 || r.MaxShots < 1 || r.MaxShots > 60 || r.GraceTicks < 0 || r.GraceTicks > 60 {
		return fmt.Errorf("spec: bad recoil section")
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
