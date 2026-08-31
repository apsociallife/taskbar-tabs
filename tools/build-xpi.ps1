<#
.SYNOPSIS
Packages src/ into a Taskbar Tabs .xpi.

.DESCRIPTION
Stages the contents of src/ and zips it. Note that src/ in this repo does not
currently contain psl.min.js or images/, which the extension needs at runtime.
If those are missing, they are pulled from -VendorFrom, which defaults to the
copy of the extension already installed in the Nightly profile.

.PARAMETER OutFile
Where to write the .xpi. Defaults to dist/taskbar-tabs.xpi.

.PARAMETER VendorFrom
An existing .xpi to source any assets missing from src/.
#>
[CmdletBinding()]
param(
  [string]$OutFile,
  [string]$VendorFrom = "$env:APPDATA\Mozilla\Firefox\Profiles\iexnlvqe.default-nightly\extensions\taskbar-tabs@mozilla.com.xpi"
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repo = Split-Path -Parent $PSScriptRoot
$src = Join-Path $repo 'src'
if (-not $OutFile) { $OutFile = Join-Path $repo 'dist\taskbar-tabs.xpi' }

$stage = Join-Path ([System.IO.Path]::GetTempPath()) "tt-build-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $stage | Out-Null

try {
  Copy-Item -Path (Join-Path $src '*') -Destination $stage -Recurse -Force

  # Backfill anything src/ doesn't carry from a previously built .xpi.
  if (Test-Path $VendorFrom) {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($VendorFrom)
    try {
      foreach ($entry in $zip.Entries) {
        if ($entry.FullName.EndsWith('/')) { continue }
        # pin.exe is no longer used; Firefox pins shortcuts natively now.
        if ($entry.FullName -eq 'pin.exe') { continue }
        $dest = Join-Path $stage ($entry.FullName -replace '/', '\')
        if (Test-Path $dest) { continue }
        $destDir = Split-Path -Parent $dest
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
        Write-Host "  vendored: $($entry.FullName)"
      }
    } finally { $zip.Dispose() }
  } else {
    Write-Warning "Vendor source not found: $VendorFrom"
  }

  $outDir = Split-Path -Parent $OutFile
  if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
  if (Test-Path $OutFile) { Remove-Item $OutFile -Force }

  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $stage, $OutFile, [System.IO.Compression.CompressionLevel]::Optimal, $false)

  $manifest = Get-Content (Join-Path $stage 'manifest.json') -Raw | ConvertFrom-Json
  Write-Host "Built $($manifest.name) $($manifest.version) -> $OutFile ($((Get-Item $OutFile).Length) bytes)"
  Write-Output $OutFile
}
finally {
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}
