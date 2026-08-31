<#
.SYNOPSIS
Packages src/ into a Taskbar Tabs .xpi.

.DESCRIPTION
Zips the contents of src/ with the extension manifest at the archive root.

Entries are written one at a time rather than with ZipFile.CreateFromDirectory,
because on .NET Framework that helper writes entry names using the OS directory
separator. A .xpi built that way contains "images\taskbar.png", which is not a
valid zip path, and Firefox silently fails to resolve every icon in the
manifest, the popup and the page action.

.PARAMETER OutFile
Where to write the .xpi. Defaults to dist/taskbar-tabs.xpi.
#>
[CmdletBinding()]
param(
  [string]$OutFile
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repo = Split-Path -Parent $PSScriptRoot
$src = Join-Path $repo 'src'
if (-not $OutFile) { $OutFile = Join-Path $repo 'dist\taskbar-tabs.xpi' }

if (-not (Test-Path (Join-Path $src 'manifest.json'))) {
  throw "No manifest.json in $src - is this the right repo?"
}

$outDir = Split-Path -Parent $OutFile
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
if (Test-Path $OutFile) { Remove-Item $OutFile -Force }

$zip = [System.IO.Compression.ZipFile]::Open($OutFile, 'Create')
try {
  foreach ($file in Get-ChildItem $src -Recurse -File) {
    $relative = $file.FullName.Substring($src.Length + 1).Replace('\', '/')
    $entry = $zip.CreateEntry($relative, [System.IO.Compression.CompressionLevel]::Optimal)
    $stream = $entry.Open()
    try {
      $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
      $stream.Write($bytes, 0, $bytes.Length)
    } finally {
      $stream.Dispose()
    }
  }
} finally {
  $zip.Dispose()
}

# A backslash here means the archive is broken in a way Firefox won't report.
$check = [System.IO.Compression.ZipFile]::OpenRead($OutFile)
try {
  $bad = @($check.Entries | Where-Object { $_.FullName -match '\\' })
  $count = $check.Entries.Count
} finally {
  $check.Dispose()
}
if ($bad.Count) {
  Remove-Item $OutFile -Force
  throw "Refusing to ship an .xpi with backslash entry names: $($bad.FullName -join ', ')"
}

$manifest = Get-Content (Join-Path $src 'manifest.json') -Raw | ConvertFrom-Json
Write-Host "Built $($manifest.name) $($manifest.version) -> $OutFile"
Write-Host "  $count entries, $((Get-Item $OutFile).Length) bytes"
Write-Output $OutFile
