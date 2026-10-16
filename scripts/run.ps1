# Build and run Strike Zone on Windows. Prints the LAN URLs to share. Loads .env if present.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (Test-Path .env) {
  Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$' -and -not $_.TrimStart().StartsWith('#')) {
      [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim('"'), 'Process')
    }
  }
}
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
  Write-Error 'Go is not installed. Install it from https://go.dev/dl/ or run a prebuilt binary from dist\.'
}

New-Item -ItemType Directory -Force dist | Out-Null
go build -trimpath -o dist\strike-zone.exe .\server
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& .\dist\strike-zone.exe
