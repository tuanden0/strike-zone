package config

import (
	"strings"
	"testing"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestDefaults(t *testing.T) {
	c, err := Load(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.Host != "0.0.0.0" || c.Port != 8080 || c.MaxConnPerIP != 8 || c.AdminToken != "" || len(c.AllowedOrigins) != 0 {
		t.Fatalf("bad defaults: %+v", c)
	}
	if c.Addr() != "0.0.0.0:8080" {
		t.Fatalf("addr %q", c.Addr())
	}
}

func TestValid(t *testing.T) {
	c, err := Load(env(map[string]string{
		"HOST": "127.0.0.1", "PORT": "9000", "MAX_CONN_PER_IP": "3",
		"ALLOWED_ORIGINS": "http://Game.LAN:8080/, https://x.example ,",
		"ADMIN_TOKEN":     "0123456789abcdef",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if c.Host != "127.0.0.1" || c.Port != 9000 || c.MaxConnPerIP != 3 || c.AdminToken != "0123456789abcdef" {
		t.Fatalf("%+v", c)
	}
	want := []string{"http://game.lan:8080", "https://x.example"}
	if len(c.AllowedOrigins) != 2 || c.AllowedOrigins[0] != want[0] || c.AllowedOrigins[1] != want[1] {
		t.Fatalf("origins %v", c.AllowedOrigins)
	}
	if c, _ = Load(env(map[string]string{"HOST": "::1", "PORT": "1"})); c.Addr() != "[::1]:1" {
		t.Fatalf("v6 addr %q", c.Addr())
	}
}

func TestInvalid(t *testing.T) {
	cases := map[string]map[string]string{
		"HOST":              {"HOST": "not an ip"},
		"PORT":              {"PORT": "abc"},
		"PORT ":             {"PORT": "70000"},
		"PORT  ":            {"PORT": "0"},
		"MAX_CONN_PER_IP":   {"MAX_CONN_PER_IP": "-1"},
		"ALLOWED_ORIGINS":   {"ALLOWED_ORIGINS": "ftp://a"},
		"ALLOWED_ORIGINS ":  {"ALLOWED_ORIGINS": "http://a/path"},
		"ALLOWED_ORIGINS  ": {"ALLOWED_ORIGINS": "just-a-host"},
		"ADMIN_TOKEN":       {"ADMIN_TOKEN": "short"},
		"ADMIN_TOKEN ":      {"ADMIN_TOKEN": "has space in token!!"},
	}
	for name, m := range cases {
		_, err := Load(env(m))
		if err == nil {
			t.Errorf("%s %v: expected error", name, m)
			continue
		}
		if !strings.Contains(err.Error(), strings.TrimSpace(name)) {
			t.Errorf("error %q should name %s", err, name)
		}
	}
}

func TestUPnPSettings(t *testing.T) {
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	c, err := Load(env(map[string]string{"PORT": "9000", "UPNP": "yes"}))
	if err != nil || !c.UPnP || c.UPnPPort != 9000 {
		t.Fatalf("UPNP=yes: %+v %v", c, err)
	}
	c, err = Load(env(map[string]string{"UPNP": "1", "UPNP_EXTERNAL_PORT": "28080"}))
	if err != nil || c.UPnPPort != 28080 || c.Port != 8080 {
		t.Fatalf("external port: %+v %v", c, err)
	}
	if c, err = Load(env(nil)); err != nil || c.UPnP {
		t.Fatalf("UPnP must be off by default: %+v %v", c, err)
	}
	for _, bad := range []map[string]string{{"UPNP": "maybe"}, {"UPNP_EXTERNAL_PORT": "0"}, {"UPNP_EXTERNAL_PORT": "70000"}, {"UPNP_EXTERNAL_PORT": "x"}} {
		if _, err := Load(env(bad)); err == nil {
			t.Errorf("%v accepted", bad)
		}
	}
}
