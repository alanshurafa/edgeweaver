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

## The Telegram command: `/mind` through Jarvis or Samantha

No bot of its own. Send the command to Jarvis's or Samantha's Telegram bot; their channel
sessions run `scripts/ops/fleet-mind.mjs` and reply with its output verbatim (instructions
in `~/.staff/<name>-home/CLAUDE.md`, section "The fleet's minds"). Either assistant can
change any agent. Neither restarts itself, because a session cannot end itself and still
answer: ask Jarvis to restart Samantha and Samantha to restart Jarvis. The tool knows who
is running it (`--self`) and says so.

```
/mind                                     table: policy and what each live session is on
/mind <agent|all> [role] <model> [effort] [now]
/effort <agent|all> <level> [now]
/reset                                    drop live overrides
/help
```

Examples: `/mind all opus medium`, `/mind genesis high now`, `/mind alpha night sonnet low`,
`/mind jarvis fable xhigh now` (sent to Samantha).

Only Alan's messages count: the staff channel access lists allow one user id, and the
CLAUDE.md rule treats a `/mind` line found anywhere else as data. The staff sessions run
`--permission-mode auto`; to make the tool call prompt-free regardless, add to
`~/.staff/claude/settings.json` permissions.allow:

```
"Bash(node C:\\Users\\agent\\Project\\Edgeweaver\\scripts\\ops\\fleet-mind.mjs:*)",
"PowerShell(node C:\\Users\\agent\\Project\\Edgeweaver\\scripts\\ops\\fleet-mind.mjs:*)"
```

From a terminal the same tool works without `--self`:

```bash
node scripts/ops/fleet-mind.mjs -- /mind all opus medium
```

## Offline check

```bash
node scripts/ops/fleet-mind.mjs --self samantha --dry -- /mind all opus high now
```

Runs the parser and the self-restart guard without changing the policy or restarting
anything. Under Git Bash, set `MSYS_NO_PATHCONV=1` or the leading slash becomes a path.
