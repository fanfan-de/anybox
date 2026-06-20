param(
  [string]$Vault,
  [string]$TestPath = "Anybox/Obsidian CLI Smoke Test.md",
  [switch]$WriteTest
)

$ErrorActionPreference = "Stop"

function Invoke-Obsidian {
  param([string[]]$Args)

  $prefix = @()
  if ($Vault) {
    $prefix += "vault=$Vault"
  }

  & obsidian @prefix @Args
}

Write-Host "Checking Obsidian CLI..."
Invoke-Obsidian @("version")

Write-Host "Checking vault..."
Invoke-Obsidian @("vault")

Write-Host "Counting files..."
Invoke-Obsidian @("files", "total")

if ($WriteTest) {
  $content = "# Obsidian CLI Smoke Test\n\nCreated by the Anybox obsidian-cli plugin smoke test."
  Write-Host "Creating smoke test note at $TestPath..."
  Invoke-Obsidian @("create", "path=$TestPath", "content=$content", "overwrite")

  Write-Host "Reading smoke test note..."
  Invoke-Obsidian @("read", "path=$TestPath")
}

Write-Host "Smoke test completed."
