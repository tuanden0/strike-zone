#!/usr/bin/env bash
# Pre-commit gate: format, vet, race tests, gitleaks (tree + history), govulncheck.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PATH:$(go env GOPATH)/bin"

echo "== gofmt";  test -z "$(gofmt -l server client)" || { gofmt -l server client; echo "gofmt needed"; exit 1; }
echo "== vet";    go vet ./...
echo "== test";   go test -race -count=1 ./...
echo "== run.sh --open-port (stub firewall)"; bash scripts/test-run.sh | tail -8
echo "== gitleaks"
if command -v gitleaks >/dev/null; then
  gitleaks dir . --no-banner --redact
  if git rev-parse --verify HEAD >/dev/null 2>&1; then gitleaks git . --no-banner --redact; fi
else
  echo "gitleaks missing: install with 'go install github.com/zricethezav/gitleaks/v8@latest'"; exit 1
fi
echo "== govulncheck"
if command -v govulncheck >/dev/null; then
  out=$(govulncheck ./... 2>&1) && rc=0 || rc=$?
  echo "$out"
  if [ "$rc" -ne 0 ]; then
    # Vulnerability DB (vuln.go.dev) can be unreachable in sandboxes: report loudly, do not pass silently.
    if echo "$out" | grep -q "fetching vulnerabilities"; then echo "WARNING: govulncheck SKIPPED (vuln DB unreachable)"; else exit "$rc"; fi
  fi
else echo "govulncheck missing"; exit 1; fi
echo "ALL OK"
