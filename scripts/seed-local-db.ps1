param([ValidateSet('http://127.0.0.1:8000','http://localhost:8000')][string]$Endpoint='http://127.0.0.1:8000')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$fixture=Get-Content -LiteralPath (Join-Path $projectRoot 'specs/demo-seed.dynamodb.json') -Raw | ConvertFrom-Json
if (-not $fixture.synthetic) { throw 'Only explicitly synthetic fixtures are allowed.' }
$oldAccess=$env:AWS_ACCESS_KEY_ID
$oldSecret=$env:AWS_SECRET_ACCESS_KEY
$oldSession=$env:AWS_SESSION_TOKEN
$env:AWS_ACCESS_KEY_ID='campusfixlocal'
$env:AWS_SECRET_ACCESS_KEY='campusfixlocal'
Remove-Item Env:AWS_SESSION_TOKEN -ErrorAction SilentlyContinue
$tempPath=Join-Path ([IO.Path]::GetTempPath()) ('campusfix-seed-'+[guid]::NewGuid()+'.json')
try {
    foreach ($batch in $fixture.batches) {
        foreach ($tableName in $batch.RequestItems.PSObject.Properties.Name) {
            if ($tableName -notmatch '^campusfix-local-(core|discovery|jobs)$') { throw 'Unexpected fixture table name.' }
        }
        $pending=$batch
        for ($attempt=0; $attempt -lt 5; $attempt++) {
            [IO.File]::WriteAllText($tempPath,($pending | ConvertTo-Json -Depth 50))
            $resultText=& aws dynamodb batch-write-item --cli-input-json ('file://'+$tempPath) --endpoint-url $Endpoint --region ap-south-1 --no-cli-pager --output json
            if ($LASTEXITCODE -ne 0) { throw 'Local seed failed. Start Docker Desktop and run init-local-db.ps1 first.' }
            $result=$resultText | ConvertFrom-Json
            if (@($result.UnprocessedItems.PSObject.Properties).Count -eq 0) { break }
            $pending=@{RequestItems=$result.UnprocessedItems}
            if ($attempt -eq 4) { throw 'Unprocessed fixture records remain; retry the local seed.' }
            Start-Sleep -Milliseconds ([Math]::Min(2000,100*[Math]::Pow(2,$attempt)))
        }
    }
    Write-Output 'Synthetic local fixtures loaded. Re-running resets these fixture records only.'
} finally {
    $env:AWS_ACCESS_KEY_ID=$oldAccess
    $env:AWS_SECRET_ACCESS_KEY=$oldSecret
    $env:AWS_SESSION_TOKEN=$oldSession
    Remove-Item -LiteralPath $tempPath -ErrorAction SilentlyContinue
}
