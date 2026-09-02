# Fleet console launcher (ASCII only). Runs the Telegram bot that reads and changes every
# agent's model + effort (scripts/ops/fleet-console.mjs; token EW_FLEET_CONSOLE_TOKEN in
# repo .env.local, never here). Registered as the EdgeweaverFleetConsole scheduled task
# (at logon + every 15 minutes) so it always starts from a clean Task Scheduler
# environment, never as a child of a Claude session (a nested launch inherits CLAUDECODE
# and any relaunch it triggers comes up mute, ops-log 2026-08-01). Self-healing loop: if
# the console exits (network blip, node crash), wait 30s and start it again. Two consoles
# on one token would fight over getUpdates (one-poller-per-token, proven 2026-07-16), so
# exit if one is already running. Exits quietly when the token is not configured yet.
$dup = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*fleet-console.mjs*' }
if ($dup) { exit 0 }
$repo = 'C:\Users\agent\Project\Edgeweaver'
$envFile = Join-Path $repo '.env.local'
if (-not (Test-Path $envFile) -or -not (Select-String -Path $envFile -Pattern '^EW_FLEET_CONSOLE_TOKEN=.+' -Quiet)) {
  Add-Content -Path "$repo\logs\fleet-console.log" -Value "$(Get-Date -Format s) fleet-console-launch: EW_FLEET_CONSOLE_TOKEN not set in .env.local; not starting" -Encoding Ascii
  exit 0
}
$host.UI.RawUI.WindowTitle = 'EdgeweaverFleetConsole'
Set-Location $repo
Remove-Item Env:CLAUDECODE -ErrorAction SilentlyContinue
Remove-Item Env:CLAUDE_CODE_SESSION_ID -ErrorAction SilentlyContinue
Remove-Item Env:CLAUDE_CODE_ENTRYPOINT -ErrorAction SilentlyContinue
# cmd owns the stderr redirect: PS 5.1 wraps a native command's stderr in
# NativeCommandError records, which killed the room ear seconds after its first stderr
# line (2026-08-22). Same pattern as room-ear-launch.ps1.
while ($true) {
  cmd /c "node scripts\ops\fleet-console.mjs 2>> logs\fleet-console.log"
  Start-Sleep -Seconds 30
}
