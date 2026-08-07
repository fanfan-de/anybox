$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..\\..\\..")).Path
$serverDir = Join-Path $repoRoot "packages\\anyboxagent"
$desktopDir = Join-Path $repoRoot "packages\\desktop"

function Resolve-PowerShell7 {
    $candidate = $null
    foreach ($commandName in @("pwsh.exe", "pwsh")) {
        $command = Get-Command $commandName -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) {
            $candidate = $command.Source
            break
        }
    }

    if (-not $candidate) {
        foreach ($path in @(
            $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles "PowerShell\\7\\pwsh.exe" }),
            $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Microsoft\\WindowsApps\\pwsh.exe" })
        )) {
            if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) {
                $candidate = $path
                break
            }
        }
    }

    if ($candidate) {
        try {
            $probe = & $candidate -NoLogo -NoProfile -NonInteractive -Command `
                '$value = [ordered]@{ version = $PSVersionTable.PSVersion.ToString(); edition = $PSVersionTable.PSEdition }; $value | ConvertTo-Json -Compress' `
                2>$null | ConvertFrom-Json
            if ($LASTEXITCODE -eq 0 -and $probe.edition -eq "Core" -and ([version]$probe.version).Major -eq 7) {
                return $candidate
            }
        }
        catch {
            # Fall through to the shared user-facing requirement below.
        }
    }

    throw @"
PowerShell 7 is required but pwsh.exe was not found.
Install it with:
winget install --id Microsoft.PowerShell --source winget
Then restart Anybox.
Windows PowerShell 5.1 is not supported.
"@
}

$powerShell7Path = Resolve-PowerShell7

function Assert-Directory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Label directory not found: $Path"
    }
}

function Start-DevWindow {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Title,
        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,
        [Parameter(Mandatory = $true)]
        [string]$Command
    )

    $startupCommand = "& { `$Host.UI.RawUI.WindowTitle = '$Title'; $Command }"

    Start-Process -FilePath $powerShell7Path `
        -WorkingDirectory $WorkingDirectory `
        -ArgumentList @(
            "-NoLogo",
            "-NoExit",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            $startupCommand
        ) | Out-Null
}

Assert-Directory -Path $serverDir -Label "Server"
Assert-Directory -Path $desktopDir -Label "Desktop"

Start-DevWindow -Title "Anybox Server" -WorkingDirectory $serverDir -Command "bun run dev:server"
Start-DevWindow -Title "Anybox Desktop" -WorkingDirectory $desktopDir -Command '$env:ANYBOX_DISABLE_MANAGED_AGENT = "1"; $env:ANYBOX_AGENT_BASE_URL = "http://127.0.0.1:4096"; bun run dev'

Write-Host "Started server in $serverDir"
Write-Host "Started desktop client in $desktopDir"
