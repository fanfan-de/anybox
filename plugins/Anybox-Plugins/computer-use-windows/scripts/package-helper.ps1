[CmdletBinding()]
param(
    [switch]$Check
)

$ErrorActionPreference = "Stop"
$pluginRoot = Split-Path -Parent $PSScriptRoot
$project = Join-Path $pluginRoot "helper\ComputerUse.Helper\ComputerUse.Helper.csproj"
$staging = Join-Path $pluginRoot ".cache\computer-use-helper\win32-x64"
$artifacts = Join-Path $pluginRoot ".cache\computer-use-helper\artifacts"
$destinationDirectory = Join-Path $pluginRoot "helper\win32-x64"
$destination = Join-Path $destinationDirectory "computer-use-helper.exe"
$hashFile = Join-Path $destinationDirectory "computer-use-helper.sha256"
$verifyScript = Join-Path $PSScriptRoot "verify-package.mjs"

if (-not $Check) {
    if (Test-Path -LiteralPath $staging) {
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
    New-Item -ItemType Directory -Path $staging -Force | Out-Null

    dotnet publish $project `
        -c Release `
        -r win-x64 `
        --self-contained true `
        --artifacts-path $artifacts `
        -p:PublishSingleFile=true `
        -p:PublishTrimmed=false `
        -o $staging
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet publish failed with exit code $LASTEXITCODE"
    }

    $stagedExecutable = Join-Path $staging "computer-use-helper.exe"
    if (-not (Test-Path -LiteralPath $stagedExecutable)) {
        throw "Published helper executable is missing: $stagedExecutable"
    }

    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    Copy-Item -LiteralPath $stagedExecutable -Destination $destination -Force
    $hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath $hashFile -Value "$hash  computer-use-helper.exe" -Encoding utf8NoBOM
}

node $verifyScript
if ($LASTEXITCODE -ne 0) {
    throw "Computer Use helper package verification failed with exit code $LASTEXITCODE"
}
