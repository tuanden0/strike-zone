package wsserver

import (
	"net/url"
	"strings"
)

// CheckOrigin implements the WebSocket origin policy:
//   - no Origin header (non-browser client): allowed; CSWSH is a browser-only attack.
//   - Origin host:port equals the request Host: allowed (works for localhost and any LAN IP).
//   - Origin listed in allowed (lowercase scheme://host[:port]): allowed.
//   - anything else, including "null": rejected.
func CheckOrigin(origin, requestHost string, allowed []string) bool {
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	if strings.EqualFold(u.Host, requestHost) {
		return true
	}
	o := strings.ToLower(u.Scheme + "://" + u.Host)
	for _, a := range allowed {
		if o == a {
			return true
		}
	}
	return false
}
