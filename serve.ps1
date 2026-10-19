# Minimal static file server for the IITR Digital Twin (no Node/Python needed).
# Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8080] [-NoBrowser]
param([int]$Port = 8080, [switch]$NoBrowser)

$root = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() }
catch { Write-Host "Could not listen on port $Port. Try: .\serve.ps1 -Port 8090" -ForegroundColor Red; exit 1 }

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.geojson' = 'application/geo+json'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
  '.glb' = 'model/gltf-binary'; '.gltf' = 'model/gltf+json'; '.czml' = 'application/json'; '.md' = 'text/plain; charset=utf-8'
}

Write-Host "IITR Digital Twin running at http://localhost:$Port/   (Ctrl+C to stop)" -ForegroundColor Cyan
if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
      if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
      $path = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
      if (-not $path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $res.StatusCode = 404
        $bytes = [Text.Encoding]::UTF8.GetBytes('Not found')
      } else {
        $ext = [IO.Path]::GetExtension($path).ToLower()
        $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $res.Headers.Add('Cache-Control', 'no-cache')
        $bytes = [IO.File]::ReadAllBytes($path)
      }
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch { $res.StatusCode = 500 }
    finally { $res.OutputStream.Close() }
  }
} finally { $listener.Stop() }
