// Package client embeds the static web client so the server is a single binary.
package client

import "embed"

// FS holds index.html, css/, js/, shared/, vendor/ and assets/ (generated .glb models).
//
//go:embed index.html css js shared vendor assets
var FS embed.FS
