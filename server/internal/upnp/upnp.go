// Package upnp opens (and closes) one TCP port on the home router through UPnP IGD, using only the standard library.
// It exists so the game can be reachable from the internet while the server runs and stop being reachable the moment it exits.
//
// Safety rules: only LAN addresses are ever contacted (the SSDP reply and the control URL must be private/link-local IPs, so a
// spoofed reply cannot make the server talk to the internet or to localhost), responses are size-limited, and every mapping
// carries a lease so the router forgets it even if the process is killed.
package upnp

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// AllowLoopback lets tests talk to 127.0.0.1 fakes. Never set in production code.
var AllowLoopback = false

const (
	ssdpAddr = "239.255.255.250:1900"
	maxBody  = 1 << 20
)

var searchTargets = []string{
	"urn:schemas-upnp-org:device:InternetGatewayDevice:2",
	"urn:schemas-upnp-org:device:InternetGatewayDevice:1",
	"urn:schemas-upnp-org:service:WANIPConnection:1",
}

// Gateway is a discovered router control point.
type Gateway struct {
	control  *url.URL
	service  string // e.g. urn:schemas-upnp-org:service:WANIPConnection:1
	client   *http.Client
	LocalIP  string // our address on the network that reaches the gateway
	Location string
}

func lanHost(host string) bool {
	ip, err := netip.ParseAddr(host)
	if err != nil {
		return false
	}
	ip = ip.Unmap()
	return ip.IsPrivate() || ip.IsLinkLocalUnicast() || (AllowLoopback && ip.IsLoopback())
}

// Discover finds the router with SSDP (multicast on the LAN). It returns the first gateway that answers within timeout.
func Discover(ctx context.Context, timeout time.Duration) (*Gateway, error) {
	conn, err := net.ListenPacket("udp4", ":0")
	if err != nil {
		return nil, fmt.Errorf("upnp: open udp socket: %w", err)
	}
	defer conn.Close()
	dst, err := net.ResolveUDPAddr("udp4", ssdpAddr)
	if err != nil {
		return nil, err
	}
	for _, st := range searchTargets {
		msg := "M-SEARCH * HTTP/1.1\r\nHOST: " + ssdpAddr + "\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: " + st + "\r\n\r\n"
		if _, err := conn.WriteTo([]byte(msg), dst); err != nil {
			return nil, fmt.Errorf("upnp: send search: %w", err)
		}
	}
	deadline := time.Now().Add(timeout)
	buf := make([]byte, 4096)
	seen := map[string]bool{}
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		n, from, err := conn.ReadFrom(buf)
		if err != nil {
			var ne net.Error
			if errors.As(err, &ne) && ne.Timeout() {
				continue
			}
			return nil, err
		}
		loc := headerValue(string(buf[:n]), "location")
		if loc == "" || seen[loc] {
			continue
		}
		seen[loc] = true
		if host, _, err := net.SplitHostPort(from.String()); err != nil || !lanHost(host) {
			continue
		}
		if g, err := FromLocation(ctx, loc); err == nil {
			return g, nil
		}
	}
	return nil, errors.New("upnp: no gateway answered (UPnP disabled on the router, or not on the home network)")
}

func headerValue(resp, name string) string {
	for _, line := range strings.Split(resp, "\r\n") {
		if k, v, ok := strings.Cut(line, ":"); ok && strings.EqualFold(strings.TrimSpace(k), name) {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

type xmlService struct {
	Type    string `xml:"serviceType"`
	Control string `xml:"controlURL"`
}

type xmlDevice struct {
	Services []xmlService `xml:"serviceList>service"`
	Devices  []xmlDevice  `xml:"deviceList>device"`
}

type xmlRoot struct {
	URLBase string    `xml:"URLBase"`
	Device  xmlDevice `xml:"device"`
}

func findService(d xmlDevice) *xmlService {
	for i := range d.Services {
		if t := d.Services[i].Type; strings.Contains(t, ":WANIPConnection:") || strings.Contains(t, ":WANPPPConnection:") {
			return &d.Services[i]
		}
	}
	for _, c := range d.Devices {
		if s := findService(c); s != nil {
			return s
		}
	}
	return nil
}

// FromLocation reads the device description at loc and returns the gateway it describes.
func FromLocation(ctx context.Context, loc string) (*Gateway, error) {
	u, err := url.Parse(loc)
	if err != nil || u.Scheme != "http" || !lanHost(u.Hostname()) {
		return nil, fmt.Errorf("upnp: refusing description URL %q (must be http on a LAN address)", loc)
	}
	client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, loc, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("upnp: fetch description: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("upnp: description HTTP %d", resp.StatusCode)
	}
	var root xmlRoot
	if err := xml.NewDecoder(io.LimitReader(resp.Body, maxBody)).Decode(&root); err != nil {
		return nil, fmt.Errorf("upnp: parse description: %w", err)
	}
	svc := findService(root.Device)
	if svc == nil {
		return nil, errors.New("upnp: device has no WANIPConnection/WANPPPConnection service")
	}
	base := u
	if root.URLBase != "" {
		if b, err := url.Parse(root.URLBase); err == nil {
			base = b
		}
	}
	ctl, err := base.Parse(svc.Control)
	if err != nil || ctl.Scheme != "http" || !lanHost(ctl.Hostname()) {
		return nil, fmt.Errorf("upnp: refusing control URL %q", svc.Control)
	}
	local := ""
	if c, err := net.Dial("udp4", net.JoinHostPort(ctl.Hostname(), "9")); err == nil {
		if a, ok := c.LocalAddr().(*net.UDPAddr); ok {
			local = a.IP.String()
		}
		c.Close()
	}
	return &Gateway{control: ctl, service: svc.Type, client: client, LocalIP: local, Location: loc}, nil
}

// faultError is a SOAP fault returned by the router (UPnP error codes: 714 = no such mapping).
type faultError struct{ action, code, desc string }

func (e *faultError) Error() string {
	return fmt.Sprintf("upnp %s refused: error %s %s", e.action, e.code, e.desc)
}

type soapFault struct {
	Code string `xml:"Body>Fault>detail>UPnPError>errorCode"`
	Desc string `xml:"Body>Fault>detail>UPnPError>errorDescription"`
}

func (g *Gateway) call(ctx context.Context, action string, args [][2]string) ([]byte, error) {
	var b bytes.Buffer
	b.WriteString(`<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>`)
	fmt.Fprintf(&b, `<u:%s xmlns:u="%s">`, action, g.service)
	for _, a := range args {
		fmt.Fprintf(&b, "<%s>", a[0])
		xml.EscapeText(&b, []byte(a[1]))
		fmt.Fprintf(&b, "</%s>", a[0])
	}
	fmt.Fprintf(&b, `</u:%s></s:Body></s:Envelope>`, action)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.control.String(), &b)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", `text/xml; charset="utf-8"`)
	req.Header.Set("SOAPAction", `"`+g.service+"#"+action+`"`)
	resp, err := g.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("upnp %s: %w", action, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	if resp.StatusCode != http.StatusOK {
		var f soapFault
		if xml.Unmarshal(body, &f) == nil && f.Code != "" {
			return nil, &faultError{action: action, code: f.Code, desc: f.Desc}
		}
		return nil, fmt.Errorf("upnp %s: HTTP %d", action, resp.StatusCode)
	}
	return body, nil
}

// ExternalIP asks the router for its public address.
func (g *Gateway) ExternalIP(ctx context.Context) (string, error) {
	body, err := g.call(ctx, "GetExternalIPAddress", nil)
	if err != nil {
		return "", err
	}
	var r struct {
		IP string `xml:"Body>GetExternalIPAddressResponse>NewExternalIPAddress"`
	}
	if err := xml.Unmarshal(body, &r); err != nil || r.IP == "" {
		return "", errors.New("upnp: router returned no external address")
	}
	return strings.TrimSpace(r.IP), nil
}

// AddPortMapping forwards TCP extPort on the router to internalIP:intPort for leaseSec seconds.
func (g *Gateway) AddPortMapping(ctx context.Context, extPort, intPort int, internalIP, desc string, leaseSec int) error {
	if extPort < 1 || extPort > 65535 || intPort < 1 || intPort > 65535 || leaseSec < 60 {
		return errors.New("upnp: bad port or lease")
	}
	if ip, err := netip.ParseAddr(internalIP); err != nil || !(ip.IsPrivate() || ip.IsLinkLocalUnicast() || (AllowLoopback && ip.IsLoopback())) {
		return fmt.Errorf("upnp: internal address %q is not a LAN address", internalIP)
	}
	_, err := g.call(ctx, "AddPortMapping", [][2]string{
		{"NewRemoteHost", ""}, {"NewExternalPort", strconv.Itoa(extPort)}, {"NewProtocol", "TCP"},
		{"NewInternalPort", strconv.Itoa(intPort)}, {"NewInternalClient", internalIP}, {"NewEnabled", "1"},
		{"NewPortMappingDescription", desc}, {"NewLeaseDuration", strconv.Itoa(leaseSec)},
	})
	return err
}

// DeletePortMapping removes the forward. A mapping that is already gone is not an error worth failing shutdown for.
func (g *Gateway) DeletePortMapping(ctx context.Context, extPort int) error {
	_, err := g.call(ctx, "DeletePortMapping", [][2]string{{"NewRemoteHost", ""}, {"NewExternalPort", strconv.Itoa(extPort)}, {"NewProtocol", "TCP"}})
	var f *faultError
	if errors.As(err, &f) && f.code == "714" {
		return nil // NoSuchEntryInArray: the lease already expired or the router dropped it
	}
	return err
}

// IsPublic reports whether an address returned by ExternalIP can be reached from the internet (false for private, CGNAT 100.64/10).
func IsPublic(ip string) bool {
	a, err := netip.ParseAddr(ip)
	if err != nil {
		return false
	}
	a = a.Unmap()
	cgnat := netip.MustParsePrefix("100.64.0.0/10")
	return a.IsGlobalUnicast() && !a.IsPrivate() && !cgnat.Contains(a)
}

// Mapping keeps one port forwarded while the server runs: it adds it, renews it halfway through the lease and removes it on Close.
type Mapping struct {
	g        *Gateway
	ext, in  int
	desc     string
	lease    int
	cancel   context.CancelFunc
	done     chan struct{}
	External string
}

const defaultLease = 3600

// Open discovers the router, maps extPort -> intPort and starts the renewal loop. The caller must call Close.
func Open(ctx context.Context, extPort, intPort int, desc string, logf func(string, ...any)) (*Mapping, error) {
	g, err := Discover(ctx, 4*time.Second)
	if err != nil {
		return nil, err
	}
	return OpenAt(ctx, g, extPort, intPort, desc, logf)
}

// OpenAt is Open for an already discovered gateway (also used by tests).
func OpenAt(ctx context.Context, g *Gateway, extPort, intPort int, desc string, logf func(string, ...any)) (*Mapping, error) {
	if g.LocalIP == "" {
		return nil, errors.New("upnp: cannot determine the local address that reaches the router")
	}
	if err := g.AddPortMapping(ctx, extPort, intPort, g.LocalIP, desc, defaultLease); err != nil {
		return nil, err
	}
	m := &Mapping{g: g, ext: extPort, in: intPort, desc: desc, lease: defaultLease, done: make(chan struct{})}
	if ip, err := g.ExternalIP(ctx); err == nil {
		m.External = ip
	}
	rctx, cancel := context.WithCancel(context.Background())
	m.cancel = cancel
	go func() {
		defer close(m.done)
		t := time.NewTicker(time.Duration(m.lease/2) * time.Second)
		defer t.Stop()
		for {
			select {
			case <-rctx.Done():
				return
			case <-t.C:
				c, cc := context.WithTimeout(rctx, 5*time.Second)
				if err := g.AddPortMapping(c, extPort, intPort, g.LocalIP, desc, m.lease); err != nil && logf != nil {
					logf("upnp: renewing the port forward failed: %v", err)
				}
				cc()
			}
		}
	}()
	return m, nil
}

// Close stops renewing and removes the forward from the router.
func (m *Mapping) Close() error {
	m.cancel()
	<-m.done
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return m.g.DeletePortMapping(ctx, m.ext)
}
