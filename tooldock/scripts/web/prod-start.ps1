& (Join-Path $PSScriptRoot '..\runtime\service.ps1') -Environment prod -Service web -Action Start
exit $LASTEXITCODE
