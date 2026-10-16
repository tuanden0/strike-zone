// Package netutil lists LAN-reachable addresses for the startup banner.
package netutil

import (
	"fmt"
	"net"
	"net/netip"
	"sort"
	"strconv"
)

// Iface is a minimal view of net.Interface so selection logic is testable.
type Iface struct {
	Name     string
	Up       bool
	Loopback bool
	Addrs    []net.Addr
}

// System returns the machine's interfaces.
func System() ([]Iface, error) {
	nis, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	out := make([]Iface, 0, len(nis))
	for _, ni := range nis {
		addrs, err := ni.Addrs()
		if err != nil {
			continue // skip: interface vanished or unreadable, not fatal for a banner
		}
		out = append(out, Iface{
			Name:     ni.Name,
			Up:       ni.Flags&net.FlagUp != 0,
			Loopback: ni.Flags&net.FlagLoopback != 0,
			Addrs:    addrs,
		})
	}
	return out, nil
}

// PrivateIPv4s returns sorted unique RFC1918 (10/8, 172.16/12, 192.168/16) addresses of up,
// non-loopback interfaces.
func PrivateIPv4s(ifs []Iface) []string {
	seen := map[string]bool{}
	for _, ifc := range ifs {
		if !ifc.Up || ifc.Loopback {
			continue
		}
		for _, a := range ifc.Addrs {
			var ip net.IP
			switch v := a.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip4 := ip.To4(); ip4 != nil && ip4.IsPrivate() && !ip4.IsLoopback() {
				seen[ip4.String()] = true
			}
		}
	}
	out := make([]string, 0, len(seen))
	for s := range seen {
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}

// URLs lists every URL a player can open for a server listening on host:port.
func URLs(host string, port int, ifs []Iface) []string {
	p := strconv.Itoa(port)
	u := func(h string) string { return fmt.Sprintf("http://%s", net.JoinHostPort(h, p)) }
	if host == "" || host == "localhost" {
		return []string{u("localhost")}
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return []string{u(host)}
	}
	switch {
	case addr.IsUnspecified():
		urls := []string{u("localhost")}
		for _, ip := range PrivateIPv4s(ifs) {
			urls = append(urls, u(ip))
		}
		return urls
	case addr.IsLoopback():
		return []string{u("localhost")}
	default:
		return []string{u(host)}
	}
}
