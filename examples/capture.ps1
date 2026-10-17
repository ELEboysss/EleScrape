<#
    Scripted capture (PowerShell).

    .\examples\capture.ps1
    .\examples\capture.ps1 -Url http://127.0.0.1:8089/ -OutDir .scrape\scripted
#>
param(
    [string]$Url = 'http://127.0.0.1:8089/',
    [string]$OutDir = '.scrape\scripted'
)

$ErrorActionPreference = 'Stop'
$node = (Get-Command node).Source
$cli = Join-Path $PSScriptRoot '..\bin\scrape-tool.js'

Write-Host "-> capturing $Url into $OutDir"
& $node $cli capture --url $Url --out $OutDir --filter '/api/' --duration 15 --quiet
if ($LASTEXITCODE -ne 0) { throw "capture failed with exit code $LASTEXITCODE" }

Write-Host '-> recorded requests'
& $node $cli list $OutDir

Write-Host '-> exporting CSV'
$csv = Join-Path $OutDir 'requests.csv'
& $node $cli export $OutDir --format csv --out $csv

Write-Host "done: $csv"
