<#
.SYNOPSIS
  Install the ArtCraft DSH plugins on Windows.

.DESCRIPTION
  Two independent steps, in order:

    1. the craft CLIs  — downloaded from each craft's own GitHub release into
       %USERPROFILE%\.dsh\crafts\bin (no Rust, no unzip, no tar needed);
    2. the DSH plugins — packed and installed into a profile as real bundles,
       so they appear on the Web Plugins page and their tools reach the agent.

  Everything is done by the Node scripts in scripts\, which work the same on
  Windows, macOS and Linux. This wrapper exists because a stock Windows box
  usually has no `node`, `npm` or `pnpm` on PATH: the harness ships its own
  copies, and this script finds them.

  If PowerShell refuses to run this file, use the .cmd next to it:
      install.cmd
  which re-invokes PowerShell with -ExecutionPolicy Bypass.

.EXAMPLE
  .\install.ps1
  Every craft this platform supports, then the plugins into the only profile.

.EXAMPLE
  .\install.ps1 -Crafts gridcraft,wordcraft -Profile desktop
  Two crafts, into the profile named desktop.

.EXAMPLE
  .\install.ps1 -List
  Show what would be fetched and installed, changing nothing.

.EXAMPLE
  .\install.ps1 -FromSource -Repos D:\src
  Compile the CLIs from source instead of downloading (needs Rust).
#>
[CmdletBinding()]
param(
  # Crafts to fetch, e.g. -Crafts gridcraft,wordcraft. Default: all supported.
  [string[]]$Crafts,

  # DSH profile to install the plugins into. Default: the only profile present,
  # or 'web' when there is a choice.
  [string]$Profile,

  # Harness home. Default: $env:DSH_HOME, else %USERPROFILE%\.dsh
  [string]$DshHome,

  # Where the CLIs land. Default: <DshHome>\crafts\bin
  [string]$BinDir,

  # Compile the CLIs from source with Cargo instead of downloading them.
  [switch]$FromSource,

  # Where -FromSource clones the craft repositories. Default: <repo>\repos
  [string]$Repos,

  # Reinstall over an existing copy instead of skipping it.
  [switch]$Force,

  # Print what would happen and exit without changing anything.
  [switch]$List,

  # Skip step 1 (the craft CLIs).
  [switch]$SkipCrafts,

  # Skip step 2 (the plugins into the profile).
  [switch]$SkipPlugins,

  # Run scripts\verify.mjs at the end to prove the installation works.
  [switch]$Verify
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$root = Split-Path -Parent $PSCommandPath
if (-not (Test-Path (Join-Path $root 'scripts\install-craft.mjs'))) {
  throw "install.ps1 must sit beside the scripts\ directory (looked in $root)."
}

function Write-Step([string]$text) {
  Write-Host ''
  Write-Host "==> $text" -ForegroundColor Cyan
}

function Write-Note([string]$text) { Write-Host "    $text" -ForegroundColor DarkGray }

# --- locate a Node the harness can actually use -----------------------------
# A stock Windows box has no `node` on PATH; the DeepSeek Harness ships one
# under <home>\dsh-runtimes\<runtime>\dependencies\node\bin\node.exe.
function Resolve-Node {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $candidates = @()
  if ($env:DSH_NODE) { $candidates += $env:DSH_NODE }
  $runtimes = Join-Path $script:dshHome 'dsh-runtimes'
  if (Test-Path $runtimes) {
    $candidates += Get-ChildItem $runtimes -Directory -ErrorAction SilentlyContinue |
      ForEach-Object { Join-Path $_.FullName 'dependencies\node\bin\node.exe' }
  }
  $candidates += @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe')
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe')
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    (Join-Path $env:APPDATA 'npm\node.exe')
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return $null
}

$script:dshHome = if ($DshHome) { $DshHome }
                  elseif ($env:DSH_HOME) { $env:DSH_HOME }
                  else { Join-Path $env:USERPROFILE '.dsh' }
$dshHome = $script:dshHome

$node = Resolve-Node
if (-not $node) {
  Write-Host 'Node.js was not found.' -ForegroundColor Red
  Write-Host ''
  Write-Host 'The harness ships its own Node; this looked for it under:'
  Write-Host "  $dshHome\dsh-runtimes\<runtime>\dependencies\node\bin\node.exe"
  Write-Host 'and then in the usual Windows install locations.'
  Write-Host ''
  Write-Host 'Either point DSH_NODE at your node.exe, or install Node.js 22.19+ / 24+:'
  Write-Host '  winget install --id OpenJS.NodeJS.LTS'
  exit 2
}

Write-Host ''
Write-Host 'ArtCraft x DSH - Windows installer' -ForegroundColor White
Write-Note "node:  $node"
Write-Note "home:  $dshHome"
if ($Profile) { Write-Note "profile: $Profile" }

# --- step 1: the craft CLIs --------------------------------------------------
$craftArgs = @()
if ($Crafts -and $Crafts.Count -gt 0) { $craftArgs += $Crafts }
$effectiveBinDir = if ($BinDir) { $BinDir } else { Join-Path $dshHome 'crafts\bin' }
if ($FromSource) {
  $craftArgs += '--from-source'
  if ($Repos) { $craftArgs += @('--repos', $Repos) }
} else {
  $craftArgs += @('--dir', $effectiveBinDir)
}
if ($Force) { $craftArgs += '--force' }

if ($List -and -not $SkipCrafts) {
  Write-Step 'craft CLIs that would be fetched'
  & $node (Join-Path $root 'scripts\install-craft.mjs') @craftArgs --list
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not $SkipCrafts -and -not $List) {
  Write-Step 'installing the craft CLIs'
  & $node (Join-Path $root 'scripts\install-craft.mjs') @craftArgs
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'The craft CLIs did not all install.' -ForegroundColor Yellow
    Write-Host 'Set GITHUB_TOKEN to avoid GitHub rate limits, or re-run with -Force.' -ForegroundColor Yellow
    exit $LASTEXITCODE
  }
}

# --- step 2: the plugins into a profile --------------------------------------
$profileArgs = @('--dsh-home', $dshHome)
if ($Profile) { $profileArgs += @('--profile', $Profile) }
if ($List) { $profileArgs += '--dry-run' }

if (-not $SkipPlugins) {
  Write-Step $(if ($List) { 'plugins that would be installed into the profile' }
               else { 'installing the plugins into the DSH profile' })
  & $node (Join-Path $root 'scripts\install-into-profile.mjs') @profileArgs
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'The profile install failed. Run it by hand for the full error:' -ForegroundColor Yellow
    Write-Host "  `"$node`" scripts\install-into-profile.mjs $($profileArgs -join ' ')" -ForegroundColor Yellow
    exit $LASTEXITCODE
  }
}

# --- optional proof ----------------------------------------------------------
if ($Verify -and -not $List) {
  Write-Step 'verifying'
  $verifyArgs = @()
  if ($Crafts -and $Crafts.Count -gt 0) { $verifyArgs += $Crafts }
  & $node (Join-Path $root 'scripts\verify.mjs') @verifyArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if ($List) {
  Write-Host ''
  Write-Host 'Dry run only - nothing was changed.' -ForegroundColor Green
  exit 0
}

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
Write-Host ''
Write-Host 'Restart the harness so the plugin rows are read at boot, then ask for'
Write-Host 'something that uses a craft, for example:'
Write-Host '  "Make a Q3 sales spreadsheet with a chart and save it to Documents."'
Write-Host ''
Write-Host 'Check any single craft at any time with:'
Write-Host "  `"$node`" scripts\verify.mjs gridcraft"
