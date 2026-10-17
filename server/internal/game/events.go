package game

// Event types.
const (
	EvShot  = "shot" // someone fired (or swung the knife); Hv marks the landing of a heavy stab
	EvStab  = "stab" // someone started a heavy stab (animation cue; the hit follows after the windup)
	EvHit   = "hit"  // a shot damaged a player
	EvKill  = "kill"
	EvThrow = "throw" // someone threw a grenade (sound)
	EvBoom  = "boom"  // a grenade went off at At
)

// Hit kinds on a shot event.
const (
	HitNone = ""
	HitWall = "wall"
	HitBody = "body"
	HitHead = "head"
)

// Event is a one-tick happening broadcast in snapshots (shots, hits, kills).
type Event struct {
	E    string      `json:"e"`
	By   int         `json:"by,omitempty"`
	V    int         `json:"v,omitempty"`
	W    int         `json:"w"`
	Dmg  int         `json:"dmg,omitempty"`
	Head bool        `json:"head,omitempty"`
	Hv   bool        `json:"hv,omitempty"`
	Hit  string      `json:"hit,omitempty"`
	From *[3]float64 `json:"from,omitempty"`
	To   *[3]float64 `json:"to,omitempty"`
	G    int         `json:"g,omitempty"`  // grenade index (throw/boom)
	At   *[3]float64 `json:"at,omitempty"` // boom position
}

// Events returns the events produced by the last Step (valid until the next Step).
func (w *World) Events() []Event { return w.events }
