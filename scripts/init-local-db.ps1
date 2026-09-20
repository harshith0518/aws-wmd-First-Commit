param([ValidateSet('http://127.0.0.1:8000','http://localhost:8000')][string]$Endpoint='http://127.0.0.1:8000')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$tables=Get-Content -LiteralPath (Join-Path $projectRoot 'specs/dynamodb-tables.json') -Raw | ConvertFrom-Json
$oldAccess=$env:AWS_ACCESS_KEY_ID
$oldSecret=$env:AWS_SECRET_ACCESS_KEY
$oldSession=$env:AWS_SESSION_TOKEN
$env:AWS_ACCESS_KEY_ID='campusfixlocal'
$env:AWS_SECRET_ACCESS_KEY='campusfixlocal'
Remove-Item Env:AWS_SESSION_TOKEN -ErrorAction SilentlyContinue
$tempPath=Join-Path ([IO.Path]::GetTempPath()) ('campusfix-tables-'+[guid]::NewGuid()+'.json')
try {
    $existingJson=& aws dynamodb list-tables --endpoint-url $Endpoint --region ap-south-1 --no-cli-pager --output json 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'DynamoDB Local is unavailable. Start Docker Desktop, then run docker compose up -d.' }
    $existing=($existingJson | ConvertFrom-Json).TableNames
    foreach ($table in $tables) {
        if ($existing -contains $table.TableName) { Write-Output ('Exists: '+$table.TableName); continue }
        [IO.File]::WriteAllText($tempPath,($table | ConvertTo-Json -Depth 20))
        & aws dynamodb create-table --cli-input-json ('file://'+$tempPath) --endpoint-url $Endpoint --region ap-south-1 --no-cli-pager --output json | Out-Null
        if ($LASTEXITCODE -ne 0) { throw ('Failed creating '+$table.TableName) }
        & aws dynamodb wait table-exists --table-name $table.TableName --endpoint-url $Endpoint --region ap-south-1 --no-cli-pager
        if ($LASTEXITCODE -ne 0) { throw ('Table not ready: '+$table.TableName) }
        Write-Output ('Created: '+$table.TableName)
    }
} finally {
    $env:AWS_ACCESS_KEY_ID=$oldAccess
    $env:AWS_SECRET_ACCESS_KEY=$oldSecret
    $env:AWS_SESSION_TOKEN=$oldSession
    Remove-Item -LiteralPath $tempPath -ErrorAction SilentlyContinue
}
