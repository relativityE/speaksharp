#!/usr/bin/env tsx
/**
 * #1263 — THE PRODUCT ENGINE, ON THE REAL RUNTIME.
 *
 * Every test in MoonshineStreamingEngine.test.ts injects a fake transcriber. That is the right shape for
 * lifecycle rules, and it is worthless for three questions, because a fake answers all of them by
 * construction:
 *
 *   1. Does the DEFAULT loader actually load? The injected path never touches `Transcriber.load`, never
 *      touches the runtime's `ModelArch` enum, and never fetches a byte. It hid a real defect: the
 *      loader indexed the enum with our own token and passed `undefined`.
 *   2. Is the three-second live window a DIFFERENT transcript from the final full-buffer pass? Against a
 *      fake returning `len:${audio.length}` the two differ trivially and prove nothing about decoding.
 *   3. Does recorded audio stay on the device? A fake makes no requests, so an egress assertion around
 *      it asserts nothing.
 *
 * This probe answers them on the real runtime with real speech, and writes an artifact.
 *
 * IT IS NOT A CI TEST. The pinned weights live in a 448 MB local `.hf-cache/external`, which CI does not
 * have; a test that silently skips when its evidence is absent is worse than no test. The CI-runnable
 * part of this defect surface is `moonshineArchBinding.test.ts`, which binds to the real enum without
 * downloading anything.
 *
 *   usage: npx tsx scripts/probe-moonshine-engine-runtime.mts \
 *            [--cache=/path/to/repo/with/.hf-cache] [--out=report.json] [--fixtures=washington_01,h1_1,…]
 *
 * #1263 LONG-AUDIO MODE (`--fixtures=`). The named committed clips under tests/fixtures/stt-isomorphic/audio
 * are JOINED, in order, into one take of different speech and fed at microphone pace. Joined, never looped:
 * looped input honestly produces a looped transcript, which is indistinguishable from a model loop. The take
 * is checked for a stable live prefix, no repetition loop, a preserved opening and tail, and exactly one
 * forced final inference that a later facade commit reuses. A detected loop FAILS the row as
 * `repetition_loop`; the raw engine output is recorded as produced and is never collapsed or relabelled.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, type Request as PwRequest } from '@playwright/test';
import { startHarnessServer } from '../tests/evidence/certification/browser/server';
import { detectRepetitionRisk } from '../frontend/src/utils/repetitionRisk';
import { WASHINGTON_01 } from '../tests/fixtures/stt-isomorphic/washington-speeches';
import { HARVARD_SENTENCES } from '../tests/fixtures/stt-isomorphic/harvard-sentences';

const arg = (name: string, fallback = ''): string =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;

const ARCH = arg('arch', 'MOONSHINE_STREAMING_MEDIUM');
/**
 * The engine FAILS CLOSED on an identity the registry does not describe, so the probe runs as the
 * registered candidate. The old free-string id (`probe-engine-runtime`) is refused before any weights load.
 */
const CANDIDATE_BY_ARCH: Record<string, string> = { MOONSHINE_STREAMING_MEDIUM: 'moonshine:streaming-medium' };
const CANDIDATE_ID = CANDIDATE_BY_ARCH[ARCH];
if (!CANDIDATE_ID) {
    console.error(`no registered candidate for ${ARCH}; registered: ${Object.keys(CANDIDATE_BY_ARCH).join(', ')}`);
    process.exit(2);
}
const OUT = arg('out', 'product_release/evidence/retained/moonshine-engine-runtime.json');
const FIXTURE_NAMES = arg('fixtures').split(',').map((s) => s.trim()).filter(Boolean);
const LONGFORM = FIXTURE_NAMES.length > 0;
/**
 * Silence appended after the last clip, as a speaker's pause before pressing Stop. Default 0 so a run is the
 * committed bytes only; a nonzero value is a DECLARED variant and is recorded in the artifact.
 */
const TRAILING_SILENCE_MS = Number(arg('trailing-silence-ms', '0'));
if (!Number.isFinite(TRAILING_SILENCE_MS) || TRAILING_SILENCE_MS < 0) {
    console.error(`--trailing-silence-ms must be a non-negative number`);
    process.exit(2);
}
/** Committed references for the long-audio clips. Public fixtures only — never the PO-held RWT corpus. */
const REFERENCES: Record<string, string> = {
    washington_01: WASHINGTON_01.transcript,
    ...Object.fromEntries(HARVARD_SENTENCES.map((s) => [s.id, s.transcript])),
};
const FIXTURE_PATHS = LONGFORM
    ? FIXTURE_NAMES.map((n) => `tests/fixtures/stt-isomorphic/audio/${n}.wav`)
    : ['tests/fixtures/harvard_sentences_16k.wav'];
for (const p of FIXTURE_PATHS) {
    if (!existsSync(p)) { console.error(`missing fixture ${p}`); process.exit(2); }
}
for (const n of FIXTURE_NAMES) {
    if (!REFERENCES[n]) { console.error(`no committed reference for ${n}; long-audio checks need one`); process.exit(2); }
}
const FIXTURE_URLS = FIXTURE_PATHS.map((p) => `/${p.replace(/^tests\//, '')}`);
const REPO = resolve('.');

/**
 * The pinned component cache is not in this worktree. Rather than symlink it into the tree — a
 * committed node_modules symlink has broken this repo's CI before — the probe is told where it is and
 * REFUSES to run without it. Falling back to the network would silently convert a pinned run into an
 * unpinned one, which is the failure the pin table exists to prevent.
 */
const CACHE_REPO = resolve(arg('cache', REPO));
const EXTERNAL = join(CACHE_REPO, '.hf-cache', 'external');
if (!existsSync(EXTERNAL)) {
    console.error(`no pinned component cache at ${EXTERNAL}\n`
        + 'pass --cache=<repo containing .hf-cache/external>. This probe will not fall back to the network.');
    process.exit(2);
}

const pinTable = JSON.parse(readFileSync('frontend/src/services/transcription/moonshineAssetPins.json', 'utf8')) as {
    runtimeVersion: string; componentSet: string;
    assets: Record<string, { sha256: string; bytes: number }>;
};

/** Bundle the ACTUAL product module. Not a copy, not a reimplementation — the file that ships. */
const BUNDLE = 'tests/evidence/certification/browser/engine.bundle.js';
await build({
    entryPoints: ['frontend/src/services/transcription/engines/MoonshineStreamingEngine.ts'],
    bundle: true, format: 'esm', outfile: BUNDLE, platform: 'browser', keepNames: true,
    // The runtime stays EXTERNAL so the page's import map resolves it exactly as the browser would in
    // production. Inlining it here would test a bundle nobody ships.
    external: ['@moonshine-ai/moonshine-wasm'],
});
const bundleDigest = createHash('sha256').update(readFileSync(BUNDLE)).digest('hex');

/**
 * A second, tiny origin for the PINNED COMPONENTS ONLY.
 *
 * The harness serves `/external/` out of the repo it was given, and the component cache is in a
 * different worktree. The alternatives were both worse: symlinking `.hf-cache` into this tree risks the
 * committed-symlink failure that has broken this repo's CI before, and fulfilling the bytes through
 * Playwright's automation channel has killed the page on model-sized files twice already.
 *
 * This server only ever serves a path that has ALREADY been digest-verified against the committed pin
 * table by the route handler below; it does no verification of its own and must not be trusted to.
 */
const componentServer = createServer((req, res) => {
    const key = decodeURIComponent((req.url ?? '').replace(/^\/+/, '').replace(/[?#].*$/, ''));
    const file = join(EXTERNAL, key);
    if (!file.startsWith(EXTERNAL) || !verifiedKeys.has(key) || !existsSync(file)) {
        res.writeHead(404, { 'access-control-allow-origin': '*' });
        res.end('not verified');
        return;
    }
    res.writeHead(200, {
        'content-type': key.endsWith('.json') ? 'application/json' : 'application/octet-stream',
        'access-control-allow-origin': '*',
        'cross-origin-resource-policy': 'cross-origin',
        'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
});
await new Promise<void>((done) => componentServer.listen(0, '127.0.0.1', done));
const componentOrigin = `http://127.0.0.1:${(componentServer.address() as { port: number }).port}`;

const harness = await startHarnessServer(REPO, { mode: 'pinned', offlineOnly: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();

/**
 * EGRESS LEDGER. Every request the page makes, recorded before it is allowed anywhere. Audio leaving the
 * device is the one failure that cannot be walked back after release, so the assertion is not "no
 * request looked like an upload" but "every request is on the allowlist, and no request carried a body".
 */
type Egress = { url: string; method: string; resourceType: string; bodyBytes: number; disposition: string };
const egress: Egress[] = [];
const pinViolations: { url: string; reason: string }[] = [];
/** Keys whose bytes matched the committed pin. The component origin serves nothing else. */
const verifiedKeys = new Set<string>();
const bodyBytesOf = (request: PwRequest): number => {
    const body = request.postDataBuffer();
    return body ? body.length : 0;
};

await context.route(() => true, async (route) => {
    const request = route.request();
    const url = request.url();
    const bodyBytes = bodyBytesOf(request);

    if (url.startsWith(harness.origin) || url.startsWith(componentOrigin) || url.startsWith('data:') || url.startsWith('blob:')) {
        egress.push({ url, method: request.method(), resourceType: request.resourceType(), bodyBytes, disposition: 'local' });
        return route.continue();
    }
    // Anything else is the open internet. It is served from the verified local cache or it is aborted.
    const key = url.replace(/^https?:\/\//, '').replace(/[?#].*$/, '');
    const pin = pinTable.assets[key];
    const cached = join(EXTERNAL, key);
    if (!pin) { pinViolations.push({ url, reason: 'unpinned' }); egress.push({ url, method: request.method(), resourceType: request.resourceType(), bodyBytes, disposition: 'aborted:unpinned' }); return route.abort(); }
    if (!existsSync(cached)) { pinViolations.push({ url, reason: 'missing_local' }); egress.push({ url, method: request.method(), resourceType: request.resourceType(), bodyBytes, disposition: 'aborted:missing_local' }); return route.abort(); }
    const digest = createHash('sha256').update(readFileSync(cached)).digest('hex');
    if (digest !== pin.sha256) { pinViolations.push({ url, reason: 'digest_mismatch' }); egress.push({ url, method: request.method(), resourceType: request.resourceType(), bodyBytes, disposition: 'aborted:digest_mismatch' }); return route.abort(); }
    egress.push({ url, method: request.method(), resourceType: request.resourceType(), bodyBytes, disposition: 'pinned_asset' });
    verifiedKeys.add(key);
    // Redirect rather than fulfil: pushing hundreds of MB through the automation channel kills the page.
    await route.fulfill({ status: 302, headers: { location: `${componentOrigin}/${key}`, 'access-control-allow-origin': '*' } });
});

/**
 * esbuild's `--keep-names` helper, installed before any script runs.
 *
 * tsx compiles this file — including the string handed to page.evaluate — with keepNames, so the
 * evaluated function references `__name` in a page that has never defined it. The published Moonshine
 * ESM has the same gap (its bundler was expected to inject the helper). One definition covers both.
 */
await context.addInitScript(() => {
    const g = globalThis as unknown as { __name?: (t: unknown, v?: unknown) => unknown };
    g.__name ??= (target) => target;
});

const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.error(`  page error: ${m.text().slice(0, 200)}`); });
await page.goto(`${harness.origin}/engine-runtime.html`);
await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);

console.log(`\n#1263 engine runtime probe — arch=${ARCH}, runtime@${pinTable.runtimeVersion}, components=${pinTable.componentSet}`);
console.log(`fixtures: ${FIXTURE_PATHS.join(' + ')}${LONGFORM ? '  (long-audio mode, microphone pace)' : ''}`);

const outcome = await page.evaluate(async (input) => {
    const w = window as unknown as {
        __readPcm16: (u: string) => Promise<{ samples: Float32Array; sampleRate: number; seconds: number }>;
        __fixtureMic: (s: Float32Array, r: number) => { stream: unknown; emit: (at: number, sec: number) => number };
    };
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
        const mod = await import(input.bundleUrl) as {
            MoonshineStreamingEngine: new (o: Record<string, unknown>) => {
                init: () => Promise<{ isOk: boolean; error?: Error }>;
                start: (m: unknown) => Promise<void>;
                stop: () => Promise<void>;
                transcribe: (a: Float32Array, o?: { final?: boolean }) => Promise<{ isOk: boolean; data?: string }>;
                getTranscript: () => Promise<string>;
                getInterimTranscript: () => string;
                getMetadata: () => Record<string, unknown>;
                terminate: () => Promise<void>;
            };
            LIVE_WINDOW_SECONDS: number;
            FORCE_UPDATE: number;
        };
        // One take of DIFFERENT speech: the clips are joined end to end, each exactly once.
        const clips = await Promise.all(input.fixtureUrls.map((u) => w.__readPcm16(u)));
        const sampleRate = clips[0].sampleRate;
        if (clips.some((c) => c.sampleRate !== sampleRate)) throw new Error('fixtures disagree on sample rate');
        const silenceSamples = Math.round((input.trailingSilenceMs / 1000) * sampleRate);
        // Float32Array is zero-filled, so the declared trailing silence is the unset tail.
        const joined = new Float32Array(clips.reduce((n, c) => n + c.samples.length, 0) + silenceSamples);
        let offset = 0;
        for (const c of clips) { joined.set(c.samples, offset); offset += c.samples.length; }
        const audio = { samples: joined, sampleRate, seconds: joined.length / sampleRate };

        const progress: number[] = [];
        // NO loadTranscriber: the DEFAULT loader runs, which is the whole point.
        const engine = new mod.MoonshineStreamingEngine({
            candidateId: input.candidateId,
            modelArch: input.arch,
            onDownloadProgress: (f: number) => progress.push(f),
        });

        const t0 = performance.now();
        const init = await engine.init();
        const loadMs = performance.now() - t0;
        if (!init.isOk) return { ok: false as const, stage: 'init', error: String(init.error?.message ?? 'init failed'), progressCount: progress.length };

        // INFERENCE LEDGER. Counts every stream the runtime opens and every pass made on one, split into live
        // passes and FORCED passes. It wraps the runtime's objects, so the engine code under test is untouched.
        //
        // The runtime's own `stream.stop()` runs one more forced pass internally ("flush a final transcription so
        // any trailing line is completed"). The engine calls stop() only AFTER it has committed its single forced
        // result, so that flush is discarded — real compute, but not a second inference that replaces the final.
        // It is counted apart, as `runtimeStopFlushPasses`, so it is neither hidden nor mistaken for one.
        const ledger = { streams: 0, livePasses: 0, forcedPasses: 0, runtimeStopFlushPasses: 0 };
        type RuntimeStream = { transcribe: (flags?: number) => unknown; stop: () => void };
        const runtime = (engine as unknown as { transcriber: { createStream: () => RuntimeStream } }).transcriber;
        const openStream = runtime.createStream.bind(runtime);
        runtime.createStream = () => {
            ledger.streams += 1;
            const stream = openStream();
            const pass = stream.transcribe.bind(stream);
            const stopStream = stream.stop.bind(stream);
            let inRuntimeStop = false;
            stream.transcribe = (flags?: number) => {
                if (inRuntimeStop) ledger.runtimeStopFlushPasses += 1;
                else if (flags === mod.FORCE_UPDATE) ledger.forcedPasses += 1;
                else ledger.livePasses += 1;
                return pass(flags);
            };
            stream.stop = () => {
                inRuntimeStop = true;
                try { return stopStream(); } finally { inRuntimeStop = false; }
            };
            return stream;
        };

        const mic = w.__fixtureMic(audio.samples, audio.sampleRate);
        await engine.start(mic.stream);

        // Feed the fixture as half-second frames, as a microphone would. The live window is only
        // exercised when audio arrives OVER TIME. Long-audio mode feeds at MICROPHONE PACE: how far the live
        // passes fall behind over a long take is part of what is being measured, and a fast feed hides it.
        let fed = 0;
        let interimAtWindow = '';
        let fedAtWindow = 0;
        const snapshots: { fed: number; text: string }[] = [];
        let nextSnapshotAt = 5;
        while (fed < audio.seconds) {
            fed += mic.emit(fed, 0.5);
            await sleep(input.longform ? 500 : 60);
            if (input.longform && fed >= nextSnapshotAt) {
                snapshots.push({ fed, text: engine.getInterimTranscript() });
                nextSnapshotAt += 5;
            }
            // Capture the live transcript once enough audio exists to fill the window but well before
            // the clip ends, so a window transcript and a full transcript are genuinely different spans.
            if (!interimAtWindow && fed >= mod.LIVE_WINDOW_SECONDS + 1) {
                for (let i = 0; i < 40 && !engine.getInterimTranscript(); i++) await sleep(250);
                interimAtWindow = engine.getInterimTranscript();
                fedAtWindow = fed;
            }
        }
        // Let any in-flight live decode settle so the interim reflects the whole fed buffer.
        for (let i = 0; i < 40 && !engine.getInterimTranscript(); i++) await sleep(250);
        const interimAtEnd = engine.getInterimTranscript();

        const t1 = performance.now();
        await engine.stop();
        const finalMs = performance.now() - t1;
        const final = await engine.getTranscript();
        const ledgerAfterStop = { ...ledger };
        // THE FACADE COMMIT AFTER STOP. The shipping order can reach a commit decode once the session has
        // already finalized; it must hand back the committed transcript, never a second whole-buffer inference.
        const commit = await engine.transcribe(audio.samples, { final: true });
        const ledgerAfterCommit = { ...ledger };
        const metadata = engine.getMetadata();
        await engine.terminate();

        return {
            ok: true as const, loadMs, finalMs, audioSeconds: audio.seconds, sampleRate: audio.sampleRate,
            liveWindowSeconds: mod.LIVE_WINDOW_SECONDS,
            interimAtWindow, fedAtWindow, interimAtEnd, final, metadata, snapshots,
            commitText: commit.isOk ? (commit.data ?? '') : null, ledgerAfterStop, ledgerAfterCommit,
            progressCount: progress.length, progressMax: progress.length ? Math.max(...progress) : null,
        };
    } catch (error) {
        return { ok: false as const, stage: 'run', error: (error as Error)?.message?.slice(0, 400) ?? String(error), progressCount: 0 };
    }
}, { bundleUrl: '/engine.bundle.js', fixtureUrls: FIXTURE_URLS, arch: ARCH, candidateId: CANDIDATE_ID, longform: LONGFORM, trailingSilenceMs: TRAILING_SILENCE_MS });

const words = (s: string): string[] => s.trim().toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);

/** Occurrences of a word sequence in a word list. */
const occurrences = (hay: string[], needle: string[]): number => {
    let count = 0;
    for (let i = 0; needle.length > 0 && i + needle.length <= hay.length; i++) {
        if (needle.every((word, j) => hay[i + j] === word)) count++;
    }
    return count;
};
/** Is `needle` present, in order, within `hay` (other words may sit between)? */
const containsInOrder = (hay: string[], needle: string[]): boolean => {
    let j = 0;
    for (const word of hay) { if (word === needle[j]) j++; if (j === needle.length) return true; }
    return needle.length === 0;
};

/**
 * A REPETITION LOOP, as the saved-transcript detector reports it — with one exclusion that keeps a row from
 * failing on real speech: a recurring 4-word span that the committed references themselves contain twice was
 * genuinely spoken twice. Adjacent loops and whole-text doubling are never excused.
 */
const referenceWords = FIXTURE_NAMES.flatMap((n) => words(REFERENCES[n]));
const loopIn = (text: string): { reason: string; span: string | null } | null => {
    const risk = detectRepetitionRisk(text);
    if (!risk.repetitionRisk) return null;
    if (risk.repetitionRiskReason === 'repeated_span') {
        const span = /"([^"]+)"/.exec(risk.repeatedSpanSummary ?? '')?.[1] ?? '';
        if (span && occurrences(referenceWords, words(span)) >= 2) return null;
    }
    return { reason: risk.repetitionRiskReason ?? 'unknown', span: risk.repeatedSpanSummary };
};
const audioEgress = egress.filter((e) => e.bodyBytes > 0);
const offOrigin = egress.filter((e) => e.disposition !== 'local');

let verdict: 'pass' | 'fail' = 'fail';
/** The row's disposition. A loop is named as a loop, never folded into a generic fail or into success. */
let rowDisposition: 'pass' | 'fail' | 'repetition_loop' | 'run_failed' = 'run_failed';
const findings: string[] = [];
let longform: Record<string, unknown> | null = null;

if (!outcome.ok) {
    findings.push(`FAIL ${outcome.stage}: ${outcome.error}`);
} else {
    const w0 = words(outcome.interimAtWindow), wEnd = words(outcome.interimAtEnd), wFin = words(outcome.final);
    const observed = outcome.metadata.observedExecution as { initSucceeded?: boolean } | undefined;
    const checks: [string, boolean, string][] = [
        ['default loader produced a transcriber', observed?.initSucceeded === true, 'init returned ok'],
        ['live window decoded real speech', w0.length > 0, `${w0.length} words after ${outcome.fedAtWindow.toFixed(1)}s fed`],
        ['final pass decoded real speech', wFin.length > 0, `${wFin.length} words`],
        // THE COMPARISON THAT MATTERS. A 3-second window over a 12-second clip cannot contain the whole
        // clip; if it does, the engine is not windowing and the "live" path is a full-buffer decode.
        ['window transcript is SHORTER than the final', w0.length > 0 && w0.length < wFin.length, `${w0.length} vs ${wFin.length} words`],
        ['window transcript is not the final transcript', outcome.interimAtWindow !== outcome.final, ''],
        // A 12s clip against a 3s window: the full pass should carry several times the window's words.
        // Stated as a ratio rather than an exact count, because the transcript is a model output.
        ['final carries substantially more than one window', wFin.length >= w0.length * 2, `final ${wFin.length}, window ${w0.length}, last-window ${wEnd.length}`],
        ['NO request carried a body — recorded audio never left the device', audioEgress.length === 0, `${audioEgress.length} bodied requests`],
        ['every off-origin request was a PINNED asset', offOrigin.every((e) => e.disposition === 'pinned_asset'), `${offOrigin.length} off-origin`],
        ['zero pin violations', pinViolations.length === 0, JSON.stringify(pinViolations.slice(0, 3))],
        ['download progress was reported', outcome.progressCount > 0, `${outcome.progressCount} callbacks`],
    ];

    let loopDetected = false;
    if (LONGFORM) {
        // STABLE PREFIX. Each live snapshot, less its most recent words (the part a later pass may still
        // revise), must survive unchanged at the head of the next snapshot and of the final transcript.
        const PREFIX_SLACK_WORDS = 12;
        const sequence = [...outcome.snapshots, { fed: outcome.audioSeconds, text: outcome.final }];
        const prefixBreaks: { atFed: number; firstDifferentWord: number; settledWords: number }[] = [];
        for (let i = 1; i < sequence.length; i++) {
            const prev = words(sequence[i - 1].text), cur = words(sequence[i].text);
            const settled = prev.slice(0, Math.max(0, prev.length - PREFIX_SLACK_WORDS));
            const firstDifferentWord = settled.findIndex((word, j) => cur[j] !== word);
            if (firstDifferentWord !== -1) prefixBreaks.push({ atFed: sequence[i].fed, firstDifferentWord, settledWords: settled.length });
        }

        const finalLoop = loopIn(outcome.final);
        const liveLoops = outcome.snapshots
            .map((s) => ({ fed: s.fed, loop: loopIn(s.text) }))
            .filter((s) => s.loop !== null);
        loopDetected = finalLoop !== null || liveLoops.length > 0;

        const EDGE_WORDS = 4, SEARCH_WORDS = 15;
        const opening = words(REFERENCES[FIXTURE_NAMES[0]]).slice(0, EDGE_WORDS);
        const tail = words(REFERENCES[FIXTURE_NAMES[FIXTURE_NAMES.length - 1]]).slice(-EDGE_WORDS);
        const openingKept = containsInOrder(wFin.slice(0, SEARCH_WORDS), opening);
        const tailKept = containsInOrder(wFin.slice(-SEARCH_WORDS), tail);

        const { ledgerAfterStop: stopLedger, ledgerAfterCommit: commitLedger } = outcome;
        checks.push(
            ['live snapshots were captured across the whole take', outcome.snapshots.length >= Math.floor(outcome.audioSeconds / 5) - 1,
                `${outcome.snapshots.length} snapshots over ${outcome.audioSeconds.toFixed(1)}s`],
            ['stable prefix — settled live text is never rewritten by a later pass', prefixBreaks.length === 0,
                prefixBreaks.length ? JSON.stringify(prefixBreaks.slice(0, 3)) : `${sequence.length - 1} transitions, slack ${PREFIX_SLACK_WORDS} words`],
            ['NO repetition loop in the final transcript (raw engine output, unsanitized)', finalLoop === null,
                finalLoop ? `${finalLoop.reason}: ${finalLoop.span}` : ''],
            ['NO repetition loop in any live snapshot', liveLoops.length === 0,
                liveLoops.length ? JSON.stringify(liveLoops.slice(0, 3)) : ''],
            ['opening preserved', openingKept, `"${opening.join(' ')}" within the first ${SEARCH_WORDS} words`],
            ['tail preserved', tailKept, `"${tail.join(' ')}" within the last ${SEARCH_WORDS} words`],
            ['exactly ONE forced final inference, on the session stream', stopLedger.forcedPasses === 1 && stopLedger.streams === 1,
                JSON.stringify(stopLedger)],
            ['a facade commit after stop returns the final — no second inference', outcome.commitText === outcome.final
                && commitLedger.forcedPasses === stopLedger.forcedPasses && commitLedger.streams === stopLedger.streams,
                JSON.stringify(commitLedger)],
        );
        longform = {
            fixtures: FIXTURE_NAMES, prefixSlackWords: PREFIX_SLACK_WORDS, prefixBreaks,
            finalLoop, liveLoops, opening, tail, openingKept, tailKept,
            finalWords: wFin.length, referenceWords: referenceWords.length,
        };
    }

    for (const [name, ok, detail] of checks) findings.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
    verdict = checks.every(([, ok]) => ok) ? 'pass' : 'fail';
    rowDisposition = loopDetected ? 'repetition_loop' : verdict;
}

for (const f of findings) console.log(`  ${f}`);
if (outcome.ok) {
    console.log(`\n  window  (${outcome.fedAtWindow.toFixed(1)}s fed): ${JSON.stringify(outcome.interimAtWindow)}`);
    console.log(`  final  (${outcome.audioSeconds.toFixed(2)}s clip): ${JSON.stringify(outcome.final)}`);
    console.log(`  metadata: ${JSON.stringify(outcome.metadata)}`);
}
console.log(`  row disposition: ${rowDisposition}`);
console.log(`\n  verdict: ${verdict.toUpperCase()}  (${egress.length} requests, ${offOrigin.length} off-origin, ${audioEgress.length} with a body)`);

const report = {
    probe: '#1263 moonshine engine on the real runtime',
    verdict, rowDisposition, arch: ARCH, candidateId: CANDIDATE_ID, trailingSilenceMs: TRAILING_SILENCE_MS,
    runtimePackage: '@moonshine-ai/moonshine-wasm', runtimeVersion: pinTable.runtimeVersion,
    componentSet: pinTable.componentSet,
    engineSource: 'frontend/src/services/transcription/engines/MoonshineStreamingEngine.ts',
    bundleSha256: bundleDigest,
    fixtures: FIXTURE_PATHS.map((path) => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })),
    findings, longform, outcome,
    egress: { total: egress.length, offOrigin: offOrigin.length, withBody: audioEgress.length, requests: egress },
    pinViolations,
    harnessRuntimeFailures: harness.runtimeFailures,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(`  artifact: ${OUT}  sha256=${createHash('sha256').update(readFileSync(OUT)).digest('hex')}`);

await context.close();
await browser.close();
await harness.close();
await new Promise<void>((done) => { componentServer.close(() => done()); });
process.exit(verdict === 'pass' ? 0 : 1);
