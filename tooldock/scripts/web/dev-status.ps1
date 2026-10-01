& (Join-Path $PSScriptRoot '..\runtime\service.ps1') -Environment dev -Service web -Action Status
exit $LASTEXITCODE
