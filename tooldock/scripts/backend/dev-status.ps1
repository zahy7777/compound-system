& (Join-Path $PSScriptRoot '..\runtime\service.ps1') -Environment dev -Service backend -Action Status
exit $LASTEXITCODE
