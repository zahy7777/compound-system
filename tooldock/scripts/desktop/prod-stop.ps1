& (Join-Path $PSScriptRoot '..\runtime\service.ps1') -Environment prod -Service desktop -Action Stop
exit $LASTEXITCODE
