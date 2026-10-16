package app

import (
	"math"

	"strikezone/client"
)

func atan2(y, x float64) float64 { return math.Atan2(y, x) }
func hypot(a, b float64) float64 { return math.Hypot(a, b) }
func readSpec() ([]byte, error)  { return client.FS.ReadFile("shared/spec.json") }
