<#
.SYNOPSIS
Restarts Firefox Nightly with the remote debugging server enabled.

.DESCRIPTION
ff-eval.ps1 needs a debugger server, which Firefox only starts when launched
with -start-debugger-server. This closes any running Firefox gracefully (so the
session is saved and restored) and relaunches it with the flag.

The matching prefs live in the profile's user.js. Delete that file to turn the
whole arrangement off.

.PARAMETER Port
Debugger server port. Defaults to 6000.

.PARAMETER SkipIfRunning
Do nothing if a debugger server is already listening.
#>
[CmdletBinding()]
param(
  [int]$Port = 6000,
  [string]$Exe = "C:\Program Files\Firefox Nightly\firefox.exe",
  [switch]$SkipIfRunning
)

$ErrorActionPreference = 'Stop'

function Test-DebuggerListening {
  param([int]$Port)
  $null -ne (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

if ($SkipIfRunning -and (Test-DebuggerListening -Port $Port)) {
  Write-Host "Debugger server already listening on $Port."
  exit 0
}

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class FxWindows {
  delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  const uint WM_CLOSE = 0x0010;
  public static int CloseAll(uint[] pids) {
    var set = new HashSet<uint>(pids);
    var found = new List<IntPtr>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      uint p; GetWindowThreadProcessId(h, out p);
      if (!set.Contains(p)) return true;
      var cls = new StringBuilder(256); GetClassNameW(h, cls, 256);
      if (cls.ToString() == "MozillaWindowClass") found.Add(h);
      return true;
    }, IntPtr.Zero);
    foreach (var h in found) PostMessage(h, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
    return found.Count;
  }
}
'@

$running = @(Get-Process firefox -ErrorAction SilentlyContinue)
if ($running.Count) {
  # WM_CLOSE on each browser window, so session store writes the session out.
  $pids = @($running | ForEach-Object { [uint32]$_.Id })
  $n = [FxWindows]::CloseAll($pids)
  Write-Host "Asked $n Firefox window(s) to close."
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Process firefox -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
  }
  if (Get-Process firefox -ErrorAction SilentlyContinue) {
    throw "Firefox did not exit. Something may be holding it open (an unload prompt?)."
  }
  Write-Host "Firefox exited."
}

Start-Process -FilePath $Exe -ArgumentList '-start-debugger-server', "$Port"
Write-Host "Relaunched with -start-debugger-server $Port; waiting for the server..."

$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
  if (Test-DebuggerListening -Port $Port) {
    Write-Host "Debugger server is listening on $Port."
    exit 0
  }
  Start-Sleep -Milliseconds 500
}
throw "Debugger server never came up on port $Port. Check devtools.debugger.remote-enabled in the profile's user.js."
