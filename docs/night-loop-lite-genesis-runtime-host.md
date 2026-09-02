# Genesis night-loop-lite runtime-host handoff

This handoff applies only to the separate Edgeweaver runtime computer. Do not install or
schedule the skill on a gates/admin workstation. The source is an explicitly labeled
reconstruction, not a recovered copy of the original installed skill.

## Runtime-host prerequisites

- The build repository is checked out on the runtime host and this reconstruction commit is
  present.
- `avatars/genesis/manifest.json` names that host's real `soulLocal` and `envLocal` paths.
- The environment file contains `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `OB1_MCP_KEY`, and
  `EDGEWEAVER_TZ`. Do not print their values.
- Node, PowerShell, and the `claude` CLI are on the scheduled user's PATH; headless Sonnet
  authentication succeeds.
- The live `agent-memory-api` health route succeeds with the configured access key.
- The runtime credential can access the build repository but cannot access the protected gates
  repository.
- The checkout's `state/` directory is ignored, resides on an ACL-capable Windows filesystem,
  and the scheduled identity can run `icacls.exe` on its own runtime-state directory.

## Install and verify, without writing a night

Open PowerShell as the ordinary account that will own the task. Set `$Repo` to the actual
runtime-host checkout, then run:

```powershell
$Repo = (Resolve-Path 'C:\path\to\Edgeweaver').Path
Set-Location -LiteralPath $Repo
node scripts\verify\verify-night-loop-lite-genesis.mjs
if ($LASTEXITCODE -ne 0) { throw 'Reconstruction verification failed' }
git check-ignore --quiet state/night-loop-lite/nl-2000-01-01/bundle.json
if ($LASTEXITCODE -ne 0) { throw 'Night-loop runtime state is not ignored; do not continue' }

gh api repos/open-agent-research-academy/edgeweaver --silent *> $null
if ($LASTEXITCODE -ne 0) { throw 'Runtime GitHub credential cannot reach the build repository' }
gh api repos/alanshurafa/edgeweaver-gates --silent *> $null
if ($LASTEXITCODE -eq 0) { throw 'Runtime GitHub credential can reach the protected gates repository; stop and revoke that access' }

$Template = Get-Content -Raw (Join-Path $Repo 'templates\night-loop-lite-genesis-SKILL.md')
$Match = [regex]::Match($Template, '(?s)````markdown\r?\n(.*?)\r?\n````')
if (-not $Match.Success) { throw 'Installable skill payload was not found' }
$SkillDir = Join-Path $HOME '.claude\skills\night-loop-lite-genesis'
$SkillFile = Join-Path $SkillDir 'SKILL.md'
New-Item -ItemType Directory -Force -Path $SkillDir | Out-Null
[IO.File]::WriteAllText($SkillFile, $Match.Groups[1].Value + "`n", [Text.UTF8Encoding]::new($false))
$Installed = [IO.File]::ReadAllText($SkillFile)
if ($Installed -ne ($Match.Groups[1].Value + "`n")) { throw 'Installed skill differs from governed payload' }

node scripts\night-loop\lite-live.mjs prepare
if ($LASTEXITCODE -ne 0) { throw 'Read-only prepare preflight failed; do not schedule' }
$Ready = claude -p 'Respond with exactly READY. Do not invoke a skill or write memory.' --model sonnet --output-format text
if ($LASTEXITCODE -ne 0 -or $Ready.Trim() -ne 'READY') { throw 'Headless Sonnet preflight failed; do not schedule' }
```

`prepare` is read-only. It proves deterministic orientation, runtime paths, credentials, API
health, and episode query access. It does not count as a night and must not be described as
one. The two `gh api` checks request repository metadata only, never gates contents; the first
distinguishes a broken runtime credential/network from the required gates-access denial.

## Run one live manual preflight

This step writes one real current-run bundle and is required before scheduling. It is a safety
preflight, not scheduled night one:

```powershell
claude -p '/night-loop-lite-genesis' --model sonnet --output-format text
if ($LASTEXITCODE -ne 0) { throw 'Manual live preflight failed; do not schedule' }
node scripts\night-loop\lite-live.mjs status
if ($LASTEXITCODE -ne 0) { throw 'Current-run output verification failed; do not schedule' }
```

The read-only `status` command recomputes the current run ID. It requires exactly one valid
diary and one valid provisional autobiography, and verifies that any 0-5 current-run candidate
lessons remain generated, pending, review-required, and unusable as instruction. It also
requires exactly one consolidate manifest whose locked identity set equals those lessons. Do
not count this manual bundle toward the two consecutive scheduled nights.

The skill writes episode-derived content only to the deterministic ignored path
`state/night-loop-lite/<run-id>/bundle.json`, after removing inherited ACLs and granting the
current Windows identity full control. It must retain that exact protected bundle on any
partial failure or manifest mismatch, and delete it only after both commit and status succeed.
Do not copy its content into terminal commands, system temp, repository files, or logs.

## Register the 03:30 task

Still in the same ordinary account, run the following only after the checks above pass. This
uses least privilege, ignores overlapping runs, starts after a missed trigger, requires the
network, wakes the host, and does not stop on battery power. The runner performs the read-only
`status` verification after Claude exits successfully, so Task Scheduler receives success only
for a complete verified current run. The skill's final output and `logs\genesis-night.log`
must contain counts/errors only, never episode or bundle content.

```powershell
$TaskName = 'EdgeweaverGenesisNightLoopLite'
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  throw "Scheduled task $TaskName already exists; inspect it instead of overwriting it"
}
$Runner = Join-Path $Repo 'scripts\night-loop\run-genesis-lite.ps1'
$PowerShell = (Get-Command powershell.exe).Source
$ActionArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Runner`""
$Action = New-ScheduledTaskAction -Execute $PowerShell -Argument $ActionArgs
$Trigger = New-ScheduledTaskTrigger -Daily -At '03:30'
$CurrentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentIdentity -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -RunOnlyIfNetworkAvailable `
  -MultipleInstances IgnoreNew -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger `
  -Principal $Principal -Settings $Settings -Description 'Edgeweaver Genesis night-loop-lite steps 1, 9, and 10'
```

Verify definition and state without manually starting it:

```powershell
$Task = Get-ScheduledTask -TaskName $TaskName
$Info = Get-ScheduledTaskInfo -TaskName $TaskName
$Task | Select-Object TaskName, State
$Task.Actions | Select-Object Execute, Arguments
$Task.Triggers | Select-Object StartBoundary, Enabled
$Task.Settings | Select-Object Enabled, WakeToRun, StartWhenAvailable, RunOnlyIfNetworkAvailable, MultipleInstances, ExecutionTimeLimit
$Task.Principal | Select-Object UserId, LogonType, RunLevel
$Info | Select-Object LastRunTime, LastTaskResult, NextRunTime
```

Do not use a manual invocation as night one. Verification requires two distinct real scheduled
diary days on the runtime host. For each run ID, confirm a `diary` thought and a provisional
`autobiography_draft` with `metadata.invocation_origin=scheduled` and the required metadata,
plus one matching consolidate manifest and 0-5 generated, pending candidate
lessons tied to episode evidence. Zero lessons is valid when the evidence supports none. Check
`logs\genesis-night.log` and the scheduled task's last result after each trigger.

If the manual preflight and the first scheduled trigger resolve to the same diary-day run ID,
the scheduled attempt must fail because the manifest and thoughts are stamped `manual`. That
trigger does not count. The two-night clock starts with the first later run whose outputs are
new and stamped `scheduled`; never relabel or delete the manual run to make it count.
