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
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { resolve } from 'node:path';
import { cpus, arch, platform } from 'node:os';
import { chromium } from '@playwright/test';
import manifest from '../tests/fixtures/corpus-manifest.json' with { type: 'json' };
import goldens from '../tests/evidence/normalization/goldens.json' with { type: 'json' };
import { startHarnessServer } from '../tests/evidence/certification/browser/server';
import { createBrowserArm, isSoftwareAdapter } from '../tests/evidence/certification/browser/browserArm';
import { ARM_MATRIX } from '../tests/evidence/certification/arms/registry';
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
const outPath = arg('out', '');
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
const results: Record<string, unknown>[] = [];

for (const spec of ARM_MATRIX) {
    if (onlyIds && !onlyIds.has(spec.id)) continue;
    if (spec.admission.status !== 'admitted') {
        results.push({ id: spec.id, lane: 'browser', set: setName, evidenceClass, skipped: spec.admission.status, reason: spec.admission.reason });
        console.log(`\n  ${spec.id}  — ${spec.admission.status} (${spec.admission.reason})`);
        continue;
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
        await context.close();
        continue;
    }

    const route = (seconds: number) => (isMoonshine
        ? resolveMoonshineRoute(spec.modelId, seconds)
        : resolveWhisperRoute(isV2 ? 'v2' : 'v4', modelId, seconds, spec.variantId));

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
        .map((c) => ({ id: c.id, reference: c.reference, locator: urlFor(c.path), audioSeconds: clipSeconds.get(c.id)! }));

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

if (outPath) {
    writeFileSync(outPath, `${JSON.stringify({ lane: 'browser', set: setName, evidenceClass, results, assets: harness.assets, assetFailures: harness.assetFailures }, null, 2)}\n`, 'utf8');
    console.log(`wrote ${outPath}`);
}
