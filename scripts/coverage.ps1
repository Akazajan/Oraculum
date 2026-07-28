#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Code-coverage runner for Oraculum contracts (Windows / PowerShell).
.DESCRIPTION
    Generates coverage reports for the Rust contract workspace using
    cargo-tarpaulin (preferred) or grcov.
.PARAMETER Engine
    Coverage engine to use: "tarpaulin" (default) or "grcov".
.PARAMETER Open
    Switch; if set, opens the generated HTML report.
#>

param(
    [Parameter(Mandatory = $false)]
    [ValidateSet("tarpaulin", "grcov")]
    [string]$Engine = "tarpaulin",

    [Parameter(Mandatory = $false)]
    [switch]$Open = $false
)

$ErrorActionPreference = "Stop"
$WorkspaceDir = Split-Path -Path $PSScriptRoot -Parent
$ReportDir = Join-Path -Path $WorkspaceDir -ChildPath "target/coverage"
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null

Write-Host "━━━ Oraculum Coverage Report ━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  Engine:   $Engine"
Write-Host "  Contracts: $((Join-Path $WorkspaceDir 'contracts'))"
Write-Host ""

if ($Engine -eq "tarpaulin") {
    # Check if tarpaulin is installed
    $null = Get-Command cargo-tarpaulin -ErrorAction SilentlyContinue
    if (-not $?) {
        Write-Error "cargo-tarpaulin not found. Run: cargo install cargo-tarpaulin"
        exit 1
    }

    Push-Location (Join-Path $WorkspaceDir "contracts")
    try {
        cargo tarpaulin --workspace --all-features --out Html --out Xml --output-dir $ReportDir --skip-clean --verbose
    } finally {
        Pop-Location
    }

    Write-Host "✓ Coverage report generated:" -ForegroundColor Green
    Write-Host "  HTML: $(Join-Path $ReportDir 'tarpaulin-report.html')"
    Write-Host "  XML:  $(Join-Path $ReportDir 'cobertura.xml')"
}
else {
    Write-Error "grcov on Windows requires additional setup. Use tarpaulin instead."
    exit 1
}

if ($Open) {
    $reportFile = Join-Path $ReportDir "tarpaulin-report.html"
    if (Test-Path $reportFile) {
        Start-Process $reportFile
    }
}
