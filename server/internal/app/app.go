// Package app wires HTTP routes: static client, health check (and later WebSocket).
package app

import (
	"net/http"

	"strikezone/client"
)

// NewHandler returns the root HTTP handler.
func NewHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.Handle("GET /", http.FileServerFS(client.FS))
	return secure(mux)
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
