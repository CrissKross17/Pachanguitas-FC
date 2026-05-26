$port = 3000
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Servidor OK en http://localhost:$port"

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $method = $ctx.Request.HttpMethod
  $p = $ctx.Request.Url.LocalPath.TrimStart('/')
  if ($p -eq '' -or $p -eq '/') { $p = 'index.html' }
  $file = Join-Path $root $p
  Write-Host "$method $p"

  # HEAD: solo cabeceras
  if ($method -eq 'HEAD') {
    $ctx.Response.StatusCode = if (Test-Path $file -PathType Leaf) { 200 } else { 404 }
    $ctx.Response.Close()
    continue
  }

  try {
    if (Test-Path $file -PathType Leaf) {
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $isText = $ext -in '.html','.css','.js','.json','.svg'
      if ($isText) {
        $content = [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8)
        $bytes   = [Text.Encoding]::UTF8.GetBytes($content)
      } else {
        $bytes = [IO.File]::ReadAllBytes($file)
      }
      $ct = switch ($ext) {
        '.html' { 'text/html; charset=utf-8' }
        '.css'  { 'text/css' }
        '.js'   { 'application/javascript' }
        '.json' { 'application/json' }
        '.svg'  { 'image/svg+xml' }
        '.png'  { 'image/png' }
        '.jpg'  { 'image/jpeg' }
        '.ico'  { 'image/x-icon' }
        default { 'application/octet-stream' }
      }
      $ctx.Response.ContentType        = $ct
      $ctx.Response.ContentLength64    = [int64]$bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host "  -> 200 ($($bytes.Length) bytes)"
    } else {
      $msg = [Text.Encoding]::UTF8.GetBytes("404: $p")
      $ctx.Response.StatusCode      = 404
      $ctx.Response.ContentLength64 = [int64]$msg.Length
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
      Write-Host "  -> 404"
    }
  } catch {
    Write-Host "  -> ERR: $_"
  } finally {
    try { $ctx.Response.OutputStream.Close() } catch {}
  }
}
