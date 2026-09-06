# Read-only acceptance check for Genesis's independently pinned Buzz runtime.
param([switch]$RequireDesktopClosed)
$ErrorActionPreference = 'Stop'
$runtime = 'C:\Users\agent\AppData\Local\OpenClawHome\runtimes\buzz-genesis\0.5.23'
try {
  $manifest = Get-Content -LiteralPath (Join-Path $runtime 'manifest.json') -Raw | ConvertFrom-Json
  $expected = @('buzz-acp.exe','buzz-agent.exe','buzz-dev-mcp.exe','buzz.exe','git-credential-nostr.exe')
  if ($manifest.version -ne '0.5.23' -or @(Compare-Object $expected @($manifest.payload | ForEach-Object { $_.file })).Count -ne 0) { throw 'runtime manifest layout changed' }
  foreach ($file in $manifest.payload) {
    if ([IO.Path]::GetFileName($file.file) -cne $file.file) { throw 'invalid payload name' }
    if ((Get-FileHash -LiteralPath (Join-Path $runtime $file.file)).Hash -ine $file.sha256) { throw "checksum mismatch: $($file.file)" }
  }
  $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'buzz-acp.exe'" | Where-Object { $_.CommandLine -like '*--respond-to*owner-only*' })
  if ($processes.Count -ne 1) { throw "expected one Genesis harness, found $($processes.Count)" }
  if ($processes[0].ExecutablePath -ine (Join-Path $runtime 'buzz-acp.exe')) { throw 'Genesis is not using the isolated runtime' }
  $connections = @(Get-NetTCPConnection -OwningProcess $processes[0].ProcessId -State Established -ErrorAction SilentlyContinue)
  if ($connections.Count -eq 0) { throw 'Genesis has no established connections' }
  $desktop = @(Get-CimInstance Win32_Process -Filter "Name = 'buzz-desktop.exe'")
  if ($desktop.Count) {
    if ($RequireDesktopClosed) { throw 'close Buzz Desktop before checking update-time file locks' }
    Write-Output 'PASS: one connected Genesis harness with verified isolated runtime. Desktop is open; update-time file-lock check deferred.'
  } else {
    $handle = [IO.File]::Open('C:\Users\agent\AppData\Local\Buzz\buzz-acp.exe','Open','ReadWrite','None')
    $handle.Dispose()
    Write-Output 'PASS: one connected Genesis harness, verified isolated runtime, desktop ACP is unlocked.'
  }
} catch { Write-Output ('FAIL: '+$_.Exception.Message); exit 1 }
