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
	bots    []int // bot player ids in the order they were added (humans are in members)
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
	team, err := r.pickTeam(team)
	if err != nil {
		return "", err
	}
	// a human takes a bot's place when the chosen team, or the whole room, is full of bots
	if r.World.TeamCount(team) >= r.teamCap() {
		r.removeBot(team)
	}
	if r.World.Len() >= r.Max {
		r.removeBot("")
	}
	if r.World.Len() >= r.Max {
		return "", ErrRoomFull
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

func (r *Room) pickTeam(team string) (string, error) {
	switch team {
	case "", "auto":
		a, b := r.World.TeamCount(game.TeamA), r.World.TeamCount(game.TeamB)
		if b < a {
			return game.TeamB, nil
		}
		return game.TeamA, nil
	case game.TeamA, game.TeamB:
		return team, nil
	}
	return "", ErrBadTeam
}

// AddBot adds an AI player on team ("A", "B" or auto) and returns the assigned team.
func (r *Room) AddBot(id int, nick, team, skill string) (string, error) {
	if r.World.Len() >= r.Max {
		return "", ErrRoomFull
	}
	team, err := r.pickTeam(team)
	if err != nil {
		return "", err
	}
	if r.World.TeamCount(team) >= r.teamCap() {
		return "", ErrTeamFull
	}
	if _, err := r.World.AddBot(id, nick, team, skill); err != nil {
		return "", err
	}
	r.bots = append(r.bots, id)
	return team, nil
}

// removeBot removes the most recently added bot (of team, or of any team when team is empty). Reports whether one was removed.
func (r *Room) removeBot(team string) bool {
	for i := len(r.bots) - 1; i >= 0; i-- {
		if p := r.World.Player(r.bots[i]); p != nil && (team == "" || p.Team == team) {
			r.World.RemovePlayer(r.bots[i])
			r.bots = append(r.bots[:i], r.bots[i+1:]...)
			return true
		}
	}
	return false
}

// RemoveBot removes the most recently added bot.
func (r *Room) RemoveBot() bool { return r.removeBot("") }

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
		TimeLimit: r.World.Cfg.TimeLimitSec, ScoreLimit: r.World.Cfg.ScoreLimit, State: r.World.State, Map: r.MapID, Bots: len(r.bots),
	}
}

// Roster lists scoreboard rows.
func (r *Room) Roster() []RosterEntry {
	ps := r.World.Players()
	out := make([]RosterEntry, 0, len(ps))
	for _, p := range ps {
		out = append(out, RosterEntry{ID: p.ID, Nick: p.Nick, Team: p.Team, Kills: p.Kills, Deaths: p.Deaths, Bot: p.IsBot, Away: p.Away})
	}
	return out
}
