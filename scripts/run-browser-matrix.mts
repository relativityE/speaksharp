#!/usr/bin/env tsx
/**
 * #1304 Task 3C — THE BROWSER LANE, on the certified path.
 *
 * Node results are diagnostics; the product runs ONNX Runtime Web in a browser. This lane wraps the
 * page as an ordinary `DecodeArm` (see `browserArm.ts`) so it goes through `certifyArmWithHonorProbe`
 * and `runArm` exactly as the Node lane does — same gates, same frozen-manifest completeness, same
 * refusal to emit a row without complete provenance. It previously ran its own decode-and-score loop
 * and derived its expected ids from the clips it had received, which can never detect a missing one.
 *
 * ASSETS ARE PINNED AND OFFLINE. The mirror refuses to serve a file whose digest is not the committed
 * one, and in pinned mode refuses the network entirely — so a run cannot silently re-acquire an asset
 * that changed upstream, and every row names the bytes it ran on.
 *
 *   usage: npx tsx scripts/run-browser-matrix.mts [--set=harvard|preflight|corpus]
 *                                                 [--mode=pinned|bootstrap] [--only=id,id] [--out=f.json]
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { resolve } from 'node:path';
import { cpus, arch, platform, loadavg } from 'node:os';
import { chromium } from '@playwright/test';
import manifest from '../tests/fixtures/corpus-manifest.json' with { type: 'json' };
import goldens from '../tests/evidence/normalization/goldens.json' with { type: 'json' };
import { startHarnessServer } from '../tests/evidence/certification/browser/server';
import { createBrowserArm, isSoftwareAdapter, generationFor } from '../tests/evidence/certification/browser/browserArm';
import { ARM_MATRIX, ADMITTED_ARMS, SELECTION_EXECUTION_SET, NOT_EXECUTED_REASONS, REQUIRED_MATRIX_ROWS } from '../tests/evidence/certification/arms/registry';
import { SELECTION_PLANS, selectionPlanDigest, validatePlanCoverage, finalizeUnderPlan } from '../tests/evidence/certification/arms/selectionPlan';
import { planResume, validateCompleteness, type RunIdentity, type CheckpointRow } from '../tests/evidence/certification/checkpoint';
import { atomicWriteFileSync } from '../tests/evidence/certification/atomicWrite';
import { ProbeRecorder, type ProbeInvocation } from '../tests/evidence/certification/probeArtifact';
import { buildAssetInventory, reconcileAssets, verifyAgainstCommittedPins } from '../tests/evidence/certification/assetInventory';
import { resolveRetention } from '../tests/evidence/certification/retention';
import { expectationFor } from '../tests/evidence/certification/arms/build';
import { certifyArmWithHonorProbe } from '../tests/evidence/certification/certify';
import { createHash } from 'node:crypto';
import { runArm, type CorpusUtterance } from '../tests/evidence/certification/runArm';
import { buildTechnicalVerdict } from '../tests/evidence/certification/buildVerdict';
import { normalizeOfficialTrackA } from '../tests/evidence/normalization/officialNormalizer';
import { decodeAudio } from '../tests/evidence/certification/audio';
import { verifyFrozenAudio, type ManifestShape } from '../tests/evidence/certification/corpusSet';
import { buildEvidenceSet } from '../tests/evidence/certification/evidenceSets';
import { EVIDENCE_SETS } from '../tests/evidence/certification/evidenceClass';
import { checkArtifactCompleteness } from '../tests/evidence/certification/artifactCompleteness';
import { resolveMoonshineRoute, resolveWhisperRoute } from '../tests/evidence/certification/candidateRoute';
import { hashModelDirectory, installedVersion } from '../tests/evidence/certification/arms/backend';
import { RUNTIME_ASSET_PINS } from '../tests/evidence/certification/arms/runtimeAssets';

/**
 * WHICH INFERENCE LIBRARY produced a row. v2 carries `@xenova/transformers`' own NESTED
 * onnxruntime-web@1.14.0; v4 and Moonshine carry the hoisted one, which the #1304 requalification pins
 * to a stable 1.27.0 containing Microsoft's Whisper QDQ fix.
 *
 * Recorded per row because old- and new-runtime numbers are measurements of DIFFERENT SYSTEMS. Sorting
 * them into one table would make the ordering an artifact of which rows had been re-run.
 */
const runtimeLabelFor = (isV2: boolean, isMoonshineWasm = false): string => {
    if (isMoonshineWasm) {
        const v = (JSON.parse(readFileSync('node_modules/@moonshine-ai/moonshine-wasm/package.json', 'utf8')) as { version: string }).version;
        return `@moonshine-ai/moonshine-wasm@${v}`;
    }
    // The NESTED copy is read by PATH, not by module resolution. `require.resolve` on
    // `@xenova/transformers/node_modules/onnxruntime-web` returns the HOISTED package, which reported
    // v2 as running 1.27.0 — the exact conflation this label exists to prevent, and it would have
    // labelled untouched v2 rows as new-runtime results.
    const nested = 'node_modules/@xenova/transformers/node_modules/onnxruntime-web/package.json';
    let ort: string | null = null;
    if (isV2 && existsSync(nested)) {
        ort = (JSON.parse(readFileSync(nested, 'utf8')) as { version: string }).version;
    } else {
        ort = installedVersion('onnxruntime-web');
    }
    return `${isV2 ? '@xenova/transformers' : '@huggingface/transformers'}+ort-web-${ort ?? 'unknown'}`;
};

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const onlyIds = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const planId = arg('selection-plan', '');
/**
 * RETENTION IS MANDATORY. A measuring run that retains nothing is not evidence — it is a console
 * session that disappears when the terminal closes. The 459-word preflight was run and its result
 * discussed, but it was invoked without `--out`, so `if (outPath)` silently skipped the write and the
 * measurement no longer exists anywhere. Hours of benchmark time produced nothing citable.
 *
 * So `--out` is now optional only in the sense that a DEFAULT is derived when it is omitted; the run
 * always retains. Discarding a run requires typing `--no-retain`, which is deliberate, loud, and
 * refused outright for the selection set.
 */
const explicitOut = arg('out', '');
const noRetain = args.includes('--no-retain');
const setName = arg('set', 'harvard');
const mode = arg('mode', 'pinned') as 'pinned' | 'bootstrap';
/**
 * Load every model and stop, recording the digest of each asset served.
 *
 * Pins have to come from somewhere, and a full measuring run is the wrong place to get them: the two
 * WebGPU cells take six to eighteen minutes each on a software rasterizer, and none of that inference
 * teaches us anything about which bytes were downloaded. Loading is the part that fetches.
 */
const pinsOnly = args.includes('--pins-only');

/**
 * DIAGNOSTIC-ONLY probe flags (#1304 Moonshine empty-hypothesis isolation).
 *
 * `--probe-clips` narrows to specific utterance ids; `--probe-max-new-tokens` overrides the Moonshine
 * generation bound. Both exist to ISOLATE a cause, never to produce a selection row: a run using either
 * is a subset run, which the retention rule already refuses to treat as complete evidence, and the
 * corrected configuration they help identify would need its own fingerprint and a full selection-grade
 * rerun before it could rank.
 */
const probeClips = arg('probe-clips', '') ? new Set(arg('probe-clips', '').split(',')) : null;
const probeMaxNewTokens = arg('probe-max-new-tokens', '') ? Number(arg('probe-max-new-tokens', '')) : null;

const PIN_FILE = 'tests/fixtures/hf-asset-pins.json';
const MOONSHINE_PIN_FILE = 'tests/fixtures/moonshine-asset-pins.json';
/** Pins for assets the official Moonshine runtime fetches from its own catalog. */
const moonshinePins: Record<string, { sha256: string; bytes: number }> = existsSync(MOONSHINE_PIN_FILE)
    ? (JSON.parse(readFileSync(MOONSHINE_PIN_FILE, 'utf8')) as {
          assets: Record<string, { sha256: string; bytes: number }>;
      }).assets
    : {};
const SELFHOSTED_PIN_FILE = 'tests/fixtures/selfhosted-model-pins.json';
/** The product's OWN model bytes. No other registry covers `frontend/public/models/**`. */
const selfHostedPinRegistry: Record<string, { sha256: string; bytes: number }> =
    existsSync(SELFHOSTED_PIN_FILE)
        ? (JSON.parse(readFileSync(SELFHOSTED_PIN_FILE, 'utf8')) as {
              assets: Record<string, { sha256: string; bytes: number }>;
          }).assets
        : {};
const LIB_PIN_FILE = 'tests/fixtures/lib-executable-pins.json';
const libExecutablePinRegistry: Record<string, { sha256: string; bytes: number; version: string }> =
    existsSync(LIB_PIN_FILE)
        ? (JSON.parse(readFileSync(LIB_PIN_FILE, 'utf8')) as {
              assets: Record<string, { sha256: string; bytes: number; version: string }>;
          }).assets
        : {};
const pins: Record<string, string> = existsSync(PIN_FILE)
    ? (JSON.parse(readFileSync(PIN_FILE, 'utf8')) as { assets: Record<string, string> }).assets
    : {};

const set = buildEvidenceSet(setName, manifest as unknown as ManifestShape);

const corpusProvenance = {
    version: manifest.corpusVersion,
    // The exact selection this run scored, not just the corpus's version label.
    digest: set.corpusDigest || `no-frozen-audio:${setName}`,
    archives: Object.fromEntries(Object.entries(manifest.archives).map(([n, a]) => [n, a.sha256])),
};

const evidenceClass = EVIDENCE_SETS[setName]?.evidenceClass ?? 'unknown';

/**
 * A TARGETED SELECTION RUN IS A COMMITTED PLAN, NEVER AN AD HOC `--only`.
 *
 * `--only` is a debugging subset: retention calls it one, and BOTH artifact and checkpoint completeness
 * are skipped when it is present. But an explicit `--out` still retains the run and `selectionEligible`
 * never required a complete plan — so a four-arm `--only` over the corpus set could write four
 * SELECTION-ELIGIBLE rows while silently omitting the rest of the matrix. The artifact would read as
 * selection evidence and be a fragment. Refusing it here is the only place that cannot be bypassed.
 */
const selectionPlan = planId ? SELECTION_PLANS[planId] : null;
if (planId && !selectionPlan) {
    console.error(`\nREFUSING to run: unknown selection plan '${planId}'. Known: ${Object.keys(SELECTION_PLANS).join(', ')}`);
    process.exit(1);
}
if (selectionPlan) {
    const coverage = validatePlanCoverage(selectionPlan);
    if (!coverage.ok) {
        console.error(`\nREFUSING to run: selection plan '${selectionPlan.id}' is ${coverage.reason} (${coverage.detail})`);
        process.exit(1);
    }
}
if (evidenceClass === 'selection' && onlyIds && !selectionPlan) {
    console.error('\nREFUSING to run: --only on a SELECTION set cannot produce selection evidence.');
    console.error('  A subset run skips completeness, so its rows would claim selection eligibility while the');
    console.error('  rest of the matrix was silently omitted. Use --selection-plan=<id> for a targeted run,');
    console.error('  which accounts for every registered arm as measured or dispositioned.');
    process.exit(1);
}
console.log(`\n#1304 BROWSER lane — set=${setName} (${evidenceClass}), `
    + `${set.clips.length} clips / ${set.referenceWords} normalized words, mirror mode=${mode}\n`);


// Frozen audio verified BEFORE anything is decoded, exactly as in the Node lane.
const audioMismatches: string[] = [];
const clipSeconds = new Map<string, number>();
for (const clip of set.clips) {
    if (clip.frozen) {
        const verified = verifyFrozenAudio(clip.path, {
            audioSha256: clip.frozen.audioSha256, audioBytes: clip.frozen.audioBytes,
        });
        if (!verified.ok) { audioMismatches.push(`${clip.id}: ${verified.reason}`); continue; }
    }
    try { clipSeconds.set(clip.id, decodeAudio(clip.path).seconds); }
    catch (error) { audioMismatches.push(`${clip.id}: unreadable (${(error as Error).message.slice(0, 60)})`); }
}

const harness = await startHarnessServer(resolve('.'), {
    mode, pins, offlineOnly: mode === 'pinned',
    // Runtime binaries are verified BY THE SERVER on every request, not merely checked to exist once.
    runtimePins: RUNTIME_ASSET_PINS,
});
const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU'],
});

const urlFor = (path: string) => path
    .replace(/^tests\/fixtures\//, '/fixtures/')
    .replace(/^bench-corpus\//, '/corpus/');

const deviceInfo = { platform: platform(), arch: arch(), cpuModel: cpus()[0]?.model ?? 'unknown', cores: cpus().length };
/**
 * Distinct decode-failure messages with counts and a bounded sample of affected utterances.
 *
 * Sorted by descending count so the dominant cause reads first. `sample` is capped because an artifact
 * should identify a failure mode, not enumerate every instance of it.
 */
const summarizeDecodeFailures = (
    failures: readonly { utteranceId: string; message: string }[],
): Array<{ message: string; count: number; sample: string[] }> => {
    const byMessage = new Map<string, string[]>();
    for (const f of failures) {
        const key = (f.message ?? 'unknown').slice(0, 300);
        byMessage.set(key, [...(byMessage.get(key) ?? []), f.utteranceId]);
    }
    return [...byMessage.entries()]
        .map(([message, ids]) => ({ message, count: ids.length, sample: ids.slice(0, 5) }))
        .sort((a, b) => b.count - a.count);
};

/**
 * Host state at run start, RECORDED IN THE ARTIFACT rather than asserted in prose.
 *
 * Two arms of the frozen 600 were latency-contaminated by competing local work, and a later rerun failed
 * with 148 throws under suspected memory pressure. In both cases the host condition was described in
 * conversation and retained nowhere, so neither claim could be checked afterwards. A timing figure whose
 * host state is unrecorded is not reproducible.
 */
const hostGate = (): Record<string, unknown> => {
    const read = (cmd: string, args: string[]) => {
        try { return execFileSync(cmd, args, { encoding: 'utf8' }); } catch { return ''; }
    };
    const vm = read('vm_stat', []);
    const num = (label: string) => {
        const m = new RegExp(`${label}[^0-9]*([0-9]+)`).exec(vm);
        return m ? Number(m[1]) : null;
    };
    const swap = /used = ([0-9.]+)M/.exec(read('sysctl', ['-n', 'vm.swapusage']));
    return {
        capturedAt: new Date().toISOString(),
        cpuCores: cpus().length,
        platform: platform(),
        arch: arch(),
        loadAverage: loadavg(),
        pageouts: num('Pageouts'),
        swapouts: num('Swapouts'),
        swapUsedMb: swap ? Number(swap[1]) : null,
        note: 'Point-in-time at run start. Counter DELTAS across a run are what indicate pressure; a high historical swap allocation is not itself a gate.',
    };
};

const headSha = (): string => {
    try {
        return execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch { /* not a git checkout — the set name alone still beats retaining nothing */ }
    return 'unknown';
};

/**
 * RETENTION IS RESOLVED BEFORE ANY MEASURING STARTS. Deciding where a run retains only AFTER the arms
 * have run means an operator learns the run kept nothing at the end of a multi-hour job — and the
 * checkpoint path cannot exist before the destination does.
 */
const retention = resolveRetention({
    explicitOut, noRetain, subsetRun: !!onlyIds, setName, evidenceClass, sha: headSha(),
});
if (retention.kind === 'refuse') {
    console.error(`\nREFUSING --no-retain on the selection set: ${retention.reason}.`);
    process.exit(1);
}
if (retention.kind === 'discard') {
    console.warn(`\nTHIS RUN RETAINS NOTHING (${retention.reason}). Nothing it prints may be cited as evidence.`);
}
const outPath = retention.kind === 'retain' ? retention.path : '';
if (retention.kind === 'retain' && retention.derived) {
    console.log(`\nno --out given; retaining to ${outPath}`);
}
// Never silently overwrite a retained measurement with a later one.
if (outPath && existsSync(outPath)) {
    console.error(`\nREFUSING to overwrite existing evidence ${outPath}. Move it aside or pass a different --out.`);
    process.exit(1);
}


/** SHA-256 over the concatenated contents of files, in the order given. Missing file => explicit marker. */
const digestOfFiles = (paths: string[]): string => {
    const h = createHash('sha256');
    for (const f of paths) {
        h.update(f);
        h.update(existsSync(f) ? readFileSync(f) : Buffer.from('<<ABSENT>>'));
    }
    return h.digest('hex').slice(0, 32);
};

/**
 * IDENTITY OF THIS RUN. Every field must match for a checkpoint to be resumable — see checkpoint.ts.
 * A resumable artifact can silently splice rows measured under a different scorer, corpus or tree into
 * one table that reads as a single experiment, so the bar for resuming is exact equality, not "close".
 */
/**
 * THE PRODUCT BASELINE IS NOT THE HARNESS TREE.
 *
 * Both fields were `headSha()`, so they always agreed and the artifact asserted an identity it had never
 * established: the baseline is the product revision the measurement CHARACTERISES, while executionSha is
 * the tree the harness ran from. They coincide only when the harness happens to be run from the product
 * commit under test, which is an accident of workflow, not a fact about the evidence — and once they are
 * conflated, an artifact can claim to characterise a baseline it never measured.
 *
 * It must therefore be stated, not inferred. `--product-baseline <sha>` or PRODUCT_BASELINE.
 */
const productBaseline = ((): string => {
    const flag = args.find((a) => a.startsWith('--product-baseline='))?.split('=')[1]
        ?? process.env.PRODUCT_BASELINE;
    if (flag && flag.trim()) return flag.trim();
    console.error('\nREFUSING to run: the product baseline was not stated.');
    console.error('  It is the product revision this measurement characterises, and it is NOT the harness');
    console.error('  tree. Pass --product-baseline=<sha> or set PRODUCT_BASELINE. Inferring it from HEAD');
    console.error('  makes the artifact claim a baseline it never measured.');
    process.exit(1);
})();

const runIdentity: RunIdentity = {
    productBaseline,
    executionSha: headSha(),
    policySha: digestOfFiles(['tests/evidence/certification/selectionPolicy.ts']),
    // The manifest IS the frozen corpus: 600 ids each bound to its audio SHA-256.
    corpusDigest: digestOfFiles(['tests/fixtures/corpus-manifest.json']),
    // Binds the normalizer IMPLEMENTATION, not a version string a change could forget to bump — a
    // silent scorer edit rewrites every WER in the table.
    normalizerId: digestOfFiles([
        'tests/evidence/normalization/officialNormalizer.ts',
        'tests/evidence/normalization/englishNumberNormalizer.ts',
        'tests/evidence/normalization/tracks.ts',
    ]),
    registryDigest: digestOfFiles(['tests/evidence/certification/arms/registry.ts']),
    // The pinned model and runtime asset identities, which are static files — `harness.assets` is empty
    // at this point because it accumulates as arms actually fetch.
    // Includes the /lib EXECUTABLE identities. Without them r3 and r4 carried the SAME assetDigest while
    // their executable inventories differed, so a partial run could resume across a change to the bytes
    // that actually execute — exactly what this digest exists to prevent.
    assetDigest: digestOfFiles([
        'tests/fixtures/hf-asset-pins.json',
        'tests/fixtures/moonshine-asset-pins.json',
        'tests/fixtures/lib-executable-pins.json',
        'tests/fixtures/selfhosted-model-pins.json',
        'tests/evidence/certification/arms/runtimeAssets.ts',
    ]),
    setName,
    evidenceClass,
    // A checkpoint measured under a DIFFERENT plan is a different experiment; the digest binds the plan
    // FILE, so editing it cannot silently splice rows across the edit.
    selectionPlanId: selectionPlan?.id ?? null,
    selectionPlanDigest: selectionPlan ? selectionPlanDigest() : null,
} as RunIdentity & { selectionPlanId: string | null; selectionPlanDigest: string | null };

const hostAtStart = hostGate();
const partialPath = outPath ? outPath.replace(/\.json$/, '') + '.partial.json' : '';

/**
 * EXCLUSIVE RESERVATION of the output and partial paths.
 *
 * A multi-hour run whose artifact a second process can also write is a run whose evidence nobody can
 * attribute. `wx` is atomic at the filesystem level, so two starters cannot both believe they own the
 * path. The lock records WHO holds it, so a stale lock is diagnosable rather than a mystery, and it is
 * released on every exit path — including signals, where the previous design would have left it behind.
 */
const lockPath = outPath ? `${outPath}.lock` : '';
if (lockPath) {
    try {
        writeFileSync(lockPath, `${JSON.stringify({
            pid: process.pid, startedAt: new Date().toISOString(),
            host: `${platform()}/${arch()}`, out: outPath,
        }, null, 2)}\n`, { flag: 'wx' });
    } catch {
        let holder = '(unreadable)';
        try { holder = readFileSync(lockPath, 'utf8').trim(); } catch { /* keep the placeholder */ }
        console.error(`\nREFUSING to start: ${lockPath} is held by another run.`);
        console.error(holder);
        console.error('If that process is gone, delete the lock deliberately — do not assume it is stale.');
        process.exit(1);
    }
    const release = () => { try { rmSync(lockPath, { force: true }); } catch { /* nothing left to do */ } };
    process.on('exit', release);
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
        process.on(sig, () => { release(); process.exit(130); });
    }
}

/**
 * The host a checkpoint was measured on, bound into resume.
 *
 * Timings are host-dependent, so resuming a partial run on a different machine, core count or browser
 * build splices two populations into one table that reads as a single experiment. Identity already
 * covers the CODE; this covers the MACHINE.
 */
const hostFingerprint = createHash('sha256').update(JSON.stringify({
    platform: platform(), arch: arch(), cpuCores: cpus().length,
    playwright: installedVersion('playwright') ?? installedVersion('@playwright/test') ?? 'unknown',
})).digest('hex').slice(0, 16);

/** Rows already measured under an IDENTICAL identity, if any. */
let results: Record<string, unknown>[] = [];
let alreadyDone = new Set<string>();
if (partialPath && existsSync(partialPath)) {
    let parsed: unknown = null;
    try { parsed = JSON.parse(readFileSync(partialPath, 'utf8')); } catch { parsed = null; }
    const recordedHost = (parsed as { hostFingerprint?: unknown } | null)?.hostFingerprint;
    if (recordedHost !== undefined && recordedHost !== hostFingerprint) {
        console.log(`\n  NOT resuming ${partialPath} (host fingerprint ${String(recordedHost)} != ${hostFingerprint}) — starting clean`);
        parsed = null;
    }
    const plan = planResume(parsed, runIdentity);
    if (plan.kind === 'resume') {
        results = plan.rows as Record<string, unknown>[];
        alreadyDone = new Set(plan.completed);
        console.log(`\n  RESUMING from ${partialPath}: ${alreadyDone.size} arm(s) already measured under an identical identity`);
    } else {
        console.log(`\n  NOT resuming ${partialPath} (${plan.reason}) — starting clean`);
    }
}

/**
 * Checkpoint after EVERY arm. The previous design wrote once at the end, so a crash hours in discarded
 * every completed arm and left only a console log, which is not retained evidence.
 */
const checkpoint = (): void => {
    if (!partialPath) return;
    atomicWriteFileSync(partialPath, `${JSON.stringify({ partial: true, identity: runIdentity, hostFingerprint, rows: results }, null, 2)}\n`);
};

for (const spec of ARM_MATRIX) {
    if (onlyIds && !onlyIds.has(spec.id)) continue;
    // Under a plan, an arm is either measured or preserved with the plan's typed reason — never skipped.
    //
    // RETAINED ROWS ARE CHECKED FIRST. Appending before consulting `alreadyDone` re-added every
    // disposition row on resume, so a resumed run failed its own duplicate-arm validation — the
    // checkpoint would be correct and the finalization would refuse it.
    if (selectionPlan && !selectionPlan.measured.includes(spec.id)) {
        if (alreadyDone.has(spec.id)) {
            console.log(`\n  ${spec.id}  — disposition already in checkpoint, not re-appended`);
            continue;
        }
        const reason = selectionPlan.dispositions[spec.id];
        results.push({ id: spec.id, lane: 'browser', set: setName, evidenceClass, executed: false, reason });
        console.log(`\n  ${spec.id}  — not measured under ${selectionPlan.id} (${reason})`);
        checkpoint();
        continue;
    }
    if (alreadyDone.has(spec.id)) {
        console.log(`\n  ${spec.id}  — already in checkpoint, not re-measured`);
        continue;
    }
    // PRESERVED BUT NOT EXECUTED. An alias cannot rank against what it is byte-identical to; a
    // diagnostic duplicate answers a harness question; SwiftShader proves WebGPU compatibility and
    // nothing about hardware speed. Each keeps a row carrying its named reason — completeness does not
    // require spending selection compute on them.
    const notExecuted = NOT_EXECUTED_REASONS[spec.id];
    if (notExecuted && evidenceClass === 'selection') {
        results.push({ id: spec.id, lane: 'browser', set: setName, evidenceClass, executed: false, reason: notExecuted });
        console.log(`\n  ${spec.id}  — not executed (${notExecuted})`);
        checkpoint();
        continue;
    }
    if (spec.admission.status !== 'admitted') {
        results.push({ id: spec.id, lane: 'browser', set: setName, evidenceClass, skipped: spec.admission.status, reason: spec.admission.reason });
        console.log(`\n  ${spec.id}  — ${spec.admission.status} (${spec.admission.reason})`);
        checkpoint();
        continue;
    }
    if (evidenceClass === 'selection' && !(SELECTION_EXECUTION_SET as readonly string[]).includes(spec.id)) {
        // Fail loudly rather than silently measuring something the ruling excluded.
        console.error(`\n  REFUSING to measure ${spec.id} on the selection set: not in SELECTION_EXECUTION_SET and no named reason.`);
        process.exit(1);
    }
    console.log(`\n  ${spec.id}  (${spec.label})`);

    const context = await browser.newContext();
    const page = await context.newPage();

    /**
     * RECORD, THEN HASH OUT OF BAND.
     *
     * `@moonshine-ai/moonshine-wasm` resolves components from its own catalog, so those weights never
     * pass through the harness mirror and the arms failed the provenance gate with an EMPTY digest map
     * — the gate working correctly.
     *
     * The first fix intercepted every request with `page.route` and fulfilled it from Node. That KILLED
     * THE PAGE ("Target page, context or browser has been closed") — buffering hundreds of megabytes
     * through the automation channel is not free. Observing which URLs were fetched and hashing them
     * afterwards, outside the page, gets the same evidence without touching the run.
     */
    const externalUrls = new Set<string>();
    /**
     * INDEPENDENTLY OBSERVED REQUEST LEDGER.
     *
     * The declared inventory comes from `beginArmCapture()`/`beginRuntimeCapture()` — the harness telling
     * us what it believes it served. Reconciling that against `modelBytes`, which is computed from the
     * SAME object, is tautological: it can never detect a file the arm requested but the harness never
     * recorded, which is exactly the omission worth catching.
     *
     * This ledger is built from the page's OWN responses, a channel the inventory does not write to, so
     * disagreement between the two is detectable. Sizes come from `content-length` where the server sent
     * it; a response with no length is recorded as unknown rather than assumed zero.
     */
    const observedRequests = new Map<string, { bytes: number | null; status: number; count: number }>();
    page.on('response', (response) => {
        const url = response.url();
        if (!url.startsWith(harness.origin) && /^https?:/.test(url)) externalUrls.add(url);
        const key = url.replace(/^https?:\/\/[^/]+\//, '').replace(/[?#].*$/, '').replace(/^hf\//, '');
        if (!/\.(onnx|bin|wasm|mjs|json|ort|txt)$/i.test(key)) return;
        const len = response.headers()['content-length'];
        const prev = observedRequests.get(key);
        observedRequests.set(key, {
            bytes: len ? Number(len) : (prev?.bytes ?? null),
            status: response.status(),
            count: (prev?.count ?? 0) + 1,
        });
    });

    /**
     * OFFLINE ENFORCEMENT for a runtime that fetches from its own CDN.
     *
     * In pinned mode every external request is served from the LOCAL CACHE and verified against a
     * committed digest. A miss, an alteration, or a path with no pin ABORTS the request and marks the
     * arm — a silent network fallback would let an unpinned or changed asset produce a measurement
     * that looks identical to a pinned one.
     *
     * Only these small `.ort`/`.bin`/`.json` component files are served this way. An earlier attempt
     * routed EVERY request through Node and killed the page outright; here the page never waits on the
     * automation channel for anything it could have fetched itself, because nothing reaches the network
     * at all.
     */
    const pinViolations: { url: string; reason: 'unpinned' | 'missing_local' | 'digest_mismatch' }[] = [];
    let networkAttempts = 0;
    if (mode === 'pinned') {
        await context.route((url) => !url.href.startsWith(harness.origin) && /^https?:/.test(url.href),
            async (route) => {
                networkAttempts += 1;
                const url = route.request().url();
                const key = url.replace(/^https?:\/\//, '').replace(/[?#].*$/, '');
                const pin = moonshinePins[key];
                const cached = join('.hf-cache', 'external', key);
                if (!pin) { pinViolations.push({ url, reason: 'unpinned' }); return route.abort(); }
                if (!existsSync(cached)) { pinViolations.push({ url, reason: 'missing_local' }); return route.abort(); }
                const body = readFileSync(cached);
                const digest = createHash('sha256').update(body).digest('hex');
                if (digest !== pin.sha256) {
                    pinViolations.push({ url, reason: 'digest_mismatch' });
                    return route.abort();
                }
                // REDIRECT to the local server rather than fulfilling with the bytes. Pushing a 147 MB
                // decoder through the automation channel killed the page outright — twice. The harness
                // server already streams 122 MB of self-hosted models without trouble, so the
                // verified bytes travel over ordinary HTTP and only the redirect crosses the channel.
                await route.fulfill({
                    status: 302,
                    headers: {
                        location: `${harness.origin}/external/${key}`,
                        // The redirect is cross-origin, so it needs CORS headers of its own — without
                        // them the runtime's fetch fails with a bare "Failed to fetch" and the arm
                        // looks like a model failure rather than a harness one.
                        'access-control-allow-origin': '*',
                    },
                });
            });
    }

    await page.goto(`${harness.origin}/harness.html`);
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);

    // Capture the assets THIS arm requests, so its provenance names its own bytes and no others.
    const endArmCapture = harness.beginArmCapture();
    const before = await page.evaluate(() => (window as unknown as { __BACKEND_EVIDENCE__: Record<string, number> }).__BACKEND_EVIDENCE__);
    const freshSession = before.wasmInstantiations === 0 && before.gpuDevicesCreated === 0;

    const isV2 = spec.runtime === 'v2';
    const isMoonshineWasm = spec.runtime === 'moonshine-wasm';
    const isMoonshine = spec.runtime === 'moonshine' || isMoonshineWasm;
    const selfHosted = isV2 && spec.localModelId !== undefined;
    const modelId = isV2 ? (spec.localModelId ?? spec.modelId) : spec.modelId;
    const deviceClaim: 'wasm' | 'webgpu' = spec.device === 'webgpu' ? 'webgpu' : 'wasm';

    /**
     * CAPTURE THE RUNTIME BINARIES THIS ARM ACTUALLY REQUESTS.
     *
     * The previous version verified the files listed in a hand-maintained `runtimeAssetsFor()` table.
     * That proves declared files exist; it cannot discover an unlisted dependency, which was the
     * entire defect. The server now refuses anything unlisted and records what it served, so the
     * evidence comes from the run rather than from the list.
     *
     * It also keeps the download total HONEST: ORT Web ships eight binaries totalling 79.8 MB, but an
     * arm fetches only the subset its backend selects. Counting all eight would overstate every v4
     * arm's first-run cost.
     */
    const endRuntimeCapture = harness.beginRuntimeCapture();
    const runtimeFailuresBefore = harness.runtimeFailures.length;

    // COLD LOAD, measured in a FRESH context: what a new user waits for once.
    const coldLoadStarted = Date.now();
    const loaded = await page.evaluate(async (input) => {
        const w = window as unknown as { __asr?: unknown };
        try {
            if (input.isMoonshineWasm) {
                // Moonshine's OWN runtime. Wrapped to the same `window.__asr` contract the
                // transformers.js arms use, so `createBrowserArm` — and therefore `runArm`, the
                // certified scorer and every gate — work unchanged. A different runtime is an
                // adapter, not a separate measurement path.
                const lib = await import(input.libUrl);
                const { Transcriber, ModelArch } = lib as {
                    Transcriber: { load: (o: Record<string, unknown>) => Promise<{
                        transcribe: (a: Float32Array) => Promise<unknown>;
                    }> };
                    ModelArch: Record<string, number>;
                };
                const transcriber = await Transcriber.load({
                    language: 'en',
                    modelArch: ModelArch[input.moonshineArch],
                });
                w.__asr = async (audio: Float32Array) => {
                    const result = await transcriber.transcribe(audio);
                    // The runtime returns `{ lines: [{ text, startTime, duration }] }`. Scoring the
                    // JSON instead of the text read as WER 2.0 for a nearly-correct transcript.
                    const structured = result as { lines?: { text?: string }[]; text?: string };
                    const text = Array.isArray(structured?.lines)
                        ? structured.lines.map((l) => l?.text ?? '').join(' ').trim()
                        : structured?.text ?? '';
                    return { text };
                };
                return { ok: true as const };
            }

            const lib = await import(input.libUrl);
            const { pipeline, env } = lib as {
                pipeline: (t: string, m: string, o: Record<string, unknown>) => Promise<unknown>;
                env: Record<string, unknown>;
            };
            /**
             * SELF-HOST THE ORT WEB RUNTIME TOO.
             *
             * `onnxruntime-web` defaults its `wasmPaths` to
             * `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/`, so every v4 and Moonshine
             * arm fetched three runtime binaries from a CDN. Same defect as v2, second package —
             * found by the clean-workspace check, not by reasoning, after I had asserted these
             * families bundled their runtime.
             */
            const ortEnv = (env as { backends?: { onnx?: { wasm?: { wasmPaths?: string } } } });
            if (ortEnv.backends?.onnx?.wasm) {
                ortEnv.backends.onnx.wasm.wasmPaths = `${input.origin}/runtime/ortweb/`;
            }

            (env as { remoteHost: string }).remoteHost = `${input.origin}/hf/`;
            (env as { remotePathTemplate: string }).remotePathTemplate = '{model}/resolve/{revision}/';
            if (input.isV2) {
                /**
                 * SELF-HOST THE RUNTIME'S OWN WASM.
                 *
                 * `@xenova/transformers` defaults `wasmPaths` to
                 * `https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/`, so the ONNX
                 * Runtime binary is fetched from a CDN at load time. Neither pin manifest listed it —
                 * they pin MODEL assets — so under offline enforcement every v2 arm was refused as
                 * `unpinned` and produced no WER.
                 *
                 * The enforcement was right; the omission was mine. I added external blocking in the
                 * final commit before merge and re-ran only the Streaming arms under it, so no v2 arm
                 * was ever exercised against the rule that broke it. Pointing `wasmPaths` at the
                 * installed copy on our own origin makes the runtime binary as pinned as the weights.
                 */
                (env as { backends: { onnx: { wasm: { wasmPaths: string } } } })
                    .backends.onnx.wasm.wasmPaths = `${input.origin}/runtime/xenova/`;
                (env as { allowLocalModels: boolean }).allowLocalModels = input.selfHosted;
                (env as { allowRemoteModels: boolean }).allowRemoteModels = !input.selfHosted;
                (env as { localModelPath: string }).localModelPath = '/models/';
            }
            const options: Record<string, unknown> = input.isV2
                ? { quantized: true }
                : { dtype: input.dtype, device: input.device };
            if (input.revision) options.revision = input.revision;
            w.__asr = await pipeline('automatic-speech-recognition', input.modelId, options);
            return { ok: true as const };
        } catch (error) {
            return { ok: false as const, error: (error as Error)?.message?.slice(0, 260) ?? String(error) };
        }
    }, {
        origin: harness.origin,
        libUrl: isMoonshineWasm
            ? '/lib/@moonshine-ai/moonshine-wasm/dist/index.js'
            : isV2
                ? '/lib/@xenova/transformers/dist/transformers.js'
                : '/lib/@huggingface/transformers/dist/transformers.web.js',
        isMoonshineWasm,
        moonshineArch: spec.id.includes('medium') ? 'MediumStreaming' : 'SmallStreaming',
        isV2, selfHosted, modelId,
        dtype: typeof spec.dtype === 'object' ? spec.dtype : spec.dtype ?? undefined,
        device: deviceClaim,
        revision: spec.revision ?? null,
    });

    const coldLoadMs = Date.now() - coldLoadStarted;
    const armAssets = endArmCapture();
    const runtimeAssetRecords = endRuntimeCapture();
    // ARM-SCOPED. `harness.runtimeFailures` accumulates for the life of the server, so one arm's
    // refusal would follow every later arm and invalidate runs that were themselves clean.
    const runtimeAssetFailures = harness.runtimeFailures.slice(runtimeFailuresBefore);
    if (runtimeAssetFailures.length > 0) {
        console.log(`    RUNTIME ASSET REFUSED (${runtimeAssetFailures.length}):`);
        for (const f of runtimeAssetFailures.slice(0, 5)) {
            console.log(`      ${f.reason}  ${f.path}  ${f.detail}`);
        }
    }

    // Hash whatever the arm fetched from outside our origin, in Node, cached on disk so a re-run does
    // not re-download. This is what lets a CDN-fetching runtime carry real provenance.
    // `pinned` is DERIVED from the pin registry, not hardcoded false.
    //
    // It was hardcoded, and the first preflight exposed the cost: every Moonshine `.ort` file was reported
    // `pinned: false` even though `pinViolations` was empty, `offlineEnforced` was true and all 7 external
    // requests had been served from committed pins. Under the new asset gate that mislabelling would have
    // made every Moonshine arm INELIGIBLE — a whole model family disqualified by a flag that described the
    // code path rather than the fact.
    const cdnAssets: Record<string, { sha256: string; bytes: number; source: 'network'; pinned: boolean }> = {};
    for (const url of externalUrls) {
        const key = url.replace(/^https?:\/\//, '').replace(/[?#].*$/, '');
        const cached = join('.hf-cache', 'external', key);
        try {
            let body: Buffer;
            if (existsSync(cached)) {
                body = readFileSync(cached);
            } else {
                const upstream = await fetch(url);
                if (!upstream.ok) continue;
                body = Buffer.from(await upstream.arrayBuffer());
                mkdirSync(dirname(cached), { recursive: true });
                writeFileSync(cached, body);
            }
            cdnAssets[key] = {
                // Pinned iff this exact key is in the committed pin registry.
                pinned: Object.prototype.hasOwnProperty.call(moonshinePins, key),
                sha256: createHash('sha256').update(body).digest('hex'),
                bytes: body.length, source: 'network',
            };
        } catch { /* recorded as absent rather than as zero */ }
    }
    if (!loaded.ok) {
        // NAME THE CAUSE. A pin violation surfaces inside the page as a bare "Failed to fetch", which
        // reads as a model or network problem rather than as the harness correctly refusing an asset
        // it did not commit to.
        if (pinViolations.length > 0) {
            console.log(`    LOAD REFUSED — ${pinViolations.length} pin violation(s):`);
            for (const v of pinViolations.slice(0, 6)) console.log(`      ${v.reason}  ${v.url}`);
        } else {
            console.log(`    LOAD FAILED: ${loaded.error}`);
        }
        results.push({
            id: spec.id, lane: 'browser', set: setName, evidenceClass, freshSession,
            loadError: loaded.error, pinViolations, networkAttempts,
            // The NAMED runtime reason survives into the artifact. It was being degraded to a generic
            // "model failed to load in this runtime", which reads as a model problem and loses the one
            // fact that explains it.
            runtimeAssetFailures,
            wer: null, selectionEligible: false,
            selectionIneligibleReason: runtimeAssetFailures.length > 0
                ? `runtime asset: ${[...new Set(runtimeAssetFailures.map((f) => f.reason))].join(', ')}`
                : pinViolations.length > 0
                    ? `asset pin violation: ${pinViolations.map((v) => v.reason).join(', ')}`
                    : 'model failed to load in this runtime',
        });
        await context.close();
        continue;
    }

    /**
     * BUILT BEFORE THE LOAD-ONLY RETURN.
     *
     * This construction used to sit AFTER the `pinsOnly` early return, so the load-only footprint control
     * — the arm whose entire purpose is to characterise what a user downloads — exited without ever
     * building the inventory it exists to produce. Hoisting it means a load-only row retains the same
     * per-file model/runtime inventory, hashes, roles, bytes, source and reconciliation result as a
     * decoding row.
     */
    const allArmAssets: Record<string, { sha256: string; bytes: number; source: 'cache' | 'network'; pinned: boolean }> =
        Object.fromEntries([
            // The runtime binaries this arm ACTUALLY requested.
            ...Object.entries(runtimeAssetRecords),
            ...(selfHosted
                ? Object.entries(hashModelDirectory(resolve('frontend/public/models', modelId)))
                      .map(([path, sha256]) => [`${modelId}/${path}`, {
                          sha256,
                          bytes: statSync(resolve('frontend/public/models', modelId, path)).size,
                          source: 'cache' as const, pinned: true,
                      }] as const)
                : Object.keys(armAssets).length > 0
                    ? Object.entries(armAssets)
                    // `...v` LAST would still be overridden by a hardcoded flag, which is what happened:
                    // this spread re-stamped every CDN asset `pinned: false` after cdnAssets had already
                    // derived the real value from the pin registry. The first preflight then reported all
                    // seven pinned Moonshine `.ort` files as unpinned, which the new asset gate would have
                    // turned into a disqualification of the entire Moonshine family.
                    : Object.entries(cdnAssets).map(([k, v]) => [k, {
                          ...v, source: 'network' as const,
                      }] as const)),
        ]);

    if (pinsOnly) {
        const loadOnlyInventory = buildAssetInventory(allArmAssets, null);
        console.log(`    loaded — ${loadOnlyInventory.fileCount} files, `
            + `${(loadOnlyInventory.totalBytes / 1e6).toFixed(1)} MB attributable to THIS arm`);
        // RECORD A ROW PER ARM. This mode used to `continue` without pushing anything, so a retained
        // artifact carried a single result while its log showed fourteen arms loading. An artifact
        // that does not stand on its own is not evidence — the reader has to trust a log beside it.
        results.push({
            id: spec.id, label: spec.label, lane: 'browser', set: setName, evidenceClass,
            runtimeLabel: runtimeLabelFor(isV2, isMoonshineWasm),
            mode: 'load-only', loaded: true, freshSession,
            runtimeAssets: Object.fromEntries(
                Object.entries(runtimeAssetRecords).map(([k, v]) => [k, { sha256: v.sha256, bytes: v.bytes }]),
            ),
            runtimeAssetFailures, pinViolations, networkAttempts,
            offlineEnforced: mode === 'pinned' && pinViolations.length === 0
                && runtimeAssetFailures.length === 0,
            // The footprint evidence this arm exists to produce — previously unreachable from here.
            assetInventory: loadOnlyInventory,
            assetReconciliation: reconcileAssets(loadOnlyInventory, Object.fromEntries(observedRequests), {
                requirePinned: mode === 'pinned',
            }),
            observedRequestCount: observedRequests.size,
            assetCount: Object.keys(allArmAssets).length,
            wer: null, selectionEligible: false,
            // A typed disposition, not a prose sentence: `load_only` is a registered non-measurement, so
            // the completeness gate can accept it deliberately instead of guessing from free text.
            disposition: 'load_only',
            selectionIneligibleReason: 'load-only run: no decode was performed',
        });
        await context.close();
        continue;
    }

    const route = (seconds: number) => {
        const resolved = isMoonshine
            ? resolveMoonshineRoute(spec.modelId, seconds)
            : resolveWhisperRoute(isV2 ? 'v2' : 'v4', modelId, seconds, spec.variantId);
        // DIAGNOSTIC OVERRIDE. Applies to the Moonshine family only — the whisper route's bound is a
        // different mechanism and overriding it here would silently change an unrelated experiment.
        if (probeMaxNewTokens !== null && resolved.family === 'moonshine') {
            return { ...resolved, maxNewTokens: probeMaxNewTokens };
        }
        return resolved;
    };

    /**
     * ONE ASSET OBJECT, used by the arm's provenance, the verdict's footprint and the serialized
     * count.
     *
     * It was built TWICE — once for `createBrowserArm` and once for `buildTechnicalVerdict` — and I
     * added the runtime binaries to the second only. The artifact then contradicted itself: the v4
     * fp32 verdict reported 9 files while its certification provenance reported 7, and the two missing
     * ones were the runtime binaries. So the fingerprint bound the model weights but NOT the bytes
     * that executed them, and a runtime could change without moving it.
     *
     * Two constructions of the same fact will diverge; the fix is to have one.
     */

    const arm = createBrowserArm({
        id: spec.id, page, route, deviceClaim,
        modelId,
        modelRevision: spec.revision ?? (selfHosted ? `self-hosted:${modelId}` : `huggingface:${modelId}`),
        // A SELF-HOSTED arm's weights never pass through the HuggingFace mirror, so its digests come
        // from the product's own models directory — the same files the page loads from /models/.
        // The runtime binaries travel with the weights they executed — on EVERY arm. They were
        // THE SAME object the verdict and the serialized count use.
        assets: allArmAssets,
        assetsSource: selfHosted ? '/models/ (product self-hosted)' : `${harness.origin}/hf/ (pinned mirror)`,
        assetsVerdict: selfHosted ? 'identical' : 'unverifiable',
        runtimeLibrary: isMoonshineWasm
            ? '@moonshine-ai/moonshine-wasm'
            : isV2 ? '@xenova/transformers' : '@huggingface/transformers',
        runtimeVersion: isMoonshineWasm
            // Import-only package: `require.resolve` cannot see it and returned 'unknown', which the
            // provenance gate rejects as a placeholder. Read by path.
            ? (JSON.parse(readFileSync('node_modules/@moonshine-ai/moonshine-wasm/package.json', 'utf8')) as { version: string }).version
            : installedVersion(isV2 ? '@xenova/transformers' : '@huggingface/transformers') ?? '',
        device: deviceInfo,
        corpus: corpusProvenance,
    });

    const utterances: CorpusUtterance[] = set.clips
        .filter((c) => clipSeconds.has(c.id))
        .filter((c) => !probeClips || probeClips.has(c.id))
        .map((c) => ({ id: c.id, reference: c.reference, locator: urlFor(c.path), audioSeconds: clipSeconds.get(c.id)! }));

    /**
     * DIAGNOSTIC PROBE PATH (#1304 Moonshine empty-hypothesis isolation).
     *
     * Persistence is delegated to ProbeRecorder, whose behaviour is proven by tests rather than by this
     * call site: skeleton before the first decode, every cell durable before anything derived from it is
     * printed, and a final artifact only once the exact expected set is covered.
     *
     * Every observation is tagged with the INVOCATION it came from. A cell holds no bare result fields,
     * so token ids from `model.generate` cannot be reported beside a `{text}` from a different pipeline
     * call as though one traced path produced both.
     *
     * Bypasses runArm, certification and scoring, and constructs NO SelectionRow: an overridden route
     * legitimately fails route parity, and certifying a probe would be false.
     */
    if (probeMaxNewTokens !== null || probeClips) {
        // PER-ARM PATHS. Without the arm id every arm in one run writes the SAME file, and the second
        // silently replaces the first — the exact overwrite the recorder refuses within a cell, reached
        // instead by two recorders sharing a path. Found when a two-arm parity probe produced a
        // one-arm artifact.
        const armSlug = spec.id.replace(/[^a-zA-Z0-9]+/g, '_');
        const base = `${(outPath || 'evidence-runs/probe').replace(/\.json$/, '')}.${armSlug}`;
        const recorder = new ProbeRecorder(`${base}.probe-partial.json`, `${base}.probe.json`, {
            kind: 'diagnostic_probe',
            armId: spec.id,
            command: process.argv.slice(1).join(' '),
            executionSha: headSha(),
            expectedCells: utterances.map((u) => u.id),
            runtimeLabel: runtimeLabelFor(isV2, isMoonshineWasm),
            modelId,
            modelRevision: spec.revision ?? null,
            probeMaxNewTokens,
            assets: allArmAssets,
            host: { platform: platform(), arch: arch(), cpus: cpus().length },
        });

        for (const u of utterances) {
            const declared = route(u.audioSeconds);
            const invocations: ProbeInvocation[] = [];

            // INVOCATION 1 — the adapter's own call, exactly as a measured run would make it.
            const inv1 = `${u.id}:adapter`;
            try {
                const adapter = await arm.decode(u.locator, u.audioSeconds);
                invocations.push({
                    invocationId: inv1, kind: 'adapter.decode',
                    observations: { result: adapter, isNull: adapter === null },
                });
            } catch (error) {
                invocations.push({
                    invocationId: inv1, kind: 'adapter.decode', observations: {},
                    error: { name: error instanceof Error ? error.name : 'unknown',
                             message: (error instanceof Error ? error.message : String(error)).slice(0, 300) },
                });
            }

            // INVOCATIONS 2 and 3 — a separate pipeline call, and a separate direct generate. Tagged
            // separately because they ARE separate: nothing here may be attributed across them.
            try {
                const deep = await page.evaluate(async (input) => {
                    const w = window as unknown as {
                        __asr: ((a: Float32Array, o: Record<string, unknown>) => Promise<unknown>) & {
                            model?: Record<string, unknown>; tokenizer?: Record<string, unknown>;
                            processor?: (a: Float32Array) => Promise<Record<string, unknown>>;
                        };
                        __decodeAudio: (url: string) => Promise<{ samples: Float32Array; seconds: number }>;
                    };
                    const audio = await w.__decodeAudio(input.locator);
                    const audioFacts = {
                        pcmSamples: audio.samples.length,
                        rms: Math.sqrt(audio.samples.reduce((a, v) => a + v * v, 0) / audio.samples.length),
                    };

                    const result = await w.__asr(audio.samples, input.generation);
                    const el = Array.isArray(result) ? (result as unknown[])[0] : undefined;
                    const pipelineObs = {
                        ...audioFacts,
                        jsType: typeof result,
                        isArray: Array.isArray(result),
                        topLevelKeys: result && typeof result === 'object' && !Array.isArray(result)
                            ? Object.keys(result as object) : null,
                        elementKeys: el && typeof el === 'object' ? Object.keys(el as object) : null,
                        text: (result as { text?: unknown })?.text ?? null,
                        elementText: (el as { text?: unknown })?.text ?? null,
                    };

                    const genObs: Record<string, unknown> = { ...audioFacts, available: false, reason: null };
                    try {
                        const pipe = w.__asr;
                        const model = pipe.model as { generate?: (a: unknown) => Promise<unknown>; config?: Record<string, unknown> } | undefined;
                        const tokenizer = pipe.tokenizer as { eos_token_id?: number; decode?: (i: number[], o?: unknown) => string } | undefined;
                        if (!model?.generate || !pipe.processor) {
                            genObs.reason = `pipeline exposes no ${!model?.generate ? 'model.generate' : 'processor'}`;
                        } else {
                            const feats = await pipe.processor(audio.samples);
                            const gen = await model.generate({ ...feats, ...input.generation }) as
                                { tolist?: () => number[][]; data?: ArrayLike<number> };
                            const toNum = (v: unknown) => Number(v);
                            const ids: number[] = gen?.tolist ? (gen.tolist()[0] ?? []).map(toNum)
                                : gen?.data ? Array.from(gen.data as ArrayLike<number>, toNum) : [];
                            const eosId = (tokenizer?.eos_token_id
                                ?? (model.config as { eos_token_id?: number } | undefined)?.eos_token_id) ?? null;
                            genObs.available = ids.length > 0;
                            genObs.tokenIds = ids.slice(0, 128);
                            genObs.generatedCount = ids.length;
                            genObs.firstToken = ids[0] ?? null;
                            genObs.eosTokenId = eosId;
                            genObs.eosPosition = eosId === null ? null : ids.indexOf(eosId);
                            genObs.decoderStartTokenId =
                                (model.config as { decoder_start_token_id?: number } | undefined)?.decoder_start_token_id ?? null;
                            // Decoded from THESE ids, in THIS invocation — so text and tokens here are
                            // attributable to one another, unlike the pipeline call above.
                            genObs.decodedFromTheseTokens = tokenizer?.decode
                                ? tokenizer.decode(ids, { skip_special_tokens: false }) : null;
                            genObs.terminationReason = eosId !== null && ids.includes(eosId) ? 'eos'
                                : ids.length >= Number(input.generation.max_new_tokens ?? 0) ? 'max_new_tokens' : 'unknown';
                        }
                    } catch (err) {
                        genObs.reason = err instanceof Error ? err.message.slice(0, 300) : String(err);
                    }
                    return { pipelineObs, genObs };
                }, { locator: u.locator, generation: generationFor(declared) });

                invocations.push({ invocationId: `${u.id}:pipeline`, kind: 'pipeline.call', observations: deep.pipelineObs });
                invocations.push({ invocationId: `${u.id}:generate`, kind: 'model.generate', observations: deep.genObs });
            } catch (error) {
                invocations.push({
                    invocationId: `${u.id}:pipeline`, kind: 'pipeline.call', observations: {},
                    error: { name: error instanceof Error ? error.name : 'unknown',
                             message: (error instanceof Error ? error.message : String(error)).slice(0, 300) },
                });
            }

            recorder.addCell({
                utteranceId: u.id, reference: u.reference, audioSeconds: u.audioSeconds,
                maxNewTokens: declared.family === 'moonshine' ? declared.maxNewTokens : null,
                invocations,
            });

            // Printed ONLY after the cell is durable, and labelled by invocation so the console cannot
            // suggest a relationship the artifact does not record.
            const gen = invocations.find((i) => i.kind === 'model.generate')?.observations as { generatedCount?: number } | undefined;
            const pipe = invocations.find((i) => i.kind === 'pipeline.call')?.observations as { text?: unknown } | undefined;
            console.log(`      ${u.id.padEnd(22)} [pipeline]text=${JSON.stringify(pipe?.text ?? null).slice(0, 24)} `
                + `[generate]tokens=${gen?.generatedCount ?? 'n/a'}`);
        }

        const finalized = recorder.finalize();
        if (!finalized.ok) {
            console.error(`\n  PROBE NOT FINALIZED for ${spec.id}: ${finalized.reason} (${finalized.detail}) — partial retained`);
        }
        results.push({
            id: spec.id, lane: 'browser', set: setName, evidenceClass: 'diagnostic_probe',
            probe: true, certified: false, selectionEligible: false,
            selectionIneligibleReason: 'diagnostic probe: uncertified route override, never selection evidence',
            probeMaxNewTokens, artifact: `${base}.probe.json`, finalized: finalized.ok,
        });
        checkpoint();
        await context.close();
        continue;
    }

    const certification = await certifyArmWithHonorProbe(
        arm, expectationFor(spec), goldens.cases, utterances[0]?.locator ?? '', utterances[0]?.audioSeconds ?? 1,
    );
    // Expected ids from the SET, never from the clips this arm happened to decode.
    const result = await runArm(arm, certification, utterances, set.expectedIds);

    // THE TRANSCRIPTS THEMSELVES. Two arms scoring 0.0479 could be the same model twice, different
    // models with different errors that happen to total 22, or a loader alias. A WER cannot tell them
    // apart; a digest of the transcripts and the per-clip S/D/I can.
    const perUtterance = result.scores.map((score) => {
        const clip = set.clips.find((c) => c.id === score.utteranceId);
        return {
            id: score.utteranceId,
            normalizedReference: normalizeOfficialTrackA(clip?.reference ?? '').join(' '),
            substitutions: score.ok ? score.row.substitutions : null,
            deletions: score.ok ? score.row.deletions : null,
            insertions: score.ok ? score.row.insertions : null,
            referenceWords: score.ok ? score.row.referenceWords : null,
            invalidReason: score.ok ? null : score.invalidReason,
        };
    });
    const transcriptDigest = createHash('sha256')
        .update(JSON.stringify(perUtterance.map((u) => [u.id, u.substitutions, u.deletions, u.insertions])))
        .digest('hex').slice(0, 16);

    const honored = certification.gates.routeHonored;
    const hardwareRepresentative = honored?.deviceClaim !== 'webgpu'
        || !isSoftwareAdapter((await page.evaluate(() => (window as unknown as { __BACKEND_EVIDENCE__: { gpuAdapterInfo: Record<string, string | null> | null } }).__BACKEND_EVIDENCE__.gpuAdapterInfo)));

    // A PIN VIOLATION INVALIDATES THE ARM. An asset that was missing, altered or unpinned means the
    // measurement was not taken on the bytes we committed to, whatever number came out.
    const backendProven = certification.certified && honored?.deviceVerifiable === true
        && pinViolations.length === 0 && runtimeAssetFailures.length === 0;
    if (pinViolations.length > 0) {
        console.log(`    PIN VIOLATIONS (${pinViolations.length}) — arm invalidated:`);
        for (const v of pinViolations.slice(0, 5)) console.log(`      ${v.reason}  ${v.url}`);
    }
    // ELIGIBILITY NEEDS BOTH: a proven backend AND a selection-grade set. A proven backend is a fact
    // about the runtime; it was being read as a fact about the evidence.
    /**
     * THE ASSET GATE IS PART OF ELIGIBILITY, and it is evaluated BEFORE eligibility is decided.
     *
     * Eligibility used to be computed here and the inventory built ~100 lines later, so the inventory
     * could not possibly constrain it: an arm with an empty, duplicated, unattributed, unpinned or
     * byte-mismatched inventory was still selection-eligible on the strength of its WER. A measurement
     * whose provenance does not reconcile is not selection evidence, however good the number is.
     */
    const armInventory = buildAssetInventory(allArmAssets, null);
    /**
     * TWO AUTHORITIES, each doing the job it can actually do.
     *
     *  1. SERVED LEDGER vs COMMITTED PINS — the independent check. `allArmAssets` is what the harness
     *     server actually served (complete, with bytes and digests); the pin files are a separate,
     *     reviewed authority. A served file whose bytes disagree with its committed digest is caught
     *     here and nowhere else.
     *  2. The Playwright response trace stays DIAGNOSTIC. It cannot see worker- or module-initiated
     *     requests, which is why the previous artifact reported `ok:true` while observing 10 of 30
     *     files with a null byte total. It may corroborate; it may not confer `ok`.
     */
    const committedPinAuthority: Record<string, { sha256: string; bytes?: number; version?: string }> = {
        ...selfHostedPinRegistry,
        ...libExecutablePinRegistry,
        ...Object.fromEntries(Object.entries(moonshinePins).map(([k, v]) => [k, { sha256: v.sha256, bytes: v.bytes }])),
        ...Object.fromEntries(Object.entries(pins).map(([k, v]) => [k, { sha256: v }])),
    };
    const pinVerification = verifyAgainstCommittedPins(armInventory, committedPinAuthority, {
        // Everything that EXECUTES, plus every model weight the arm loaded.
        require: (f) => /\.(mjs|js|wasm|onnx|ort|bin)$/.test(f.name),
    });
    const assetReconciliation = reconcileAssets(armInventory, Object.fromEntries(observedRequests), {
        requirePinned: mode === 'pinned',
    });
    if (!pinVerification.ok) {
        console.log(`    COMMITTED-PIN VERIFICATION FAILED (${pinVerification.failures.length}) — arm not selection-grade:`);
        for (const f of pinVerification.failures.slice(0, 6)) console.log(`      ${f.kind}: ${f.detail}`);
    }
    if (!assetReconciliation.ok) {
        console.log(`    ASSET RECONCILIATION FAILED (${assetReconciliation.failures.length}) — arm not selection-grade:`);
        for (const f of assetReconciliation.failures.slice(0, 6)) console.log(`      ${f.kind}: ${f.detail}`);
    }


    // The POPULATED measurement table — collected, not declared.
    const verdict = buildTechnicalVerdict({
        armId: spec.id,
        runtimeLabel: runtimeLabelFor(isV2, isMoonshineWasm),
        evidenceSet: setName,
        evidenceClass,
        dtypeAliasOf: spec.dtypeAliasOf,
        role: spec.role,
        result,
        coldLoadMs,
        stopToFinalMs: null, // set by the long-form control, which this set does not include
        backendProven,
        resolvedBackend: honored?.deviceResolved ?? null,
        hardwareRepresentative,
        transcriptDigest,
        fingerprint: certification.fingerprint.digest,
        // The runtime binaries travel with the weights they executed — on EVERY arm. They were
        // previously folded in only for self-hosted v2, so v2-small, every v4 and both non-streaming
        // Moonshine rows understated both their provenance and their download.
        assets: allArmAssets,
        expectedClips: set.expectedIds.length,
        audioRejected: audioMismatches.length,
    });

    /**
     * EVERY RELIABILITY COUNTER IS ELIGIBILITY-GATING.
     *
     * The frozen-600 `v4:base:q4-decoder:wasm` row recorded `truncated=1` and was still selection
     * eligible. A truncated decode is a measurement of something other than the clip, so an arm carrying
     * one is not a completed measurement of the corpus — it is an arm to re-measure. The same holds for
     * a throw, an empty output, a lost clip, a timeout and a rejected audio file.
     */
    const counters = {
        threw: verdict.reliability.threw, emptyOutput: verdict.reliability.emptyOutput,
        missing: verdict.reliability.missing, timedOut: verdict.reliability.timedOut ?? 0,
        audioRejected: verdict.reliability.audioRejected ?? 0,
        truncated: verdict.duration?.truncatedClips ?? 0,
    };
    const dirtyCounters = Object.entries(counters).filter(([, v]) => (v ?? 0) !== 0);

    const selectionEligible = backendProven && result.ok && evidenceClass === 'selection'
        && spec.role === 'selection' && harness.assetFailures.length === 0
        && assetReconciliation.ok
        && pinVerification.ok
        && dirtyCounters.length === 0;
    const ineligible = !selectionEligible
        ? evidenceClass !== 'selection'
            ? `${setName} is a ${evidenceClass} set — not selection evidence`
            : spec.role !== 'selection' ? 'diagnostic cell'
                : !backendProven ? 'backend claim not proven'
                    : !result.ok ? `no row: ${result.reason}`
                        : harness.assetFailures.length > 0 ? 'asset pins failed'
                            : !assetReconciliation.ok
                                ? `asset reconciliation: ${assetReconciliation.failures.map((f) => f.kind).join(', ')}`
                                : !pinVerification.ok
                                    ? `committed pins: ${pinVerification.failures.map((f) => f.kind).join(', ')}`
                                    : `reliability: ${dirtyCounters.map(([k, v]) => `${k}=${v}`).join(', ')}`
        : null;

    console.log(`    backend: ${honored?.deviceResolved ?? 'UNRESOLVED'} (${backendProven ? 'PROVEN' : 'NOT proven'})`
        + (hardwareRepresentative ? '' : '  [SOFTWARE RASTERIZER — timing is NOT a GPU result]'));
    console.log(result.ok
        ? `    POOLED WER = ${result.row.wer.toFixed(4)}  words=${result.row.referenceWords} `
          + `S=${result.row.substitutions} D=${result.row.deletions} I=${result.row.insertions}`
        : `    NO ROW: ${result.reason} (${result.detail})`);
    console.log(`    selection eligible: ${selectionEligible ? 'YES' : `no — ${ineligible}`}`);

    console.log(`    cold load ${verdict.speed.coldLoadMs}ms · warm p50 ${verdict.speed.warmDecodeMsP50}ms `
        + `p95 ${verdict.speed.warmDecodeMsP95}ms · RTF p50 ${verdict.speed.realTimeFactorP50?.toFixed(3)} `
        + `p95 ${verdict.speed.realTimeFactorP95?.toFixed(3)}`);
    console.log(`    download ${verdict.footprint.modelBytes === null ? 'unmeasured' : `${(verdict.footprint.modelBytes / 1e6).toFixed(1)} MB`} `
        + `over ${verdict.footprint.assetCount ?? 0} files · reliability `
        + `decoded=${verdict.reliability.decoded}/${verdict.reliability.expectedClips} `
        + `threw=${verdict.reliability.threw} empty=${verdict.reliability.emptyOutput} `
        + `missing=${verdict.reliability.missing} truncated=${verdict.duration.truncatedClips}`);

    results.push({
        id: spec.id, label: spec.label, lane: 'browser', set: setName, evidenceClass,
        // WHAT WAS ACTUALLY TESTED, serialized onto the evidence row.
        //
        // The registry carries these, but the artifact serialized them as null — so a reader of the
        // EVIDENCE still had to infer the candidate and backend from the historical arm ID, which is
        // exactly the inference the id-vs-reality correction exists to stop.
        candidate: spec.candidate ?? null,
        executionBackend: spec.executionBackend ?? null,
        historicalArmId: spec.historicalArmId ?? spec.id,
        dtype: spec.dtype ?? null,
        dtypeAliasOf: spec.dtypeAliasOf ?? null,
        runtimeLabel: runtimeLabelFor(isV2, isMoonshineWasm),
        verdict,
        role: spec.role, freshSession,
        requestedDevice: deviceClaim,
        resolvedBackend: honored?.deviceResolved ?? null,
        backendProven, hardwareRepresentative,
        certified: certification.certified, failedGates: certification.failedGates,
        fingerprint: certification.fingerprint.digest,
        // FROM THE RELIABILITY RECORD, not `utterances.length`. That was the number of clips OFFERED to
        // the runner, so a run that threw on 148 of them still serialized `decodedClips: 600` and read as
        // a complete measurement. `verdict.reliability` is the only place that knows what SUCCEEDED.
        expectedClips: verdict.reliability.expectedClips,
        decodedClips: verdict.reliability.decoded,
        clipsOffered: utterances.length,
        // EVERY counter is serialized, because every counter is eligibility-gating. The old q4 row carried
        // `truncated=1` and stayed selection eligible: the truncation was printed to the log and never
        // written to the row, so nothing downstream could act on it.
        reliability: {
            decoded: verdict.reliability.decoded,
            expectedClips: verdict.reliability.expectedClips,
            threw: verdict.reliability.threw,
            emptyOutput: verdict.reliability.emptyOutput,
            missing: verdict.reliability.missing,
            timedOut: verdict.reliability.timedOut ?? 0,
            audioRejected: verdict.reliability.audioRejected ?? 0,
            truncated: verdict.duration?.truncatedClips ?? 0,
        },
        audioMismatches,
        transcriptDigest, perUtterance,
        // #1304 — DECODE FAILURES ARE RETAINED, deduplicated by message.
        //
        // A quiet-rerun attempt reported `threw=148` and kept nothing about WHY. runArm captured
        // {utteranceId, message} for every failure, but the artifact writer never referenced it, so the
        // messages existed only in memory and died with the process. A run that records 148 failures and
        // no cause cannot be diagnosed afterwards — the same defect class as writing the artifact once at
        // the end, evidence gathered and then discarded at the boundary.
        //
        // Deduplicated because 148 copies of one message is noise; the DISTINCT messages plus their counts
        // and a bounded sample of affected utterances are what identify a cause. Messages are truncated:
        // a decode error is a diagnostic, not a place to accumulate unbounded text in an artifact.
        decodeFailures: summarizeDecodeFailures(result.decodeFailures),
        /**
         * PER-CLIP TIMING, RETAINED — so p50/p95/RTF can be RECOMPUTED from evidence rather than trusted
         * as the runner emitted them.
         *
         * These were computed and then dropped at the serialization boundary, which left the aggregate
         * percentiles unfalsifiable: a reviewer could read RTF p95 = 5.969 and had no way to check it.
         * An aggregate nobody can re-derive is an assertion, not a measurement — the same defect that
         * discarded 148 decode-failure messages.
         *
         * Audio seconds travel with each clip because RTF is meaningless without the duration it divides.
         */
        clipTimings: result.clipOutcomes.map((c) => ({
            utteranceId: c.utteranceId,
            audioSeconds: c.audioSeconds,
            decodeMs: c.decodeMs,
            realTimeFactor: Number.isFinite(c.realTimeFactor) ? c.realTimeFactor : null,
            outcome: c.outcome,
        })),
        /**
         * FULL PER-ARM ASSET INVENTORY — name, role, hash, bytes — and a total that reconciles against
         * the reported modelBytes.
         *
         * The row previously carried only `assetCount` and a `decoderAssets` list filtered from
         * `armAssets`, which is empty for self-hosted arms. So `modelBytes` could not be decomposed, and
         * v4-q4-wasm's 233.1 MB against a registered 142 MB was unexplainable from the artifact.
         */
        assetInventory: armInventory,
        // Reconciled against an INDEPENDENTLY OBSERVED ledger, not against a total derived from the same
        // object. The previous form compared allArmAssets to a modelBytes computed from allArmAssets.
        assetReconciliation,
        // The INDEPENDENT authority. `assetReconciliation` alone is harness-vs-harness.
        pinVerification,
        observedRequestCount: observedRequests.size,
        // Kept for continuity with earlier artifacts; the inventory above is the authority.
        decoderAssets: Object.entries(allArmAssets)
            .filter(([path]) => /decoder/i.test(path))
            .map(([path, record]) => ({ path, sha256: record.sha256, bytes: record.bytes })),
        assetCount: Object.keys(allArmAssets).length,
        pinViolations, networkAttempts,
        // True only when nothing reached the network: every external byte came from a verified pin.
        offlineEnforced: mode === 'pinned' && pinViolations.length === 0,
        assetFailures: harness.assetFailures,
        ...(result.ok
            ? { wer: result.row.wer, referenceWords: result.row.referenceWords, substitutions: result.row.substitutions, deletions: result.row.deletions, insertions: result.row.insertions, wallClockMs: result.row.provenance.resources.wallClockMs }
            : { wer: null, rejectedReason: result.reason, rejectedDetail: result.detail }),
        selectionEligible, selectionIneligibleReason: ineligible,
        // TYPED non-measurement. A no-row arm previously carried only a prose reason, so the completeness
        // gate could not tell a deliberate unscoreable result from a run that simply failed.
        ...(result.ok ? {} : { disposition: 'unscoreable_arm' as const }),
        ...(result.ok || assetReconciliation.ok ? {} : { disposition: 'asset_reconciliation_failed' as const }),
        provenance: arm.provenance(),
    });

    // Durable after EVERY arm, so a crash costs one arm rather than the whole run.
    checkpoint();
    await context.close();
}

await browser.close();
await harness.close();

console.log('\n\n=== BROWSER LANE SUMMARY ===');
for (const r of results) {
    const wer = typeof r.wer === 'number' ? (r.wer as number).toFixed(4) : '  —   ';
    console.log(`  ${wer}  ${String(r.id).padEnd(36)} ${String(r.resolvedBackend ?? r.skipped ?? 'n/a').padEnd(28)} `
        + `${r.selectionEligible ? 'ELIGIBLE' : 'not eligible'}`);
}
console.log(`\n  evidence class: ${evidenceClass}. `
    + `${evidenceClass === 'selection' ? '' : 'NO row from this set may inform the down-select.'}`);
if (harness.assetFailures.length > 0) {
    console.log(`\n  ASSET FAILURES (${harness.assetFailures.length}) — no measurement is valid:`);
    for (const f of harness.assetFailures.slice(0, 10)) console.log(`    ${f.reason}  ${f.path}  ${f.detail}`);
}
console.log();

if (pinsOnly) {
    // REFUSE TO SHRINK THE PIN FILE.
    //
    // A `--pins-only` run over a SUBSET of arms just overwrote 44 committed pins with 0, because the
    // arms selected fetch from their own CDN and never touch this mirror. The next pinned run would
    // then have failed every asset — fail-closed, but only by luck, and the pins would have been gone.
    // Bootstrapping is additive: it may add pins, never silently drop them.
    const merged = { ...pins };
    for (const [path, record] of Object.entries(harness.assets)) merged[path] = record.sha256;
    const dropped = Object.keys(pins).filter((k) => merged[k] === undefined);
    if (dropped.length > 0) {
        console.error(`\nREFUSING to write pins: ${dropped.length} existing pin(s) would be lost.`);
        process.exit(1);
    }
    const added = Object.keys(merged).length - Object.keys(pins).length;
    console.log(`\npins: ${Object.keys(pins).length} existing + ${added} new = ${Object.keys(merged).length}`);
    const pinFile = {
        note: 'SHA-256 of every HuggingFace asset the browser lane serves. Recorded in --mode=bootstrap '
            + '--pins-only; verified on every pinned run, where a missing pin is a FAILURE, not a skip.',
        recordedAt: new Date(0).toISOString().slice(0, 10),
        assets: Object.fromEntries(Object.entries(merged).sort()),
    };
    writeFileSync(PIN_FILE, `${JSON.stringify(pinFile, null, 2)}\n`, 'utf8');
    console.log(`\nwrote ${PIN_FILE} with ${Object.keys(pinFile.assets).length} pinned assets`);
}

/**
 * Resolve where this run retains. A `--only=` subset run is a debugging slice, not a matrix run, so it
 * keeps the old opt-in behaviour; everything else retains by default.
 */


// AN INCOMPLETE ARTIFACT IS NOT WRITTEN. Checked before serialization rather than trusted afterwards,
// because the previous artifact was described as complete on the strength of a log beside it.
// Artifact completeness is likewise the plan's job when a plan is active.
if (outPath && !onlyIds && !selectionPlan) {
    const completeness = checkArtifactCompleteness(
        results as { id: string }[],
        {
            admitted: ADMITTED_ARMS.map((a) => a.id),
            excluded: ARM_MATRIX.filter((a) => a.admission.status !== 'admitted').map((a) => a.id),
        },
    );
    if (!completeness.ok) {
        console.error(`\nREFUSING to write ${outPath}: ${completeness.reason} (${completeness.detail})`);
        process.exit(1);
    }
}

if (outPath) {
    // A checkpoint becomes the FINAL artifact only when every required row is accounted for — measured,
    // skipped, or preserved with a named not-executed reason. A hole in a selection table reads as
    // "not applicable" rather than "unknown", which is the more dangerous of the two.
    if (selectionPlan) {
        // EVERY registered arm, measured or dispositioned. A four-row artifact cannot satisfy this.
        // The SAME function the finalization tests exercise — not a second description of the rule.
        const planned = finalizeUnderPlan(results as { id: string }[], selectionPlan);
        if (!planned.ok) {
            console.error(`\nREFUSING to finalise ${outPath}: plan ${selectionPlan.id} ${planned.reason} (${planned.detail})`);
            console.error(`The checkpoint at ${partialPath} is retained; resume to complete it.`);
            process.exit(1);
        }
    }
    // The plan validator is the SOLE matrix authority when a plan is active. Running the legacy
    // validator afterwards meant a complete targeted run could decode for hours and then be REFUSED at
    // promotion, because `not_a_targeted_finalist` is a plan reason the legacy registry does not know.
    // Two authorities disagreeing about what "complete" means is worse than either alone.
    if (!onlyIds && !selectionPlan) {
        const complete = validateCompleteness(results as CheckpointRow[], REQUIRED_MATRIX_ROWS);
        if (!complete.ok) {
            console.error(`\nREFUSING to finalise ${outPath}: ${complete.reason} (${complete.detail})`);
            console.error(`The checkpoint at ${partialPath} is retained; resume to complete it.`);
            process.exit(1);
        }
    }
    atomicWriteFileSync(outPath, `${JSON.stringify({
        lane: 'browser', set: setName, evidenceClass, identity: runIdentity,
        hostAtStart, hostAtEnd: hostGate(),
        results, assets: harness.assets, assetFailures: harness.assetFailures,
    }, null, 2)}\n`);
    console.log(`wrote ${outPath}`);
    // The partial has served its purpose; the immutable artifact is now the record.
    if (partialPath && existsSync(partialPath)) {
        try { unlinkSync(partialPath); } catch { /* leaving a stale partial is harmless — identity gates it */ }
    }
} else {
    console.warn('\nNOTHING RETAINED by this run.');
}
