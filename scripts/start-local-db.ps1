param([string]$JavaPath='java')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$dbFolder=Join-Path $projectRoot '.local/dynamodb'
$archive=Join-Path $dbFolder 'dynamodb.zip'
$expected='5b0d17dd3b4e929db64a9f624a3f96eaf0961e3cf4acece00091656aec5fc7ed'
New-Item -ItemType Directory -Path $dbFolder -Force | Out-Null
if (!(Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri 'https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_latest.zip' -OutFile $archive -UseBasicParsing
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $expected) { throw 'Archive changed. Verify the new official AWS checksum before updating this script.' }
if (!(Test-Path -LiteralPath (Join-Path $dbFolder 'DynamoDBLocal.jar'))) { Expand-Archive -LiteralPath $archive -DestinationPath $dbFolder }
Write-Output 'Starting DynamoDB Local 3.3.1 for synthetic development data. Stop with Ctrl+C. This database is in memory.'
Push-Location $dbFolder
try { & $JavaPath '-Djava.library.path=./DynamoDBLocal_lib' -jar DynamoDBLocal.jar -sharedDb -inMemory -disableTelemetry -port 8000 -cors 'http://localhost:5173' }
finally { Pop-Location }
