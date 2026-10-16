package game

// Event types.
const (
	EvShot = "shot" // someone fired (or swung the knife)
	EvHit  = "hit"  // a shot damaged a player
	EvKill = "kill"
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
	Hit  string      `json:"hit,omitempty"`
	From *[3]float64 `json:"from,omitempty"`
	To   *[3]float64 `json:"to,omitempty"`
}

// Events returns the events produced by the last Step (valid until the next Step).
func (w *World) Events() []Event { return w.events }
