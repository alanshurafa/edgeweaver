# Prebuild loop runbook - the autonomous dark build, start to finish

> Authority chain: PREBUILD.md (D13) > this runbook. This file is the standing orders for a
> /loop run that builds every Bucket-A component. Each loop iteration MUST re-read this file
> and PREBUILD.md §6 fresh from disk: the repo is the memory, not the conversation.

## How Alan starts it (once)

1. Open Claude Code in this repo. Be present for the first iteration (~30-45 min: it is the
   login sitting). Choose a permission mode that lets the run edit files and run commands
   without prompting for every step, or stay nearby to approve.
2. Run:
   `/loop Follow handoff/prebuild-loop.md exactly. First iteration: Phase 0 provisioning
   with me present. Then build PREBUILD.md sessions S1-S8 until every §6 row is PASS or
   parked with a logged reason. Commit and push every iteration. Never cross a STOP gate,
   never tick checklists or the §1 ledger, never touch soulfiles, never run First Boot.
   When done or nothing buildable remains, post the final report and end the loop.`
3. Walk away after Phase 0. Glance at commits and the §6 table whenever curious.

## Phase 0 - provisioning (first iteration only, Alan present)

Purpose: collect every login up front so the build never stalls on a credential.

1. Inventory what exists: read `.env.local` variable names (never print values), run
   `ant auth status` if `ant` is installed. Build the missing-items list from the table
   below. Skip anything already present and verified.
2. Walk Alan through each missing item, one at a time, with exact steps. Verify each
   credential the moment it lands, before moving to the next:

| # | Item | Alan does | Lands as | Immediate verify |
|---|---|---|---|---|
| B1 | Anthropic OAuth | install `ant` (try scoop, then release binary, then `go install`; record which worked in ops-log), then `ant auth login` (browser, pick org/workspace) | OAuth profile, no env var | `ant auth status` shows active profile; one tiny `ant messages count-tokens` call succeeds. Confirm ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN are NOT set (they shadow the profile) |
| B2a | Deepgram | signup, create API key | DEEPGRAM_API_KEY | projects-list API call returns 200 |
| B2b | LiveKit Cloud | signup, create project + key pair | LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET | mint a room token locally; list-rooms API call returns 200 |
| B3 | TTS (one required, both preferred for the W3 bake-off) | ElevenLabs and/or Cartesia signup + key | ELEVENLABS_API_KEY, CARTESIA_API_KEY | voices-list call returns 200 on each provided |
| B4 | Telegram | @BotFather new bot; @userinfobot for numeric id | TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USER_ID | `getMe` returns the bot. One pairing round-trip test is allowed later (A8), then the channel session closes until Phase 3 arms |
| B5 | Supabase session-pooler string | Supabase → Settings → Database → Connection string → Session pooler | SUPABASE_DB_URL (.env.local) + `gh secret set SUPABASE_DB_URL -R alanshurafa/edgeweaver-backups` | trigger the backups workflow; first green run closes checklist 00's G2 verify (this arm is sanctioned: G2 is already Decided) |
| B6 | thought_edges migration | says yes/no to applying it now | applied via supabase CLI with existing service key | `select count(*) from thought_edges` runs; then re-run SPARK ingest (idempotent, edges only) |

3. Optional while Alan is present (none of these block the build; log any answers in
   decisions.md): gate answers for G4 (emoji), G5 (hosting), G6 (ceiling number, present
   the observed-usage table), G7 (private journal); the ChatGPT export zip drop for 0a.
4. Tick provisioned rows in decisions.md's "Needed from Alan" table with dates. Commit
   (never a secret value, names only). If Alan must leave mid-list: park the missing items,
   note which A-components they block, and proceed: the build starts anyway.

## Every iteration after Phase 0 (the loop body)

1. `git pull`. Read PREBUILD.md §5 and §6. Pick the earliest session (S1..S8) with
   unfinished, unblocked items. S2 (mind server) may run any time after B1.
2. Build per the five dark rules (PREBUILD §0) and START-HERE's iron rules. In particular:
   - every component lands disabled behind `state/flags.json`;
   - every component ships a verify script under `scripts/verify/` printing PASS/FAIL;
   - anything written to OB1 in tests carries `metadata.rehearsal=true` + `nl-rehearsal-*`
     run_id and is voided immediately after the verify (use the scratch-restore DB instead
     once B5 landed);
   - the initiation machinery (A16) rehearses on a throwaway sandbox repo only;
   - templates/ are the authoritative specs (night-loop-contracts, state-schemas,
     coherence-queries); checklists 03-08 give the per-item verify wording to mirror darkly.
3. On dark PASS: fill the component's §6 row (date + one-line evidence: the verify script
   path and its output). Do NOT tick any checklist box or §1 ledger line. The only
   sanctioned real arms during this run: the G2 backups verify (B5, checklist 00) and A19's
   disaster-recovery drill (it arms by being performed once).
4. On failure: two genuine attempts, then park: note in the §6 row, blocked-entry in
   decisions.md per the START-HERE template (with recommended default), move to the next
   item. Never improvise against the templates; never mark a verify that did not run.
5. End every iteration: `git add -A && git commit -m "build: prebuild <ids> - <one line>"
   && git push`. Then:
   - buildable work remains → continue immediately (or schedule a short wakeup);
   - waiting only on something external (e.g. a workflow run) → schedule a wakeup sized to
     that wait, with the reason stated;
   - goal met, or every remaining item parked → final report, and do NOT schedule another
     wakeup: that ends the loop.

## Hard limits (the run never does these, no matter what)

- No STOP gate crossed (G4 G5 G6 G7 stay parked unless Alan answered them in Phase 0, and
  even then only the *build-side* consequence changes: activation still waits for phases).
- No First Boot, no rites, no probe baseline, no stage or tier change, no checklist/ledger
  ticks beyond the two sanctioned arms above.
- No writes to edgeweaver-soul (not even proposal branches during prebuild); no credential
  near the gates repo; secrets only in `.env.local`/`state/`.
- No live channel presence: Telegram gets at most the single A8 pairing round-trip, then
  the channel closes until Phase 3 arms.
- Rehearsal residue: zero rows left behind (voider verified after every rehearsal).
- Honest reporting: failures reported as failures, partials as partials (iron rule 9).

## Done definition and final report

Done = every A1-A21 row in PREBUILD §6 shows PASS, or is parked with a reason and a
decisions.md entry. The final report (posted as the last loop message and appended to
ops-log.md): the §6 table as built; parked items with their unblock conditions; B-items
still missing; observed spend vs the PLAN §10.2 table (feeds G6); and the human moves that
are now next (gate answers, Phase 2 items, First Boot readiness). Then the loop ends by
not rescheduling.
