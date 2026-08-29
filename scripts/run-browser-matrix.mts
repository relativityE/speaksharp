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
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { resolve } from 'node:path';
import { cpus, arch, platform } from 'node:os';
import { chromium } from '@playwright/test';
import manifest from '../tests/fixtures/corpus-manifest.json' with { type: 'json' };
import goldens from '../tests/evidence/normalization/goldens.json' with { type: 'json' };
import { startHarnessServer } from '../tests/evidence/certification/browser/server';
import { createBrowserArm, isSoftwareAdapter, generationFor } from '../tests/evidence/certification/browser/browserArm';
import { ARM_MATRIX, ADMITTED_ARMS, SELECTION_EXECUTION_SET, NOT_EXECUTED_REASONS, REQUIRED_MATRIX_ROWS } from '../tests/evidence/certification/arms/registry';
import { planResume, validateCompleteness, type RunIdentity, type CheckpointRow } from '../tests/evidence/certification/checkpoint';
import { atomicWriteFileSync } from '../tests/evidence/certification/atomicWrite';
import { ProbeRecorder, type ProbeInvocation } from '../tests/evidence/certification/probeArtifact';
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
const runIdentity: RunIdentity = {
    productBaseline: headSha(),
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
    assetDigest: digestOfFiles([
        'tests/fixtures/hf-asset-pins.json',
        'tests/fixtures/moonshine-asset-pins.json',
        'tests/evidence/certification/arms/runtimeAssets.ts',
    ]),
    setName,
    evidenceClass,
};

const partialPath = outPath ? outPath.replace(/\.json$/, '') + '.partial.json' : '';

/** Rows already measured under an IDENTICAL identity, if any. */
let results: Record<string, unknown>[] = [];
let alreadyDone = new Set<string>();
if (partialPath && existsSync(partialPath)) {
    let parsed: unknown = null;
    try { parsed = JSON.parse(readFileSync(partialPath, 'utf8')); } catch { parsed = null; }
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
    atomicWriteFileSync(partialPath, `${JSON.stringify({ partial: true, identity: runIdentity, rows: results }, null, 2)}\n`);
};

for (const spec of ARM_MATRIX) {
    if (onlyIds && !onlyIds.has(spec.id)) continue;
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
    page.on('response', (response) => {
        const url = response.url();
        if (!url.startsWith(harness.origin) && /^https?:/.test(url)) externalUrls.add(url);
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
    const cdnAssets: Record<string, { sha256: string; bytes: number; source: 'network'; pinned: false }> = {};
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
                sha256: createHash('sha256').update(body).digest('hex'),
                bytes: body.length, source: 'network', pinned: false,
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

    if (pinsOnly) {
        console.log(`    loaded — ${Object.keys(harness.assets).length} assets mirrored so far`);
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
            wer: null, selectionEligible: false,
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
                    : Object.entries(cdnAssets).map(([k, v]) => [k, {
                          ...v, source: 'network' as const, pinned: false,
                      }] as const)),
        ]);

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
        const base = (outPath || 'evidence-runs/probe').replace(/\.json$/, '');
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
    const selectionEligible = backendProven && result.ok && evidenceClass === 'selection'
        && spec.role === 'selection' && harness.assetFailures.length === 0;
    const ineligible = !selectionEligible
        ? evidenceClass !== 'selection'
            ? `${setName} is a ${evidenceClass} set — not selection evidence`
            : spec.role !== 'selection' ? 'diagnostic cell'
                : !backendProven ? 'backend claim not proven'
                    : !result.ok ? `no row: ${result.reason}` : 'asset pins failed'
        : null;

    console.log(`    backend: ${honored?.deviceResolved ?? 'UNRESOLVED'} (${backendProven ? 'PROVEN' : 'NOT proven'})`
        + (hardwareRepresentative ? '' : '  [SOFTWARE RASTERIZER — timing is NOT a GPU result]'));
    console.log(result.ok
        ? `    POOLED WER = ${result.row.wer.toFixed(4)}  words=${result.row.referenceWords} `
          + `S=${result.row.substitutions} D=${result.row.deletions} I=${result.row.insertions}`
        : `    NO ROW: ${result.reason} (${result.detail})`);
    console.log(`    selection eligible: ${selectionEligible ? 'YES' : `no — ${ineligible}`}`);

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
        runtimeLabel: runtimeLabelFor(isV2, isMoonshineWasm),
        verdict,
        role: spec.role, freshSession,
        requestedDevice: deviceClaim,
        resolvedBackend: honored?.deviceResolved ?? null,
        backendProven, hardwareRepresentative,
        certified: certification.certified, failedGates: certification.failedGates,
        fingerprint: certification.fingerprint.digest,
        expectedClips: set.expectedIds.length, decodedClips: utterances.length, audioMismatches,
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
        // The decoder graph this arm actually loaded — the file, and its digest.
        decoderAssets: Object.entries(armAssets)
            .filter(([path]) => /decoder/i.test(path))
            .map(([path, record]) => ({ path, sha256: record.sha256, bytes: record.bytes })),
        // From the SAME object as provenance and the verdict; `armAssets` omitted the runtime binaries
        // and was the third disagreeing count in one artifact.
        assetCount: Object.keys(allArmAssets).length,
        pinViolations, networkAttempts,
        // True only when nothing reached the network: every external byte came from a verified pin.
        offlineEnforced: mode === 'pinned' && pinViolations.length === 0,
        assetFailures: harness.assetFailures,
        ...(result.ok
            ? { wer: result.row.wer, referenceWords: result.row.referenceWords, substitutions: result.row.substitutions, deletions: result.row.deletions, insertions: result.row.insertions, wallClockMs: result.row.provenance.resources.wallClockMs }
            : { wer: null, rejectedReason: result.reason, rejectedDetail: result.detail }),
        selectionEligible, selectionIneligibleReason: ineligible,
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
if (outPath && !onlyIds) {
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
    if (!onlyIds) {
        const complete = validateCompleteness(results as CheckpointRow[], REQUIRED_MATRIX_ROWS);
        if (!complete.ok) {
            console.error(`\nREFUSING to finalise ${outPath}: ${complete.reason} (${complete.detail})`);
            console.error(`The checkpoint at ${partialPath} is retained; resume to complete it.`);
            process.exit(1);
        }
    }
    atomicWriteFileSync(outPath, `${JSON.stringify({ lane: 'browser', set: setName, evidenceClass, identity: runIdentity, results, assets: harness.assets, assetFailures: harness.assetFailures }, null, 2)}\n`);
    console.log(`wrote ${outPath}`);
    // The partial has served its purpose; the immutable artifact is now the record.
    if (partialPath && existsSync(partialPath)) {
        try { unlinkSync(partialPath); } catch { /* leaving a stale partial is harmless — identity gates it */ }
    }
} else {
    console.warn('\nNOTHING RETAINED by this run.');
}
