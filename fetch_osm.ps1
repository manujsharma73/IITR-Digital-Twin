# Saves a local OSM snapshot (campus boundary + roads) into data\ so the twin
# does not depend on the public Overpass API at runtime.
# Usage: powershell -ExecutionPolicy Bypass -File fetch_osm.ps1
$ErrorActionPreference = 'Stop'
$dir = Join-Path $PSScriptRoot 'data'
New-Item -ItemType Directory -Force $dir | Out-Null

$queries = [ordered]@{
  'osm_boundary.json' = '[out:json][timeout:25];(way(52435788);relation(52435788););out geom;'
  'osm_roads.json'    = '[out:json][timeout:40];way["highway"~"^(primary|secondary|tertiary|unclassified|residential|service|living_street|pedestrian|footway|path|cycleway|track)$"](29.8598074,77.8894552,29.8728944,77.9029596);out geom;'
}
$mirrors = 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'
$headers = @{ 'User-Agent' = 'IITR-Digital-Twin/1.0'; 'Accept' = 'application/json' }

foreach ($name in $queries.Keys) {
  $done = $false
  foreach ($m in $mirrors) {
    try {
      $url = $m + '?data=' + [Uri]::EscapeDataString($queries[$name])
      $r = Invoke-WebRequest -Uri $url -Headers $headers -UseBasicParsing -TimeoutSec 90
      $n = ($r.Content | ConvertFrom-Json).elements.Count
      if ($n -lt 1) { throw 'empty result' }
      [IO.File]::WriteAllText((Join-Path $dir $name), $r.Content)
      Write-Host "$name : $n elements from $m" -ForegroundColor Green
      $done = $true; break
    } catch { Write-Host "  $m failed: $($_.Exception.Message)" -ForegroundColor Yellow }
  }
  if (-not $done) { Write-Host "$name could not be fetched. Try again later." -ForegroundColor Red }
  Start-Sleep -Seconds 3
}
Write-Host 'Data © OpenStreetMap contributors, ODbL 1.0'
