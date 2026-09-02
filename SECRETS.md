# SECRETS.md — key manifest (names and provenance ONLY; values never live here)

Source of truth for values: the **sealed DR bundle + paper** (D11: passphrase-encrypted
`age -p` bundle, copies at state/dr-staging, OneDrive Desktop, and a release asset in the
private backups repo; root of trust is Alan's memorized passphrase + the paper at home.
There is deliberately NO password manager in this design). This file exists so a bare
machine can be re-seeded: every key, what it's for, where a fresh value comes from. Update
this table whenever `.env.local` gains or loses a key — the weekly machine-state backup
archives the key *names* alongside the encrypted values, so drift shows up in drills.

## `.env.local` (repo root, gitignored) — Genesis + shared ops

| Key | What | Re-issue / retrieve |
|---|---|---|
| SUPABASE_URL | family brain Supabase project URL | Supabase dashboard → Settings → API |
| SUPABASE_ANON_KEY | public (anon) API key | same page |
| SUPABASE_SERVICE_KEY | service-role key, full DB access — present since 2026-07-04. OPS-ONLY by design (FAMILY.md §4); moving the being's runtime off it is a standing pre-Telegram task | same page, `service_role` (Alan retrieves) |
| OB1_MCP_URL | OB1 MCP edge-function endpoint | Supabase → Edge Functions; also OB1 dashboards `.env.local` |
| OB1_MCP_KEY | key for that endpoint (guards recall-scoped, agent-memory-api, sql-migrate) | same |
| TELEGRAM_BOT_TOKEN | Genesis's Telegram bot — **value pending** (Phase 3) | @BotFather (`/token`; revoke with `/revoke`) |
| TELEGRAM_ALLOWED_USER_ID | Alan's Telegram user id (config, not secret) — **value pending** | @userinfobot |
| LAB_DB_URL | brain lab (D15/BRAINS.md): edgeweaver-lab pooler string, scratch brains only | Supabase → edgeweaver-lab → Connection string |
| EW_SITE_PASSWORD | Vercel shared-password gate for the private explainer site; fail-closed, 20-character minimum | Vercel project environment settings; Alan sets and rotates it out of band |

**Deliberately absent (do not create):**

| Name | Why it must not exist |
|---|---|
| ANTHROPIC_API_KEY | D12: all scripted LLM steps run through the claude CLI on Alan's subscription OAuth; a set key would shadow the profile. Must stay unset. |
| SOUL_REPO_PAT | Superseded (decisions.md Phase-2 notes): the daemon holds zero write access to any canonical soul; it works from a fork and opens PRs cross-repo. Never mint. |

## `edgeweaver-backups` repo → Actions secrets

| Secret | What | Source |
|---|---|---|
| SUPABASE_DB_URL | **Session-pooler** Postgres connection string (nightly `pg_dump`) — set 2026-07-07, G2 green | Supabase → Settings → Database → Connection string → *Session pooler* |
| TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID | backup-failure alerts — **pending** (mirror of `.env.local` values above) | set with `gh secret set <NAME> -R alanshurafa/edgeweaver-backups` |
| HEALTHCHECKS_URL | dead-man-switch ping (alerts on backup *silence*) — **pending, optional** | healthchecks.io → the check's ping URL |

## Not in any file on any machine

| Item | Custody |
|---|---|
| **age private key** — decrypts every brain dump and machine-state archive | generated 2026-07-04. Sealed DR bundle + paper (D11); root of trust is Alan's memorized passphrase |
| Supabase / GitHub / Anthropic account logins | their owners' heads and devices |

## Alpha (created at A2, FAMILY.md §7 — placeholders so drift shows early)

| Item | What | Custody plan |
|---|---|---|
| `ew_alpha` role connection string (`EW_ALPHA_DB_URL`) | Alpha's ONLY runtime credential: its schema + the corpus view, nothing else; written by `scripts/brainrooms/ew-alpha-room.mjs --target live` at the gated A2 apply | avatars/alpha/.env.local (gitignored) once A2 lands; at the D31 dashboard deploy also a Vercel server-side env (piped from the env file, never echoed) - a second cloud custodian, named |
| Circle dashboard password (`ALPHA_DASH_PASSWORD`) | gates the read-only Alpha dashboard (`tools/alpha-dashboard/`, D31); fail-closed 503 while unset; cookie is an HMAC of it, so rotation revokes every session | Vercel env only, value set by Alan in the Vercel dashboard (D21 custody pattern); Alan chose the site password's value (2026-07-23) - the site copy is Sensitive/write-only in Vercel, so it cannot be cloned programmatically and Alan re-enters it; rotating either surface means updating both by hand; shared with the six seats by Alan, never in git or terminals. SEAT-EXIT RULE (first case: Millicent, D32 2026-07-23): a departing seat holds this value (and the site's, same value per D31), so rotation on BOTH Vercel surfaces + redistribution to current seats is owed at every exit; Alan's hand only |
| Alpha Telegram bot token + seat-ID allowlist (`ALPHA_BOT_TOKEN`, `ALPHA_SEAT_IDS`) | Alpha's channel; multi-sender pinned allowlist (policy: `scripts/telegram/multi-sender-policy.mjs`, dark; runbook: `avatars/alpha/handoff/telegram-pairing-runbook.md`) | same |
| Alpha age key | encrypts Alpha's backup stream | passphrase SPLIT among seats, any two reconstruct (D18); shares cut at a founding ceremony, never on this machine |

Iron rule (START-HERE.md): secrets only in `.env.local` / `state/` (both gitignored) and
the stores above. Never in git, OB1 memory, soulfiles, or the gates repo.
