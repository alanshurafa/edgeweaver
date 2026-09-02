// restore-point.mjs - the time-machine MAP (D17 / BRAINS.md section 7): one JSON line per day
// tying the four stores together (brain backup, soul repo, body repo, live registry row), so a
// human or agent can ask "what did every store look like on day X" without hunting four places.
// Committed at brains/restore-points.jsonl. Metadata only, no secrets, ever.
//   node scripts/brains/restore-point.mjs --live [--root <path>]
//   node scripts/brains/restore-point.mjs --dry-run [--root <path>]
// gatherRestorePoint({ gh, git, root }) is pure given its injected gh/git callbacks: it makes no
// direct network call or shell-out itself. The CLI below wires gh/git to real execFileSync calls.
// Dark-verified on canned gh/git output (scripts/verify/verify-restore-point.mjs); the first real
// line is written later, live, by the orchestrator (BRAINS.md section 7, plan box T4).
//
// Sharp edges:
//   - rows is best-effort: parsed from the backup release body's own phrasing, either
//     "<N> rows" ("18 tables, 1,946 rows dumped") or "rows ...: <N>" (the pipeline's actual
//     current body reads "live rows at dump time: 1946"). A body with neither phrasing yields
//     null, never a guess.
//   - soulHead: `gh api .../commits/main --jq .sha` returns the FULL commit sha; the 7-char
//     truncation happens here in JS (not inside the gh call), so it stays testable without a
//     network call and without depending on gh/jq quoting behavior.
//   - stateArchive is always null for now: the machine-state storage-location decision (see
//     decisions.md open gates) has not closed. Do not infer or invent a location here.
//   - --live REPLACES any existing line for today's UTC date (idempotent: one line per day),
//     never appends a second line for the same date.
//   - --dry-run touches no network, no git, no gh: it only reads the local jsonl file, so it is
//     safe to run before .env.local or gh auth exist, and before the map file itself exists.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { loadRegistry } from "./profiles.mjs";

const ROOT = join(import.meta.dirname, "..", "..");

// Parse a total row count out of free-form release-body text. Two phrasings are recognized:
// "18 tables, 1,946 rows dumped" -> 1946, and the pipeline's actual current body
// "live rows at dump time: 1946" -> 1946. Returns null otherwise (never guesses).
export function parseRowsFromBody(body) {
  if (typeof body !== "string") return null;
  const m = body.match(/([0-9][0-9,]*)\s+rows\b/i) || body.match(/\brows\b[^:\r\n]*:\s*([0-9][0-9,]*)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Gather one restore-point record. gh(args)/git(args) are injected (args: string[] -> stdout
// string): this function makes no direct network or shell call itself, so it is exercised on
// canned output in the dark verify. root supplies the brains/registry.json this repo checkout
// carries (generation + schemaVersion of the live row); defaults to this file's own repo root.
export async function gatherRestorePoint({ gh, git, root = ROOT }) {
  const releaseList = JSON.parse(gh(["release", "list", "--repo", "alanshurafa/edgeweaver-backups", "--limit", "1", "--json", "tagName"]));
  if (!Array.isArray(releaseList) || !releaseList.length || !releaseList[0].tagName) {
    throw new Error("no releases found in alanshurafa/edgeweaver-backups");
  }
  const backupTag = releaseList[0].tagName;

  const view = JSON.parse(gh(["release", "view", backupTag, "--repo", "alanshurafa/edgeweaver-backups", "--json", "body"]));
  const rows = parseRowsFromBody(view.body);

  // full sha in, 7-char short sha out (truncated here, not via a gh/jq slice expression).
  const soulShaFull = gh(["api", "repos/open-agent-research-academy/edgeweaver-soul/commits/main", "--jq", ".sha"]).trim().replace(/^"|"$/g, "");
  const soulHead = soulShaFull.slice(0, 7);

  const bodyHead = git(["rev-parse", "--short", "HEAD"]).trim();

  const reg = await loadRegistry(root);
  const live = reg.brains.find((b) => b.kind === "live" && b.status === "active");
  if (!live) throw new Error("no active live brain in registry");

  return {
    date: new Date().toISOString().slice(0, 10), // UTC YYYY-MM-DD; toISOString is always UTC
    backupTag,
    rows,
    soulHead,
    bodyHead,
    generation: live.generation,
    schemaVersion: live.schemaVersion,
    stateArchive: null, // machine-state storage location still Alan's open decision; never guess
  };
}

// Read brains/restore-points.jsonl at `path` as an array of records (empty array if the file is
// missing or blank). Throws loudly if any line fails to parse - a corrupt map must fail loud,
// never silently drop a day.
export function readRestorePoints(path) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  return lines.map((line, i) => {
    try { return JSON.parse(line); }
    catch (e) { throw new Error(`restore-points.jsonl line ${i + 1} did not parse: ${e.message}`); }
  });
}

// Append `record`, replacing any existing line for the same date (one line per day, idempotent).
// Creates the file and its parent directory if missing. Returns the full updated array.
export function upsertRestorePoint(path, record) {
  const existing = readRestorePoints(path);
  const kept = existing.filter((r) => r.date !== record.date);
  kept.push(record);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, kept.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  return kept;
}

// --- CLI (guarded: importing this module for the functions above must never run this block;
// the path-separator anchor matters because "verify-restore-point.mjs" also ends with the
// literal string "restore-point.mjs") ---
if (/[\\/]restore-point\.mjs$/.test(process.argv[1] || "")) {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
  const has = (n) => args.includes("--" + n);
  const USAGE = "usage: restore-point.mjs --live | --dry-run [--root <path>]";
  const root = flag("root") || ROOT;
  const mapPath = join(root, "brains", "restore-points.jsonl");

  if (has("live")) {
    const ghReal = (a) => execFileSync("gh", a, { encoding: "utf8" });
    const gitReal = (a) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
    const record = await gatherRestorePoint({ gh: ghReal, git: gitReal, root });
    upsertRestorePoint(mapPath, record);
    console.log(JSON.stringify(record, null, 2));
    process.exit(0);
  } else if (has("dry-run")) {
    const records = readRestorePoints(mapPath);
    if (!records.length) { console.log("no map yet"); process.exit(0); }
    console.log(JSON.stringify(records[records.length - 1], null, 2));
    process.exit(0);
  } else {
    console.error(USAGE);
    process.exit(2);
  }
}
