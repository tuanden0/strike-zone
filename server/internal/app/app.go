// Package app wires HTTP routes: static client, health check, WebSocket, admin stats.
package app

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"strikezone/client"
	"strikezone/server/internal/config"
	"strikezone/server/internal/game"
	"strikezone/server/internal/lobby"
	"strikezone/server/internal/wsserver"
)

// App is the assembled server.
type App struct {
	Handler http.Handler
	ws      *wsserver.Server
}

// New builds the app from validated config.
func New(cfg config.Config) (*App, error) {
	spec, maps, err := game.LoadAll()
	if err != nil {
		return nil, err
	}
	return NewWithMaps(cfg, spec, maps), nil
}

// NewWith builds the app with explicit game data and a single map (tests use custom maps/specs).
func NewWith(cfg config.Config, spec *game.Spec, gmap *game.Map) *App {
	return NewWithMaps(cfg, spec, game.OneMap(gmap))
}

// NewWithMaps builds the app serving every map in the set.
func NewWithMaps(cfg config.Config, spec *game.Spec, maps *game.MapSet) *App {
	hub := lobby.NewHubMaps(spec, maps)
	ws := wsserver.New(hub, wsserver.Config{AllowedOrigins: cfg.AllowedOrigins, MaxConnPerIP: cfg.MaxConnPerIP})

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.Handle("GET /ws", ws)
	mux.HandleFunc("GET /admin/stats", adminStats(cfg.AdminToken, hub))
	mux.Handle("GET /", static(client.FS))
	return &App{Handler: secure(mux), ws: ws}
}

// static serves the embedded client. embed.FS files carry no modification time, so without help every reload would download the whole
// client again (about 10 MB, the map models are the bulk): answer If-Modified-Since with the time this process started (the client only
// changes with a new binary), which together with `Cache-Control: no-cache` makes the browser revalidate and get a 304. Directories are
// not listed.
func static(fsys fs.FS) http.Handler {
	files := http.FileServerFS(fsys)
	started := time.Now().UTC().Truncate(time.Second)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Last-Modified", started.Format(http.TimeFormat))
		if t, err := http.ParseTime(r.Header.Get("If-Modified-Since")); err == nil && !started.After(t) {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		files.ServeHTTP(w, r)
	})
}

// Run drives the game loop until ctx is done.
func (a *App) Run(ctx context.Context) { a.ws.Run(ctx) }

// Close disconnects all WebSocket clients.
func (a *App) Close() { a.ws.Close() }

func adminStats(token string, hub *lobby.Hub) http.HandlerFunc {
	want := sha256.Sum256([]byte(token))
	return func(w http.ResponseWriter, r *http.Request) {
		if token == "" { // disabled unless ADMIN_TOKEN is set
			http.NotFound(w, r)
			return
		}
		got := sha256.Sum256([]byte(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")))
		if subtle.ConstantTimeCompare(got[:], want[:]) != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(hub.Stats())
	}
}

// secure adds defensive headers. CSP forbids inline script/style and third-party loads.
func secure(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' blob: ws: wss:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Cache-Control", "no-cache")
		next.ServeHTTP(w, r)
	})
}
