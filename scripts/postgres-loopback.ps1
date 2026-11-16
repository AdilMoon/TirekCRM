# Run in an elevated PowerShell on the TirekCRM Windows workstation.
$ErrorActionPreference = 'Stop'
$serviceName = 'postgresql-x64-17'
$configPath = 'C:\Program Files\PostgreSQL\17\data\postgresql.conf'
$dataPath = Split-Path -Parent $configPath
$settingsPath = Join-Path $dataPath 'postgresql.auto.conf'
$service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
if (!$service -or !$service.PathName.Contains('-D "' + $dataPath + '"') -or $service.State -ne 'Running') {
    throw 'Expected the installed and running PostgreSQL 17 service at the documented data path.'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Open PowerShell as Administrator to change and restart the PostgreSQL service.'
}
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$original = [IO.File]::ReadAllText($configPath, $utf8)
$listen = '(?m)^[ \t]*listen_addresses[ \t]*=[^\r\n]*'
if ([regex]::Matches($original, $listen).Count -ne 1 -or
    $original -match '(?m)^[ \t]*include(?:_if_exists|_dir)?[ \t]*[=\x27"]' -or
    ((Test-Path -LiteralPath $settingsPath) -and ([IO.File]::ReadAllText($settingsPath) -match $listen))) {
    throw 'Unexpected PostgreSQL configuration. Inspect overrides before changing the listener.'
}
$updated = [regex]::Replace($original, $listen, "listen_addresses = 'localhost'")
$listeners = @(Get-NetTCPConnection -LocalPort 5432 -State Listen)
if ($listeners.Count -eq 0 -or @($listeners | Where-Object OwningProcess -ne $service.ProcessId).Count -gt 0) {
    # pg_ctl can be the service process, with postgres.exe as its child.
    $serverIds = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($service.ProcessId) AND Name='postgres.exe'" | Select-Object -ExpandProperty ProcessId)
    if (!$listeners.Count -or @($listeners | Where-Object { $_.OwningProcess -ne $service.ProcessId -and $_.OwningProcess -notin $serverIds }).Count -gt 0) {
        throw 'Port 5432 belongs to a different process.'
    }
}
if ($updated -eq $original -and @($listeners | Where-Object LocalAddress -notin @('127.0.0.1','::1')).Count -eq 0) {
    Write-Output 'PostgreSQL is already listening on loopback only.'
    return
}
$backupPath = $configPath + '.before-loopback-' + (Get-Date -Format 'yyyyMMddTHHmmssfff')
Copy-Item -LiteralPath $configPath -Destination $backupPath
try {
    [IO.File]::WriteAllText($configPath, $updated, $utf8)
    Restart-Service -Name $serviceName
} catch {
    Copy-Item -LiteralPath $backupPath -Destination $configPath -Force
    if ((Get-Service -Name $serviceName).Status -ne 'Running') { Start-Service -Name $serviceName }
    throw
}
$listeners = @(Get-NetTCPConnection -LocalPort 5432 -State Listen)
if ('127.0.0.1' -notin $listeners.LocalAddress -or @($listeners | Where-Object LocalAddress -notin @('127.0.0.1','::1')).Count -gt 0) {
    throw "Unexpected listeners after restart. Inspect the service and backup at $backupPath."
}
$listeners | Select-Object LocalAddress, LocalPort
