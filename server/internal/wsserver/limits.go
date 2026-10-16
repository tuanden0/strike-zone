package wsserver

import (
	"sync"
	"time"
)

// Bucket is a token-bucket rate limiter. The caller supplies the clock (testable).
type Bucket struct {
	rate, burst float64
	tokens      float64
	last        time.Time
}

// NewBucket allows rate events/second with bursts up to burst.
func NewBucket(rate, burst float64) *Bucket {
	return &Bucket{rate: rate, burst: burst, tokens: burst}
}

// Allow consumes one token if available.
func (b *Bucket) Allow(now time.Time) bool {
	if !b.last.IsZero() {
		if dt := now.Sub(b.last).Seconds(); dt > 0 {
			b.tokens += dt * b.rate
			if b.tokens > b.burst {
				b.tokens = b.burst
			}
		}
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// IPLimiter caps concurrent connections per client IP.
type IPLimiter struct {
	mu  sync.Mutex
	max int
	n   map[string]int
}

// NewIPLimiter creates a limiter allowing max concurrent connections per IP.
func NewIPLimiter(max int) *IPLimiter { return &IPLimiter{max: max, n: map[string]int{}} }

// Acquire reserves a slot; false when ip is at its cap.
func (l *IPLimiter) Acquire(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.n[ip] >= l.max {
		return false
	}
	l.n[ip]++
	return true
}

// Release frees a slot obtained from Acquire.
func (l *IPLimiter) Release(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.n[ip] <= 1 {
		delete(l.n, ip)
		return
	}
	l.n[ip]--
}
