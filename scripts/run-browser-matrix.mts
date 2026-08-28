#!/usr/bin/env tsx
/**
 * #1304 Task 3C — THE BROWSER LANE.
 *
 * Node results are diagnostics. The product runs ONNX Runtime Web in a browser, so a selection needs
 * every candidate measured there — including Moonshine through its native route. Node CPU is not a
 * stand-in for browser WASM and is never presented as one.
 *
 * BACKEND EVIDENCE IS COUNTED, NOT ASKED FOR. Neither transformers package exposes execution providers
 * on a loaded session, and echoing back the REQUESTED device is what let `device: 'webgpu'` pass in
 * Node where no GPU exists. The harness page instruments `WebAssembly.instantiate` and the whole
 * WebGPU adapter/device/queue chain before any library loads, so a claim is proven by what the backend
 * actually did:
 *
 *   webgpu proven  <=>  an adapter was obtained, a device created, compute pipelines built, and the
 *                       queue submitted work
 *   wasm proven    <=>  WebAssembly modules were instantiated and NO GPU device was created
 *
 * Every fixture's sample count is cross-checked against the Node WAV loader, so the two parsers cannot
 * quietly feed the browser different audio.
 *
 *   usage: npx tsx scripts/run-browser-matrix.mts [--only=id,id] [--out=report.json] [--headed]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { startHarnessServer } from '../tests/evidence/certification/browser/server';
import { decodeWav } from '../tests/evidence/certification/audio';
import { scoreUtterance, aggregateArm } from '../tests/evidence/certification/scoringAdapter';
import { ARM_MATRIX } from '../tests/evidence/certification/arms/registry';
import { resolveMoonshineRoute, resolveWhisperRoute, candidateRouteHash } from '../tests/evidence/certification/candidateRoute';
import { normalizeOfficialTrackA } from '../tests/evidence/normalization/officialNormalizer';
import { HARVARD_SENTENCES } from '../tests/fixtures/stt-isomorphic/harvard-sentences';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const onlyIds = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const outPath = arg('out', '');
const clipSet = arg('clips', 'harvard');

const HARVARD = HARVARD_SENTENCES.filter((s) => /^h1_\d+$/.test(s.id));

/**
 * The >30s fixture, as a single clip. Harvard utterances are 2–4 seconds each, so they cross NO window
 * boundary and there is never a preceding window — which is why `condition_on_previous_text` had no
 * observable effect on them and that arm produced byte-identical output to shipping. The option only
 * exists across windows, so only this fixture can test it.
 */
const LONGFORM = [{
    id: 'long-01',
    transcript: readFileSync('tests/fixtures/corpus-longform/long-01.reference.txt', 'utf8')
        .split('\n').filter(Boolean).join(' '),
}];

const CLIPS = clipSet === 'longform' ? LONGFORM : HARVARD;
const clipUrl = (id: string) =>
    clipSet === 'longform' ? '/fixtures/corpus-longform/long-01.wav' : `/fixtures/stt-isomorphic/audio/${id}.wav`;
const clipPath = (id: string) =>
    clipSet === 'longform' ? 'tests/fixtures/corpus-longform/long-01.wav' : `tests/fixtures/stt-isomorphic/audio/${id}.wav`;

export interface BackendEvidence {
    wasmInstantiations: number;
    wasmBytes: number;
    gpuAdapterRequests: number;
    gpuDevicesCreated: number;
    gpuComputePipelines: number;
    gpuQueueSubmits: number;
    gpuAdapterInfo: Record<string, string | null> | null;
    gpuAvailable: boolean;
}

/**
 * Is the WebGPU adapter REAL HARDWARE?
 *
 * Headless Chromium falls back to SwiftShader — a software rasterizer that implements the WebGPU API
 * faithfully and executes on the CPU. So the backend claim is genuinely proven (adapter, device,
 * pipelines, submissions all real) while the TIMING is meaningless: the WebGPU cells here ran 20x to
 * 60x slower than WASM, which is the opposite of what a GPU does. Proven and representative are two
 * different questions, and merging them would publish a SwiftShader number as a GPU result.
 */
const SOFTWARE_ADAPTERS = ['swiftshader', 'llvmpipe', 'software', 'microsoft basic'];
function isSoftwareAdapter(info: Record<string, string | null> | null): boolean {
    const text = Object.values(info ?? {}).filter(Boolean).join(' ').toLowerCase();
    return SOFTWARE_ADAPTERS.some((name) => text.includes(name));
}

/** The ONLY place a backend claim is decided. Counters, never the request. */
function resolveBackend(evidence: BackendEvidence): { resolved: string | null; proves: 'wasm' | 'webgpu' | null } {
    const gpuRan = evidence.gpuDevicesCreated > 0 && evidence.gpuComputePipelines > 0 && evidence.gpuQueueSubmits > 0;
    if (gpuRan) {
        const info = evidence.gpuAdapterInfo;
        const label = info ? `webgpu:${info.vendor ?? '?'}/${info.architecture ?? info.device ?? '?'}` : 'webgpu';
        return { resolved: label, proves: 'webgpu' };
    }
    if (evidence.wasmInstantiations > 0 && evidence.gpuDevicesCreated === 0) {
        return { resolved: `wasm:${evidence.wasmInstantiations} module(s)`, proves: 'wasm' };
    }
    // Neither proven. A device claim resting on this must FAIL rather than inherit the request.
    return { resolved: null, proves: null };
}

const harness = await startHarnessServer(resolve('.'));
const browser = await chromium.launch({
    headless: !args.includes('--headed'),
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU'],
});

interface BrowserArmResult {
    id: string;
    label: string;
    requestedDevice: string;
    backendResolved: string | null;
    backendProves: 'wasm' | 'webgpu' | null;
    claimSatisfied: boolean;
    evidence?: BackendEvidence;
    routeHash: string;
    /** False when WebGPU ran on a software rasterizer: proven, but not a hardware result. */
    hardwareRepresentative: boolean;
    /** SHA-256 of THIS lane's transcripts. Browser digests are never mixed with Node ones. */
    transcriptDigest?: string;
    freshSession: boolean;
    perUtterance?: unknown[];
    wer: number | null;
    referenceWords: number;
    substitutions: number;
    deletions: number;
    insertions: number;
    error?: string;
    wallClockMs: number;
}

const results: BrowserArmResult[] = [];

// Sample counts from the NODE loader, to bind the page's parser to it.
const nodeSampleCounts = Object.fromEntries(
    CLIPS.map((s) => [s.id, decodeWav(clipPath(s.id)).samples.length]),
);

for (const spec of ARM_MATRIX) {
    if (onlyIds && !onlyIds.has(spec.id)) continue;
    // Node-lane-only arms still run here: the whole point is that EVERY candidate gets browser
    // evidence before a selection, not only the cells Node could not execute.
    process.stdout.write(`\n  ${spec.id}  (${spec.label})\n`);

    // A FRESH BROWSING CONTEXT PER ARM. A shared page would carry the previous arm's WASM modules,
    // GPU device and instrumentation counters, and a "proven" backend could then be evidence of the
    // arm before it. The counters are asserted to start at zero below, which is what makes the
    // isolation checked rather than assumed.
    const context = await browser.newContext();
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('pageerror', (e) => consoleErrors.push(e.message));
    await page.goto(`${harness.origin}/harness.html`);
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);

    const startingEvidence = await page.evaluate(
        () => (window as unknown as { __BACKEND_EVIDENCE__: Record<string, number> }).__BACKEND_EVIDENCE__,
    );
    const carriedOver = ['wasmInstantiations', 'gpuDevicesCreated', 'gpuComputePipelines', 'gpuQueueSubmits']
        .filter((k) => (startingEvidence as Record<string, number>)[k] !== 0);
    if (carriedOver.length > 0) {
        console.log(`    SESSION NOT FRESH — counters already non-zero: ${carriedOver.join(', ')}`);
    }

    const isMoonshine = spec.runtime === 'moonshine';
    const isV2 = spec.runtime === 'v2';
    const route = isMoonshine
        ? resolveMoonshineRoute(spec.modelId, 4.2)
        : resolveWhisperRoute(isV2 ? 'v2' : 'v4', isV2 ? (spec.localModelId ?? spec.modelId) : spec.modelId, 4.2, spec.variantId);

    const started = Date.now();
    const outcome = await page.evaluate(async (input) => {
        const w = window as unknown as {
            __BACKEND_EVIDENCE__: Record<string, unknown>;
            __decodeWav: (url: string) => Promise<{ samples: Float32Array; seconds: number }>;
        };
        try {
            const lib = await import(input.libUrl);
            const { pipeline, env } = lib as {
                pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<unknown>;
                env: Record<string, unknown>;
            };

            // Weights come from THIS ORIGIN's HuggingFace mirror, not from huggingface.co. A fresh
            // context per arm has no cache, so hitting the CDN directly re-downloaded every file and
            // earned an HTTP 429 part-way through the matrix — six arms failed on a network verdict
            // that would have been recorded as a model result.
            (env as { remoteHost: string }).remoteHost = `${input.origin}/hf/`;
            (env as { remotePathTemplate: string }).remotePathTemplate = '{model}/resolve/{revision}/';

            if (input.isV2) {
                // Self-hosted candidates load the product's OWN weights from this origin at /models/ —
                // the same path the app uses — with remote loading OFF so a missing asset fails loudly.
                // A candidate the product does not self-host (whisper-small.en) has no such copy, so
                // it must fetch from HuggingFace; its provenance says `unverifiable` accordingly.
                (env as { allowLocalModels: boolean }).allowLocalModels = !input.allowRemote;
                (env as { allowRemoteModels: boolean }).allowRemoteModels = input.allowRemote;
                (env as { localModelPath: string }).localModelPath = '/models/';
            }

            const options: Record<string, unknown> = input.isV2
                ? { quantized: true }
                : { dtype: input.dtype, device: input.device };
            if (input.revision) options.revision = input.revision;

            const asr = (await pipeline('automatic-speech-recognition', input.modelId, options)) as
                (audio: Float32Array, opts: Record<string, unknown>) => Promise<unknown>;

            const transcripts: { id: string; text: string | null; samples: number }[] = [];
            for (const clip of input.clips) {
                const audio = await w.__decodeWav(clip.url);
                // The generation options are the arm's OWN route: Whisper's window/stride/timestamps,
                // or Moonshine's duration-derived bound. Never one family's options on the other.
                const generation = input.family === 'moonshine'
                    ? { max_new_tokens: Math.min(512, Math.max(1, Math.ceil(audio.seconds * 6))) }
                    : {
                          chunk_length_s: input.chunkLengthS,
                          stride_length_s: audio.seconds < input.chunkLengthS ? 0 : input.strideLengthS,
                          return_timestamps: true,
                      };
                const result = await asr(audio.samples, generation);
                const text = typeof result === 'string' ? result : (result as { text?: string })?.text ?? null;
                transcripts.push({ id: clip.id, text, samples: audio.samples.length });
            }
            return { ok: true as const, transcripts, evidence: w.__BACKEND_EVIDENCE__ };
        } catch (error) {
            return {
                ok: false as const,
                error: (error as Error)?.message?.slice(0, 300) ?? String(error),
                evidence: w.__BACKEND_EVIDENCE__,
            };
        }
    }, {
        origin: harness.origin,
        libUrl: spec.runtime === 'v2'
            ? '/lib/@xenova/transformers/dist/transformers.js'
            : '/lib/@huggingface/transformers/dist/transformers.web.js',
        isV2,
        allowRemote: isV2 && spec.localModelId === undefined,
        family: isMoonshine ? 'moonshine' : 'whisper',
        modelId: isV2 ? (spec.localModelId ?? spec.modelId) : spec.modelId,
        dtype: typeof spec.dtype === 'object' ? spec.dtype : spec.dtype ?? undefined,
        // `onnxruntime-node` and `cpu` are NODE concepts. In a browser the only backends are `wasm`
        // and `webgpu`, and passing `cpu` is rejected outright — so a Node accuracy arm becomes the
        // WASM arm it would really be in the product.
        device: spec.device === 'onnxruntime-node' || spec.device === 'cpu' ? 'wasm' : spec.device,
        revision: spec.revision ?? null,
        chunkLengthS: route.family === 'whisper' ? route.decode.chunk_length_s : 0,
        strideLengthS: route.family === 'whisper' ? 5 : 0,
        clips: CLIPS.map((s) => ({ id: s.id, url: clipUrl(s.id) })),
    });

    const wallClockMs = Date.now() - started;
    const evidence = outcome.evidence as unknown as BackendEvidence;
    const { resolved, proves } = resolveBackend(evidence);
    const hardwareRepresentative = proves !== 'webgpu' || !isSoftwareAdapter(evidence.gpuAdapterInfo);
    // In the browser there are only two backends, so every Node-lane arm is really a WASM arm here.
    const requestedDevice = spec.device === 'onnxruntime-node' || spec.device === 'cpu' ? 'wasm' : spec.device;
    const claimed = requestedDevice;

    if (!outcome.ok) {
        console.log(`    FAILED: ${outcome.error}`);
        results.push({
            id: spec.id, label: spec.label, requestedDevice, backendResolved: resolved, backendProves: proves,
            claimSatisfied: false, evidence, routeHash: candidateRouteHash(route), hardwareRepresentative,
            freshSession: carriedOver.length === 0,
            wer: null, referenceWords: 0, substitutions: 0, deletions: 0, insertions: 0,
            error: outcome.error, wallClockMs,
        });
        await context.close();
        continue;
    }

    // Bind the page's WAV parser to Node's: a divergence here would mean the browser arm scored
    // different audio than the Node arm and nothing would say so.
    const mismatched = outcome.transcripts.filter((t) => t.samples !== nodeSampleCounts[t.id]);
    if (mismatched.length > 0) {
        console.log(`    AUDIO PARSER DIVERGENCE on ${mismatched.map((m) => m.id).join(',')} — refusing to score`);
        results.push({
            id: spec.id, label: spec.label, requestedDevice, backendResolved: resolved, backendProves: proves,
            claimSatisfied: false, evidence, routeHash: candidateRouteHash(route), hardwareRepresentative,
            freshSession: carriedOver.length === 0,
            wer: null, referenceWords: 0, substitutions: 0, deletions: 0, insertions: 0,
            error: 'audio_parser_divergence', wallClockMs,
        });
        await context.close();
        continue;
    }

    const scores = outcome.transcripts.map((t) =>
        scoreUtterance(t.id, CLIPS.find((s) => s.id === t.id)?.transcript ?? '', t.text));
    const aggregate = aggregateArm(scores, CLIPS.map((s) => s.id));

    // PER-UTTERANCE DETAIL, from the browser run itself. Aggregates alone cannot show whether two arms
    // that scored the same produced the same TEXT — which is the only way to tell a real tie from a
    // coincidence of a small set.
    const perUtterance = outcome.transcripts.map((t) => {
        const reference = CLIPS.find((s) => s.id === t.id)?.transcript ?? '';
        const score = scores.find((sc) => sc.utteranceId === t.id);
        return {
            id: t.id,
            hypothesisRaw: t.text,
            normalizedReference: normalizeOfficialTrackA(reference).join(' '),
            normalizedHypothesis: normalizeOfficialTrackA(t.text ?? '').join(' '),
            substitutions: score?.ok ? score.row.substitutions : null,
            deletions: score?.ok ? score.row.deletions : null,
            insertions: score?.ok ? score.row.insertions : null,
            referenceWords: score?.ok ? score.row.referenceWords : null,
            invalidReason: score?.ok ? null : score?.invalidReason ?? null,
        };
    });
    // Digest of the BROWSER transcripts. The earlier fingerprints were computed from the NODE lane and
    // should never have been presented alongside browser results.
    const transcriptDigest = createHash('sha256')
        .update(outcome.transcripts.map((t) => `${t.id}\t${t.text ?? '<null>'}`).join('\n'))
        .digest('hex').slice(0, 16);
    const claimSatisfied = proves === claimed;

    console.log(
        `    backend: ${resolved ?? 'UNRESOLVED'}  (claim ${claimed}: ${claimSatisfied ? 'PROVEN' : 'NOT PROVEN'})`
        + (hardwareRepresentative ? '' : '  [SOFTWARE RASTERIZER — timing is NOT a GPU result]'),
    );
    console.log(
        aggregate.wer === null
            ? `    POOLED: unscoreable (${aggregate.armInvalidReason})`
            : `    POOLED WER = ${aggregate.wer.toFixed(4)}  words=${aggregate.referenceWords}  ` +
              `S=${aggregate.substitutions} D=${aggregate.deletions} I=${aggregate.insertions}  ${wallClockMs}ms`,
    );

    results.push({
        id: spec.id, label: spec.label, requestedDevice, backendResolved: resolved, backendProves: proves,
        claimSatisfied, evidence, routeHash: candidateRouteHash(route), hardwareRepresentative,
        transcriptDigest, freshSession: carriedOver.length === 0, perUtterance,
        wer: aggregate.wer, referenceWords: aggregate.referenceWords,
        substitutions: aggregate.substitutions, deletions: aggregate.deletions, insertions: aggregate.insertions,
        wallClockMs,
    });
    await context.close();
}

await browser.close();
await harness.close();

console.log('\n\n=== BROWSER LANE SUMMARY ===');
for (const r of results) {
    const wer = r.wer === null ? '   —   ' : r.wer.toFixed(4);
    console.log(
        `  ${wer}  ${r.id.padEnd(34)} backend=${(r.backendResolved ?? 'unresolved').padEnd(28)} `
        + `${r.claimSatisfied ? 'claim proven' : 'claim NOT proven'}${r.freshSession ? '' : ' [SESSION NOT FRESH]'}`
        + (r.hardwareRepresentative ? '' : '  [software rasterizer: timing not comparable]'),
    );
}
console.log('\n  A backend claim is proven by counted work — adapters, devices, compute pipelines, queue');
console.log('  submissions, WASM instantiations — never by the device string that was requested.\n');

if (outPath) {
    writeFileSync(outPath, `${JSON.stringify({ lane: 'browser', results }, null, 2)}\n`, 'utf8');
    console.log(`wrote ${outPath}`);
}
