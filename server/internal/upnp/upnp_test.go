package upnp

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// fakeIGD emulates a router: device description + SOAP control endpoint, recording the mappings.
type fakeIGD struct {
	mu       sync.Mutex
	mappings map[string]string // external port -> internal client
	actions  []string
	extIP    string
	refuse   bool
}

func newFakeIGD(t *testing.T) (*fakeIGD, *httptest.Server) {
	t.Helper()
	f := &fakeIGD{mappings: map[string]string{}, extIP: "203.0.113.7"}
	mux := http.NewServeMux()
	mux.HandleFunc("/desc.xml", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<?xml version="1.0"?><root><device><deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType>
<deviceList><device><deviceType>urn:schemas-upnp-org:device:WANDevice:1</deviceType><deviceList><device>
<deviceType>urn:schemas-upnp-org:device:WANConnectionDevice:1</deviceType><serviceList>
<service><serviceType>urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1</serviceType><controlURL>/nope</controlURL></service>
<service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/ip</controlURL></service>
</serviceList></device></deviceList></device></deviceList></device></root>`)
	})
	mux.HandleFunc("/ctl/ip", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		action := strings.Trim(strings.SplitN(r.Header.Get("SOAPAction"), "#", 2)[1], `"`)
		f.mu.Lock()
		defer f.mu.Unlock()
		f.actions = append(f.actions, action)
		if f.refuse {
			w.WriteHeader(500)
			fmt.Fprint(w, `<s:Envelope xmlns:s="x"><s:Body><s:Fault><detail><UPnPError><errorCode>718</errorCode><errorDescription>ConflictInMappingEntry</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`)
			return
		}
		var env struct {
			Body struct {
				Inner struct {
					Ext    string `xml:"NewExternalPort"`
					Client string `xml:"NewInternalClient"`
					Lease  string `xml:"NewLeaseDuration"`
				} `xml:",any"`
			} `xml:"Body"`
		}
		_ = xml.Unmarshal(body, &env)
		switch action {
		case "AddPortMapping":
			f.mappings[env.Body.Inner.Ext] = env.Body.Inner.Client
			fmt.Fprint(w, `<s:Envelope xmlns:s="x"><s:Body><u:AddPortMappingResponse xmlns:u="y"/></s:Body></s:Envelope>`)
		case "DeletePortMapping":
			delete(f.mappings, env.Body.Inner.Ext)
			fmt.Fprint(w, `<s:Envelope xmlns:s="x"><s:Body><u:DeletePortMappingResponse xmlns:u="y"/></s:Body></s:Envelope>`)
		case "GetExternalIPAddress":
			fmt.Fprintf(w, `<s:Envelope xmlns:s="x"><s:Body><u:GetExternalIPAddressResponse xmlns:u="y"><NewExternalIPAddress>%s</NewExternalIPAddress></u:GetExternalIPAddressResponse></s:Body></s:Envelope>`, f.extIP)
		default:
			w.WriteHeader(501)
		}
	})
	return f, httptest.NewServer(mux)
}

func TestMappingLifecycleOpenRenewCloseAgainstAFakeRouter(t *testing.T) {
	AllowLoopback = true
	defer func() { AllowLoopback = false }()
	f, srv := newFakeIGD(t)
	defer srv.Close()
	g, err := FromLocation(context.Background(), srv.URL+"/desc.xml")
	if err != nil {
		t.Fatal(err)
	}
	if g.service != "urn:schemas-upnp-org:service:WANIPConnection:1" || g.control.Path != "/ctl/ip" {
		t.Fatalf("picked the wrong service: %s %s", g.service, g.control)
	}
	m, err := OpenAt(context.Background(), g, 8080, 8080, "Strike Zone", nil)
	if err != nil {
		t.Fatal(err)
	}
	if m.External != "203.0.113.7" || !IsPublic(m.External) {
		t.Fatalf("external ip %q", m.External)
	}
	f.mu.Lock()
	if f.mappings["8080"] == "" {
		t.Fatal("router has no mapping after Open")
	}
	f.mu.Unlock()
	if err := m.Close(); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.mappings) != 0 {
		t.Fatalf("mapping still present after Close: %v", f.mappings)
	}
	if got := strings.Join(f.actions, ","); got != "AddPortMapping,GetExternalIPAddress,DeletePortMapping" {
		t.Fatalf("calls: %s", got)
	}
}

func TestRouterRefusalAndBadInputAreReported(t *testing.T) {
	AllowLoopback = true
	defer func() { AllowLoopback = false }()
	f, srv := newFakeIGD(t)
	defer srv.Close()
	f.refuse = true
	g, _ := FromLocation(context.Background(), srv.URL+"/desc.xml")
	err := g.AddPortMapping(context.Background(), 8080, 8080, "127.0.0.1", "x", 3600)
	if err == nil || !strings.Contains(err.Error(), "718") {
		t.Fatalf("a refused mapping must surface the router's error code: %v", err)
	}
	for name, a := range map[string]func() error{
		"port 0":          func() error { return g.AddPortMapping(context.Background(), 0, 80, "127.0.0.1", "x", 3600) },
		"short lease":     func() error { return g.AddPortMapping(context.Background(), 80, 80, "127.0.0.1", "x", 5) },
		"public internal": func() error { return g.AddPortMapping(context.Background(), 80, 80, "8.8.8.8", "x", 3600) },
	} {
		if a() == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestOnlyLanAddressesAreEverContacted(t *testing.T) {
	for _, loc := range []string{"http://8.8.8.8/desc.xml", "http://127.0.0.1:1/desc.xml", "https://192.168.1.1/desc.xml", "http://example.com/desc.xml", "http://[::1]/d.xml", "ftp://192.168.1.1/x"} {
		if _, err := FromLocation(context.Background(), loc); err == nil || !strings.Contains(err.Error(), "refusing") {
			t.Errorf("%s: want a refusal, got %v", loc, err)
		}
	}
	for _, ip := range []string{"10.0.0.1", "192.168.0.5", "172.16.3.4", "169.254.1.1"} {
		if !lanHost(ip) {
			t.Errorf("%s should count as LAN", ip)
		}
	}
	for _, ip := range []string{"8.8.8.8", "1.1.1.1", "127.0.0.1", "0.0.0.0", "not-an-ip"} {
		if lanHost(ip) {
			t.Errorf("%s must not count as LAN", ip)
		}
	}
}

func TestControlURLOnAnotherHostIsRefused(t *testing.T) {
	AllowLoopback = true
	defer func() { AllowLoopback = false }()
	mux := http.NewServeMux()
	mux.HandleFunc("/desc.xml", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<root><device><serviceList><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>http://8.8.8.8/ctl</controlURL></service></serviceList></device></root>`)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	if _, err := FromLocation(context.Background(), srv.URL+"/desc.xml"); err == nil || !strings.Contains(err.Error(), "refusing control URL") {
		t.Fatalf("a description pointing the control URL at the internet must be refused: %v", err)
	}
}

func TestIsPublicRejectsPrivateAndCGNAT(t *testing.T) {
	for ip, want := range map[string]bool{"203.0.113.7": true, "8.8.8.8": true, "192.168.1.5": false, "10.1.2.3": false, "100.64.1.1": false, "100.127.255.255": false, "100.128.0.1": true, "": false} {
		if IsPublic(ip) != want {
			t.Errorf("IsPublic(%q) = %v want %v", ip, !want, want)
		}
	}
}

func TestHeaderParsing(t *testing.T) {
	r := "HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=120\r\nLocation: http://192.168.1.1:5000/rootDesc.xml\r\nST: x\r\n\r\n"
	if got := headerValue(r, "LOCATION"); got != "http://192.168.1.1:5000/rootDesc.xml" {
		t.Fatalf("got %q", got)
	}
	if headerValue(r, "missing") != "" {
		t.Fatal("missing header")
	}
}
