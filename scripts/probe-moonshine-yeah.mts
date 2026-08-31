#!/usr/bin/env tsx
/**
 * #1304 — CAUSAL CLASSIFICATION OF THE LEADING "yeah".
 *
 * The targeted 600 shows moonshine:streaming-medium emitting a spurious leading `yeah` in 101 of 600
 * clips (16.8%). Every occurrence is at token position 0, never more than once per clip, and no
 * reference contains the word. That signature does not look like weight-level hallucination.
 *
 * The benchmark loads ONE Transcriber per arm and reuses it for all 600 clips with no reset, so a
 * streaming model carries state across clip boundaries. This probe separates the two explanations by
 * decoding the SAME clips two ways:
 *
 *   SHARED : one transcriber, clips decoded in sequence (the benchmark's condition)
 *   FRESH  : a new transcriber per clip, destroyed after (no cross-clip state)
 *
 * If `yeah` survives FRESH it is model behaviour. If it vanishes, the benchmark harness — not the model
 * — produced it, and the 600's insertion count for this arm is a harness artifact.
 *
 * RAW text is captured before any normalization, because a token introduced by our own scoring pipeline
 * would be a third explanation and must be excluded.
 *
 *   usage: npx tsx scripts/probe-moonshine-yeah.mts --ids=<file> [--n=15] [--out=report.json]
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { startHarnessServer } from '../tests/evidence/certification/browser/server';
import manifest from '../tests/fixtures/corpus-manifest.json' with { type: 'json' };

const arg = (n: string, d = '') => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const idsFile = arg('ids');
const N = Number(arg('n', '15'));
const OUT = arg('out', 'evidence-runs/1304-yeah-classification.json');

const wanted = readFileSync(idsFile, 'utf8').trim().split('\n').filter(Boolean).slice(0, N);
type Clip = { id: string; reference: string; audio: { path: string } };
const allClips = Object.values((manifest as { subsets: Record<string, Clip[]> }).subsets).flat();
const clips = wanted.map((id) => allClips.find((c) => c.id === id)).filter(Boolean) as Clip[];
if (clips.length !== wanted.length) {
    console.error(`manifest resolved ${clips.length}/${wanted.length} requested ids`);
    process.exit(2);
}

const harness = await startHarnessServer(resolve('.'), { mode: 'pinned', offlineOnly: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addInitScript(() => {
    const g = globalThis as unknown as { __name?: (t: unknown) => unknown };
    g.__name ??= (t) => t;
});
const pinTable = JSON.parse(readFileSync('tests/fixtures/moonshine-asset-pins.json', 'utf8')) as {
    assets: Record<string, { sha256: string }>;
};
await context.route((u) => !u.href.startsWith(harness.origin) && /^https?:/.test(u.href), async (route) => {
    const key = route.request().url().replace(/^https?:\/\//, '').replace(/[?#].*$/, '');
    const cached = resolve('.hf-cache/external', key);
    if (!pinTable.assets[key] || !existsSync(cached)) return route.abort();
    if (createHash('sha256').update(readFileSync(cached)).digest('hex') !== pinTable.assets[key].sha256) return route.abort();
    await route.fulfill({ status: 302, headers: { location: `${harness.origin}/external/${key}`, 'access-control-allow-origin': '*' } });
});
/** One page = one WASM heap. Loading the 147 MB medium decoder repeatedly in a single page exhausts it
 * with std::bad_alloc, so the FRESH arm gets a new page per clip. */
const newDriver = async () => {
    const pg = await context.newPage();
    pg.on('console', (m) => { if (m.type() === 'error') console.error('  page:', m.text().slice(0, 140)); });
    await pg.goto(`${harness.origin}/harness.html`);
    await pg.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
    return pg;
};

const LIB = '/lib/@moonshine-ai/moonshine-wasm/dist/index.js';

console.log(`\n#1304 "yeah" classification — ${clips.length} clips known to show a leading yeah\n`);

// SHARED — one transcriber, clips decoded in sequence: exactly the benchmark's condition.
const sharedPage = await newDriver();
const shared = await sharedPage.evaluate(async (input) => {
    const w = window as unknown as { __decodeAudio: (u: string) => Promise<{ samples: Float32Array }> };
    const lib = await import(input.libUrl) as {
        Transcriber: { load: (o: Record<string, unknown>) => Promise<{
            transcribe: (a: Float32Array) => Promise<{ lines?: { text?: string }[]; text?: string }>;
            destroy?: () => Promise<void> | void; }> };
        ModelArch: Record<string, number>;
    };
    const textOf = (r: { lines?: { text?: string }[]; text?: string }) =>
        (Array.isArray(r?.lines) ? r.lines.map((l) => l?.text ?? '').join(' ') : (r?.text ?? '')).trim();
    const t = await lib.Transcriber.load({ language: 'en', modelArch: lib.ModelArch.MediumStreaming });
    const out: Record<string, string> = {};
    for (const c of input.clips) {
        const a = await w.__decodeAudio(`/corpus/${c.audioPath}`);
        out[c.id] = textOf(await t.transcribe(a.samples));
    }
    await t.destroy?.();
    return out;
}, { libUrl: LIB, clips: clips.map((c) => ({ id: c.id, audioPath: c.audio.path })) });
await sharedPage.close();
console.log(`  shared arm done (${Object.keys(shared).length} clips)`);

// FRESH — a new page, a new transcriber, ONE clip, then the page is discarded.
const fresh: Record<string, string> = {};
for (const c of clips) {
    const pg = await newDriver();
    fresh[c.id] = await pg.evaluate(async (input) => {
        const w = window as unknown as { __decodeAudio: (u: string) => Promise<{ samples: Float32Array }> };
        const lib = await import(input.libUrl) as {
            Transcriber: { load: (o: Record<string, unknown>) => Promise<{
                transcribe: (a: Float32Array) => Promise<{ lines?: { text?: string }[]; text?: string }>;
                destroy?: () => Promise<void> | void; }> };
            ModelArch: Record<string, number>;
        };
        const textOf = (r: { lines?: { text?: string }[]; text?: string }) =>
            (Array.isArray(r?.lines) ? r.lines.map((l) => l?.text ?? '').join(' ') : (r?.text ?? '')).trim();
        const t = await lib.Transcriber.load({ language: 'en', modelArch: lib.ModelArch.MediumStreaming });
        const a = await w.__decodeAudio(`/corpus/${input.audioPath}`);
        const text = textOf(await t.transcribe(a.samples));
        await t.destroy?.();
        return text;
    }, { libUrl: LIB, audioPath: c.audio.path });
    await pg.close();
    console.log(`  fresh ${c.id}`);
}
const outcome = { shared, fresh };

const leadingYeah = (s: string) => /^\s*yeah\b/i.test(s);
let sharedYeah = 0, freshYeah = 0;
const rows = clips.map((c) => {
    const s = outcome.shared[c.id] ?? '', f = outcome.fresh[c.id] ?? '';
    if (leadingYeah(s)) sharedYeah++;
    if (leadingYeah(f)) freshYeah++;
    return { id: c.id, sharedLeadingYeah: leadingYeah(s), freshLeadingYeah: leadingYeah(f), sharedRaw: s, freshRaw: f };
});

for (const r of rows) {
    console.log(`  ${r.id.padEnd(22)} shared=${r.sharedLeadingYeah ? 'YEAH' : '  - '}  fresh=${r.freshLeadingYeah ? 'YEAH' : '  - '}`);
    if (r.sharedLeadingYeah !== r.freshLeadingYeah) console.log(`      shared: ${JSON.stringify(r.sharedRaw.slice(0, 70))}\n      fresh : ${JSON.stringify(r.freshRaw.slice(0, 70))}`);
}

const verdict = freshYeah === 0 && sharedYeah > 0 ? 'HARNESS_SHARED_STATE'
    : freshYeah > 0 && freshYeah === sharedYeah ? 'MODEL_BEHAVIOUR'
        : 'MIXED_OR_INCONCLUSIVE';
console.log(`\n  shared: ${sharedYeah}/${rows.length} leading "yeah"   fresh: ${freshYeah}/${rows.length}`);
console.log(`  VERDICT: ${verdict}`);
console.log('  NOTE: raw runtime text, captured before any normalization.');

writeFileSync(OUT, `${JSON.stringify({
    probe: '#1304 leading-yeah causal classification',
    verdict, clipCount: rows.length, sharedYeah, freshYeah,
    runtime: '@moonshine-ai/moonshine-wasm', arch: 'MediumStreaming',
    method: 'same clips decoded with one shared transcriber (benchmark condition) vs a fresh transcriber per clip',
    rows,
}, null, 2)}\n`);
console.log(`  artifact: ${OUT}  sha256=${createHash('sha256').update(readFileSync(OUT)).digest('hex')}`);

await context.close(); await browser.close(); await harness.close();
