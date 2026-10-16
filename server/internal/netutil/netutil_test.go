package netutil

import (
	"net"
	"reflect"
	"testing"
)

func cidr(s string) net.Addr {
	ip, n, err := net.ParseCIDR(s)
	if err != nil {
		panic(err)
	}
	n.IP = ip
	return n
}

var fixture = []Iface{
	{Name: "lo", Up: true, Loopback: true, Addrs: []net.Addr{cidr("127.0.0.1/8")}},
	{Name: "eth0", Up: true, Addrs: []net.Addr{cidr("192.168.1.20/24"), cidr("fe80::1/64"), cidr("8.8.4.4/24")}},
	{Name: "wlan0", Up: true, Addrs: []net.Addr{cidr("10.1.2.3/8"), &net.IPAddr{IP: net.ParseIP("172.16.5.5")}}},
	{Name: "down0", Up: false, Addrs: []net.Addr{cidr("192.168.9.9/24")}},
	{Name: "edge", Up: true, Addrs: []net.Addr{cidr("172.15.0.1/16"), cidr("172.32.0.1/16"), cidr("172.31.255.1/16"), cidr("169.254.1.1/16"), cidr("192.168.1.20/24")}},
}

func TestPrivateIPv4s(t *testing.T) {
	got := PrivateIPv4s(fixture)
	want := []string{"10.1.2.3", "172.16.5.5", "172.31.255.1", "192.168.1.20"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
	if len(PrivateIPv4s(nil)) != 0 {
		t.Fatal("nil input should give empty")
	}
}

func TestURLs(t *testing.T) {
	got := URLs("0.0.0.0", 8080, fixture)
	want := []string{"http://localhost:8080", "http://10.1.2.3:8080", "http://172.16.5.5:8080", "http://172.31.255.1:8080", "http://192.168.1.20:8080"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v", got)
	}
	if got := URLs("127.0.0.1", 9, fixture); !reflect.DeepEqual(got, []string{"http://localhost:9"}) {
		t.Fatalf("loopback: %v", got)
	}
	if got := URLs("192.168.1.20", 9, fixture); !reflect.DeepEqual(got, []string{"http://192.168.1.20:9"}) {
		t.Fatalf("specific: %v", got)
	}
	if got := URLs("::", 9, nil); !reflect.DeepEqual(got, []string{"http://localhost:9"}) {
		t.Fatalf("v6 wildcard: %v", got)
	}
}
