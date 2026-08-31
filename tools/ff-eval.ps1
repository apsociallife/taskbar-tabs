<#
.SYNOPSIS
Evaluates chrome-privileged JavaScript in a running Firefox via the Remote Debugging Protocol.

.DESCRIPTION
Speaks the Firefox RDP directly over TCP, so no devtools window or Node.js is needed.
Requires Firefox to be running with a debugger server, i.e. launched as:

    firefox.exe -start-debugger-server 6000

and with these prefs set (see the profile's user.js):
    devtools.debugger.remote-enabled = true
    devtools.chrome.enabled          = true
    devtools.debugger.prompt-connection = false

The evaluated script runs in the parent process with full chrome privileges, so
Services, Cc/Ci, ChromeUtils and friends are all available.

.PARAMETER Script
JavaScript source to evaluate. The value of the last expression is returned.

.PARAMETER ScriptFile
Path to a file containing JavaScript to evaluate. Takes precedence over -Script.

.PARAMETER Addon
Evaluate inside an add-on's background context instead of the parent process.
Pass the add-on ID, e.g. taskbar-tabs@mozilla.com. In that context the WebExtension
`browser` API and the extension's own background globals are in scope.

.PARAMETER Port
Debugger server port. Defaults to 6000.

.EXAMPLE
.\ff-eval.ps1 -Script "Services.appinfo.version"

.EXAMPLE
.\ff-eval.ps1 -Addon taskbar-tabs@mozilla.com -Script "JSON.stringify(installedSites)"

.EXAMPLE
.\ff-eval.ps1 -ScriptFile .\probe.js
#>
[CmdletBinding()]
param(
  [string]$Script,
  [string]$ScriptFile,
  [string]$Addon,
  [int]$Port = 6000,
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'

if ($ScriptFile) {
  if (-not (Test-Path $ScriptFile)) { throw "Script file not found: $ScriptFile" }
  $Script = Get-Content -Path $ScriptFile -Raw
}
if (-not $Script) { throw "Provide either -Script or -ScriptFile." }

# --- RDP framing: packets are "<utf8ByteLength>:<jsonPayload>" ---------------

$enc = New-Object System.Text.UTF8Encoding($false)

function Send-Packet {
  param($Stream, [hashtable]$Obj)
  $json = $Obj | ConvertTo-Json -Compress -Depth 20
  $body = $enc.GetBytes($json)
  $head = $enc.GetBytes("$($body.Length):")
  $Stream.Write($head, 0, $head.Length)
  $Stream.Write($body, 0, $body.Length)
  $Stream.Flush()
}

function Read-Packet {
  param($Stream)
  # Read the ASCII byte-length prefix up to the ':' separator.
  $lenChars = New-Object System.Text.StringBuilder
  while ($true) {
    $b = $Stream.ReadByte()
    if ($b -lt 0) { throw "Connection closed while reading packet length." }
    $c = [char]$b
    if ($c -eq ':') { break }
    [void]$lenChars.Append($c)
  }
  $len = [int]$lenChars.ToString()
  $buf = New-Object byte[] $len
  $read = 0
  while ($read -lt $len) {
    $n = $Stream.Read($buf, $read, $len - $read)
    if ($n -le 0) { throw "Connection closed mid-packet." }
    $read += $n
  }
  return ($enc.GetString($buf) | ConvertFrom-Json)
}

function Request {
  param($Stream, [hashtable]$Obj, [string]$ExpectFrom)
  Send-Packet -Stream $Stream -Obj $Obj
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $p = Read-Packet -Stream $Stream
    if ($p.error) { throw "RDP error: $($p.error) - $($p.message)" }
    if (-not $ExpectFrom -or $p.from -eq $ExpectFrom) { return $p }
    # Otherwise it's an unsolicited notification; keep reading.
  }
  throw "Timed out waiting for a reply from '$ExpectFrom'."
}

# --- Connect and find a parent-process console actor ------------------------

$client = New-Object System.Net.Sockets.TcpClient
$client.Connect('127.0.0.1', $Port)
$stream = $client.GetStream()
$stream.ReadTimeout = $TimeoutSeconds * 1000

try {
  [void](Read-Packet -Stream $stream)   # initial "root" greeting

  if ($Addon) {
    $addonsReply = Request -Stream $stream -Obj @{ to = 'root'; type = 'listAddons' } -ExpectFrom 'root'
    $entry = $addonsReply.addons | Where-Object { $_.id -eq $Addon } | Select-Object -First 1
    if (-not $entry) {
      throw "Add-on '$Addon' not found. Available: $(($addonsReply.addons | ForEach-Object { $_.id }) -join ', ')"
    }
    $descriptor = $entry.actor

    # Add-on descriptors no longer answer 'getTarget'; targets arrive as
    # 'target-available-form' notifications after subscribing via the watcher.
    $watcherReply = Request -Stream $stream -Obj @{ to = $descriptor; type = 'getWatcher' } -ExpectFrom $descriptor
    $watcher = $watcherReply.actor
    if (-not $watcher) { throw "Add-on descriptor exposed no watcher actor." }

    Send-Packet -Stream $stream -Obj @{ to = $watcher; type = 'watchTargets'; targetType = 'frame' }

    # An add-on can expose several frame targets. The background page is the one
    # that has the extension's globals and the `browser` API, so prefer it and
    # only settle for another target if it never shows up.
    $targets = @()
    $stream.ReadTimeout = 4000
    try {
      while ($true) {
        $p = Read-Packet -Stream $stream
        if ($p.error) { throw "RDP error: $($p.error) - $($p.message)" }
        if ($p.type -eq 'target-available-form' -and $p.target.consoleActor) {
          $targets += $p.target
          if ($p.target.url -match 'background') { break }
        }
      }
    }
    catch [System.IO.IOException] { }
    $stream.ReadTimeout = $TimeoutSeconds * 1000

    if (-not $targets) { throw "No add-on target appeared (is the background script running?)." }
    $chosen = $targets | Where-Object { $_.url -match 'background' } | Select-Object -First 1
    if (-not $chosen) { $chosen = $targets[0] }
    Write-Verbose "Evaluating in add-on target: $($chosen.url)"
    $consoleActor = $chosen.consoleActor
  }
  else {
    $procReply = Request -Stream $stream -Obj @{ to = 'root'; type = 'getProcess'; id = 0 } -ExpectFrom 'root'
    $descriptor = $procReply.processDescriptor.actor
    if (-not $descriptor) { throw "Could not obtain a parent process descriptor." }

    $targetReply = Request -Stream $stream -Obj @{ to = $descriptor; type = 'getTarget' } -ExpectFrom $descriptor
    $consoleActor = $targetReply.process.consoleActor
    if (-not $consoleActor) { throw "Parent process target exposed no consoleActor." }
  }

  # --- Evaluate -------------------------------------------------------------

  # 'mapped.await' tells the server the expression may complete with a promise
  # and that it should resolve it before returning, which gives us top-level await.
  Send-Packet -Stream $stream -Obj @{
    to     = $consoleActor
    type   = 'evaluateJSAsync'
    text   = $Script
    eager  = $false
    mapped = @{ await = $true }
  }

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $p = Read-Packet -Stream $stream
    if ($p.type -ne 'evaluationResult') { continue }

    if ($p.exception -ne $null -or $p.exceptionMessage) {
      $msg = if ($p.exceptionMessage) { $p.exceptionMessage } else { ($p.exception | ConvertTo-Json -Compress -Depth 10) }
      Write-Error "JS exception: $msg"
      if ($p.exceptionStack) { Write-Host ($p.exceptionStack | ConvertTo-Json -Compress -Depth 10) }
      exit 2
    }

    $r = $p.result
    if ($r -is [string] -or $r -is [int] -or $r -is [double] -or $r -is [bool]) {
      Write-Output $r
    } elseif ($null -eq $r) {
      Write-Output ''
    } elseif ($r.type -eq 'undefined') {
      Write-Output '(undefined)'
    } elseif ($r.type -eq 'null') {
      Write-Output '(null)'
    } else {
      # A grip for a non-primitive. Ask the script to JSON.stringify instead.
      Write-Output ($r | ConvertTo-Json -Compress -Depth 10)
    }
    exit 0
  }
  throw "Timed out waiting for the evaluation result."
}
finally {
  $stream.Dispose()
  $client.Close()
}
