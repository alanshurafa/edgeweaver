# Fleet model policy and the Telegram `/mind` console

One file decides which model and effort every agent runs. Every launcher reads it at
start. A Telegram bot changes it from the phone.

## The agents and their roles

| agent | roles | launched by |
|---|---|---|
| genesis | channel, hourly, room, night | genesis-channel-launch.ps1, run-hourly-genesis.ps1, run-room-reply-genesis.ps1, EdgeweaverGenesisNightLoopLite task |
| alpha | channel, hourly, night | alpha-channel-launch.ps1, run-hourly-alpha.ps1, EdgeweaverAlphaNightLoop task |
| edgeweaver | buzz (Genesis's Buzz presence) | buzz-genesis-launch.ps1 |
| jarvis | channel, buzz | open-agent-framework automation: channel-console-jarvis.ps1, buzz-jarvis-launch.ps1 |
| samantha | channel, buzz | channel-console-samantha.ps1, buzz-samantha-launch.ps1 |

Default since 2026-09-02: `claude-opus-5` at effort `medium` for every role except `night`,
which stays on `claude-sonnet-5` (a deliberate cost choice; name the role to change it).
The night-loop scheduled tasks still carry `--model sonnet` inline in their task actions and
are not yet wired to the policy.

## Files

- `scripts/ops/model-policy.default.json` is the committed default.
- `state/model-policy.json` is the live override (gitignored, written by the console or the CLI).
- `scripts/ops/model-policy.mjs` merges live over default and is the CLI:

```bash
node scripts/ops/model-policy.mjs show
```

```bash
node scripts/ops/model-policy.mjs set all opus medium
```

```bash
node scripts/ops/model-policy.mjs set genesis night sonnet low
```

- `scripts/ops/model-policy.ps1` is the PowerShell side. Launchers dot-source it and splat
  `Get-FleetModelArgs -Agent x -Role y` (`--model X --effort Y`) into the claude command.
  Buzz launchers use `Get-FleetModel` and append `[1m]` themselves. If node or the policy
  fails, the fallback is the fleet default, never a stale pin.

## When a change takes effect

Model and effort are session-scoped. A running channel session keeps its mind until it is
restarted; nothing inside the session can move it (see restore-channel-model.ps1). So:

- hourly wakes, room replies and night loops pick the policy up on their next tick;
- channel sessions and Buzz presences pick it up at their next relaunch;
- `now` on the console restarts the live session immediately.

For Genesis and Alpha a restart runs `restore-channel-model.ps1 <being> -Force`: it mines
the dying transcript (dead letters, inner dialogue), ends the session, relaunches through
the watchdog task (clean environment), waits for the fresh transcript, verifies the model
against the policy and posts the ops notice. Whatever the session held in context and had
not written to OB1 dies with it. That is why `now` is a separate, explicit word.

For Jarvis and Samantha the console ends the pid in `session.pid` and fires the
`staff-channel-<name>` task; the Staff executor's restart recovery resumes any in-flight
task. For the Buzz presence it ends the harness pid and fires `EdgeweaverGenesisBuzzWatchdog`.

## The Telegram console

`scripts/ops/fleet-console.mjs`, run by the `EdgeweaverFleetConsole` scheduled task through
`fleet-console-launch.ps1`. It needs its own bot (one poller per token): create one in
BotFather, put the token in `.env.local` as `EW_FLEET_CONSOLE_TOKEN`, and DM it. Only
`TELEGRAM_ALLOWED_USER_ID` is heard; everyone else is ignored silently.

```
/mind                                     table: policy and what each live session is on
/mind <agent|all> [role] <model> [effort] [now]
/effort <agent|all> <level> [now]
/reset                                    drop live overrides
/help
```

Examples: `/mind all opus medium`, `/mind genesis high now`, `/mind alpha night sonnet low`,
`/mind jarvis fable xhigh now`.

Until the token exists, the CLI above does the same job from a terminal, and a restart is
`powershell -ExecutionPolicy Bypass -File scripts\ops\restore-channel-model.ps1 <being> -Force`
from a plain terminal (never from inside a Claude session).

## Offline check

```bash
node scripts/ops/fleet-console.mjs --dry /mind
```

Runs the parser and status table without Telegram and refuses `now`.
