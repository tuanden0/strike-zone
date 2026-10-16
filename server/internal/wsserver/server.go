// Package wsserver is the network layer: origin check, limits, timeouts, WebSocket <-> lobby.Hub.
package wsserver

import (
	"context"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"

	"strikezone/server/internal/lobby"
)

// Tunables. Message sizes: an input is ~150 bytes, create ~250.
const (
	ReadLimit    = 4096
	IdleTimeout  = 30 * time.Second // client pings every few seconds
	WriteTimeout = 5 * time.Second
	SendQueue    = 64
	MsgRate      = 80.0 // sustained messages/s per connection (inputs are ~30/s)
	MsgBurst     = 120.0
	maxRateDrops = 200 // dropped (rate-limited) messages before disconnect
	TickInterval = time.Second / 30
)

// Config is the subset of server config the network layer needs.
type Config struct {
	AllowedOrigins []string
	MaxConnPerIP   int
}

// Server serves /ws.
type Server struct {
	hub  *lobby.Hub
	cfg  Config
	ips  *IPLimiter
	base context.Context
	stop context.CancelFunc
	wg   sync.WaitGroup
}

// New creates a Server bound to hub.
func New(hub *lobby.Hub, cfg Config) *Server {
	ctx, cancel := context.WithCancel(context.Background())
	return &Server{hub: hub, cfg: cfg, ips: NewIPLimiter(cfg.MaxConnPerIP), base: ctx, stop: cancel}
}

// Run drives the 30 Hz simulation until ctx ends.
func (s *Server) Run(ctx context.Context) {
	t := time.NewTicker(TickInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.hub.Tick()
		}
	}
}

// Close disconnects every client and waits for handlers to finish.
func (s *Server) Close() {
	s.stop()
	s.wg.Wait()
}

type wsConn struct {
	out    chan []byte
	cancel context.CancelFunc
}

// Send implements lobby.Conn: marshal now, enqueue without blocking; slow clients are dropped.
func (c *wsConn) Send(v any) bool {
	b, err := json.Marshal(v)
	if err != nil {
		log.Printf("marshal: %v", err)
		return true
	}
	select {
	case c.out <- b:
		return true
	default:
		c.cancel() // queue full: client cannot keep up
		return false
	}
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// ServeHTTP upgrades /ws requests.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !CheckOrigin(r.Header.Get("Origin"), r.Host, s.cfg.AllowedOrigins) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	ip := clientIP(r)
	if !s.ips.Acquire(ip) {
		http.Error(w, "too many connections from this address", http.StatusTooManyRequests)
		return
	}
	defer s.ips.Release(ip)

	// Origin was validated above with our own same-origin rule, so the library's check is skipped.
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
		CompressionMode:    websocket.CompressionDisabled,
	})
	if err != nil {
		return // Accept already replied
	}
	s.wg.Add(1)
	defer s.wg.Done()
	c.SetReadLimit(ReadLimit)

	ctx, cancel := context.WithCancel(context.Background()) // not a child of base: shutdown closes explicitly
	defer cancel()
	conn := &wsConn{out: make(chan []byte, SendQueue), cancel: cancel}

	// A panic anywhere in this connection must not take the server down.
	defer func() {
		if e := recover(); e != nil {
			log.Printf("panic in connection from %s: %v", ip, e)
			_ = c.Close(websocket.StatusInternalError, "internal error")
		}
	}()

	sess, err := s.hub.Register(conn)
	if err != nil {
		_ = c.Close(websocket.StatusTryAgainLater, "server full")
		return
	}
	defer s.hub.Unregister(sess)

	// Cancelling a Read context kills the socket without a close frame, so shutdown closes explicitly.
	shutdownClosed := make(chan struct{})
	go func() {
		defer close(shutdownClosed)
		select {
		case <-s.base.Done():
			_ = c.Close(websocket.StatusGoingAway, "server shutting down")
		case <-ctx.Done():
		}
	}()

	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		defer func() {
			if e := recover(); e != nil {
				log.Printf("panic in writer for %s: %v", ip, e)
				cancel()
			}
		}()
		for {
			select {
			case <-ctx.Done():
				return
			case msg := <-conn.out:
				wctx, wcancel := context.WithTimeout(ctx, WriteTimeout)
				err := c.Write(wctx, websocket.MessageText, msg)
				wcancel()
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()

	closeCode, closeReason := websocket.StatusNormalClosure, ""
	limiter := NewBucket(MsgRate, MsgBurst)
	drops := 0
loop:
	for {
		rctx, rcancel := context.WithTimeout(ctx, IdleTimeout)
		typ, data, err := c.Read(rctx)
		rcancel()
		if err != nil {
			closeCode = -1 // peer gone, timeout or shutdown (already closed): nothing more to say
			break
		}
		if typ != websocket.MessageText {
			closeCode, closeReason = websocket.StatusUnsupportedData, "text frames only"
			break
		}
		if !limiter.Allow(time.Now()) {
			drops++
			if drops >= maxRateDrops {
				closeCode, closeReason = websocket.StatusPolicyViolation, "rate limit exceeded"
				break loop
			}
			continue
		}
		if err := s.hub.Handle(sess, data); err != nil {
			closeCode, closeReason = websocket.StatusPolicyViolation, "protocol violation"
			break
		}
	}
	if s.base.Err() != nil {
		<-shutdownClosed // let the going-away close frame reach the peer before the socket is dropped
	}
	cancel()
	<-writerDone
	if closeCode == -1 {
		_ = c.CloseNow()
	} else {
		_ = c.Close(closeCode, closeReason)
	}
}
