// Package client embeds the static web client so the server is a single binary.
package client

import "embed"

// FS holds index.html, css/, js/, shared/ and vendor/.
//
//go:embed index.html css js shared vendor
var FS embed.FS
