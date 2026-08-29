#!/usr/bin/env tsx
/**
 * #1304 — BOUNDED LOAD PROBE: Moonshine Streaming Small and Medium, through their OFFICIAL runtime.
 *
 * WHY THIS EXISTS. I previously concluded Moonshine Streaming could not be evaluated, having searched
 * only the transformers.js / `onnx-community` route. That was wrong: Moonshine publishes its own
 * browser runtime, `@moonshine-ai/moonshine-wasm`, which loads official `.ort` components and knows
 * `SmallStreaming` and `MediumStreaming` directly. A model is not rejected because it does not fit one
 * adapter — that is integration cost, and integration cost belongs in the ACTIVATION verdict, never in
 * the accuracy comparison.
 *
 * This probe is deliberately small. It answers: does it load, does it decode ONE known fixture, on what
 * backend, at what download size and load time. It does NOT run the 459-word set — that happens on the
 * pushed, reviewable head.
 *
 * A failure here is classified `pending_harness`, NOT a model rejection.
 *
 *   usage: npx tsx scripts/probe-moonshine-streaming.mts [--out=report.json]
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { startHarnessServer } from '../tests/evidence/certification/browser/server';
import { decodeAudio } from '../tests/evidence/certification/audio';
import { scoreUtterance } from '../tests/evidence/certification/scoringAdapter';
import { readFileSync } from 'node:fs';
import { HARVARD_SENTENCES } from '../tests/fixtures/stt-isomorphic/harvard-sentences';

const outPath = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] ?? '';
const FIXTURE = HARVARD_SENTENCES.find((s) => s.id === 'h1_2')!; // no leading filler; a clean short check
const FIXTURE_PATH = 'tests/fixtures/stt-isomorphic/audio/h1_2.wav';

// Read by PATH: the package is import-only, so `require.resolve` cannot see it and reported 'unknown'
// — a placeholder in a provenance field, which the provenance gate exists to reject.
const runtimeVersion = (JSON.parse(
    readFileSync('node_modules/@moonshine-ai/moonshine-wasm/package.json', 'utf8'),
) as { version: string }).version;
console.log(`\n#1304 Moonshine Streaming probe — @moonshine-ai/moonshine-wasm@${runtimeVersion}`);
console.log(`fixture: ${FIXTURE.id} (${decodeAudio(FIXTURE_PATH).seconds.toFixed(2)}s)\n`);

// bootstrap: these assets have never been mirrored, so the network is permitted for THIS probe only.
const harness = await startHarnessServer(resolve('.'), { mode: 'bootstrap', offlineOnly: false });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu'] });

interface ProbeResult {
    arch: string;
    loaded: boolean;
    error?: string;
    classification: 'admitted' | 'pending_harness';
    loadMs: number | null;
    decodeMs: number | null;
    transcript: string | null;
    wer: number | null;
    downloadedBytes: number | null;
    fileCount: number | null;
    files: { name: string; bytes: number }[];
    backend: { wasmInstantiations: number; gpuDevicesCreated: number; resolved: string | null };
}

const results: ProbeResult[] = [];

for (const arch of ['SmallStreaming', 'MediumStreaming'] as const) {
    console.log(`  ${arch}`);
    const context = await browser.newContext();
    const page = await context.newPage();
    // BYTES FROM THE NETWORK, not from `onProgress`. The callback reports a RUNNING TOTAL, so taking a
    // maximum per file and summing them over-counted badly — Small came out at 731 MB against a
    // documented ~255 MB for the larger Medium. Response bodies are what the user actually downloads.
    const transfers: { url: string; bytes: number; from: 'content-length' | 'body' }[] = [];
    page.on('response', (response) => {
        const url = response.url();
        if (url.startsWith(harness.origin)) return; // harness/library assets, not model weights
        // CONTENT-LENGTH FIRST. Reading `response.body()` fails on large streamed responses, and my
        // first version swallowed those failures in a `.catch()` — so the biggest weight files vanished
        // and Medium reported 15.5 MB against a documented ~255 MB. A byte count that silently omits
        // the large files is worse than none: it makes an unshippable download look trivial.
        const declared = Number(response.headers()['content-length']);
        if (Number.isFinite(declared) && declared > 0) {
            transfers.push({ url, bytes: declared, from: 'content-length' });
            return;
        }
        void response.body()
            .then((body) => transfers.push({ url, bytes: body.length, from: 'body' }))
            .catch(() => { /* nothing retrievable; recorded as absent rather than as zero */ });
    });
    await page.goto(`${harness.origin}/harness.html`);
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);

    const outcome = await page.evaluate(async (input) => {
        const w = window as unknown as {
            __decodeAudio: (url: string) => Promise<{ samples: Float32Array; seconds: number }>;
            __BACKEND_EVIDENCE__: Record<string, number>;
        };
        const downloaded: { name: string; bytes: number }[] = [];
        try {
            const lib = await import(input.libUrl);
            const { Transcriber, ModelArch } = lib as {
                Transcriber: { load: (o: Record<string, unknown>) => Promise<{
                    transcribe: (a: Float32Array) => Promise<unknown>;
                }> };
                ModelArch: Record<string, number>;
            };
            const started = performance.now();
            const transcriber = await Transcriber.load({
                language: 'en',
                modelArch: ModelArch[input.arch],
                onProgress: (loaded: number, _total: number | undefined, file: string) => {
                    const existing = downloaded.find((d) => d.name === file);
                    if (existing) existing.bytes = Math.max(existing.bytes, loaded);
                    else downloaded.push({ name: file, bytes: loaded });
                },
            });
            const loadMs = performance.now() - started;

            const audio = await w.__decodeAudio(input.fixtureUrl);
            const t0 = performance.now();
            const result = await transcriber.transcribe(audio.samples);
            const decodeMs = performance.now() - t0;
            // The runtime returns a STRUCTURED transcript: `{ lines: [{ text, startTime, duration }] }`.
            // My first version fell through to `JSON.stringify(result)` and scored the JSON, which read
            // as WER 2.0 for a transcript that was nearly correct. Scoring a serialisation instead of a
            // transcript is a harness defect that would have libelled the model.
            const structured = result as { lines?: { text?: string }[]; text?: string; transcript?: string };
            const text = typeof result === 'string'
                ? result
                : Array.isArray(structured?.lines)
                    ? structured.lines.map((l) => l?.text ?? '').join(' ').trim()
                    : structured?.text ?? structured?.transcript ?? null;
            return { ok: true as const, loadMs, decodeMs, text, downloaded, evidence: w.__BACKEND_EVIDENCE__ };
        } catch (error) {
            return {
                ok: false as const,
                error: (error as Error)?.message?.slice(0, 300) ?? String(error),
                downloaded,
                evidence: w.__BACKEND_EVIDENCE__,
            };
        }
    }, {
        libUrl: '/lib/@moonshine-ai/moonshine-wasm/dist/index.js',
        arch,
        fixtureUrl: '/fixtures/stt-isomorphic/audio/h1_2.wav',
    });

    const evidence = outcome.evidence as unknown as ProbeResult['backend'] & Record<string, number>;
    const resolved = evidence.gpuDevicesCreated > 0
        ? 'webgpu'
        : evidence.wasmInstantiations > 0 ? `wasm:${evidence.wasmInstantiations} module(s)` : null;

    if (!outcome.ok) {
        // A harness/integration failure is NOT a model rejection.
        console.log(`    pending_harness: ${outcome.error}`);
        results.push({
            arch, loaded: false, error: outcome.error, classification: 'pending_harness',
            loadMs: null, decodeMs: null, transcript: null, wer: null,
            downloadedBytes: transfers.reduce((n, t) => n + t.bytes, 0) || null,
            fileCount: transfers.length || null,
            files: transfers.map((t) => ({ name: t.url.split('/').slice(-2).join('/'), bytes: t.bytes })),
            backend: { wasmInstantiations: evidence.wasmInstantiations, gpuDevicesCreated: evidence.gpuDevicesCreated, resolved },
        });
        await context.close();
        continue;
    }

    // Scored through the SAME certified adapter as every other arm, so the number is comparable.
    const score = scoreUtterance(FIXTURE.id, FIXTURE.transcript, outcome.text);
    // Give in-flight response bodies a moment to resolve before totalling.
    await page.waitForTimeout(1500);
    const bytes = transfers.reduce((n, t) => n + t.bytes, 0);
    const modelFiles = transfers
        .filter((t) => /\.(ort|bin|json)(\?|$)/i.test(t.url))
        .map((t) => ({ name: t.url.split('/').slice(-2).join('/'), bytes: t.bytes }));
    const missingSize = transfers.filter((t) => !Number.isFinite(t.bytes) || t.bytes <= 0).length;
    console.log(`    loaded in ${Math.round(outcome.loadMs)}ms, decoded in ${Math.round(outcome.decodeMs)}ms`);
    console.log(`    backend: ${resolved ?? 'UNRESOLVED'}`);
    console.log(`    download: ${(bytes / 1e6).toFixed(1)} MB over ${transfers.length} responses `
        + `(${modelFiles.length} model files${missingSize > 0 ? `, ${missingSize} WITHOUT a size` : ''})`);
    for (const f of [...modelFiles].sort((a, b) => b.bytes - a.bytes).slice(0, 8)) {
        console.log(`        ${(f.bytes / 1e6).toFixed(1).padStart(7)} MB  ${f.name}`);
    }
    console.log(`    transcript: ${JSON.stringify((outcome.text ?? '').slice(0, 80))}`);
    console.log(`    WER on ${FIXTURE.id}: ${score.ok ? score.row.wer?.toFixed(4) : `invalid (${score.invalidReason})`}`);
    results.push({
        arch, loaded: true, classification: 'admitted',
        loadMs: Math.round(outcome.loadMs), decodeMs: Math.round(outcome.decodeMs),
        transcript: outcome.text, wer: score.ok ? score.row.wer : null,
        downloadedBytes: bytes, fileCount: transfers.length, files: modelFiles,
        backend: { wasmInstantiations: evidence.wasmInstantiations, gpuDevicesCreated: evidence.gpuDevicesCreated, resolved },
    });
    await context.close();
}

await browser.close();
console.log('\n=== assets served by the mirror (name, bytes, sha256) ===');
for (const [path, record] of Object.entries(harness.assets).slice(0, 40)) {
    console.log(`  ${record.sha256.slice(0, 16)}  ${String(record.bytes).padStart(10)}  ${path}`);
}
await harness.close();

if (outPath) {
    writeFileSync(outPath, `${JSON.stringify({ runtimeVersion, fixture: FIXTURE.id, results, assets: harness.assets }, null, 2)}\n`, 'utf8');
    console.log(`\nwrote ${outPath}`);
}
