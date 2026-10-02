$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path

try {
    Push-Location -LiteralPath $projectRoot
    try {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) {throw "前端构建失败（退出码 $LASTEXITCODE）"}
    } finally {
        Pop-Location
    }
    Write-Output 'Compound 前端构建完成'
} catch {
    Write-Output $_.Exception.Message
    exit 1
}
