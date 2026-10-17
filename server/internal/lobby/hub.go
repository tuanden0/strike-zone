package lobby

import (
	crand "crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"sort"
	"sync"

	"strikezone/server/internal/game"
)

// Server-wide caps (small LAN game; keeps memory bounded).
const (
	MaxSessions = 200
	MaxRooms    = 20
	maxBadMsgs  = 10 // protocol violations tolerated per session before disconnect
	maxBadPass  = 5
)

// ErrServerFull is returned by Register when MaxSessions is reached.
var ErrServerFull = errors.New("server full")

// Conn is the outbound side of a client connection. Send must marshal v before returning and
// must not block; it returns false when the connection is dead or too slow.
type Conn interface {
	Send(v any) bool
}

// Session is one connected client.
type Session struct {
	ID   int
	Nick string
	Conn Conn

	room    *Room
	hello   bool
	badMsgs int
	badPass int
	token   string // resume secret (hex), set at hello
	limbo   bool   // connection lost; waiting for `resume` until limboLeft ticks run out
}

// LimboTicks is how long (30 Hz ticks) a dropped player stays in the match waiting for `resume`: 30 s.
const LimboTicks = 30 * 30

// closer is implemented by connections that can be force-closed (used when a resume takes over a still-open old socket).
type closer interface{ Close() }

// deadConn swallows messages for a session whose socket is gone.
type deadConn struct{}

func (deadConn) Send(any) bool { return true }

// Hub owns all rooms and sessions. All methods are safe for concurrent use.
type Hub struct {
	mu       sync.Mutex
	spec     *game.Spec
	maps     *game.MapSet
	rooms    map[int]*Room
	sessions map[int]*Session
	nextRoom int
	nextID   int
	seed     uint64
	tokens   map[string]*Session // resume token -> session (active or in limbo)
	limbo    map[int]int         // session id -> ticks left
}

// NewHub creates an empty hub serving a single map (the default id).
func NewHub(spec *game.Spec, m *game.Map) *Hub { return NewHubMaps(spec, game.OneMap(m)) }

// NewHubMaps creates an empty hub serving every map in the set.
func NewHubMaps(spec *game.Spec, maps *game.MapSet) *Hub {
	return &Hub{spec: spec, maps: maps, rooms: map[int]*Room{}, sessions: map[int]*Session{}, nextRoom: 1, nextID: 1, seed: 1, tokens: map[string]*Session{}, limbo: map[int]int{}}
}

// Register allocates a session for a new connection.
func (h *Hub) Register(c Conn) (*Session, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.sessions) >= MaxSessions {
		return nil, ErrServerFull
	}
	s := &Session{ID: h.nextID, Conn: c}
	h.nextID++
	h.sessions[s.ID] = s
	return s, nil
}

// Unregister removes the session and leaves its room.
func (h *Hub) Unregister(s *Session) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.sessions[s.ID] != s { // this transport was already taken over by a resume: nothing left to clean up
		return
	}
	// A player in a room keeps their place for LimboTicks so they can resume after a network drop.
	if s.room != nil && s.token != "" && s.room.members[s.ID] == s {
		s.Conn = deadConn{}
		s.limbo = true
		h.limbo[s.ID] = LimboTicks
		if p := s.room.World.Player(s.ID); p != nil {
			p.Away = true
			s.room.World.Dirty = true
		}
		return
	}
	h.dropLocked(s)
}

// dropLocked removes a session for good.
func (h *Hub) dropLocked(s *Session) {
	h.leaveLocked(s)
	delete(h.sessions, s.ID)
	delete(h.limbo, s.ID)
	if s.token != "" && h.tokens[s.token] == s {
		delete(h.tokens, s.token)
	}
}

// Stats is a point-in-time summary for the admin endpoint.
type Stats struct {
	Sessions int        `json:"sessions"`
	Rooms    []RoomInfo `json:"rooms"`
}

// Stats returns counters.
func (h *Hub) Stats() Stats {
	h.mu.Lock()
	defer h.mu.Unlock()
	return Stats{Sessions: len(h.sessions), Rooms: h.listLocked()}
}

func (h *Hub) listLocked() []RoomInfo {
	out := make([]RoomInfo, 0, len(h.rooms))
	for _, r := range h.rooms {
		out = append(out, r.Info())
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (h *Hub) sendErr(s *Session, code, msg string) {
	s.Conn.Send(errorMsg{T: "error", Code: code, Msg: msg})
}

// violation counts a protocol error; returns a non-nil error once the session should be dropped.
func (h *Hub) violation(s *Session, code, msg string) error {
	h.sendErr(s, code, msg)
	s.badMsgs++
	if s.badMsgs >= maxBadMsgs {
		return fmt.Errorf("too many protocol violations (last: %s)", msg)
	}
	return nil
}

// Handle processes one client message. A non-nil error means: close this connection.
func (h *Hub) Handle(s *Session, raw []byte) error {
	var env struct {
		T string `json:"t"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return fmt.Errorf("malformed json: %w", err)
	}
	h.mu.Lock()
	defer h.mu.Unlock()

	if env.T == "in" { // hot path
		return h.handleInput(s, raw)
	}
	if env.T == "ping" {
		var m pingMsg
		if err := json.Unmarshal(raw, &m); err != nil || math.IsNaN(m.Ts) || math.IsInf(m.Ts, 0) {
			return h.violation(s, CodeBadRequest, "bad ping")
		}
		s.Conn.Send(pongMsg{T: "pong", Ts: m.Ts})
		return nil
	}
	if env.T == "hello" {
		var m helloMsg
		if err := json.Unmarshal(raw, &m); err != nil {
			return h.violation(s, CodeBadRequest, "bad hello")
		}
		if s.hello {
			return h.violation(s, CodeBadRequest, "already introduced")
		}
		nick := SanitizeName(m.Nick, MaxNickRunes)
		if nick == "" {
			nick = fmt.Sprintf("Player%d", s.ID)
		}
		s.Nick, s.hello = nick, true
		s.token = h.newToken(s)
		s.Conn.Send(welcomeMsg{T: "welcome", ID: s.ID, Nick: nick, TickRate: h.spec.TickRate, Token: s.token})
		return nil
	}
	if env.T == "resume" {
		return h.resume(s, raw)
	}
	if !s.hello {
		return h.violation(s, CodeNotReady, "send hello first")
	}

	switch env.T {
	case "rooms":
		s.Conn.Send(roomsMsg{T: "rooms", Rooms: h.listLocked()})
	case "create":
		var m createMsg
		if err := json.Unmarshal(raw, &m); err != nil {
			return h.violation(s, CodeBadRequest, "bad create")
		}
		return h.create(s, m)
	case "join":
		var m joinMsg
		if err := json.Unmarshal(raw, &m); err != nil {
			return h.violation(s, CodeBadRequest, "bad join")
		}
		return h.join(s, m)
	case "team":
		var m teamMsg
		if err := json.Unmarshal(raw, &m); err != nil {
			return h.violation(s, CodeBadRequest, "bad team")
		}
		if s.room == nil {
			return h.violation(s, CodeNotInRoom, "not in a room")
		}
		if err := s.room.SetTeam(s.ID, m.Team); err != nil {
			h.sendErr(s, joinCode(err), err.Error())
			return nil
		}
		h.broadcastRoster(s.room)
	case "addbot":
		var m addBotMsg
		if err := json.Unmarshal(raw, &m); err != nil {
			return h.violation(s, CodeBadRequest, "bad addbot")
		}
		if s.room == nil {
			return h.violation(s, CodeNotInRoom, "not in a room")
		}
		if m.Skill == "" {
			m.Skill = game.SkillNormal
		}
		if !game.ValidSkill(m.Skill) {
			return h.violation(s, CodeBadRequest, "skill must be easy, normal or hard")
		}
		if _, err := h.addBot(s.room, m.Team, m.Skill); err != nil {
			h.sendErr(s, joinCode(err), err.Error())
			return nil
		}
		h.broadcastRoster(s.room)
	case "rmbot":
		if s.room == nil {
			return h.violation(s, CodeNotInRoom, "not in a room")
		}
		if !s.room.RemoveBot() {
			h.sendErr(s, CodeNoBots, "no bots in this room")
			return nil
		}
		h.broadcastRoster(s.room)
	case "leave":
		if s.room == nil {
			return h.violation(s, CodeNotInRoom, "not in a room")
		}
		h.leaveLocked(s)
		s.Conn.Send(simpleMsg{T: "left"})
	default:
		return h.violation(s, CodeBadRequest, "unknown message type")
	}
	return nil
}

func (h *Hub) newToken(s *Session) string {
	var b [16]byte
	if _, err := crand.Read(b[:]); err != nil {
		panic(err) // no entropy: refuse to hand out guessable tokens (the connection's panic guard closes it)
	}
	t := hex.EncodeToString(b[:])
	h.tokens[t] = s
	return t
}

// resume attaches a fresh connection (session s, which has not said hello) to a player whose connection dropped, or is still half
// open. The old session's identity (id, nick, room, team, score) moves to s; the token is rotated so a leaked one is useless.
func (h *Hub) resume(s *Session, raw []byte) error {
	var m resumeMsg
	if err := json.Unmarshal(raw, &m); err != nil {
		return h.violation(s, CodeBadRequest, "bad resume")
	}
	if s.hello {
		return h.violation(s, CodeBadRequest, "already introduced")
	}
	old := h.tokens[m.Token]
	if len(m.Token) != 32 || old == nil || old == s {
		return h.violation(s, CodeBadToken, "unknown or expired session")
	}
	if c, ok := old.Conn.(closer); ok && !old.limbo {
		c.Close() // the old socket was never noticed as dead: cut it
	}
	delete(h.sessions, s.ID) // the temporary id of the new connection
	delete(h.limbo, old.ID)
	delete(h.tokens, old.token)
	s.ID, s.Nick, s.hello, s.room = old.ID, old.Nick, true, old.room
	old.room, old.limbo, old.token = nil, false, ""
	h.sessions[s.ID] = s
	s.token = h.newToken(s)
	ack := resumedMsg{T: "resumed", ID: s.ID, Nick: s.Nick, TickRate: h.spec.TickRate, Token: s.token}
	if r := s.room; r != nil {
		r.members[s.ID] = s
		info := r.Info()
		ack.Room = &info
		if p := r.World.Player(s.ID); p != nil {
			p.Away = false
			ack.Team = p.Team
			r.World.Dirty = true
		}
	}
	s.Conn.Send(ack)
	if r := s.room; r != nil {
		s.Conn.Send(pickupsMsg{T: "pk", List: r.World.Pickups()})
		h.broadcastRoster(r)
	}
	return nil
}

func (h *Hub) handleInput(s *Session, raw []byte) error {
	if s.room == nil {
		return h.violation(s, CodeNotInRoom, "input outside a room")
	}
	m := struct {
		T string `json:"t"`
		game.Input
	}{Input: game.Input{Weapon: -1}}
	if err := json.Unmarshal(raw, &m); err != nil {
		return h.violation(s, CodeBadRequest, "bad input")
	}
	if err := s.room.World.QueueInput(s.ID, m.Input); err != nil {
		return h.violation(s, CodeBadRequest, err.Error())
	}
	return nil
}

func joinCode(err error) string {
	switch {
	case errors.Is(err, ErrBadPassword):
		return CodeBadPassword
	case errors.Is(err, ErrRoomFull):
		return CodeRoomFull
	case errors.Is(err, ErrTeamFull):
		return CodeTeamFull
	default:
		return CodeBadRequest
	}
}

func (h *Hub) create(s *Session, m createMsg) error {
	if s.room != nil {
		return h.violation(s, CodeInRoom, "already in a room")
	}
	ms := h.spec.Match
	name := SanitizeName(m.Name, MaxRoomRunes)
	switch {
	case name == "":
		return h.violation(s, CodeBadRequest, "room name required")
	case len(m.Password) > MaxPassBytes:
		return h.violation(s, CodeBadRequest, "password too long")
	case m.Max < 2 || m.Max > ms.MaxPlayers:
		return h.violation(s, CodeBadRequest, fmt.Sprintf("max players must be 2..%d", ms.MaxPlayers))
	case m.TimeLimit < ms.MinTimeLimit || m.TimeLimit > ms.MaxTimeLimit:
		return h.violation(s, CodeBadRequest, fmt.Sprintf("time limit must be %d..%d seconds", ms.MinTimeLimit, ms.MaxTimeLimit))
	case m.ScoreLimit < ms.MinScoreLimit || m.ScoreLimit > ms.MaxScoreLimit:
		return h.violation(s, CodeBadRequest, fmt.Sprintf("score limit must be %d..%d", ms.MinScoreLimit, ms.MaxScoreLimit))
	case m.Bots < 0 || m.Bots > m.Max-1:
		return h.violation(s, CodeBadRequest, fmt.Sprintf("bots must be 0..%d (one slot stays free for you)", m.Max-1))
	}
	if m.Skill == "" {
		m.Skill = game.SkillNormal
	}
	if !game.ValidSkill(m.Skill) {
		return h.violation(s, CodeBadRequest, "skill must be easy, normal or hard")
	}
	if len(h.rooms) >= MaxRooms {
		h.sendErr(s, CodeTooManyRoom, "too many rooms")
		return nil
	}
	mapID := m.Map
	if mapID == "" {
		mapID = h.maps.Default()
	}
	gm := h.maps.Maps[mapID]
	if gm == nil {
		return h.violation(s, CodeBadRequest, "unknown map")
	}
	h.seed++
	w := game.NewWorld(h.spec, gm, game.MatchConfig{TimeLimitSec: m.TimeLimit, ScoreLimit: m.ScoreLimit}, h.seed)
	r, err := newRoom(h.nextRoom, name, m.Password, m.Max, mapID, w)
	if err != nil {
		log.Printf("create room: %v", err)
		h.sendErr(s, CodeBadRequest, "could not create room")
		return nil
	}
	team, err := r.Join(s, m.Password, m.Team)
	if err != nil {
		h.sendErr(s, joinCode(err), err.Error())
		return nil
	}
	h.nextRoom++
	h.rooms[r.ID] = r
	s.room = r
	for i := 0; i < m.Bots; i++ {
		if _, err := h.addBot(r, "auto", m.Skill); err != nil {
			log.Printf("create room: bot %d: %v", i, err)
			break
		}
	}
	h.afterJoin(s, r, team)
	return nil
}

var botNames = [...]string{"Rex", "Nova", "Viper", "Mako", "Echo", "Blaze", "Onyx", "Zed", "Kilo", "Jett"}

// addBot allocates an id from the shared counter (so it never collides with a session) and adds the bot.
func (h *Hub) addBot(r *Room, team, skill string) (string, error) {
	id := h.nextID
	t, err := r.AddBot(id, "[BOT] "+botNames[id%len(botNames)], team, skill)
	if err == nil {
		h.nextID++
	}
	return t, err
}

func (h *Hub) join(s *Session, m joinMsg) error {
	if s.room != nil {
		return h.violation(s, CodeInRoom, "already in a room")
	}
	r := h.rooms[m.Room]
	if r == nil {
		h.sendErr(s, CodeNoRoom, "no such room")
		return nil
	}
	team, err := r.Join(s, m.Password, m.Team)
	if err != nil {
		h.sendErr(s, joinCode(err), err.Error())
		if errors.Is(err, ErrBadPassword) {
			s.badPass++
			if s.badPass >= maxBadPass {
				return errors.New("too many wrong passwords")
			}
		}
		return nil
	}
	s.room = r
	h.afterJoin(s, r, team)
	return nil
}

func (h *Hub) afterJoin(s *Session, r *Room, team string) {
	s.Conn.Send(joinedMsg{T: "joined", Room: r.Info(), ID: s.ID, Team: team})
	s.Conn.Send(pickupsMsg{T: "pk", List: r.World.Pickups()})
	h.broadcastRoster(r)
}

func (h *Hub) leaveLocked(s *Session) {
	r := s.room
	if r == nil {
		return
	}
	s.room = nil
	if r.Leave(s.ID) {
		delete(h.rooms, r.ID)
		return
	}
	h.broadcastRoster(r)
}

func (h *Hub) broadcastRoster(r *Room) {
	msg := rosterMsg{T: "roster", Players: r.Roster(), Score: r.World.Score}
	for _, m := range r.members {
		m.Conn.Send(msg)
	}
	r.World.Dirty = false
}

// Tick steps every room once and broadcasts snapshots. A panic in one room is contained.
func (h *Hub) Tick() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, r := range h.rooms {
		h.stepRoom(r)
	}
	for id, left := range h.limbo { // players who never came back
		if left--; left > 0 {
			h.limbo[id] = left
			continue
		}
		if s := h.sessions[id]; s != nil {
			h.dropLocked(s)
		}
		delete(h.limbo, id)
	}
}

func (h *Hub) stepRoom(r *Room) {
	defer func() {
		if e := recover(); e != nil {
			log.Printf("panic in room %d tick: %v", r.ID, e)
		}
	}()
	r.World.Step()
	snap := r.World.Snapshot()
	for id, m := range r.members {
		s := snap
		s.You = r.World.SelfFor(id)
		m.Conn.Send(&s)
	}
	if r.World.Dirty {
		h.broadcastRoster(r)
	}
	if r.World.PickupsDirty {
		msg := pickupsMsg{T: "pk", List: r.World.Pickups()}
		for _, m := range r.members {
			m.Conn.Send(msg)
		}
		r.World.PickupsDirty = false
	}
}
