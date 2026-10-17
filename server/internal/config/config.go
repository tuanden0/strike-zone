// Package config loads server settings from environment variables.
package config

import (
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
)

// Config is the validated server configuration.
type Config struct {
	Host           string   // listen address
	Port           int      // listen port
	AllowedOrigins []string // extra WebSocket origins (lowercase scheme://host[:port])
	AdminToken     string   // empty = admin endpoint disabled
	MaxConnPerIP   int      // concurrent WebSocket connections per client IP
	UPnP           bool     // temporarily forward the port on the router while the server runs (opt-in)
	UPnPPort       int      // external port for UPnP (default = Port)
}

// Addr returns host:port suitable for net.Listen.
func (c Config) Addr() string { return net.JoinHostPort(c.Host, strconv.Itoa(c.Port)) }

// Load reads configuration via getenv. Any malformed value returns an error naming the variable.
func Load(getenv func(string) string) (Config, error) {
	c := Config{Host: "0.0.0.0", Port: 8080, MaxConnPerIP: 8}

	if v := strings.TrimSpace(getenv("HOST")); v != "" {
		if v != "localhost" {
			if _, err := netip.ParseAddr(v); err != nil {
				return c, fmt.Errorf("HOST %q: not an IP address or \"localhost\"", v)
			}
		}
		c.Host = v
	}
	if v := strings.TrimSpace(getenv("PORT")); v != "" {
		p, err := strconv.Atoi(v)
		if err != nil || p < 1 || p > 65535 {
			return c, fmt.Errorf("PORT %q: must be an integer in 1..65535", v)
		}
		c.Port = p
	}
	if v := strings.ToLower(strings.TrimSpace(getenv("UPNP"))); v != "" {
		switch v {
		case "1", "true", "yes", "on":
			c.UPnP = true
		case "0", "false", "no", "off":
		default:
			return c, fmt.Errorf("UPNP %q: use 1/true/yes/on or 0/false/no/off", v)
		}
	}
	c.UPnPPort = c.Port
	if v := strings.TrimSpace(getenv("UPNP_EXTERNAL_PORT")); v != "" {
		p, err := strconv.Atoi(v)
		if err != nil || p < 1 || p > 65535 {
			return c, fmt.Errorf("UPNP_EXTERNAL_PORT %q: must be an integer in 1..65535", v)
		}
		c.UPnPPort = p
	}
	if v := strings.TrimSpace(getenv("MAX_CONN_PER_IP")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 1000 {
			return c, fmt.Errorf("MAX_CONN_PER_IP %q: must be an integer in 1..1000", v)
		}
		c.MaxConnPerIP = n
	}
	if v := getenv("ALLOWED_ORIGINS"); strings.TrimSpace(v) != "" {
		for _, raw := range strings.Split(v, ",") {
			raw = strings.TrimSpace(raw)
			if raw == "" {
				continue
			}
			o, err := normalizeOrigin(raw)
			if err != nil {
				return c, fmt.Errorf("ALLOWED_ORIGINS entry %q: %w", raw, err)
			}
			c.AllowedOrigins = append(c.AllowedOrigins, o)
		}
	}
	if v := getenv("ADMIN_TOKEN"); v != "" {
		if len(v) < 16 {
			return c, fmt.Errorf("ADMIN_TOKEN: must be at least 16 characters")
		}
		for _, r := range v {
			if r <= ' ' || r > '~' {
				return c, fmt.Errorf("ADMIN_TOKEN: must be printable ASCII without spaces")
			}
		}
		c.AdminToken = v
	}
	return c, nil
}

func normalizeOrigin(s string) (string, error) {
	u, err := url.Parse(s)
	if err != nil {
		return "", err
	}
	if (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Hostname() == "" {
		return "", fmt.Errorf("must look like http://host[:port] or https://host[:port]")
	}
	if (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return "", fmt.Errorf("must not contain path, query or credentials")
	}
	if p := u.Port(); p != "" {
		if n, err := strconv.Atoi(p); err != nil || n < 1 || n > 65535 {
			return "", fmt.Errorf("invalid port")
		}
	}
	return strings.ToLower(u.Scheme + "://" + u.Host), nil
}
