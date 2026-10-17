param(
  [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent),
  [string]$RuntimeRoot = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) '.intelwatch-work\public-host')
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$RuntimeRoot = [System.IO.Path]::GetFullPath($RuntimeRoot)
New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
$hostMutex = [System.Threading.Mutex]::new($false, 'Local\InternationalIntelligenceWatchHost')
if (-not $hostMutex.WaitOne(0)) { exit 0 }
$hostStateFile = Join-Path $RuntimeRoot 'processes.json'
$hostLog = Join-Path $RuntimeRoot 'supervisor.log'
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$env:NODE_ENV = 'production'
$services = @{
  api = @{ Directory = $ProjectRoot; Arguments = @("--env-file=`"$ProjectRoot\.env`"", 'apps/api/src/main.ts') }
  web = @{ Directory = (Join-Path $ProjectRoot 'apps\web'); Arguments = @("--env-file=`"$ProjectRoot\.env`"", 'server.ts') }
  worker = @{ Directory = $ProjectRoot; Arguments = @("--env-file=`"$ProjectRoot\.env`"", 'apps/worker/src/main.ts') }
}
$owned = @{}
if (Test-Path -LiteralPath $hostStateFile) {
  $saved = Get-Content -LiteralPath $hostStateFile -Raw | ConvertFrom-Json
  foreach ($property in $saved.PSObject.Properties) { $owned[$property.Name] = $property.Value }
}
function Write-HostLog([string]$Message) {
  Add-Content -LiteralPath $hostLog -Value "$(Get-Date -Format o) $Message"
}
function Service-IsRunning([string]$Name) {
  if (-not $owned.ContainsKey($Name)) { return $false }
  $record = $owned[$Name]
  $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($record.Id)" -ErrorAction SilentlyContinue
  return $null -ne $current -and $current.Name -eq 'node.exe' -and $current.CommandLine -eq $record.CommandLine
}
try {
  # Keep the computer awake only while this host runs; the display can still turn off.
  Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class IntelligenceHostPower { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags); }'
  Write-HostLog 'Supervisor started; hosting remains local until a separate publication is configured.'
  while ($true) {
    [IntelligenceHostPower]::SetThreadExecutionState([uint32]2147483649) | Out-Null
    $pgBin = Join-Path (Split-Path $RuntimeRoot -Parent) 'postgres-runtime\bin\pg_ctl.exe'
    $pgData = Join-Path (Split-Path $RuntimeRoot -Parent) 'postgres-data'
    & $pgBin -D $pgData status *> $null
    if ($LASTEXITCODE -ne 0) {
      & $pgBin -D $pgData -l (Join-Path $RuntimeRoot 'postgres.log') -o '-p 55433 -h 127.0.0.1' -w -t 60 start *> $null
      if ($LASTEXITCODE -ne 0) { Write-HostLog 'Database startup failed; retry in 20 seconds'; Start-Sleep -Seconds 20; continue }
    }
    foreach ($name in @('api', 'web', 'worker')) {
      if (Service-IsRunning $name) { continue }
      $service = $services[$name]
      $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
      $child = Start-Process -FilePath $nodeExe -ArgumentList $service.Arguments -WorkingDirectory $service.Directory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $RuntimeRoot "$name-$stamp.out.log") -RedirectStandardError (Join-Path $RuntimeRoot "$name-$stamp.err.log") -PassThru
      $details = Get-CimInstance Win32_Process -Filter "ProcessId=$($child.Id)"
      if ($null -eq $details) { Write-HostLog "$name exited during startup"; continue }
      $owned[$name] = @{ Id = $child.Id; CommandLine = $details.CommandLine }
      $owned | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $hostStateFile -Encoding UTF8
      Write-HostLog "Started $name PID=$($child.Id)"
    }
    Start-Sleep -Seconds 20
  }
} finally {
  [IntelligenceHostPower]::SetThreadExecutionState([uint32]2147483648) | Out-Null
  $hostMutex.ReleaseMutex()
  $hostMutex.Dispose()
}
