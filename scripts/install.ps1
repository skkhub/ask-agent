# Install ask CLI on Windows: set up ~/.ask, copy config templates, download binary.
param(
    [string]$Version = "",
    [switch]$Dev
)

$ErrorActionPreference = "Stop"

$AskHome = Join-Path $env:USERPROFILE ".ask"
$AskBinDir = Join-Path $AskHome "bin"
$AskBin = Join-Path $AskBinDir "ask.exe"
$DefaultRepo = "skkhub/ask-agent"
$UserAgent = "ask-cli-install"

$ScriptPath = $MyInvocation.MyCommand.Path
$LocalCheckout = $false
$RepoRoot = $null
if ($ScriptPath -and (Test-Path -LiteralPath $ScriptPath)) {
    $ScriptDir = Split-Path -Parent $ScriptPath
    $candidateRoot = Split-Path -Parent $ScriptDir
    $pkg = Join-Path $candidateRoot "package.json"
    $self = Join-Path $candidateRoot "scripts/install.ps1"
    if ((Test-Path -LiteralPath $pkg) -and (Test-Path -LiteralPath $self)) {
        $LocalCheckout = $true
        $RepoRoot = $candidateRoot
    }
}

function Write-Info([string]$Message) { Write-Host "==> $Message" }
function Write-Warn([string]$Message) { Write-Warning $Message }

function Get-PlatformArtifact {
    if ($env:PROCESSOR_ARCHITECTURE -notmatch "64") {
        throw "Unsupported CPU architecture: $env:PROCESSOR_ARCHITECTURE"
    }
    $script:Platform = "windows-x64"
    $script:Artifact = "ask-windows-x64.exe"
}

function Get-Repo {
    if (-not $LocalCheckout) {
        return $DefaultRepo
    }
    Push-Location $RepoRoot
    try {
        $url = git remote get-url origin 2>$null
        if ($url -match "github\.com[:/](.+?)(?:\.git)?$") {
            return $Matches[1]
        }
    } finally { Pop-Location }
    return $DefaultRepo
}

function Get-ReleaseVersion([string]$Repo) {
    $headers = @{
        Accept       = "application/vnd.github+json"
        "User-Agent" = $UserAgent
    }
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers
    return ($release.tag_name -replace '^v', '')
}

function Get-Version([string]$Repo) {
    if ($Version) {
        return $Version.TrimStart('v')
    }
    if ($Dev) {
        if (-not $LocalCheckout) {
            throw "--Dev requires a local git checkout"
        }
        $pkg = Join-Path $RepoRoot "package.json"
        $v = (Get-Content $pkg -Raw | ConvertFrom-Json).version
        if (-not $v) {
            throw "Could not read version from $pkg"
        }
        Write-Warn "Using local dev version v$v (--Dev)"
        return $v
    }
    Write-Info "Fetching latest release version from GitHub…"
    return Get-ReleaseVersion $Repo
}

function Invoke-DownloadWithProgress {
    param(
        [string]$Uri,
        [string]$OutFile,
        [string]$Label,
        [switch]$Atomic
    )

    $dest = if ($Atomic) { "$OutFile.new" } else { $OutFile }
    if (Test-Path -LiteralPath $dest) {
        Remove-Item -LiteralPath $dest -Force
    }

    Write-Info "Downloading $Label …"
    $webClient = New-Object System.Net.WebClient
    $webClient.Headers.Add("User-Agent", $UserAgent)
    $event = Register-ObjectEvent -InputObject $webClient -EventName DownloadProgressChanged -MessageData $Label -Action {
        $pct = $EventArgs.ProgressPercentage
        $received = [math]::Round($EventArgs.BytesReceived / 1MB, 2)
        $total = $EventArgs.TotalBytesToReceive
        if ($total -gt 0) {
            $totalMb = [math]::Round($total / 1MB, 2)
            $status = "$pct% ($received MB / $totalMb MB)"
        } else {
            $status = "$received MB downloaded"
        }
        Write-Progress -Activity $MessageData -Status $status -PercentComplete $pct
    }

    try {
        $webClient.DownloadFile($Uri, $dest)
    } finally {
        Write-Progress -Activity $Label -Completed
        Unregister-Event -SourceIdentifier $event.Name -ErrorAction SilentlyContinue
        Remove-Event -SourceIdentifier $event.Name -ErrorAction SilentlyContinue
        $webClient.Dispose()
    }

    if (-not (Test-Path -LiteralPath $dest)) {
        throw "Download failed: $Label"
    }
    if ((Get-Item -LiteralPath $dest).Length -eq 0) {
        Remove-Item -LiteralPath $dest -Force -ErrorAction SilentlyContinue
        throw "Downloaded file is empty: $Label"
    }

    if ($Atomic) {
        Move-Item -LiteralPath $dest -Destination $OutFile -Force
    }
}

function Copy-RepoFile([string]$Name, [string]$Dest, [string]$Repo, [string]$TargetVersion) {
    if ($LocalCheckout) {
        $local = Join-Path $RepoRoot $Name
        if (Test-Path -LiteralPath $local) {
            Copy-Item -LiteralPath $local -Destination $Dest
            return
        }
    }
    $url = "https://raw.githubusercontent.com/$Repo/v$TargetVersion/$Name"
    Invoke-DownloadWithProgress -Uri $url -OutFile $Dest -Label $Name
}

function Download-Binary([string]$Repo, [string]$TargetVersion) {
    $url = "https://github.com/$Repo/releases/download/v$TargetVersion/$($script:Artifact)"
    Invoke-DownloadWithProgress -Uri $url -OutFile $AskBin -Label "$($script:Artifact) (v$TargetVersion)" -Atomic
}

function Add-UserPathEntry {
    $entries = @([Environment]::GetEnvironmentVariable("Path", "User") -split ';' | Where-Object { $_ })
    if ($entries -contains $AskBinDir) {
        Write-Info "User PATH already contains $AskBinDir"
        return
    }
    $newPath = if ($entries.Count -gt 0) { "$AskBinDir;" + ($entries -join ';') } else { $AskBinDir }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Info "Added $AskBinDir to user PATH (cmd.exe and new terminals)"
}

function Ensure-Path {
    $profilePath = $PROFILE
    $pathMarker = "# Added by ask install"
    $pathLine = '$env:Path = "$env:USERPROFILE\.ask\bin;" + $env:Path'

    Add-UserPathEntry

    if (-not $profilePath) {
        Write-Warn "Could not determine PowerShell profile; user PATH was still updated."
        $script:PathConfigured = $true
        $script:PathRc = "(user PATH)"
    } elseif ((Test-Path -LiteralPath $profilePath) -and (Select-String -Path $profilePath -Pattern [regex]::Escape($pathMarker) -Quiet)) {
        Write-Info "~/.ask/bin already in $profilePath"
        $script:PathConfigured = $true
        $script:PathRc = $profilePath
    } else {
        $profileDir = Split-Path -Parent $profilePath
        if (-not (Test-Path -LiteralPath $profileDir)) {
            New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
        }
        @"

$pathMarker
$pathLine
"@ | Add-Content -Path $profilePath
        Write-Info "Added ~/.ask/bin to PATH in $profilePath"
        $script:PathConfigured = $true
        $script:PathRc = $profilePath
    }

    $env:Path = "$AskBinDir;" + $env:Path
}

function Test-Install {
    if (-not (Test-Path -LiteralPath $AskBin)) {
        throw "Binary not found: $AskBin"
    }
    & $AskBin --help *> $null
    if (-not $?) {
        throw "Binary failed to run: $AskBin"
    }
}

function Write-Success {
    $pathNote = if ($script:PathConfigured) {
        @"
PATH updated:
  User environment PATH (cmd.exe / new terminals)
  PowerShell profile: $($script:PathRc)
"@
    } else {
        "Add ~/.ask/bin to PATH manually"
    }

    $reloadNote = if ($script:PathConfigured) {
        @"
Open a new terminal (cmd.exe or PowerShell), or reload PowerShell:
  . $($script:PathRc)

Then use the short command:
  ask --help
"@
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
Version: v$($script:InstallVersion)

$pathNote

$reloadNote

Run now without reloading (full path):
  $AskBin --help

Next steps:
  1. Edit $AskHome\config.json — model profiles and API key references
  2. Copy and edit environment file:
       Copy-Item $AskHome\.env.example $AskHome\.env
     Fill in AI API keys (e.g. DEEPSEEK_API_KEY, ANTHROPIC_API_KEY)

"@
}

Get-PlatformArtifact
Write-Info "Platform: $Platform (artifact: $Artifact)"

$Repo = Get-Repo
$script:InstallVersion = Get-Version $Repo
Write-Info "Repository: $Repo, version: v$($script:InstallVersion)"

Write-Info "Creating $AskHome …"
New-Item -ItemType Directory -Force -Path $AskBinDir | Out-Null

$configPath = Join-Path $AskHome "config.json"
if (Test-Path -LiteralPath $configPath) {
    Write-Warn "Already exists: $configPath — skipping"
} else {
    Write-Info "Copying config.json …"
    Copy-RepoFile "config.json" $configPath $Repo $script:InstallVersion
}

$envExamplePath = Join-Path $AskHome ".env.example"
if (Test-Path -LiteralPath $envExamplePath) {
    Write-Warn "Already exists: $envExamplePath — skipping"
} else {
    Write-Info "Copying .env.example …"
    Copy-RepoFile ".env.example" $envExamplePath $Repo $script:InstallVersion
}

Download-Binary $Repo $script:InstallVersion
Ensure-Path
Test-Install
Write-Success
