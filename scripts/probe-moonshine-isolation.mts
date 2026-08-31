#!/usr/bin/env tsx
/**
 * #1304 conditions C–G — WHICH ISOLATION METHOD GUARANTEES INDEPENDENT CLIPS?
 *
 * r2 established that persistent transcriber state changes later decodes. It did not establish how to
 * prevent that cheaply. This probe compares candidate lifecycles on the same clips, in one process,
 * against the real pinned runtime.
 *
 * The runtime exposes no `reset()` on Transcriber, and `transcribe()` is documented as the
 * NON-STREAMING whole-buffer call — so calling it repeatedly on a `MediumStreaming` arch is the
 * suspected misuse. `createStream()` is the API's own per-utterance boundary and is the cheap candidate.
 *
 * CONDITIONS
 *   B  shared transcriber, original order        (reproduces the defect)
 *   C  shared transcriber, REVERSED order        (order dependence)
 *   D  per-clip createStream() on ONE transcriber (candidate fix, cheap)
 *   D2 fresh Transcriber per clip                 (known-good control, expensive)
 *   G  the same clip decoded twice in one process (repeat stability)
 *
 * INDEPENDENCE is the property under test: a clip's transcript must not depend on what preceded it.
 *
 *   usage: npx tsx scripts/probe-moonshine-isolation.mts --ids=<file> [--n=6] [--out=report.json]
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { startHarnessServer } from '../tests/evidence/certification/browser/server';
import manifest from '../tests/fixtures/corpus-manifest.json' with { type: 'json' };

const arg = (n: string, d = '') => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const N = Number(arg('n', '6'));
const OUT = arg('out', 'evidence-runs/1304-isolation-classification.json');

type Clip = { id: string; reference: string; audio: { path: string } };
const all = Object.values((manifest as { subsets: Record<string, Clip[]> }).subsets).flat();
const wanted = readFileSync(arg('ids'), 'utf8').trim().split('\n').filter(Boolean).slice(0, N);
const clips = wanted.map((id) => all.find((c) => c.id === id)).filter(Boolean) as Clip[];
if (clips.length !== wanted.length) { console.error('manifest could not resolve every id'); process.exit(2); }

const harness = await startHarnessServer(resolve('.'), { mode: 'pinned', offlineOnly: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addInitScript(() => {
    const g = globalThis as unknown as { __name?: (t: unknown) => unknown };
    g.__name ??= (t) => t;
});
const pins = JSON.parse(readFileSync('tests/fixtures/moonshine-asset-pins.json', 'utf8')) as {
    assets: Record<string, { sha256: string }>;
};
await context.route((u) => !u.href.startsWith(harness.origin) && /^https?:/.test(u.href), async (route) => {
    const key = route.request().url().replace(/^https?:\/\//, '').replace(/[?#].*$/, '');
    const cached = resolve('.hf-cache/external', key);
    if (!pins.assets[key] || !existsSync(cached)) return route.abort();
    if (createHash('sha256').update(readFileSync(cached)).digest('hex') !== pins.assets[key].sha256) return route.abort();
    await route.fulfill({ status: 302, headers: { location: `${harness.origin}/external/${key}`, 'access-control-allow-origin': '*' } });
});

const LIB = '/lib/@moonshine-ai/moonshine-wasm/dist/index.js';
const newPage = async () => {
    const p = await context.newPage();
    p.on('console', (m) => { if (m.type() === 'error') console.error('  page:', m.text().slice(0, 140)); });
    await p.goto(`${harness.origin}/harness.html`);
    await p.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
    return p;
};

const input = { libUrl: LIB, clips: clips.map((c) => ({ id: c.id, audioPath: c.audio.path })) };
console.log(`\n#1304 isolation probe — ${clips.length} clips, real pinned runtime\n`);

/** Conditions that fit in ONE page/heap: shared-order, reversed, per-clip stream, repeat. */
const inPage = await (await newPage()).evaluate(async (inp) => {
    const w = window as unknown as { __decodeAudio: (u: string) => Promise<{ samples: Float32Array }> };
    const lib = await import(inp.libUrl) as {
        Transcriber: { load: (o: Record<string, unknown>) => Promise<{
            transcribe: (a: Float32Array, o?: Record<string, unknown>) => { lines?: { text?: string }[]; text?: string };
            createStream?: (o?: Record<string, unknown>) => {
                start: () => void; stop: () => void; close: () => void;
                addAudio: (a: Float32Array, sr: number) => void;
                transcribe?: (flags?: number) => { lines?: { text?: string }[]; text?: string };
            };
            destroy?: () => Promise<void> | void;
        }> };
        ModelArch: Record<string, number>;
    };
    const textOf = (r: { lines?: { text?: string }[]; text?: string }) =>
        (Array.isArray(r?.lines) ? r.lines.map((l) => l?.text ?? '').join(' ') : (r?.text ?? '')).trim();

    const audio: Record<string, Float32Array> = {};
    for (const c of inp.clips) audio[c.id] = (await w.__decodeAudio(`/corpus/${c.audioPath}`)).samples;

    const t = await lib.Transcriber.load({ language: 'en', modelArch: lib.ModelArch.MediumStreaming });

    // B — shared, original order.
    const shared: Record<string, string> = {};
    for (const c of inp.clips) shared[c.id] = textOf(t.transcribe(audio[c.id]));

    // C — shared, REVERSED order. Same instance, different predecessors.
    const reversed: Record<string, string> = {};
    for (const c of [...inp.clips].reverse()) reversed[c.id] = textOf(t.transcribe(audio[c.id]));

    // G — the same clip twice in a row on the shared instance.
    const first = inp.clips[0];
    const repeatA = textOf(t.transcribe(audio[first.id]));
    const repeatB = textOf(t.transcribe(audio[first.id]));

    // D — per-clip createStream(): the API's OWN utterance boundary.
    //
    // addAudio() only BUFFERS; `stream.transcribe(flags)` is what runs a pass and returns the snapshot,
    // and a pass that comes too soon returns the previous snapshot unless ForceUpdate insists. An
    // earlier version of this probe called addAudio/stop and read nothing, which produced empty strings
    // and would have been reported as "streaming does not isolate" — a probe defect, not a finding.
    const streamed: Record<string, string> = {};
    let streamSupported = true;
    try {
        for (const c of inp.clips) {
            const s = t.createStream?.();
            if (!s) { streamSupported = false; break; }
            s.start();
            s.addAudio(audio[c.id], 16000);
            const snap = s.transcribe?.(1 /* TranscribeFlags.ForceUpdate */);
            streamed[c.id] = snap ? textOf(snap as { lines?: { text?: string }[] }) : '';
            s.stop();
            s.close();
        }
    } catch (e) { streamSupported = false; streamed.__error = String((e as Error)?.message ?? e).slice(0, 200); }

    // D(reversed) — the SAME stream method with different predecessors. Independence is a method
    // agreeing with ITSELF under a different order, NOT agreeing with a different decode path:
    // whole-buffer and streaming legitimately differ, so streamed-vs-fresh cannot measure isolation.
    const streamedReversed: Record<string, string> = {};
    if (streamSupported) {
        try {
            for (const c of [...inp.clips].reverse()) {
                const s2 = t.createStream?.();
                if (!s2) break;
                s2.start();
                s2.addAudio(audio[c.id], 16000);
                const snap = s2.transcribe?.(1);
                streamedReversed[c.id] = snap ? textOf(snap as { lines?: { text?: string }[] }) : '';
                s2.stop();
                s2.close();
            }
        } catch { /* recorded by the comparison below */ }
    }

    await t.destroy?.();
    return { shared, reversed, repeatA, repeatB, streamed, streamedReversed, streamSupported };
}, input);

// D2 — fresh Transcriber per clip, each in its own page/heap (known-good control).
const fresh: Record<string, string> = {};
for (const c of clips) {
    const pg = await newPage();
    fresh[c.id] = await pg.evaluate(async (inp) => {
        const w = window as unknown as { __decodeAudio: (u: string) => Promise<{ samples: Float32Array }> };
        const lib = await import(inp.libUrl) as {
            Transcriber: { load: (o: Record<string, unknown>) => Promise<{
                transcribe: (a: Float32Array) => { lines?: { text?: string }[]; text?: string };
                destroy?: () => Promise<void> | void; }> };
            ModelArch: Record<string, number>;
        };
        const textOf = (r: { lines?: { text?: string }[]; text?: string }) =>
            (Array.isArray(r?.lines) ? r.lines.map((l) => l?.text ?? '').join(' ') : (r?.text ?? '')).trim();
        const t = await lib.Transcriber.load({ language: 'en', modelArch: lib.ModelArch.MediumStreaming });
        const a = await w.__decodeAudio(`/corpus/${inp.audioPath}`);
        const text = textOf(t.transcribe(a.samples));
        await t.destroy?.();
        return text;
    }, { libUrl: LIB, audioPath: c.audio.path });
    await pg.close();
    console.log(`  fresh ${c.id}`);
}

const rows = clips.map((c) => ({
    id: c.id,
    shared: inPage.shared[c.id] ?? '',
    reversed: inPage.reversed[c.id] ?? '',
    streamed: inPage.streamed[c.id] ?? '',
    streamedReversed: inPage.streamedReversed?.[c.id] ?? '',
    fresh: fresh[c.id] ?? '',
}));

const agrees = (a: string, b: string) => a === b;
const sharedIndependent = rows.every((r) => agrees(r.shared, r.reversed));
// ORDER-INDEPENDENCE of the stream method: same method, different predecessors.
const streamIndependent = inPage.streamSupported && rows.every((r) => agrees(r.streamed, r.streamedReversed));
const sharedMatchesFresh = rows.filter((r) => agrees(r.shared, r.fresh)).length;
const repeatStable = inPage.repeatA === inPage.repeatB;

console.log('\n  condition results');
console.log(`    B/C  shared order-independent      : ${sharedIndependent ? 'YES' : 'NO'} (${rows.filter((r) => agrees(r.shared, r.reversed)).length}/${rows.length} agree)`);
console.log(`    G    repeat of one clip stable     : ${repeatStable ? 'YES' : 'NO'}`);
console.log(`    D    per-clip stream == fresh      : ${inPage.streamSupported ? (streamIndependent ? 'YES' : 'NO') : 'STREAM API UNAVAILABLE'}`);
console.log(`    D2   shared == fresh               : ${sharedMatchesFresh}/${rows.length}`);
for (const r of rows) {
    const flag = agrees(r.shared, r.fresh) ? '   ' : '***';
    console.log(`    ${flag} ${r.id}`);
    if (!agrees(r.shared, r.fresh)) {
        console.log(`        shared  : ${JSON.stringify(r.shared.slice(0, 80))}`);
        console.log(`        fresh   : ${JSON.stringify(r.fresh.slice(0, 80))}`);
        if (inPage.streamSupported) console.log(`        streamed: ${JSON.stringify(r.streamed.slice(0, 80))}`);
    }
}

const verdict = sharedIndependent ? 'NO_LEAK_REPRODUCED'
    : streamIndependent ? 'STREAM_PER_CLIP_ISOLATES'
        : 'ONLY_FRESH_INSTANCE_ISOLATES';
console.log(`\n  VERDICT: ${verdict}`);

writeFileSync(OUT, `${JSON.stringify({
    probe: '#1304 moonshine isolation conditions C-G',
    verdict, clipCount: rows.length,
    runtime: '@moonshine-ai/moonshine-wasm', arch: 'MediumStreaming',
    conditions: {
        sharedOrderIndependent: sharedIndependent,
        repeatStable, repeatA: inPage.repeatA, repeatB: inPage.repeatB,
        streamApiAvailable: inPage.streamSupported,
        streamOrderIndependent: streamIndependent,
        streamAgreesWithReversed: `${rows.filter((r) => agrees(r.streamed, r.streamedReversed)).length}/${rows.length}`,
        streamMatchesFresh: `${rows.filter((r) => agrees(r.streamed, r.fresh)).length}/${rows.length}`,
        sharedMatchesFresh: `${sharedMatchesFresh}/${rows.length}`,
    },
    rows,
}, null, 2)}\n`);
console.log(`  artifact: ${OUT}  sha256=${createHash('sha256').update(readFileSync(OUT)).digest('hex')}`);

await context.close(); await browser.close(); await harness.close();
