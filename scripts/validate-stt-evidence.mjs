#!/usr/bin/env node
/**
 * #1037 — STT evidence artifact validator (Lane A / Lane B gate).
 *
 * Any lane that produces STT evidence must pass its artifact through this validator before the result
 * is quoted, ranked, or published. It is FAIL-CLOSED: a row missing required fields, or whose audio
 * route is not structurally proven, is reported inadmissible and excluded from rankings.
 *
 * This is deliberately a pure, offline check — it reads a JSON artifact and exits non-zero. It makes
 * NO network calls and CANNOT incur provider cost, so it is safe to run in ordinary CI. Producing the
 * evidence (which may cost money for Cloud) is a separate, explicitly authorized act.
 *
 * Usage:
 *   node scripts/validate-stt-evidence.mjs <artifact.json> [--json]
 *
 * Exit codes: 0 = every row admissible · 1 = one or more inadmissible · 2 = usage/parse error.
 */
import { readFileSync } from 'node:fs';

const REQUIRED_FIELDS = [
    'comparability_class', 'engine', 'engine_version', 'model_name', 'attribution_status',
    'browser', 'browser_version', 'os', 'device', 'network_condition', 'fixture_id',
    'audio_route_proven', 'run_validity', 'invalid_reason', 'wer', 'first_partial_latency_ms',
    'finalization_latency_ms', 'failure_class', 'release_sha',
];

const COMPARABILITY_CLASSES = new Set(['corpus_fixture', 'browser_journey']);
/** How a browser_journey was driven — a closed set; anything else is inadmissible. */
const BROWSER_EXECUTION_MODES = new Set(['automated', 'manual-assisted']);
/** Cloud/Private engine keys a browser_journey MUST prove its guard protected (installed before app code). */
const REQUIRED_FORBIDDEN_ENGINE_KEYS = ['assemblyai', 'transformers-js', 'transformers-js-v4', 'whisper-turbo'];
const RUN_VALIDITY = new Set(['valid', 'invalid']);
const FAILURE_CLASSES = new Set(['none', 'model_load_failed', 'decode_failed', 'audio_route_unproven', 'timeout', 'provider_error', 'unknown']);
/** Revisions that move over time make a "comparable" cohort silently incomparable. */
const MUTABLE_REVISIONS = new Set(['main', 'master', 'latest', 'head', 'HEAD', '']);
/** Release evidence must identify the EXACT deployed commit — an abbreviated SHA is ambiguous. */
const SHA_RE = /^[0-9a-f]{40}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isStr = v => typeof v === 'string' && v.trim() !== '';

/**
 * #1047-adjacent / #1037: a browser_journey row must still declare an HONEST runtime_capability — the
 * Browser/Web-Speech runtime path with a well-typed capability shape — rather than skipping it. Returns the
 * problems for a Browser row's runtime_capability (empty = admissible).
 */
function browserRuntimeCapabilityProblems(rc) {
    if (typeof rc !== 'object' || rc === null || Array.isArray(rc)) {
        return ['browser_journey runtime_capability must be an object'];
    }
    const p = [];
    if (rc.runtimePath !== 'browser-webspeech') p.push(`browser_journey runtime_capability.runtimePath must be 'browser-webspeech', got '${rc.runtimePath}'`);
    for (const k of ['requestedThreads', 'configuredThreads', 'workerReportedThreads']) {
        if (!(rc[k] === null || isNum(rc[k]))) p.push(`browser_journey runtime_capability.${k} must be a finite number or null`);
    }
    for (const k of ['crossOriginIsolated', 'sharedArrayBufferAvailable']) {
        if (typeof rc[k] !== 'boolean') p.push(`browser_journey runtime_capability.${k} must be a boolean`);
    }
    if (!(rc.fallbackReason === null || typeof rc.fallbackReason === 'string')) p.push('browser_journey runtime_capability.fallbackReason must be a string or null');
    return p;
}

/** Semantic checks — existence is not validity. A failed or malformed row must never rank. */
function semanticProblems(row, isBrowser) {
    const p = [];
    if (!COMPARABILITY_CLASSES.has(row.comparability_class)) p.push(`comparability_class '${row.comparability_class}' is not a known class`);
    if (!RUN_VALIDITY.has(row.run_validity)) p.push(`run_validity '${row.run_validity}' is not valid|invalid`);
    if (!FAILURE_CLASSES.has(row.failure_class)) p.push(`failure_class '${row.failure_class}' is not a known class`);
    for (const f of ['engine', 'engine_version', 'model_name', 'browser', 'browser_version', 'os', 'device', 'network_condition', 'fixture_id']) {
        if (!isStr(row[f])) p.push(`${f} must be a non-empty string`);
    }
    if (!SHA_RE.test(String(row.release_sha ?? ''))) p.push(`release_sha '${row.release_sha}' must be the FULL 40-character commit SHA`);

    // Admissibility differs by class. This validator is the runtime boundary for arbitrary JSON, so a
    // browser_journey row is affirmatively constrained to the canonical Browser engine, exact `unverified`
    // attribution, and a route it never proved — a class label alone cannot launder another engine's row.
    if (isBrowser) {
        if (row.engine !== 'browser-webspeech') p.push(`browser_journey requires engine 'browser-webspeech', got '${row.engine}'`);
        if (row.attribution_status !== 'unverified') p.push(`browser_journey attribution must be exactly 'unverified', got '${row.attribution_status}'`);
        if (row.audio_route_proven !== false) p.push('browser_journey must not claim a proven audio route (audio_route_proven must be false)');
    } else {
        if (row.attribution_status !== 'verified') p.push(`attribution_status is '${row.attribution_status}', not 'verified' — engine evidence inadmissible`);
    }

    // Validity/failure consistency — a row cannot be both admissible and failed.
    if (row.run_validity === 'invalid') p.push('run_validity is "invalid" — the row reports its own measurement as unusable');
    if (row.run_validity === 'valid' && row.invalid_reason != null) p.push('run_validity "valid" contradicts a non-null invalid_reason');
    if (row.run_validity === 'valid' && row.failure_class !== 'none') p.push(`run_validity "valid" contradicts failure_class '${row.failure_class}'`);
    if (!isBrowser && row.audio_route_proven !== true) p.push('audio_route_proven must be exactly true for an admissible corpus row');
    if (isBrowser && row.wer !== null && row.wer !== undefined) p.push('browser_journey is non-rankable — wer must be null');

    // Ranges. WER is a rate; latencies are non-negative milliseconds.
    if (row.wer !== null && row.wer !== undefined) {
        if (!isNum(row.wer)) p.push('wer must be a finite number or null');
        else if (row.wer < 0 || row.wer > 1) p.push(`wer ${row.wer} is outside [0,1] — express as a rate, not a percentage`);
    }
    for (const f of ['first_partial_latency_ms', 'finalization_latency_ms']) {
        const v = row[f];
        if (v !== null && v !== undefined && (!isNum(v) || v < 0)) p.push(`${f} must be a non-negative number or null`);
    }
    return p;
}

/** Mirrors deriveAudioRouteProven in tests/evidence/sttEvidenceSchema.ts. A start timestamp is NOT proof. */
function routeProblem(ev, engine) {
    if (!ev) return 'missing audio_route_evidence';
    if (!ev.fixtureSha256) return 'missing fixture hash';
    if (!ev.adapterInputPayloadSha256) return 'missing adapter-input payload hash';
    if (!(ev.adapterInputBytes > 0)) return 'adapter-input payload is empty';
    if (!(ev.decodedSampleCount > 0)) return 'no decoded samples reached the adapter';
    if (!(ev.decodedDurationSeconds > 0)) return 'decoded duration is zero';
    if (engine === 'cloud') {
        if (!ev.submittedPayloadSha256) return 'cloud row missing submitted-payload hash';
        if (!ev.providerJobId) return 'cloud row missing provider job id';
    }
    return null;
}

function checkRow(row, index) {
    const problems = [];
    for (const f of REQUIRED_FIELDS) {
        if (!(f in row)) problems.push(`missing required field ${f}`);
    }
    const isBrowser = row.comparability_class === 'browser_journey';
    problems.push(...semanticProblems(row, isBrowser));

    if (isBrowser) {
        // Journey admissibility: recognition actually happened + zero app-server/Cloud calls. NO audio-route
        // proof and NO corpus comparability inputs are required — Web Speech's capture is opaque.
        const journey = row.browser_journey_evidence;
        if (!journey) {
            problems.push('browser_journey row missing browser_journey_evidence');
        } else {
            if (journey.supportState !== 'supported') problems.push(`Browser support state is '${journey.supportState}', not supported`);
            if (journey.recognitionStarted !== true) problems.push('Browser recognition did not actually start');
            if (journey.timerAdvanced !== true) problems.push('Browser recording timer did not advance beyond 00:00');
            if (journey.transcriptProduced !== true) problems.push('Browser journey produced no transcript');
            if (journey.sessionProduced !== true) problems.push('Browser journey produced no session');
            if (journey.applicationServerWrites !== 0) problems.push('Browser evidence made an application-server write');
            if (journey.cloudProviderCalls !== 0) problems.push('Browser evidence invoked a SpeakSharp Cloud provider');
            if (journey.browserManagedTranscription !== true) problems.push('browser_journey must affirm browserManagedTranscription === true');
            if (!BROWSER_EXECUTION_MODES.has(journey.executionMode)) problems.push(`browser_journey executionMode must be one of ${[...BROWSER_EXECUTION_MODES].join('/')}, got '${journey.executionMode}'`);
            // Forbidden-engine tripwire proof must be IN the row: present (guard ran) and empty (no Cloud/
            // Private engine constructed/started). The artifact-envelope copy is human-facing only — this
            // runtime boundary validates arbitrary JSON and cannot trust an envelope the parser discards.
            if (!Array.isArray(journey.forbiddenEngineInvocations)) problems.push('browser_journey must carry a forbiddenEngineInvocations array (tripwire proof)');
            else if (journey.forbiddenEngineInvocations.length !== 0) problems.push(`browser_journey recorded a forbidden engine construction/start: ${JSON.stringify(journey.forbiddenEngineInvocations)}`);
            // Guard-installation proof: an empty invocation list is only meaningful if the guard is proven
            // installed (atomically, before app code) and protected every required Cloud/Private key.
            const guard = journey.forbiddenEngineGuard;
            if (!guard || guard.installed !== true) problems.push('browser_journey must prove forbiddenEngineGuard.installed === true (guard authoritative before app execution)');
            else {
                const missing = REQUIRED_FORBIDDEN_ENGINE_KEYS.filter(k => !Array.isArray(guard.protectedKeys) || !guard.protectedKeys.includes(k));
                if (missing.length) problems.push(`browser_journey guard did not protect required forbidden engines: ${missing.join(', ')}`);
            }
            // Release-proof attestation: a diagnostic/mock runtime (releaseProofEligible=false) cannot back
            // release evidence even with a valid __APP_RELEASE__.
            if (journey.releaseProofEligible !== true) problems.push('browser_journey must be produced by a release-proof runtime (releaseProofEligible === true)');
        }
        // Runtime capability is validated for Browser rows too (not skipped): it must declare the
        // Browser/Web-Speech runtime path with a well-typed capability shape.
        problems.push(...browserRuntimeCapabilityProblems(row.runtime_capability));
        return { index, fixture_id: row.fixture_id ?? `#${index}`, problems };
    }

    // ── corpus contract: proven audio route + comparability inputs ──
    const rp = routeProblem(row.audio_route_evidence, row.engine);
    if (rp) problems.push(`audio route unproven: ${rp}`);

    const ci = row.comparability_inputs ?? {};
    for (const k of ['fixtureHash', 'groundTruthVersion', 'normalizationVersion', 'decodeConfiguration', 'modelRevision']) {
        if (!ci[k]) problems.push(`missing comparability input ${k}`);
    }
    if (ci.modelRevision && MUTABLE_REVISIONS.has(ci.modelRevision)) {
        problems.push(`modelRevision '${ci.modelRevision}' is mutable — pin an immutable revision`);
    }
    if (!ci.runtimeVersions || typeof ci.runtimeVersions !== 'object' || Object.keys(ci.runtimeVersions).length === 0) {
        problems.push('runtimeVersions must be a non-empty map — a silent runtime upgrade would invalidate any ranking');
    } else {
        for (const [k, v] of Object.entries(ci.runtimeVersions)) {
            if (!isStr(v)) problems.push(`runtimeVersions.${k} must be a non-empty version string`);
        }
    }
    for (const [k, re] of [['fixtureHash', SHA256_RE]]) {
        if (ci[k] && !re.test(String(ci[k]))) problems.push(`${k} '${ci[k]}' is not a hash`);
    }
    if (row.audio_route_evidence?.fixtureSha256 && !SHA256_RE.test(String(row.audio_route_evidence.fixtureSha256))) {
        problems.push('audio_route_evidence.fixtureSha256 is not a hash');
    }
    if (row.audio_route_evidence?.adapterInputPayloadSha256 &&
        !SHA256_RE.test(String(row.audio_route_evidence.adapterInputPayloadSha256))) {
        problems.push('audio_route_evidence.adapterInputPayloadSha256 is not a SHA-256 hash');
    }
    if (ci.fixtureHash && row.audio_route_evidence?.fixtureSha256 &&
        ci.fixtureHash !== row.audio_route_evidence.fixtureSha256) {
        problems.push('fixtureHash does not match the routed fixture');
    }
    // WER may only be present on a proven route — never estimated, never defaulted to zero.
    if (rp && row.wer !== null && row.wer !== undefined) {
        problems.push('wer present on a row whose audio route is unproven');
    }
    // Threads: configuration is not proof of use. `workerReportedThreads` may be null, never invented.
    const rc = row.runtime_capability;
    if (rc && rc.workerReportedThreads !== null && rc.workerReportedThreads !== undefined
        && typeof rc.workerReportedThreads !== 'number') {
        problems.push('workerReportedThreads must be a number or null');
    }
    if (row.engine === 'private-v2-browser-worker') {
        const worker = row.private_worker_evidence;
        if (!worker) {
            problems.push('Private browser-worker row missing private_worker_evidence');
        } else {
            if (worker.workerUsed !== true) problems.push('Private evidence did not use the production browser worker');
            if (worker.modelSource !== 'self-hosted') problems.push('Private evidence did not use self-hosted model assets');
            if (!isStr(worker.modelLoaded)) problems.push('Private worker did not report a loaded model');
            if (worker.inputHashesMatch !== true || worker.mainThreadInputSha256 !== worker.workerInputSha256) {
                problems.push('Private main-thread and worker PCM hashes do not match');
            }
            if (!SHA256_RE.test(String(worker.mainThreadInputSha256 ?? '')) ||
                !SHA256_RE.test(String(worker.workerInputSha256 ?? ''))) {
                problems.push('Private worker PCM hashes must be 64-character SHA-256 values');
            }
            if (worker.cloudProviderCalls !== 0) problems.push('Private evidence invoked a Cloud provider');
        }
        if (rc?.requestedThreads !== 4) problems.push('Private v2 evidence did not request the four-thread policy ceiling');
        if (rc?.configuredThreads !== 1) problems.push('Private v2 non-isolated evidence did not configure the single-thread floor');
        if (rc?.workerReportedThreads !== null) problems.push('ORT v1.14 does not report effective threads; workerReportedThreads must be null');
        if (rc?.crossOriginIsolated !== false || rc?.sharedArrayBufferAvailable !== false) {
            problems.push('Private v2 fallback evidence was not collected without cross-origin isolation/SharedArrayBuffer');
        }
        if (rc?.runtimePath !== 'wasm') problems.push('Private v2 single-thread fallback must report runtimePath=wasm');
    }
    return { index, fixture_id: row.fixture_id ?? `#${index}`, problems };
}

const [, , file, ...flags] = process.argv;
if (!file) {
    console.error('usage: node scripts/validate-stt-evidence.mjs <artifact.json> [--json]');
    process.exit(2);
}

let rows;
try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    rows = Array.isArray(parsed) ? parsed : parsed.rows;
    if (!Array.isArray(rows)) throw new Error('artifact must be an array of rows, or an object with a `rows` array');
} catch (err) {
    console.error(`[stt-evidence] cannot read ${file}: ${err.message}`);
    process.exit(2);
}

// FAIL CLOSED on an empty artifact: a gate meant to ESTABLISH evidence must not pass when a lane
// produced no observations (fixture discovery failed, execution never ran, filter matched nothing).
if (rows.length === 0) {
    console.error(`[stt-evidence] ${file}: artifact contains ZERO rows — no evidence was produced. Failing closed.`);
    process.exit(1);
}

const results = rows.map(checkRow);
const bad = results.filter(r => r.problems.length > 0);
const rankable = results.length - bad.length;

/** Rows may only be compared inside one cohort — differing fixture/runtime/model is not a ranking. */
const cohortKey = row => {
    const ci = row.comparability_inputs ?? {};
    return [row.comparability_class, row.engine, row.engine_version, row.model_name,
        ci.fixtureHash, ci.groundTruthVersion, ci.normalizationVersion, ci.decodeConfiguration, ci.modelRevision,
        Object.entries(ci.runtimeVersions ?? {}).sort().map(([k, v]) => `${k}@${v}`).join(',')].join('|');
};
const cohorts = new Map();
for (const [i, row] of rows.entries()) {
    if (results[i].problems.length) continue;
    const k = cohortKey(row);
    cohorts.set(k, (cohorts.get(k) ?? 0) + 1);
}

if (flags.includes('--json')) {
    console.log(JSON.stringify({ total: rows.length, admissible: rankable, inadmissible: bad.length, cohorts: cohorts.size, findings: bad }, null, 2));
} else {
    console.log(`[stt-evidence] ${file}`);
    console.log(`  rows: ${rows.length}  admissible: ${rankable}  inadmissible: ${bad.length}`);
    for (const b of bad) {
        console.log(`  ✗ ${b.fixture_id}`);
        for (const p of b.problems) console.log(`      - ${p}`);
    }
    if (cohorts.size > 1) {
        console.log(`  ⚠ ${cohorts.size} distinct comparable cohorts — rank ONLY within a cohort, never across them`);
    }
    if (bad.length === 0) console.log(`  ✓ every row is admissible; ${cohorts.size} cohort(s)`);
}

// FAIL CLOSED: an artifact with any inadmissible row must not be quoted or ranked as-is.
process.exit(bad.length > 0 ? 1 : 0);
