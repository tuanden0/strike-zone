# Build and run Strike Zone on Windows. Prints the LAN URLs to share. Loads .env if present.
#   .\scripts\run.ps1               LAN only
#   .\scripts\run.ps1 -OpenPort     also open the port for the internet while the server runs and close it when it stops:
#                                    UPnP forward on the router (done and removed by the server) + a temporary Windows Firewall rule
#                                    (needs an elevated PowerShell). Anyone who knows the address can connect: use room passwords.
param([switch]$OpenPort)
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
$port = if ($env:PORT) { $env:PORT } else { '8080' }
$rule = 'Strike Zone (temporary)'
$ruleAdded = $false
if ($OpenPort -or $env:OPEN_PORT -eq '1') {
  Write-Host "== opening port $port temporarily (stops when the server stops). Anyone with the address can connect: use room passwords."
  $env:UPNP = '1'
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) {
    Write-Warning "Not running as Administrator: the Windows Firewall rule was NOT added (UPnP still is). Run an elevated PowerShell, or: netsh advfirewall firewall add rule name=`"$rule`" dir=in action=allow protocol=TCP localport=$port"
  } else {
    netsh advfirewall firewall delete rule name="$rule" | Out-Null   # leftover from a crashed run
    netsh advfirewall firewall add rule name="$rule" dir=in action=allow protocol=TCP localport=$port profile=any | Out-Null
    if ($LASTEXITCODE -eq 0) { $ruleAdded = $true; Write-Host "firewall: opened $port/tcp until the server stops" }
  }
}
try {
  & .\dist\strike-zone.exe
} finally {
  if ($ruleAdded) {
    netsh advfirewall firewall delete rule name="$rule" | Out-Null
    Write-Host "firewall: closed again ($rule)"
  }
}
