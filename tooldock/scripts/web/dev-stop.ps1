& (Join-Path $PSScriptRoot '..\runtime\service.ps1') -Environment dev -Service web -Action Stop
exit $LASTEXITCODE
