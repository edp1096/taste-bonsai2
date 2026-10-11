$ErrorActionPreference = 'Stop'
$llamaRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
& "$llamaRoot\run.cmd"
exit $LASTEXITCODE
