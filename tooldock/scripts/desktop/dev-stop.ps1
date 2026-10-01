& (Join-Path $PSScriptRoot '..\runtime\service.ps1') -Environment dev -Service desktop -Action Stop
exit $LASTEXITCODE
