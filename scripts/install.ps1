# Install ask CLI on Windows: set up ~/.ask, copy config templates, download binary.
$ErrorActionPreference = "Stop"

$AskHome = Join-Path $env:USERPROFILE ".ask"
$AskBinDir = Join-Path $AskHome "bin"
$AskBin = Join-Path $AskBinDir "ask.exe"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

function Write-Info([string]$Message) { Write-Host "==> $Message" }
function Write-Warn([string]$Message) { Write-Warning $Message }

function Get-PlatformArtifact {
    if ($env:PROCESSOR_ARCHITECTURE -notmatch "64") {
        throw "Unsupported CPU architecture: $env:PROCESSOR_ARCHITECTURE"
    }
    $script:Platform = "windows-x64"
    $script:Artifact = "ask-windows-x64.exe"
}

$DefaultRepo = "skkhub/ask-agent"

function Get-Repo {
    Push-Location $RepoRoot
    try {
        $url = git remote get-url origin 2>$null
        if ($url -match "github\.com[:/]([^/]+/[^/.]+)") {
            return $Matches[1] -replace '\.git$', ''
        }
    } finally { Pop-Location }
    return $DefaultRepo
}

function Get-Version([string]$Repo) {
    $pkg = Join-Path $RepoRoot "package.json"
    if (Test-Path $pkg) {
        $v = (Get-Content $pkg -Raw | ConvertFrom-Json).version
        if ($v) { return $v }
    }
    Write-Info "Fetching latest release version from GitHub…"
    $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
    return ($release.tag_name -replace '^v', '')
}

function Copy-RepoFile([string]$Name, [string]$Dest, [string]$Repo, [string]$Version) {
    $local = Join-Path $RepoRoot $Name
    if (Test-Path $local) {
        Copy-Item $local $Dest
        return
    }
    $url = "https://raw.githubusercontent.com/$Repo/v$Version/$Name"
    Write-Info "Downloading $Name …"
    Invoke-WebRequest -Uri $url -OutFile $Dest -UseBasicParsing
}

function Download-Binary([string]$Repo, [string]$Version) {
    $url = "https://github.com/$Repo/releases/download/v$Version/$Artifact"
    Write-Info "Downloading $Artifact (v$Version) …"
    Invoke-WebRequest -Uri $url -OutFile $AskBin -UseBasicParsing
}

function Ensure-Path {
    $profilePath = $PROFILE
    $pathLine = '$env:Path = "$env:USERPROFILE\.ask\bin;" + $env:Path'

    if (-not $profilePath) {
        Write-Warn "Could not determine PowerShell profile; add ~/.ask/bin to PATH manually:"
        Write-Warn "  $pathLine"
        $script:PathConfigured = $false
        return
    }

    if ((Test-Path $profilePath) -and (Select-String -Path $profilePath -Pattern '\.ask\\bin' -Quiet)) {
        Write-Info "~/.ask/bin already in $profilePath"
    } else {
        $profileDir = Split-Path -Parent $profilePath
        if (-not (Test-Path $profileDir)) {
            New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
        }
        @'

# Added by ask install
$env:Path = "$env:USERPROFILE\.ask\bin;" + $env:Path
'@ | Add-Content -Path $profilePath
        Write-Info "Added ~/.ask/bin to PATH in $profilePath"
    }

    $env:Path = "$AskBinDir;" + $env:Path
    $script:PathConfigured = $true
    $script:PathRc = $profilePath
}

function Write-Success {
    $pathNote = if ($script:PathConfigured) {
        "PATH updated in $($script:PathRc). Run: . $($script:PathRc)"
    } else {
        @"
Add ~/.ask/bin to PATH manually:
  `$env:Path = "`$env:USERPROFILE\.ask\bin;" + `$env:Path
"@
    }

    Write-Host @"

Installation complete!

Install directory: $AskHome
Executable: $AskBin

$pathNote

Next steps:
  1. Edit $AskHome\config.json — model profiles and API key references
  2. Copy and edit environment file:
       Copy-Item $AskHome\.env.example $AskHome\.env
     Fill in AI API keys (e.g. DEEPSEEK_API_KEY, ANTHROPIC_API_KEY)

Then run:
  ask --help

"@
}

Get-PlatformArtifact
Write-Info "Platform: $Platform (artifact: $Artifact)"

$Repo = Get-Repo
$Version = Get-Version $Repo
Write-Info "Repository: $Repo, version: v$Version"

Write-Info "Creating $AskHome …"
New-Item -ItemType Directory -Force -Path $AskBinDir | Out-Null

$configPath = Join-Path $AskHome "config.json"
if (Test-Path $configPath) {
    Write-Warn "Already exists: $configPath — skipping"
} else {
    Write-Info "Copying config.json …"
    Copy-RepoFile "config.json" $configPath $Repo $Version
}

Write-Info "Copying .env.example …"
Copy-RepoFile ".env.example" (Join-Path $AskHome ".env.example") $Repo $Version

Download-Binary $Repo $Version
Ensure-Path
Write-Success
