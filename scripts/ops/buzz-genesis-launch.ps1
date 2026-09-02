# Edgeweaver Genesis - Buzz channel launcher (ASCII only)
#
# Starts ONE buzz-acp harness for Genesis against the canonical Buzz relay and exits.
# The harness keeps running as a detached child. Called by buzz-genesis-watchdog.ps1,
# and safe to run by hand.
#
# Built dark 2026-08-01 per avatars/genesis/handoff/buzz-harness-edgeweaver-plan.md
# stage B3. Running it is an arming act and is Alan's hand (B5 cutover), not the loop's.

$repo      = 'C:\Users\agent\Project\Edgeweaver'
$pack      = "$repo\avatars\genesis\buzz-pack"
$acp       = 'C:\Users\agent\AppData\Local\buzz\buzz-acp.exe'
$store     = 'C:\Users\agent\AppData\Roaming\xyz.block.buzz.app\agents\managed-agents.json'
$pubkey    = 'dea7e846155e1a9207658ec6dd091c95d66dbbb9ccd026fa7112f02e6739202e'
$credTarget = 'secrets.buzz-desktop'
$nest      = "$repo\avatars\genesis\buzz-nest"
$logDir    = "$repo\logs"
$pidFile   = "$repo\state\channel-pid-genesis-buzz.txt"
$opsLog    = "$logDir\buzz-genesis-launch.log"

# CANONICAL RELAY (Alan's decision 2026-08-01, reversing the earlier self-hosted choice).
# The string is exact: no trailing slash, no :443. buzz-core normalize_relay_url and the
# desktop's runtime-key hash both depend on the exact form, and Edgeweaver's real channel
# c7b4f1dd-ef58-459b-86fb-a5a0d9d40bce lives on this relay, not on the local one.
$relayUrl = 'wss://edgeweaver.communities.buzz.xyz'

function Say($msg) {
  $line = "$(Get-Date -Format s) $msg"
  Add-Content -Path $opsLog -Value $line -Encoding Ascii -ErrorAction SilentlyContinue
  Write-Output $line
}

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
if (-not (Test-Path $nest))   { New-Item -ItemType Directory -Path $nest   -Force | Out-Null }

# TWO PRESENCES NEVER OVERLAP. The relay does NOT enforce this: two harnesses on one
# pubkey both connect and both reply, which is exactly how a double presence ran for 20
# hours unnoticed on 2026-08-01. The launch precondition is the only guard there is, so
# it checks for BOTH a caretaker-managed harness (ours, identifiable by its flags) and a
# desktop-managed one (bare command line, spawned by the Buzz app).
$existing = @(Get-CimInstance Win32_Process -Filter "Name = 'buzz-acp.exe'" -ErrorAction SilentlyContinue)
if ($existing.Count -gt 0) {
  $ours = @($existing | Where-Object { $_.CommandLine -like '*--respond-to*owner-only*' })
  if ($ours.Count -gt 0) {
    Say "ABORT already running: caretaker harness pid $($ours[0].ProcessId); refusing to start a second presence"
    exit 0
  }
  # A bare buzz-acp could be any desktop-managed agent, including Genesis itself. The
  # desktop writes one pid file per agent keyed by pubkey; that is what disambiguates.
  $deskPids = @(Get-ChildItem 'C:\Users\agent\AppData\Roaming\xyz.block.buzz.app\agents\agent-pids\*.json' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "$pubkey*" } |
    ForEach-Object { try { (Get-Content $_.FullName -Raw | ConvertFrom-Json).pid } catch {} } |
    Where-Object { $_ -and (Get-Process -Id $_ -ErrorAction SilentlyContinue) })
  if ($deskPids.Count -gt 0) {
    Say "ABORT desktop-managed Genesis is alive (pid $($deskPids -join ',')); retire it before the caretaker takes over"
    exit 0
  }
}

if (-not (Test-Path $acp)) { Say "ABORT harness binary missing at $acp"; exit 1 }

# AUTH TAG (NIP-OA owner attestation). This, not a relay roster row, is what admits the
# agent: it proves Alan owns this key and Alan is a member. Read from the desktop record;
# it is credential-shaped, so it is never printed and never written to a log or a
# command line.
$authTag = $null
try {
  $records = Get-Content $store -Raw -Encoding UTF8 | ConvertFrom-Json
  $rec = $records | Where-Object { $_.pubkey -eq $pubkey } | Select-Object -First 1
  if ($rec) { $authTag = $rec.auth_tag }
} catch { Say "WARN could not read the agent record: $($_.Exception.Message)" }
if (-not $authTag) { Say "ABORT no auth_tag for $($pubkey.Substring(0,8)); the relay would refuse this key"; exit 1 }

# PRIVATE KEY. Not in managed-agents.json: the desktop blanks it there once the key is in
# the OS keyring. It lives in the Windows Credential Manager blob as UTF-16LE JSON, one
# entry per agent keyed agent:<pubkey>. A scheduled task must run with an interactive
# token to reach the vault; a task set to run whether-logged-on-or-not uses S4U logon and
# cannot decrypt it. The watchdog task is registered InteractiveToken for this reason.
if (-not ('EwCredMan' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class EwCredMan {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL { public uint Flags; public uint Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint CredentialBlobSize;
    public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes;
    public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
}
'@
}

$nsec = $null
$ptr = [IntPtr]::Zero
if (-not [EwCredMan]::CredRead($credTarget, 1, 0, [ref]$ptr)) {
  Say "ABORT credential vault unreadable (win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error())); if this ran from a scheduled task, check the task uses an interactive token"
  exit 1
}
try {
  $c = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][EwCredMan+CREDENTIAL])
  $buf = New-Object byte[] $c.CredentialBlobSize
  [Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob, $buf, 0, $c.CredentialBlobSize)
  $blob = [Text.Encoding]::Unicode.GetString($buf) | ConvertFrom-Json
  $nsec = $blob."agent:$pubkey"
} catch {
  Say "ABORT could not parse the credential blob"
} finally {
  [EwCredMan]::CredFree($ptr)
  if ($buf) { [array]::Clear($buf, 0, $buf.Length) }
  Remove-Variable blob, buf, c -ErrorAction SilentlyContinue
}
if (-not $nsec) { Say "ABORT no key for agent:$($pubkey.Substring(0,8)) in the vault"; exit 1 }

# Secrets go in the ENVIRONMENT, never on the command line: a command line is readable by
# any process on the box through Win32_Process. Everything non-secret goes on the command
# line instead, which is also what makes this harness distinguishable from a
# desktop-spawned one (the desktop passes everything by env and spawns a bare binary).
$env:BUZZ_PRIVATE_KEY = $nsec
$env:BUZZ_AUTH_TAG    = $authTag
Remove-Variable nsec, authTag

# Do NOT set BUZZ_MANAGED_AGENT. It is the desktop reaper's sole ownership proof; carrying
# it would invite the Buzz app to kill a process it does not own.
$env:RUST_LOG = 'buzz_acp=info'

# PATH for the harness's children, mirroring the desktop's build_augmented_path. The
# claude-agent-acp shim is a .cmd in Buzz's app-private npm prefix (node-tools), the node
# it runs is Buzz's managed runtime, and the buzz CLI the handbook teaches is a sidecar
# beside buzz-desktop.exe. None of the three are on the plain user PATH (verified
# 2026-08-03). Prepended, so they win over any stray global installs.
$env:Path = 'C:\Users\agent\AppData\Roaming\Buzz\node-tools;' +
            'C:\Users\agent\AppData\Roaming\Buzz\runtimes\node\v24.18.0\win-x64;' +
            'C:\Users\agent\AppData\Local\Buzz;' + $env:Path

$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$outLog = "$logDir\buzz-genesis-harness-$stamp.log"
$errLog = "$logDir\buzz-genesis-harness-$stamp.err.log"

# --agent-command is the FULL PATH to the .cmd shim, not the bare name: CreateProcess
# only searches PATH for .exe, so a bare "claude-agent-acp" never resolves. Rust's
# Command special-cases a path ending in .cmd/.bat (runs it via cmd.exe), which is how
# the desktop spawns the same shim. --model mirrors the desktop record's pinned model
# so the caretaker presence behaves identically to the A5-verified one.
. 'C:/Users/agent/Project/Edgeweaver/scripts/ops/model-policy.ps1'
$buzzModel = Get-FleetModel -Agent edgeweaver -Role buzz
$argList = @(
  '--relay-url',           $relayUrl,
  '--respond-to',          'owner-only',
  '--agents',              '1',
  '--heartbeat-interval',  '0',
  '--agent-command',       'C:\Users\agent\AppData\Roaming\Buzz\node-tools\claude-agent-acp.cmd',
  '--model',               "$buzzModel[1m]",
  '--base-prompt-file',    "$pack\base-prompt-edgeweaver.md",
  '--system-prompt-file',  "$pack\system-prompt-edgeweaver.md",
  '--no-memory'
)

# AGENT_CWD does not exist. There is no env var or flag for the agent's working
# directory anywhere in buzz-acp; it is the harness PROCESS's own cwd. Hence
# -WorkingDirectory, and hence buzz-nest has to exist before this line.
$proc = Start-Process -FilePath $acp -ArgumentList $argList -WorkingDirectory $nest `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog -NoNewWindow -PassThru

$env:BUZZ_PRIVATE_KEY = $null
$env:BUZZ_AUTH_TAG    = $null

if ($proc) {
  Set-Content -Path $pidFile -Value $proc.Id -Encoding Ascii
  Say "launched harness pid $($proc.Id) relay $relayUrl log $(Split-Path $outLog -Leaf)"
} else {
  Say "ABORT Start-Process returned nothing"
  exit 1
}
