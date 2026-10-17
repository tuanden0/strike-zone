// Package lobby holds rooms, sessions and the JSON message protocol (see docs/PROTOCOL.md).
// It performs no network I/O: connections are injected through the Conn interface.
package lobby

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"strikezone/server/internal/game"
)

// Limits on user-supplied text.
const (
	MaxNickRunes = 16
	MaxRoomRunes = 24
	MaxPassBytes = 32
)

// SanitizeName removes non-printable runes (control, format/bidi, unassigned), trims space and
// truncates to max runes. Result may be empty.
func SanitizeName(s string, max int) string {
	var b strings.Builder
	n := 0
	for _, r := range s {
		if r == utf8.RuneError || !unicode.IsPrint(r) {
			continue
		}
		if unicode.IsSpace(r) && r != ' ' {
			continue
		}
		if n >= max {
			break
		}
		b.WriteRune(r)
		n++
	}
	return strings.TrimSpace(b.String())
}

// ---- client -> server ----------------------------------------------------------------------

type helloMsg struct {
	Nick string `json:"nick"`
}

type createMsg struct {
	Name       string `json:"name"`
	Password   string `json:"password"`
	Max        int    `json:"max"`
	TimeLimit  int    `json:"timeLimit"` // seconds
	ScoreLimit int    `json:"scoreLimit"`
	Team       string `json:"team"`
	Map        string `json:"map"` // map id from shared/maps.json; empty = default
}

type joinMsg struct {
	Room     int    `json:"room"`
	Password string `json:"password"`
	Team     string `json:"team"`
}

type teamMsg struct {
	Team string `json:"team"`
}

type pingMsg struct {
	Ts float64 `json:"ts"`
}

// ---- server -> client ----------------------------------------------------------------------

type welcomeMsg struct {
	T        string `json:"t"`
	ID       int    `json:"id"`
	Nick     string `json:"nick"`
	TickRate int    `json:"tickRate"`
}

// RoomInfo is the public description of a room.
type RoomInfo struct {
	ID         int    `json:"id"`
	Name       string `json:"name"`
	Players    int    `json:"players"`
	Max        int    `json:"max"`
	Locked     bool   `json:"locked"`
	TimeLimit  int    `json:"timeLimit"`
	ScoreLimit int    `json:"scoreLimit"`
	State      string `json:"st"`
	Map        string `json:"map"`
}

type roomsMsg struct {
	T     string     `json:"t"`
	Rooms []RoomInfo `json:"rooms"`
}

type joinedMsg struct {
	T    string   `json:"t"`
	Room RoomInfo `json:"room"`
	ID   int      `json:"id"`
	Team string   `json:"team"`
}

// RosterEntry is one row of the scoreboard.
type RosterEntry struct {
	ID     int    `json:"id"`
	Nick   string `json:"nick"`
	Team   string `json:"team"`
	Kills  int    `json:"kills"`
	Deaths int    `json:"deaths"`
}

type rosterMsg struct {
	T       string        `json:"t"`
	Players []RosterEntry `json:"players"`
	Score   [2]int        `json:"sc"`
}

// pickupsMsg is the full list of weapons lying on the ground (sent on join and whenever it changes).
type pickupsMsg struct {
	T    string        `json:"t"`
	List []game.Pickup `json:"list"`
}

type errorMsg struct {
	T    string `json:"t"`
	Code string `json:"code"`
	Msg  string `json:"msg"`
}

type simpleMsg struct {
	T string `json:"t"`
}

type pongMsg struct {
	T  string  `json:"t"`
	Ts float64 `json:"ts"`
}

// Error codes sent to clients.
const (
	CodeBadRequest  = "bad_request"
	CodeNotReady    = "not_ready"
	CodeBadPassword = "bad_password"
	CodeRoomFull    = "room_full"
	CodeTeamFull    = "team_full"
	CodeNoRoom      = "no_room"
	CodeInRoom      = "in_room"
	CodeNotInRoom   = "not_in_room"
	CodeTooManyRoom = "too_many_rooms"
	CodeServerFull  = "server_full"
)
