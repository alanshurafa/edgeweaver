#!/usr/bin/env node
// Fleet console: a Telegram bot that lets Alan read and change which model and effort
// every agent runs (Genesis, Alpha, Edgeweaver on Buzz, Jarvis, Samantha) with one
// command, from the phone, without opening a terminal.
//
//   node scripts/ops/fleet-console.mjs
//
// Needs in .env.local: EW_FLEET_CONSOLE_TOKEN (a bot created for this and nothing else;
// DM it, no group needed) and TELEGRAM_ALLOWED_USER_ID (Alan). Every message from any
// other user id is ignored without reply. One poller per token (proven 2026-07-16), so
// the launcher refuses to start a second console.
//
// Commands (DM):
//   /mind                                   table: policy + the model each live session is on
//   /mind <agent|all> [role] <model> [effort] [now]
//   /effort <agent|all> <level> [now]       effort only
//   /reset                                  drop live overrides (back to committed defaults)
//   /help
//
// Agents: genesis alpha edgeweaver jarvis samantha all. Models: opus fable sonnet haiku or
// a claude-* id. Efforts: low medium high xhigh max. Roles (optional): channel hourly room
// night buzz. Without a role, every role except night changes.
//
// WITHOUT "now": the policy file changes and the next launch picks it up. Headless roles
// (hourly, room) do that on their next tick. A live channel session keeps its model until it
// is restarted, because model and effort are session-scoped.
// WITH "now": the console restarts the agent's live session. For Genesis and Alpha that is
// scripts/ops/restore-channel-model.ps1 -Force, which mines the dying transcript, ends the
// session, relaunches through the watchdog task (clean environment), verifies the model and
// posts the ops notice. A restart costs whatever the session held in context and had not
// written to OB1, which is why "now" is a separate, explicit word.
//
// This process must be started by Task Scheduler (fleet-console-launch.ps1), never from
// inside a Claude session: a child of a session inherits CLAUDECODE and friends, and any
// relaunch it triggers directly would come up mute (ops-log 2026-08-01). The restarts here
// all go through scheduled tasks for that reason.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { loadPolicy, setPolicy, resetPolicy, resolve, table, parseSet } from "./model-policy.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = {};
try {
  for (const line of readFileSync(join(repo, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/\r$/, "");
  }
} catch {}
const need = (k) => { if (!env[k]) { console.error(`fleet-console: missing ${k} in .env.local`); process.exit(2); } return env[k]; };
let TOKEN = "", ALAN = "";
const log = (m) => process.stderr.write(`${new Date().toISOString()} fleet-console: ${m}\n`);

const PS = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const AGENT_NAMES = { genesis: "Genesis", alpha: "Alpha", edgeweaver: "Edgeweaver (Buzz)", jarvis: "Jarvis", samantha: "Samantha" };

// ---- live model detection: the newest transcript for each live session names its model ----
const PROJ_EW = "C:\\Users\\agent\\.claude\\projects\\C--Users-agent-Project-Edgeweaver";
const PROJ_STAFF = (n) => `C:\\Users\\agent\\.staff\\claude\\projects\\C--Users-agent--staff-${n}-home`;

function newestTranscript(dir, marker) {
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")); } catch { return null; }
  const now = Date.now();
  const cands = files
    .map((f) => ({ p: join(dir, f), t: statSync(join(dir, f)).mtimeMs }))
    .filter((c) => c.t < now + 120000) // future-dated transcripts fooled the restore script once (2026-08-24)
    .sort((a, b) => b.t - a.t);
  for (const c of cands.slice(0, 40)) {
    let head;
    try { head = readFileSync(c.p, "utf8").slice(0, 60000); } catch { continue; }
    if (marker && !head.includes(marker)) continue;
    const m = head.match(/"model":"([a-z0-9\-\[\]]+)"/);
    if (m) return { model: m[1], age: Math.round((now - c.t) / 60000) };
  }
  return null;
}
function pidAlive(pidFile) {
  try {
    const pid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}
function liveStatus(agent) {
  switch (agent) {
    case "genesis": return { ...newestTranscript(PROJ_EW, "<command-name>/wake-edgeweaver-genesis"), up: pidAlive("C:\\Users\\agent\\.claude\\channels\\telegram-genesis\\bot.pid") };
    case "alpha": return { ...newestTranscript(PROJ_EW, "<command-name>/wake-edgeweaver-alpha"), up: pidAlive("C:\\Users\\agent\\.claude\\channels\\telegram-alpha\\bot.pid") };
    case "jarvis": return { ...newestTranscript(PROJ_STAFF("jarvis"), null), up: pidAlive("C:\\Users\\agent\\.staff\\claude\\channels\\telegram-jarvis\\session.pid") };
    case "samantha": return { ...newestTranscript(PROJ_STAFF("samantha"), null), up: pidAlive("C:\\Users\\agent\\.staff\\claude\\channels\\telegram-samantha\\session.pid") };
    case "edgeweaver": return { up: pidAlive(join(repo, "state", "channel-pid-genesis-buzz.txt")) };
    default: return {};
  }
}

function statusText() {
  const p = loadPolicy();
  const lines = ["Fleet minds (policy -> live)"];
  for (const a of Object.keys(p.agents)) {
    const main = p.agents[a].channel ? "channel" : Object.keys(p.agents[a])[0];
    const { model, effort } = resolve(a, main, p);
    const live = liveStatus(a);
    let liveTxt = live.up ? "up" : "down";
    if (live.model) liveTxt += ` on ${live.model}${live.model !== model && live.model !== model + "[1m]" ? " (differs; restart to apply)" : ""}`;
    lines.push(`${AGENT_NAMES[a] || a}: ${model} ${effort} | ${liveTxt}`);
    for (const r of Object.keys(p.agents[a])) {
      if (r === main) continue;
      const x = resolve(a, r, p);
      if (x.model !== model || x.effort !== effort) lines.push(`   ${r}: ${x.model} ${x.effort}`);
    }
  }
  if (p.updated) lines.push(`Last change ${p.updated} by ${p.updatedBy}`);
  lines.push("", "/mind <agent|all> <model> [effort] [now]  -  /help");
  return lines.join("\n");
}

const HELP = [
  "/mind  -  show every agent's model + effort and what each live session is on",
  "/mind <agent|all> [role] <model> [effort] [now]",
  "/effort <agent|all> <level> [now]",
  "/reset  -  back to committed defaults",
  "",
  "agents: genesis alpha edgeweaver jarvis samantha all",
  "models: opus fable sonnet haiku (or a claude-* id)",
  "effort: low medium high xhigh max",
  "roles: channel hourly room night buzz (optional; night never changes unless named)",
  "",
  "Without 'now' the change waits for the next launch (hourly wakes and room replies pick it up on their next tick).",
  "With 'now' the live session is restarted: Genesis/Alpha lose whatever they held in context and had not written back, so say 'now' on purpose.",
  "",
  "examples:  /mind all opus medium  |  /mind genesis high now  |  /mind alpha night sonnet low",
].join("\n");

// ---- restarts, all through scheduled tasks (clean environment) ----
function runPs(args) {
  return new Promise((res) => {
    const child = spawn(PS, ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], { cwd: repo, windowsHide: true, env: { ...process.env, CLAUDECODE: "", CLAUDE_CODE_SESSION_ID: "", CLAUDE_CODE_ENTRYPOINT: "" } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (e) => res({ code: -1, out: String(e) }));
    child.on("close", (code) => res({ code, out }));
  });
}
async function restart(agent) {
  switch (agent) {
    case "genesis":
    case "alpha": {
      // Deliberately the same path as a model-fallback repair: deadletter + inner-dialogue
      // extraction, end the session, fire the watchdog task, verify, ops notice.
      const child = spawn(PS, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(repo, "scripts", "ops", "restore-channel-model.ps1"), agent, "-Force"], { cwd: repo, windowsHide: true, detached: true, stdio: "ignore", env: { ...process.env, CLAUDECODE: "", CLAUDE_CODE_SESSION_ID: "", CLAUDE_CODE_ENTRYPOINT: "" } });
      child.unref();
      return `${AGENT_NAMES[agent]}: restart started (restore-channel-model -Force). Expect the automated ops notice naming the model within ~5 minutes.`;
    }
    case "jarvis":
    case "samantha": {
      const cmd = `$pf='C:\\Users\\agent\\.staff\\claude\\channels\\telegram-${agent}\\session.pid'; if (Test-Path $pf) { $id=[int](Get-Content $pf | Select-Object -First 1); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Remove-Item $pf -ErrorAction SilentlyContinue; "ended pid $id" }; Start-Sleep 3; Start-ScheduledTask -TaskName 'staff-channel-${agent}'; 'fired staff-channel-${agent}'`;
      const r = await runPs(["-Command", cmd]);
      return `${AGENT_NAMES[agent]}: ${r.out.trim().replace(/\s+/g, " ") || "restart fired"} (exit ${r.code}).`;
    }
    case "edgeweaver": {
      const cmd = `$pf='${join(repo, "state", "channel-pid-genesis-buzz.txt").replace(/\\/g, "\\\\")}'; if (Test-Path $pf) { $id=[int](Get-Content $pf | Select-Object -First 1); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Remove-Item $pf -ErrorAction SilentlyContinue; "ended pid $id" }; Start-Sleep 3; Start-ScheduledTask -TaskName 'EdgeweaverGenesisBuzzWatchdog'; 'fired EdgeweaverGenesisBuzzWatchdog'`;
      const r = await runPs(["-Command", cmd]);
      return `${AGENT_NAMES[agent]}: ${r.out.trim().replace(/\s+/g, " ") || "restart fired"} (exit ${r.code}). If the desktop-managed presence is the live one, restart it in the Buzz app instead.`;
    }
  }
  return `${agent}: no restart path`;
}

// ---- command handling ----
export async function handle(text) {
  const words = text.trim().split(/\s+/);
  const cmd = (words[0] || "").toLowerCase().replace(/@\w+$/, "");
  if (cmd === "/start" || cmd === "/help") return HELP;
  if (cmd === "/reset") { resetPolicy(); return "Live overrides dropped.\n\n" + table(); }
  if (cmd !== "/mind" && cmd !== "/effort") return null;
  if (words.length === 1) return statusText();
  let args = words.slice(1);
  const now = args[args.length - 1]?.toLowerCase() === "now";
  if (now) args = args.slice(0, -1);
  if (cmd === "/effort" && args.length === 2) args = [args[0], args[1]]; // same shape; parseSet accepts effort-only
  let parsed;
  try { parsed = parseSet(args); } catch (e) { return `Could not read that: ${e.message}\n\n${HELP}`; }
  if (parsed.rest.length) return `Unexpected '${parsed.rest.join(" ")}'.\n\n${HELP}`;
  let changed;
  try { ({ changed } = setPolicy({ ...parsed, by: "telegram" })); } catch (e) { return `Not applied: ${e.message}`; }
  const out = [`Set ${changed.join(", ")} -> ${[parsed.model, parsed.effort].filter(Boolean).join(" ")}.`];
  const agents = parsed.agent === "all" ? Object.keys(loadPolicy().agents) : [parsed.agent];
  const liveRoles = new Set(parsed.role ? [parsed.role] : ["channel", "buzz"]);
  const needsRestart = agents.filter((a) => [...liveRoles].some((r) => loadPolicy().agents[a]?.[r]));
  if (now) {
    for (const a of needsRestart) out.push(await restart(a));
  } else if (needsRestart.length) {
    out.push(`Live sessions keep their current mind until restarted: ${needsRestart.map((a) => AGENT_NAMES[a]).join(", ")}. Repeat with 'now' to restart them, or wait for the next relaunch. Hourly wakes and room replies use the new setting on their next tick.`);
  } else {
    out.push("Headless role; the next tick uses it.");
  }
  return out.join("\n");
}

// ---- Telegram long-poll ----
async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return r.json();
}
async function main() {
  TOKEN = need("EW_FLEET_CONSOLE_TOKEN");
  ALAN = String(need("TELEGRAM_ALLOWED_USER_ID"));
  const me = await tg("getMe", {});
  if (!me.ok) { log(`getMe failed: ${me.error_code} ${me.description}`); process.exit(1); }
  log(`up as @${me.result.username}; only user ${ALAN} is heard`);
  await tg("setMyCommands", { commands: [
    { command: "mind", description: "show or set model + effort: /mind [agent] [model] [effort] [now]" },
    { command: "effort", description: "set effort: /effort <agent|all> <level> [now]" },
    { command: "reset", description: "back to committed defaults" },
    { command: "help", description: "how the fleet console works" },
  ] });
  let offset = 0;
  while (true) {
    let j;
    try { j = await tg("getUpdates", { offset, timeout: 50, allowed_updates: ["message"] }); }
    catch (e) { log(`getUpdates error: ${e.message}`); await new Promise((s) => setTimeout(s, 5000)); continue; }
    if (!j.ok) { log(`getUpdates failed: ${j.error_code} ${j.description}`); await new Promise((s) => setTimeout(s, 5000)); continue; }
    for (const u of j.result) {
      offset = u.update_id + 1;
      const msg = u.message;
      if (!msg?.text || !msg.from) continue;
      if (String(msg.from.id) !== ALAN) { log(`ignored message from user ${msg.from.id}`); continue; }
      let reply;
      try { reply = await handle(msg.text); } catch (e) { reply = `Error: ${e.message}`; log(`handle error: ${e.stack || e}`); }
      if (!reply) continue;
      log(`cmd ${msg.text.split(/\s+/)[0]} -> ${reply.split("\n")[0].slice(0, 80)}`);
      const s = await tg("sendMessage", { chat_id: msg.chat.id, text: reply.slice(0, 4000) });
      if (!s.ok) log(`sendMessage failed: ${s.error_code} ${s.description}`);
    }
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  if (process.argv[2] === "--dry") {
    // Offline exercise of the parser and status without touching Telegram or restarting anything.
    const t = process.argv.slice(3).join(" ") || "/mind";
    if (/\bnow$/.test(t)) { console.log("dry mode refuses 'now'"); process.exit(1); }
    handle(t).then((r) => console.log(r));
  } else {
    main().catch((e) => { log(`fatal: ${e.stack || e}`); process.exit(1); });
  }
}
