// Package app wires HTTP routes: static client, health check, WebSocket, admin stats.
package app

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"

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
	spec, gmap, err := game.LoadDefault()
	if err != nil {
		return nil, err
	}
	hub := lobby.NewHub(spec, gmap)
	ws := wsserver.New(hub, wsserver.Config{AllowedOrigins: cfg.AllowedOrigins, MaxConnPerIP: cfg.MaxConnPerIP})

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.Handle("GET /ws", ws)
	mux.HandleFunc("GET /admin/stats", adminStats(cfg.AdminToken, hub))
	mux.Handle("GET /", http.FileServerFS(client.FS))
	return &App{Handler: secure(mux), ws: ws}, nil
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
		_ = json.NewEncoder(w).Encode(hub.Stats())
	}
}

// secure adds defensive headers. CSP forbids inline script/style and third-party loads.
func secure(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Cache-Control", "no-cache")
		next.ServeHTTP(w, r)
	})
}
