// Command server runs the Strike Zone game server and serves the embedded web client.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"strikezone/server/internal/app"
	"strikezone/server/internal/config"
	"strikezone/server/internal/netutil"
	"strikezone/server/internal/upnp"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("fatal: %v", err)
	}
}

func run() error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}
	ln, err := net.Listen("tcp", cfg.Addr())
	if err != nil {
		return fmt.Errorf("listen %s: %w", cfg.Addr(), err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	a, err := app.New(cfg)
	if err != nil {
		return fmt.Errorf("init: %w", err)
	}
	srv := &http.Server{
		Handler:           a.Handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      5 * time.Minute, // the map and character models are up to 3.4 MB each: a slow WAN uplink needs more than 30 s
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}

	ifs, err := netutil.System()
	if err != nil {
		log.Printf("warn: cannot list interfaces: %v", err)
	}
	log.Printf("Strike Zone listening on %s", ln.Addr())
	for _, u := range netutil.URLs(cfg.Host, cfg.Port, ifs) {
		log.Printf("  open: %s", u)
	}

	var internet chan *upnp.Mapping // result of the optional UPnP port forward
	if cfg.UPnP {
		internet = make(chan *upnp.Mapping, 1)
		go func() { internet <- openInternet(ctx, cfg) }()
	}

	go a.Run(ctx)
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
		log.Printf("shutting down")
	}
	if internet != nil { // take the port forward away again before anything else can fail
		if m := <-internet; m != nil {
			if err := m.Close(); err != nil {
				log.Printf("WARNING: could not remove the router port forward (%v): it expires by itself within an hour, or remove it in the router's UPnP/port-forwarding page", err)
			} else {
				log.Printf("router port %d closed again", cfg.UPnPPort)
			}
		}
	}
	a.Close() // closes WebSocket clients (http.Server.Shutdown does not track hijacked conns)
	sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(sctx); err != nil && !errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	return nil
}

// openInternet forwards cfg.UPnPPort on the router to this server and prints the public address. Failure is not fatal:
// the game keeps working on the LAN.
func openInternet(ctx context.Context, cfg config.Config) *upnp.Mapping {
	m, err := upnp.Open(ctx, cfg.UPnPPort, cfg.Port, "Strike Zone (temporary)", log.Printf)
	if err != nil {
		log.Printf("UPnP: could not open the port on the router: %v", err)
		log.Printf("UPnP: the game still works on the LAN; for internet play forward TCP port %d on the router yourself", cfg.Port)
		return nil
	}
	switch {
	case m.External == "":
		log.Printf("UPnP: port %d forwarded, but the router would not tell its public address", cfg.UPnPPort)
	case !upnp.IsPublic(m.External):
		log.Printf("UPnP: port forwarded, but the router's WAN address %s is private/CGNAT: players on the internet cannot reach it", m.External)
	default:
		log.Printf("INTERNET: http://%s:%d  (temporary port forward, removed when this server stops)", m.External, cfg.UPnPPort)
	}
	log.Printf("SECURITY: while the port is open anyone who knows the address can connect. Give your rooms a password; stop the server to close the port.")
	return m
}
