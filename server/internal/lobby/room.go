package lobby

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"errors"

	"strikezone/server/internal/game"
)

// Join/team errors (mapped to protocol codes by the hub).
var (
	ErrRoomFull    = errors.New("room is full")
	ErrTeamFull    = errors.New("team is full")
	ErrBadPassword = errors.New("wrong password")
	ErrBadTeam     = errors.New("invalid team")
)

// Room is a lobby entry wrapping one match.
type Room struct {
	ID    int
	Name  string
	Max   int
	MapID string
	World *game.World

	locked  bool
	salt    [16]byte
	pwHash  [32]byte
	members map[int]*Session
}

func hashPassword(salt [16]byte, pw string) [32]byte {
	return sha256.Sum256(append(salt[:], pw...))
}

func newRoom(id int, name, password string, max int, mapID string, w *game.World) (*Room, error) {
	r := &Room{ID: id, Name: name, Max: max, MapID: mapID, World: w, members: map[int]*Session{}}
	if password != "" {
		if _, err := rand.Read(r.salt[:]); err != nil {
			return nil, err
		}
		r.pwHash = hashPassword(r.salt, password)
		r.locked = true
	}
	return r, nil
}

// CheckPassword compares in constant time (hashes are fixed length). Unlocked rooms accept anything.
func (r *Room) CheckPassword(pw string) bool {
	if !r.locked {
		return true
	}
	h := hashPassword(r.salt, pw)
	return subtle.ConstantTimeCompare(h[:], r.pwHash[:]) == 1
}

func (r *Room) teamCap() int { return (r.Max + 1) / 2 }

// Join adds a member. team: "A", "B" or ""/"auto". Returns the assigned team.
func (r *Room) Join(s *Session, password, team string) (string, error) {
	if !r.CheckPassword(password) {
		return "", ErrBadPassword
	}
	if r.World.Len() >= r.Max {
		return "", ErrRoomFull
	}
	switch team {
	case "", "auto":
		a, b := r.World.TeamCount(game.TeamA), r.World.TeamCount(game.TeamB)
		team = game.TeamA
		if b < a {
			team = game.TeamB
		}
	case game.TeamA, game.TeamB:
	default:
		return "", ErrBadTeam
	}
	if r.World.TeamCount(team) >= r.teamCap() {
		return "", ErrTeamFull
	}
	if _, err := r.World.AddPlayer(s.ID, s.Nick, team); err != nil {
		return "", err
	}
	r.members[s.ID] = s
	return team, nil
}

// SetTeam switches a member's team if the target team has room.
func (r *Room) SetTeam(id int, team string) error {
	p := r.World.Player(id)
	if p == nil {
		return game.ErrNoPlayer
	}
	if team != game.TeamA && team != game.TeamB {
		return ErrBadTeam
	}
	if p.Team != team && r.World.TeamCount(team) >= r.teamCap() {
		return ErrTeamFull
	}
	return r.World.SetTeam(id, team)
}

// Leave removes a member and reports whether the room is now empty.
func (r *Room) Leave(id int) (empty bool) {
	delete(r.members, id)
	r.World.RemovePlayer(id)
	return len(r.members) == 0
}

// Info returns the public description.
func (r *Room) Info() RoomInfo {
	return RoomInfo{
		ID: r.ID, Name: r.Name, Players: r.World.Len(), Max: r.Max, Locked: r.locked,
		TimeLimit: r.World.Cfg.TimeLimitSec, ScoreLimit: r.World.Cfg.ScoreLimit, State: r.World.State, Map: r.MapID,
	}
}

// Roster lists scoreboard rows.
func (r *Room) Roster() []RosterEntry {
	ps := r.World.Players()
	out := make([]RosterEntry, 0, len(ps))
	for _, p := range ps {
		out = append(out, RosterEntry{ID: p.ID, Nick: p.Nick, Team: p.Team, Kills: p.Kills, Deaths: p.Deaths})
	}
	return out
}
