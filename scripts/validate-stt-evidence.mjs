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
    'comparability_class', 'engine', 'engine_version', 'browser', 'browser_version', 'os',
    'device', 'network_condition', 'fixture_id', 'audio_route_proven', 'run_validity',
    'invalid_reason', 'wer', 'first_partial_latency_ms', 'finalization_latency_ms',
    'failure_class', 'release_sha',
];

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
    const rp = routeProblem(row.audio_route_evidence, row.engine);
    if (rp) problems.push(`audio route unproven: ${rp}`);

    const ci = row.comparability_inputs ?? {};
    for (const k of ['fixtureHash', 'groundTruthVersion', 'normalizationVersion', 'decodeConfiguration', 'modelRevision']) {
        if (!ci[k]) problems.push(`missing comparability input ${k}`);
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

const results = rows.map(checkRow);
const bad = results.filter(r => r.problems.length > 0);
const rankable = results.length - bad.length;

if (flags.includes('--json')) {
    console.log(JSON.stringify({ total: rows.length, admissible: rankable, inadmissible: bad.length, findings: bad }, null, 2));
} else {
    console.log(`[stt-evidence] ${file}`);
    console.log(`  rows: ${rows.length}  admissible: ${rankable}  inadmissible: ${bad.length}`);
    for (const b of bad) {
        console.log(`  ✗ ${b.fixture_id}`);
        for (const p of b.problems) console.log(`      - ${p}`);
    }
    if (bad.length === 0) console.log('  ✓ every row is admissible and rankable');
}

// FAIL CLOSED: an artifact with any inadmissible row must not be quoted or ranked as-is.
process.exit(bad.length > 0 ? 1 : 0);
