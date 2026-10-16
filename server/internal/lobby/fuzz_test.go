package lobby

import (
	"encoding/json"
	"testing"

	"strikezone/server/internal/game"
)

// FuzzHandle feeds arbitrary bytes through the hub in every session state: it must never panic.
func FuzzHandle(f *testing.F) {
	seeds := []string{
		`{"t":"hello","nick":"a"}`, `{"t":"rooms"}`, `{"t":"ping","ts":1}`,
		`{"t":"create","name":"r","max":4,"timeLimit":300,"scoreLimit":20}`,
		`{"t":"join","room":1,"password":"x","team":"A"}`, `{"t":"team","team":"B"}`, `{"t":"leave"}`,
		`{"t":"in","seq":1,"f":1,"s":0,"yaw":0,"pitch":0,"fire":true,"weapon":-1}`,
		`{"t":"in","seq":"x"}`, `{"t":"in","f":1e999}`, `{"t":null}`, `[]`, `null`, `{}`, `{"t":"create","max":"4"}`,
		`{"t":"in","seq":4294967296}`, `{"t":"join","room":9007199254740993}`,
	}
	for _, s := range seeds {
		f.Add([]byte(s))
	}
	spec, m, err := game.LoadDefault()
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		h := NewHub(spec, m)
		host := &fakeConn{}
		hs, _ := h.Register(host)
		hello, _ := json.Marshal(map[string]any{"t": "hello", "nick": "h"})
		_ = h.Handle(hs, hello)
		_ = h.Handle(hs, []byte(`{"t":"create","name":"r","max":4,"timeLimit":300,"scoreLimit":20}`))
		for _, stage := range []int{0, 1, 2} {
			s, _ := h.Register(&fakeConn{})
			if stage >= 1 {
				_ = h.Handle(s, hello)
			}
			if stage == 2 {
				_ = h.Handle(s, []byte(`{"t":"join","room":1}`))
			}
			_ = h.Handle(s, data)
			_ = h.Handle(s, data)
			h.Tick()
			h.Unregister(s)
		}
	})
}
