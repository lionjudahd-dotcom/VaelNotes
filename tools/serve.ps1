# Serves the docs folder at http://localhost:8765/ for local testing.
# Run:  powershell -ExecutionPolicy Bypass -File tools\serve.ps1     (Ctrl+C to stop)
$root = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) 'docs'
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.json'='application/json'; '.webmanifest'='application/manifest+json'; '.png'='image/png'; '.svg'='image/svg+xml' }
$l = New-Object System.Net.HttpListener; $l.Prefixes.Add('http://localhost:8765/'); $l.Start()
"Serving $root at http://localhost:8765/"
try {
  while ($l.IsListening) {
    $c = $l.GetContext(); $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath).TrimStart('/'); if (-not $p) { $p = 'index.html' }
    $f = [System.IO.Path]::GetFullPath((Join-Path $root $p))
    if ($f.StartsWith($root) -and (Test-Path $f -PathType Leaf)) {
      $b = [System.IO.File]::ReadAllBytes($f); $t = $types[[System.IO.Path]::GetExtension($f).ToLower()]; if ($t) { $c.Response.ContentType = $t }
      $c.Response.Headers.Add('Cache-Control', 'no-store'); $c.Response.OutputStream.Write($b, 0, $b.Length)
    } else { $c.Response.StatusCode = 404 }
    $c.Response.Close()
  }
} finally { $l.Stop() }
