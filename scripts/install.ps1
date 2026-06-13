# DevAgent installer for Windows (PowerShell)
# Usage: iwr -useb https://raw.githubusercontent.com/your-repo/devagent/main/scripts/install.ps1 | iex

$ErrorActionPreference = "Stop"
$REPO = "your-repo/devagent"
$InstallDir = "$env:USERPROFILE\.devagent\src"

function Write-Info    { param($m) Write-Host "  i  $m" -ForegroundColor Cyan }
function Write-Success { param($m) Write-Host "  v  $m" -ForegroundColor Green }
function Write-Warn    { param($m) Write-Host "  !  $m" -ForegroundColor Yellow }
function Write-Err     { param($m) Write-Host "  x  $m" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  DevAgent installer" -ForegroundColor Cyan
Write-Host "  ---------------------------------" -ForegroundColor Cyan
Write-Host ""

# --- Check Node.js ---
try {
    $nodeVer = (node --version 2>&1).ToString().TrimStart('v')
    $major = [int]($nodeVer.Split('.')[0])
    if ($major -lt 18) { Write-Err "Node.js v18+ required (found v$nodeVer). Upgrade at https://nodejs.org" }
    Write-Success "Node.js v$nodeVer found"
} catch {
    Write-Err "Node.js is required (v18+). Install from https://nodejs.org"
}

# --- Download ---
Write-Info "Downloading DevAgent to $InstallDir ..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$TarballUrl = "https://github.com/$REPO/archive/refs/heads/main.zip"
$TmpZip = "$env:TEMP\devagent.zip"
$TmpDir = "$env:TEMP\devagent_extract"

try {
    Invoke-WebRequest -Uri $TarballUrl -OutFile $TmpZip -UseBasicParsing
    if (Test-Path $TmpDir) { Remove-Item $TmpDir -Recurse -Force }
    Expand-Archive -Path $TmpZip -DestinationPath $TmpDir
    $extracted = Get-ChildItem $TmpDir | Select-Object -First 1
    Copy-Item "$($extracted.FullName)\*" $InstallDir -Recurse -Force
    Remove-Item $TmpZip -Force
    Remove-Item $TmpDir -Recurse -Force
} catch {
    Write-Err "Download failed: $_"
}

# --- npm install ---
Write-Info "Installing dependencies..."
Push-Location $InstallDir
npm install --omit=dev --silent
Pop-Location

# --- Add to PATH via profile ---
$ProfileDir = Split-Path $PROFILE
if (-not (Test-Path $ProfileDir)) { New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null }
if (-not (Test-Path $PROFILE)) { New-Item -ItemType File -Force -Path $PROFILE | Out-Null }

$DaScript = "$InstallDir\src\da.js"

# Write a `da` wrapper function to the PowerShell profile
$FuncDef = @"

# DevAgent
function da { node "$DaScript" @args }
"@

$existing = Get-Content $PROFILE -Raw -ErrorAction SilentlyContinue
if ($existing -notlike "*DevAgent*") {
    Add-Content -Path $PROFILE -Value $FuncDef
    Write-Success "Added `da` function to PowerShell profile: $PROFILE"
} else {
    Write-Info "da function already in profile — skipping"
}

# Also create a .cmd wrapper in a directory that's likely in PATH
$CmdWrapper = "$env:USERPROFILE\.devagent\da.cmd"
"@node `"$DaScript`" %*" | Set-Content $CmdWrapper
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$daDir = "$env:USERPROFILE\.devagent"
if ($userPath -notlike "*$daDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$daDir", "User")
    Write-Success "Added $daDir to your PATH"
}

Write-Host ""
Write-Success "DevAgent installed successfully!"
Write-Host ""
Write-Host "  Next steps (restart your terminal first):" -ForegroundColor White
Write-Host "  da config set api-key YOUR_ANTHROPIC_KEY" -ForegroundColor Cyan
Write-Host "  da                                        -- start interactive chat" -ForegroundColor Cyan
Write-Host "  da `"explain this codebase`"               -- one-shot query" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Get an API key at: https://console.anthropic.com" -ForegroundColor White
Write-Host ""
