& (Join-Path $PSScriptRoot '..\runtime\service.ps1') -Environment prod -Service backend -Action Status
exit $LASTEXITCODE
