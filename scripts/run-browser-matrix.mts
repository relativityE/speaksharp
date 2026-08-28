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

const harness = await startHarnessServer(resolve('.'), { mode, pins, offlineOnly: mode === 'pinned' });
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
            (env as { remoteHost: string }).remoteHost = `${input.origin}/hf/`;
            (env as { remotePathTemplate: string }).remotePathTemplate = '{model}/resolve/{revision}/';
            if (input.isV2) {
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
        console.log(`    LOAD FAILED: ${loaded.error}`);
        results.push({ id: spec.id, lane: 'browser', set: setName, evidenceClass, freshSession, loadError: loaded.error, wer: null, selectionEligible: false, selectionIneligibleReason: 'model failed to load in this runtime' });
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

    const arm = createBrowserArm({
        id: spec.id, page, route, deviceClaim,
        modelId,
        modelRevision: spec.revision ?? (selfHosted ? `self-hosted:${modelId}` : `huggingface:${modelId}`),
        // A SELF-HOSTED arm's weights never pass through the HuggingFace mirror, so its digests come
        // from the product's own models directory — the same files the page loads from /models/.
        assets: selfHosted
            ? Object.fromEntries(
                  Object.entries(hashModelDirectory(resolve('frontend/public/models', modelId)))
                      // REAL sizes, read from disk. `bytes: 0` made every self-hosted arm's download
                      // footprint look like nothing, which is one of the measures a selection turns on.
                      .map(([path, sha256]) => [`${modelId}/${path}`, {
                          sha256,
                          bytes: statSync(resolve('frontend/public/models', modelId, path)).size,
                          source: 'cache' as const,
                          pinned: true,
                      }]),
              )
            // THIS arm's assets only — not everything the run has served so far. For an arm whose
            // runtime fetches from its own CDN, those intercepted files are its assets.
            : Object.keys(armAssets).length > 0
                ? armAssets
                : Object.fromEntries(Object.entries(cdnAssets).map(([k, v]) => [k, {
                      ...v, source: 'network' as const, pinned: false,
                  }])),
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

    const backendProven = certification.certified && honored?.deviceVerifiable === true;
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
        assets: selfHosted
            ? Object.fromEntries(
                  Object.entries(hashModelDirectory(resolve('frontend/public/models', modelId)))
                      .map(([path, sha256]) => [`${modelId}/${path}`, {
                          sha256,
                          bytes: statSync(resolve('frontend/public/models', modelId, path)).size,
                          source: 'cache' as const, pinned: true,
                      }]),
              )
            : Object.keys(armAssets).length > 0
                ? armAssets
                : Object.fromEntries(Object.entries(cdnAssets).map(([k, v]) => [k, {
                      ...v, source: 'network' as const, pinned: false,
                  }])),
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
        assetCount: Object.keys(armAssets).length,
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
