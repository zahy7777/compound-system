& (Join-Path $PSScriptRoot '..\runtime\service.ps1') -Environment prod -Service backend -Action Stop
exit $LASTEXITCODE
