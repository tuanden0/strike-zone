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

	srv := &http.Server{
		Handler:           app.NewHandler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
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

	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
		log.Printf("shutting down")
	}
	sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(sctx); err != nil && !errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	return nil
}
