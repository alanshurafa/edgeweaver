// Hermetic verification of the reconstructed Genesis lite adapter and installable template.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  consolidateManifestWriteback, invocationOrigin, lessonIdentity, lessonWriteback, parseOrientation, runSteps,
  thoughtMetadata, validateBundle, validateBundlePath, validateConsolidateManifest, validateCurrentStatus, validateRuntimeEnv,
} from "../night-loop/lite-live.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const fails = [];
const check = (ok, message) => { if (!ok) fails.push(message); };
const rejects = (fn, message) => { try { fn(); fails.push(message); } catch { /* expected */ } };

const orientText = [
  "diary-day: 2026-07-15",
  "utc-window: 2026-07-15T04:00:00.000Z .. 2026-07-16T04:00:00.000Z",
  "run-id: nl-2026-07-15",
].join("\n");
const orientation = parseOrientation(orientText);
check(orientation.run_id === "nl-2026-07-15" && orientation.utc_start.endsWith("04:00:00.000Z"), "orientation was not parsed verbatim");
rejects(() => parseOrientation(orientText.replace("nl-2026-07-15", "nl-2026-07-14")), "mismatched run-id was accepted");
const runtimeEnv = { SUPABASE_URL: "https://example.supabase.co/", SUPABASE_SERVICE_KEY: "service", OB1_MCP_KEY: "brain", EDGEWEAVER_TZ: "America/New_York" };
check(validateRuntimeEnv(runtimeEnv).SUPABASE_URL === "https://example.supabase.co", "runtime env did not normalize SUPABASE_URL");
rejects(() => validateRuntimeEnv({ ...runtimeEnv, EDGEWEAVER_TZ: "" }), "runtime env accepted a missing EDGEWEAVER_TZ");

const valid = {
  diary_day: orientation.diary_day,
  utc_window: orientation.utc_window,
  run_id: orientation.run_id,
  lessons: [{ content: "Alan prefers evidence to ornament.", evidence_ids: ["ep-1"], confidence: 0.8 }],
  diary: "2026-07-15 I recorded one grounded exchange.",
  autobiography_draft: "2026-07-15 Provisional: one exchange emphasized grounded evidence.",
};
const governedBundlePath = join(ROOT, "state", "night-loop-lite", valid.run_id, "bundle.json");
check(validateBundlePath(governedBundlePath, valid.run_id) === governedBundlePath, "governed bundle path was rejected");
rejects(() => validateBundlePath(join(ROOT, "bundle.json"), valid.run_id), "repo-root bundle path was accepted");
rejects(() => validateBundlePath(join(ROOT, "state", "night-loop-lite", valid.run_id, "..", "..", "outside", "bundle.json"), valid.run_id), "bundle traversal outside governed state was accepted");
rejects(() => validateBundlePath(join(ROOT, "state", "night-loop-lite", valid.run_id, "other.json"), valid.run_id), "non-bundle filename was accepted");
rejects(() => validateBundlePath(governedBundlePath, "nl-2026-07-14"), "bundle directory/content run-id mismatch was accepted");
rejects(() => validateBundlePath(join(ROOT, "state", "night-loop-lite", valid.run_id, "nested", "bundle.json"), valid.run_id), "nested arbitrary bundle path was accepted");
try {
  execFileSync("git", ["check-ignore", "--quiet", "state/night-loop-lite/nl-2000-01-01/bundle.json"], { cwd: ROOT });
} catch { fails.push("state/night-loop-lite bundle path is not ignored by git"); }
validateBundle(valid, orientation, ["ep-1"]);
rejects(() => validateBundle({ ...valid, run_id: "nl-2026-07-14" }, orientation, ["ep-1"]), "altered bundle run-id was accepted");
rejects(() => validateBundle({ ...valid, lessons: [{ ...valid.lessons[0], evidence_ids: ["outside"] }] }, orientation, ["ep-1"]), "out-of-window evidence was accepted");
rejects(() => validateBundle({ ...valid, lessons: [{ ...valid.lessons[0], content: "Perhaps this is durable." }] }, orientation, ["ep-1"]), "speculative lesson was accepted");
rejects(() => validateBundle({ ...valid, diary: "Wrong date" }, orientation, ["ep-1"]), "undated diary was accepted");
rejects(() => validateBundle({ ...valid, lessons: Array(6).fill(valid.lessons[0]) }, orientation, ["ep-1"]), "more than five lessons were accepted");
rejects(() => validateBundle({ ...valid, lessons: [valid.lessons[0], { ...valid.lessons[0], confidence: 0.6 }] }, orientation, ["ep-1"]), "duplicate stable lesson identities were accepted");
rejects(() => validateBundle({ ...valid, diary: `2026-07-15 ${Array(249).fill("word").join(" ")}` }, orientation, ["ep-1"]), "250-word diary was accepted");
rejects(() => validateBundle({ ...valid, autobiography_draft: `2026-07-15 ${Array(399).fill("word").join(" ")}` }, orientation, ["ep-1"]), "400-word autobiography was accepted");

const metadata = thoughtMetadata(valid.run_id, "diary");
check(metadata.era === "alive" && metadata.generation === 0 && metadata.audience === "alan"
  && metadata.provenance_class === "interpretation" && metadata.night_loop_run_id === valid.run_id
  && metadata.step === "diary" && !Object.hasOwn(metadata, "rehearsal"), "thought metadata violates live conventions");
check(invocationOrigin() === "manual" && invocationOrigin("scheduled") === "scheduled", "invocation origin defaults or scheduled validation are wrong");
rejects(() => invocationOrigin("rehearsal"), "invalid invocation origin was accepted");

const stableIdentity = lessonIdentity(valid.lessons[0]);
check(stableIdentity === lessonIdentity({ ...valid.lessons[0], evidence_ids: ["ep-1", "ep-1"], confidence: 0.1 }), "lesson identity is not canonical or incorrectly depends on confidence");
check(lessonIdentity({ content: "Stable lesson.", evidence_ids: ["ep-2", "ep-1", "ep-1"] })
  === lessonIdentity({ content: " Stable   lesson. ", evidence_ids: ["ep-1", "ep-2"] }), "lesson identity is not stable across evidence order/deduplication and whitespace");
const wb = lessonWriteback(valid, valid.lessons[0], stableIdentity);
check(wb.schema_version === "openbrain.agent_memory.writeback.v1"
  && wb.idempotency_key === `nl-2026-07-15:consolidate:${stableIdentity}`
  && wb.provenance.default_status === "generated" && wb.provenance.requires_review === true
  && wb.source_refs[0].uri === "ob1://thoughts/ep-1", "lesson writeback does not match the review-gated API schema");
const roundedWb = lessonWriteback(valid, { ...valid.lessons[0], confidence: 0.777 });
check(roundedWb.provenance.confidence === 0.78 && roundedWb.memory_payload.lessons[0].includes("Confidence: 0.78."), "lesson confidence is not normalized to live NUMERIC(3,2) precision");

const statusThoughts = [
  { source_type: "diary", content: valid.diary, metadata: thoughtMetadata(valid.run_id, "diary", { invocation_origin: "manual" }) },
  { source_type: "autobiography_draft", content: valid.autobiography_draft, metadata: thoughtMetadata(valid.run_id, "autobiography", { provisional: true, invocation_origin: "manual" }) },
];
const statusLessons = [{
  id: "mem-1", content: wb.memory_payload.lessons[0], confidence: 0.8, idempotency_key: `${wb.idempotency_key}:0`,
  provenance_status: "generated", review_status: "pending", requires_user_confirmation: true, can_use_as_instruction: false,
}];
const statusRefs = [{ memory_id: "mem-1", source_kind: "thought", uri: "ob1://thoughts/ep-1" }];
const manifestPayload = consolidateManifestWriteback(valid, "manual");
const statusManifests = [{
  memory_type: "output", content: manifestPayload.memory_payload.outputs[0], idempotency_key: `${manifestPayload.idempotency_key}:0`,
  provenance_status: "generated", review_status: "pending", requires_user_confirmation: true, can_use_as_instruction: false,
}];
check(validateCurrentStatus(statusThoughts, statusLessons, statusRefs, ["ep-1"], statusManifests, orientation).candidate_lessons === 1, "valid current-run status did not pass");
const roundedStatus = [{ ...statusLessons[0], content: roundedWb.memory_payload.lessons[0], confidence: "0.78", idempotency_key: `${roundedWb.idempotency_key}:0` }];
check(validateCurrentStatus(statusThoughts, roundedStatus, statusRefs, ["ep-1"], statusManifests, orientation).candidate_lessons === 1, "status rejected a successfully rounded confidence");
rejects(() => validateCurrentStatus(statusThoughts.slice(0, 1), statusLessons, statusRefs, ["ep-1"], statusManifests, orientation), "status accepted a missing autobiography");
rejects(() => validateCurrentStatus(statusThoughts, [{ ...statusLessons[0], review_status: "confirmed" }], statusRefs, ["ep-1"], statusManifests, orientation), "status accepted a non-pending lesson");
rejects(() => validateCurrentStatus([...statusThoughts, statusThoughts[0]], statusLessons, statusRefs, ["ep-1"], statusManifests, orientation), "status accepted a duplicate diary");
rejects(() => validateCurrentStatus(statusThoughts, statusLessons, [], ["ep-1"], statusManifests, orientation), "status accepted a lesson with no persisted source refs");
rejects(() => validateCurrentStatus(statusThoughts, statusLessons, [{ ...statusRefs[0], uri: "ob1://thoughts/outside" }], ["ep-1"], statusManifests, orientation), "status accepted an out-of-window source ref");
rejects(() => validateCurrentStatus(statusThoughts, [{ ...statusLessons[0], confidence: 0.2 }], statusRefs, ["ep-1"], statusManifests, orientation), "status accepted confidence inconsistent with stored content");
rejects(() => validateCurrentStatus(statusThoughts, [{ ...statusLessons[0], idempotency_key: `${valid.run_id}:consolidate:${"0".repeat(64)}:0` }], statusRefs, ["ep-1"], statusManifests, orientation), "status accepted a stable identity inconsistent with content/evidence");
rejects(() => validateCurrentStatus(statusThoughts, statusLessons, statusRefs, ["ep-1"], [], orientation), "status accepted a missing consolidate manifest");
rejects(() => validateCurrentStatus(statusThoughts, statusLessons, statusRefs, ["ep-1"], statusManifests, orientation, "scheduled"), "scheduled status accepted manual outputs");
const zeroBundle = { ...valid, lessons: [] };
const zeroPayload = consolidateManifestWriteback(zeroBundle, "manual");
const zeroManifest = [{ ...statusManifests[0], content: zeroPayload.memory_payload.outputs[0], idempotency_key: `${zeroPayload.idempotency_key}:0` }];
check(validateCurrentStatus(statusThoughts, [], [], ["ep-1"], zeroManifest, orientation).candidate_lessons === 0, "status rejected a valid zero-lesson manifest");

const calls = [];
const results = await runSteps(valid, {
  ensureManifest: async () => { calls.push("manifest"); },
  lessonExists: async () => false,
  writeLesson: async () => { calls.push("lesson"); throw new Error("injected lesson failure"); },
  thoughtExists: async (_runId, step) => { calls.push(`exists:${step}`); return false; },
  writeThought: async (row) => { calls.push(`write:${row.metadata.step}`); },
});
check(Boolean(results.consolidate.error), "injected consolidate failure was not logged as a step failure");
check(calls.includes("write:diary") && calls.includes("write:autobiography"), "independent steps did not continue after a failure");

function rowFromManifestPayload(payload) {
  return {
    memory_type: "output", content: payload.memory_payload.outputs[0], idempotency_key: `${payload.idempotency_key}:0`,
    provenance_status: "generated", review_status: "pending", requires_user_confirmation: true, can_use_as_instruction: false,
  };
}
function manifestStoreOperations() {
  const store = { row: null };
  return {
    store,
    ensure: async (payload) => {
      const candidate = rowFromManifestPayload(payload);
      if (!store.row) store.row = candidate;
      const parsed = JSON.parse(payload.memory_payload.outputs[0].split("\n").slice(1).join("\n"));
      validateConsolidateManifest([store.row], payload.task_id, parsed.lesson_identities, parsed.invocation_origin);
    },
  };
}

const idempotentManifest = manifestStoreOperations();
const stored = { lessons: new Set(), thoughts: new Set() };
const idempotentOps = {
  ensureManifest: idempotentManifest.ensure,
  lessonExists: async (runId, identity) => stored.lessons.has(`${runId}:${identity}`),
  writeLesson: async (payload) => { stored.lessons.add(`${payload.task_id}:${payload.idempotency_key.split(":").at(-1)}`); },
  thoughtExists: async (runId, step) => stored.thoughts.has(`${runId}:${step}`),
  writeThought: async (row) => { stored.thoughts.add(`${row.metadata.night_loop_run_id}:${row.metadata.step}`); },
};
await runSteps(valid, idempotentOps);
const secondRun = await runSteps(valid, idempotentOps);
check(secondRun.consolidate.written === 0 && secondRun.consolidate.skipped === 1
  && secondRun.diary.skipped === true && secondRun.autobiography.skipped === true,
"a repeated run did not skip every persisted output");

const fiveLessons = Array.from({ length: 5 }, (_, i) => ({
  content: `Durable lesson number ${i + 1}.`, evidence_ids: [`ep-${i + 1}`], confidence: 0.7,
}));
const retryBase = { ...valid, lessons: fiveLessons };
const retryManifest = manifestStoreOperations();
const persisted = new Set();
const writeCounts = new Map();
let writesBeforeFailure = 0;
const retryOps = {
  ensureManifest: retryManifest.ensure,
  lessonExists: async (runId, identity) => persisted.has(`${runId}:${identity}`),
  writeLesson: async (payload) => {
    const identity = payload.idempotency_key.split(":").at(-1);
    if (writesBeforeFailure === 4) { writesBeforeFailure++; throw new Error("partial failure after four of five"); }
    writesBeforeFailure++;
    const key = `${payload.task_id}:${identity}`;
    persisted.add(key);
    writeCounts.set(identity, (writeCounts.get(identity) || 0) + 1);
  },
  thoughtExists: async () => true,
  writeThought: async () => { throw new Error("thought write should have skipped"); },
};
const partial = await runSteps(retryBase, retryOps);
check(Boolean(partial.consolidate.error) && persisted.size === 4, "four-of-five partial run did not stop with exactly four lessons");
const changedFifth = { content: "A changed fifth lesson.", evidence_ids: ["ep-5"], confidence: 0.7 };
const changed = await runSteps({ ...retryBase, lessons: [...fiveLessons.slice(0, 4), changedFifth] }, retryOps);
check(Boolean(changed.consolidate.error) && persisted.size === 4, "changed retry was not refused before a new lesson write");
writesBeforeFailure = 99;
const reordered = await runSteps({ ...retryBase, lessons: [...fiveLessons].reverse() }, retryOps);
check(!reordered.consolidate.error && persisted.size === 5
  && fiveLessons.every((lesson) => writeCounts.get(lessonIdentity(lesson)) === 1),
"reordered identical retry did not resume to five lessons exactly once");

const emptyManifestStore = manifestStoreOperations();
const emptyRun = await runSteps(zeroBundle, {
  ensureManifest: emptyManifestStore.ensure,
  lessonExists: async () => false,
  writeLesson: async () => { throw new Error("zero-lesson run wrote a lesson"); },
  thoughtExists: async () => true,
  writeThought: async () => { throw new Error("thought should skip"); },
});
check(emptyRun.consolidate.manifest === "verified" && emptyRun.consolidate.candidates === 0 && emptyManifestStore.store.row,
"zero-lesson run did not persist and verify a consolidate manifest");

const scheduledManifestStore = manifestStoreOperations();
const scheduledThoughts = [];
await runSteps(zeroBundle, {
  ensureManifest: scheduledManifestStore.ensure,
  lessonExists: async () => false,
  writeLesson: async () => { throw new Error("zero-lesson scheduled run wrote a lesson"); },
  thoughtExists: async () => false,
  writeThought: async (row) => { scheduledThoughts.push(row); },
}, () => {}, "scheduled");
check(scheduledThoughts.length === 2 && scheduledThoughts.every((row) => row.metadata.invocation_origin === "scheduled")
  && scheduledManifestStore.store.row.content.includes('"invocation_origin":"scheduled"'),
"scheduled run did not stamp manifest, diary, and autobiography with scheduled origin");

// autocrlf checks these out CRLF on Windows; the contract literals below use \n, so
// normalize on read (the committed bytes are LF either way).
const readLf = async (...p) => (await readFile(join(ROOT, ...p), "utf8")).replace(/\r\n/g, "\n");
const template = await readLf("templates", "night-loop-lite-genesis-SKILL.md");
const helper = await readLf("scripts", "night-loop", "lite-live.mjs");
const runner = await readLf("scripts", "night-loop", "run-genesis-lite.ps1");
const handoff = await readLf("docs", "night-loop-lite-genesis-runtime-host.md");
for (const required of [
  "steps 1, 9, and 10", "orient.mjs --diary-day --being genesis", "/functions/v1/agent-memory-api/writeback",
  "Never POST directly to", "manual run never counts", "not a\n> recovered original", "actual runtime host",
]) check(template.includes(required), `template is missing required contract text: ${required}`);
check(!/method:\s*["']POST["'][\s\S]{0,180}rest\(["']agent_memories["']/.test(helper), "helper contains a direct agent_memories POST");
check(helper.includes("agent-memory-api/health") && helper.includes("review_status !== \"pending\""), "helper lacks fail-closed health/review-state checks");
check(helper.includes('command === "status"') && helper.includes("validateCurrentStatus"), "helper lacks the read-only current-run verifier");
check(helper.includes("validateBundlePath") && helper.includes("verifiedBundlePath")
  && helper.includes("bundle path may not use symlinks or junctions"), "helper does not constrain bundle input to governed real runtime state");
check(helper.includes("consolidateManifestWriteback") && helper.includes("await operations.ensureManifest")
  && helper.indexOf("await operations.ensureManifest") < helper.indexOf("await operations.writeLesson"),
"helper does not lock a consolidate manifest before lesson writes");
check(helper.includes('"EDGEWEAVER_TZ"') && helper.indexOf("const env = await readEnv()") < helper.indexOf("const orientation = liveOrientation(env)"), "helper does not fail closed on timezone before orientation");
check(helper.includes("replace(/\\/+$/, \"\")"), "helper does not normalize a trailing SUPABASE_URL slash");
check(!/--now|nl-rehearsal|era:\s*["']rehearsal/.test(helper), "live helper exposes simulation or rehearsal behavior");
check(!template.includes("C:\\Users\\alan") && !template.includes("C:\\Users\\agent"), "installable template hardcodes a workstation path");
check(!runner.includes("C:\\Users\\") && runner.includes("$PSScriptRoot")
  && runner.includes("-p '/night-loop-lite-genesis'") && runner.includes("--model sonnet")
  && runner.includes("EDGEWEAVER_NIGHT_LOOP_ORIGIN = 'scheduled'")
  && runner.includes("genesis-night.log") && runner.includes("lite-live.mjs status") && runner.includes("exit $LASTEXITCODE"),
"scheduled runner is not path-neutral or does not pin the skill/model/log/exit code");
check(runner.indexOf("lite-live.mjs status") > runner.indexOf("-p '/night-loop-lite-genesis'")
  && runner.indexOf("if ($claudeExit -ne 0)") < runner.indexOf("lite-live.mjs status"),
"scheduled runner does not gate status on a successful Claude invocation");
check(handoff.includes("New-ScheduledTaskPrincipal") && handoff.includes("-RunLevel Limited")
  && handoff.includes("-WakeToRun") && handoff.includes("-StartWhenAvailable")
  && handoff.includes("-RunOnlyIfNetworkAvailable") && handoff.includes("-MultipleInstances IgnoreNew")
  && handoff.includes("WindowsIdentity]::GetCurrent().Name") && handoff.includes("Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue")
  && !handoff.includes("Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger `\n  -Principal $Principal -Settings $Settings -Description 'Edgeweaver Genesis night-loop-lite steps 1, 9, and 10' -Force")
  && handoff.includes("lite-live.mjs status") && handoff.includes("not scheduled night one")
  && handoff.includes("gh api repos/open-agent-research-academy/edgeweaver --silent") && handoff.includes("gh api repos/alanshurafa/edgeweaver-gates --silent")
  && handoff.includes("metadata.invocation_origin=scheduled") && handoff.includes("same diary-day run ID")
  && handoff.includes("two distinct real scheduled"), "runtime-host handoff is missing preflight, scheduler, no-overwrite, or two-night safeguards");
check(template.includes("Retain the protected bundle on any partial") && template.includes("consolidate manifest"),
"skill does not retain the bundle on partial failure or describe the manifest lock");
check(template.includes("state/night-loop-lite/<run-id>/bundle.json")
  && template.includes("WindowsIdentity]::GetCurrent().Name") && template.includes("/inheritance:r")
  && template.includes("/grant:r") && template.includes("never through `echo`")
  && template.includes("Delete it only after") && template.includes("never content"),
"skill does not protect, retain, or safely delete the deterministic bundle");
check(handoff.includes("git check-ignore --quiet state/night-loop-lite")
  && handoff.includes("removing inherited ACLs") && handoff.includes("never episode or bundle content"),
"runtime handoff does not verify ignored protected bundle state and log hygiene");

if (fails.length) { console.log("FAIL:\n - " + fails.join("\n - ")); process.exit(1); }
console.log("PASS: reconstructed night-loop-lite-genesis is portable and limited to steps 1/9/10; trusts orient verbatim; validates dates/evidence; uses review-gated API writeback; emits live interpretation metadata; is idempotent by run+step; and continues independent steps after failure.");
