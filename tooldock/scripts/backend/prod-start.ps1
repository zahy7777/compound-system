& (Join-Path $PSScriptRoot '..\runtime\service.ps1') -Environment prod -Service backend -Action Start
exit $LASTEXITCODE
