#!/usr/bin/env tsx
/**
 * #1304 — does `condition_on_previous_text: false` do ANYTHING in the shipping runtime?
 *
 * The Harvard clips are 2–4 seconds, so they never cross Whisper's 30-second window and there is never
 * a previous window to condition on. That is why the arm produced byte-identical output there, and it
 * is why the comparison has to be run on the frozen 37.87-second fixture, which spans two windows.
 *
 * Everything except the option is held fixed: same model, same self-hosted assets, same WASM backend,
 * same audio, fresh browsing context each time. Two things are proven rather than assumed:
 *
 *   1. MORE THAN ONE WINDOW ACTUALLY RAN — counted by hooking the model's own generate call, not
 *      inferred from the clip length.
 *   2. THE OPTIONS EACH WINDOW RECEIVED are recorded verbatim, so "the option was passed" is evidence
 *      rather than intent.
 *
 * If the outputs are identical, the finding is "no measured effect" — never "equivalent".
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { startHarnessServer } from '../tests/evidence/certification/browser/server';
import { wordErrorRate } from '../tests/evidence/werMetric';
import { normalizeOfficialTrackA } from '../tests/evidence/normalization/officialNormalizer';

const outPath = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1] ?? '';
const REFERENCE = readFileSync('tests/fixtures/corpus-longform/long-01.reference.txt', 'utf8')
    .split('\n').filter(Boolean).join(' ');

const harness = await startHarnessServer(resolve('.'));
const browser = await chromium.launch({ headless: true });

interface Arm {
    label: string;
    /** Extra generation options layered onto the shipping ones. `null` = shipping default, absent. */
    override: Record<string, unknown> | null;
}
const ARMS: Arm[] = [
    { label: 'baseline (shipping default — option ABSENT)', override: null },
    { label: 'variant  (condition_on_previous_text: false)', override: { condition_on_previous_text: false } },
];

interface ProbeResult {
    label: string;
    generateCalls: number;
    optionsPerCall: Record<string, unknown>[];
    timestampSpanSeconds: number | null;
    chunkCount: number | null;
    transcript: string;
    transcriptSha256: string;
    wallClockMs: number;
    backend: { wasmInstantiations: number; gpuDevicesCreated: number };
    freshSession: boolean;
}

const results: ProbeResult[] = [];

for (const arm of ARMS) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${harness.origin}/harness.html`);
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);

    const before = await page.evaluate(
        () => (window as unknown as { __BACKEND_EVIDENCE__: Record<string, number> }).__BACKEND_EVIDENCE__,
    );
    const freshSession = before.wasmInstantiations === 0 && before.gpuDevicesCreated === 0;

    const started = Date.now();
    const outcome = await page.evaluate(async (input) => {
        const w = window as unknown as {
            __BACKEND_EVIDENCE__: Record<string, number>;
            __decodeWav: (url: string) => Promise<{ samples: Float32Array; seconds: number }>;
        };
        const lib = await import('/lib/@xenova/transformers/dist/transformers.js');
        const { pipeline, env } = lib as {
            pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<unknown>;
            env: Record<string, unknown>;
        };
        // The product's own self-hosted assets, remote loading off — identical for both arms.
        env.allowLocalModels = true;
        env.allowRemoteModels = false;
        env.localModelPath = '/models/';

        const asr = await pipeline('automatic-speech-recognition', 'whisper-base.en', { quantized: true });

        // COUNT THE WINDOWS, by hooking the model's own generate. Inferring "two windows ran" from a
        // 37.87s clip and a 30s setting would be assuming exactly the thing under test.
        const optionsPerCall: Record<string, unknown>[] = [];
        const model = (asr as { model?: { generate?: (...a: unknown[]) => unknown } }).model;
        if (model?.generate) {
            const real = model.generate.bind(model);
            model.generate = function (...args: unknown[]) {
                const opts = args[1] ?? args[0];
                // Record only serialisable scalars: the tensors in this object are enormous.
                const flat: Record<string, unknown> = {};
                for (const [k, v] of Object.entries((opts ?? {}) as Record<string, unknown>)) {
                    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) flat[k] = v;
                }
                optionsPerCall.push(flat);
                return real(...args);
            };
        }

        const audio = await w.__decodeWav(input.url);
        const generation: Record<string, unknown> = {
            chunk_length_s: 30,
            stride_length_s: audio.seconds < 30 ? 0 : 5,
            return_timestamps: true,
            ...(input.override ?? {}),
        };
        const result = await asr(audio.samples, generation) as
            { text?: string; chunks?: { timestamp?: [number, number] }[] };

        const chunks = result?.chunks ?? [];
        const last = chunks[chunks.length - 1]?.timestamp;
        return {
            text: (result?.text ?? '').trim(),
            optionsPerCall,
            generationPassed: generation,
            chunkCount: chunks.length,
            timestampSpanSeconds: Array.isArray(last) ? last[1] ?? null : null,
            audioSeconds: audio.seconds,
            evidence: w.__BACKEND_EVIDENCE__,
        };
    }, { url: '/fixtures/corpus-longform/long-01.wav', override: arm.override });

    const wallClockMs = Date.now() - started;
    results.push({
        label: arm.label,
        generateCalls: outcome.optionsPerCall.length,
        optionsPerCall: outcome.optionsPerCall,
        timestampSpanSeconds: outcome.timestampSpanSeconds,
        chunkCount: outcome.chunkCount,
        transcript: outcome.text,
        transcriptSha256: createHash('sha256').update(outcome.text).digest('hex'),
        wallClockMs,
        backend: {
            wasmInstantiations: Number(outcome.evidence.wasmInstantiations),
            gpuDevicesCreated: Number(outcome.evidence.gpuDevicesCreated),
        },
        freshSession,
    });
    await context.close();
}

await browser.close();
await harness.close();

/** Repeated 5-grams: the shape a conditioning failure takes is a looping tail. */
const repetition = (text: string) => {
    const words = normalizeOfficialTrackA(text);
    const seen = new Map<string, number>();
    for (let i = 0; i + 5 <= words.length; i++) {
        const gram = words.slice(i, i + 5).join(' ');
        seen.set(gram, (seen.get(gram) ?? 0) + 1);
    }
    return [...seen.values()].filter((n) => n > 1).length;
};
/** Did the END of the reference survive? A dropped tail is the other conditioning failure mode. */
const tailPreserved = (text: string) => {
    const ref = normalizeOfficialTrackA(REFERENCE).slice(-6).join(' ');
    return normalizeOfficialTrackA(text).join(' ').endsWith(ref);
};

console.log('\n=== condition_on_previous_text on the 37.87s frozen fixture ===\n');
for (const r of results) {
    const wer = wordErrorRate(REFERENCE, r.transcript, { track: 'track_a' });
    console.log(`  ${r.label}`);
    console.log(`    windows (model.generate calls): ${r.generateCalls}`);
    console.log(`    timestamp span: ${r.timestampSpanSeconds}s over ${r.chunkCount} chunk(s)`);
    console.log(`    options passed per window: ${JSON.stringify(r.optionsPerCall)}`);
    console.log(`    transcript sha256: ${r.transcriptSha256.slice(0, 32)}`);
    console.log(`    S=${wer.substitutions} D=${wer.deletions} I=${wer.insertions} refWords=${wer.referenceWords} WER=${wer.wer?.toFixed(4)}`);
    console.log(`    repeated 5-grams: ${repetition(r.transcript)}   tail preserved: ${tailPreserved(r.transcript)}`);
    console.log(`    backend: wasm=${r.backend.wasmInstantiations} gpu=${r.backend.gpuDevicesCreated}  fresh session: ${r.freshSession}`);
    console.log(`    wall clock: ${r.wallClockMs}ms\n`);
}

const [a, b] = results;
const identical = a.transcriptSha256 === b.transcriptSha256;
console.log(identical
    ? '  VERDICT: identical transcripts — NO MEASURED EFFECT.\n'
      + '  Not "equivalent": the option is absent from both transformers.js bundles, so the runtime\n'
      + '  silently ignores it. Nothing here shows the option works and produced the same answer.'
    : '  VERDICT: the option CHANGED the output — see the two transcripts above.');
console.log();

if (outPath) {
    writeFileSync(outPath, `${JSON.stringify({ reference: REFERENCE, results, identical }, null, 2)}\n`, 'utf8');
    console.log(`wrote ${outPath}`);
}
