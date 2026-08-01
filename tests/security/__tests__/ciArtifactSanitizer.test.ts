import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    mergePlaywrightSummaries,
    sanitizeAssemblyAiStreamingFile,
    sanitizeAssemblyAiStreamingProof,
    sanitizeLighthouseDirectory,
    sanitizeLighthouseReports,
    sanitizePlaywrightFile,
    sanitizePlaywrightReport,
    sanitizePrivateExactBufferFile,
    sanitizePrivateExactBufferProof,
} from '../../../scripts/sanitize-ci-artifact.mjs';
import { aggregatePlaywright } from '../../../scripts/aggregate-playwright.mjs';
import { parseLighthouse, parsePlaywrightResults } from '../../../scripts/ci-telemetry-utils.mjs';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), 'speaksharp-ci-sanitizer-'));
    temporaryDirectories.push(directory);
    return directory;
}

function lighthouseReport() {
    const metric = { score: 0.9, numericValue: 123.4 };
    return {
        requestedUrl: 'https://person@example.com/private',
        categories: {
            performance: { score: 0.91, description: 'data:image/png;base64,forbidden' },
            accessibility: { score: 0.95 },
            'best-practices': { score: 0.88 },
            seo: { score: 0.93 },
        },
        audits: {
            'first-contentful-paint': metric,
            'largest-contentful-paint': metric,
            'speed-index': metric,
            'total-blocking-time': metric,
            'cumulative-layout-shift': metric,
            'final-screenshot': { details: { data: 'data:image/jpeg;base64,forbidden' } },
        },
    };
}

function assemblyAiStreamingProof() {
    return {
        model: 'universal-streaming-english',
        chunkMs: 50,
        variants: ['baseline'],
        fixtures: ['h1_6'],
        results: [{
            variant: 'baseline',
            fixture: 'h1_6',
            truth: 'private reference words from person@example.com',
            transcript: 'private recognized words',
            wer: 0.1,
            accuracyPct: 90,
            fillerRecall: 0.75,
            turnCount: 3,
            finalTurnCount: 1,
            partialTurnCount: 2,
            terminationSeen: true,
            messageCount: 4,
            closeCode: 1000,
            closeReason: 'session transcript complete',
            firstMessageRaw: 'data:image/png;base64,forbidden',
            invalidSession: false,
            invalidReason: null,
            concurrencyRetries: 0,
        }],
    };
}

function privateExactBufferProof() {
    const audioDataUrl = `data:audio/wav;base64,${Buffer.from('fixture audio bytes').toString('base64')}`;
    return {
        environmentProof: {
            url: 'http://person@example.com/session',
            authMode: 'real',
            mockAuth: false,
            releaseProofEligible: true,
            cdpSameTab: true,
        },
        privateEngine: 'transformers-js',
        webgpuDisabledForRun: true,
        injectedMicAudio: { enabled: true, route: 'private fixture route' },
        runnerPass: true,
        gatePass: true,
        pass: true,
        results: [{
            mode: 'private',
            fixture: 'h1_6',
            truth: 'private reference words',
            transcript: 'private recognized words',
            selectedForSaveTranscript: 'private recognized words',
            wordCount: 3,
            wer: 0.1,
            accuracyPct: 90,
            selectedForSaveWer: 0.1,
            selectedForSaveAccuracyPct: 90,
            sessionPersisted: true,
            historyVisible: true,
            detailVisible: true,
            journeyPass: true,
            inputLikelyContaminated: false,
            fillerPass: true,
            meetsWerThreshold: true,
            privateRuntime: 'transformers-js-v2',
            privateProvider: 'wasm',
            privateWebgpuAvailable: false,
            privateCrossOriginIsolated: true,
            privateWasmThreadCount: 4,
            privateCloudFallbackAttempted: false,
            audioFrameStats: { count: 25, maxRms: 0.4, speechFrames: 20 },
            privateAudioChunks: [{
                samples: 16000,
                durationSec: 1,
                wavDataUrlBytes: audioDataUrl.length,
                wavDataUrl: audioDataUrl,
                transcript: 'private recognized words',
            }],
            privateUtteranceAudioChunks: [{
                samples: 16000,
                durationSec: 1,
                wavDataUrlBytes: audioDataUrl.length,
                wavDataUrl: audioDataUrl,
            }],
            rtf: {
                canonicalRtf: 0.2,
                capturedAudioMs: 1000,
                finalizeDecodeMs: 200,
                totalFinalizeMs: 240,
                firstTextMs: 320,
                rtfDefinition: 'private diagnostic definition',
            },
            auth: { email: 'person@example.com' },
        }],
    };
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('#1132 CI artifact sanitization', () => {
    it('allowlists Playwright metrics and excludes emails, identifiers, content, and embedded media', () => {
        const raw = {
            stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0, total: 1 },
            tests: [{
                id: 'account-550e8400-e29b-41d4-a716-446655440000',
                title: 'signs in person@example.com',
                status: 'passed',
                outcome: 'expected',
                retries: 0,
                duration: 25,
                retryOverheadMs: 0,
                attempts: 1,
                error: 'transcript: private words',
                attachments: [{ body: 'data:image/png;base64,forbidden' }],
            }],
        };

        const sanitized = sanitizePlaywrightReport(raw, 2);
        const serialized = JSON.stringify(sanitized);
        expect(sanitized).toEqual({
            schemaVersion: 1,
            kind: 'playwright-shard-summary',
            shard: 2,
            stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0, total: 1 },
            tests: [{
                status: 'passed',
                outcome: 'expected',
                retries: 0,
                duration: 25,
                retryOverheadMs: 0,
                attempts: 1,
            }],
        });
        expect(serialized).not.toMatch(/person@example\.com|550e8400|transcript|data:image|base64/i);
    });

    it('allowlists Lighthouse categories and metrics while excluding raw reports and screenshots', () => {
        const sanitized = sanitizeLighthouseReports([lighthouseReport()]);
        const serialized = JSON.stringify(sanitized);
        expect(sanitized.reports[0].categories).toEqual({
            performance: 0.91,
            accessibility: 0.95,
            bestPractices: 0.88,
            seo: 0.93,
        });
        expect(Object.keys(sanitized.reports[0].metrics)).toEqual([
            'first-contentful-paint',
            'largest-contentful-paint',
            'speed-index',
            'total-blocking-time',
            'cumulative-layout-shift',
        ]);
        expect(serialized).not.toMatch(/person@example\.com|requestedUrl|final-screenshot|data:image|base64/i);
    });

    it('allowlists AssemblyAI metrics while excluding transcripts, provider payloads, and identifiers', () => {
        const sanitized = sanitizeAssemblyAiStreamingProof(assemblyAiStreamingProof());
        const serialized = JSON.stringify(sanitized);

        expect(sanitized).toMatchObject({
            kind: 'assemblyai-streaming-metrics-summary',
            model: 'universal-streaming-english',
            fixtureCount: 1,
            resultCount: 1,
            results: [{
                variant: 'baseline',
                fixtureOrdinal: 1,
                status: 'measured',
                wer: 0.1,
                accuracyPct: 90,
            }],
        });
        expect(serialized).not.toMatch(/person@example\.com|truth|transcript|closeReason|firstMessageRaw|data:image|base64/i);
    });

    it('hashes Private exact-buffer audio while excluding raw audio, transcripts, and account content', () => {
        const sanitized = sanitizePrivateExactBufferProof(privateExactBufferProof());
        const serialized = JSON.stringify(sanitized);

        expect(sanitized).toMatchObject({
            kind: 'private-exact-app-buffer-summary',
            environment: { releaseProofEligible: true, authMode: 'real' },
            runner: { runnerPass: true, gatePass: true, pass: true, resultCount: 1 },
            results: [{
                mode: 'private',
                journeyPass: true,
                inferenceAudio: {
                    chunkCount: 1,
                    totalSamples: 16000,
                    totalDurationSec: 1,
                },
            }],
        });
        expect(sanitized.results[0].inferenceAudio.audioSha256[0]).toMatch(/^[a-f0-9]{64}$/);
        expect(serialized).not.toMatch(/person@example\.com|truth|transcript|wavDataUrl|data:audio|base64|fixture audio bytes/i);
    });

    it('removes stale output and fails closed when sanitization input is missing or malformed', () => {
        const directory = temporaryDirectory();
        const playwrightOutput = join(directory, 'playwright-summary.json');
        writeFileSync(playwrightOutput, '{"stale":true}\n');
        expect(() => sanitizePlaywrightFile(join(directory, 'missing.json'), playwrightOutput, 1)).toThrow(/missing/);
        expect(() => readFileSync(playwrightOutput, 'utf8')).toThrow();

        const lighthouseDirectory = join(directory, 'lighthouse');
        const lighthouseOutput = join(directory, 'lighthouse-summary.json');
        mkdirSync(lighthouseDirectory);
        writeFileSync(lighthouseOutput, '{"stale":true}\n');
        writeFileSync(join(lighthouseDirectory, 'invalid-report.json'), '{"categories":{}}\n');
        expect(() => sanitizeLighthouseDirectory(lighthouseDirectory, lighthouseOutput)).toThrow(/No valid Lighthouse/);
        expect(() => readFileSync(lighthouseOutput, 'utf8')).toThrow();

        const assemblyAiOutput = join(directory, 'assemblyai-summary.json');
        writeFileSync(assemblyAiOutput, '{"stale":true}\n');
        expect(() => sanitizeAssemblyAiStreamingFile(join(directory, 'missing-assemblyai.json'), assemblyAiOutput)).toThrow(/missing/);
        expect(() => readFileSync(assemblyAiOutput, 'utf8')).toThrow();

        const exactBufferInput = join(directory, 'exact-buffer.json');
        const exactBufferOutput = join(directory, 'exact-buffer-summary.json');
        writeFileSync(exactBufferInput, JSON.stringify({ ...privateExactBufferProof(), results: [] }));
        writeFileSync(exactBufferOutput, '{"stale":true}\n');
        expect(() => sanitizePrivateExactBufferFile(exactBufferInput, exactBufferOutput)).toThrow(/results are missing/);
        expect(() => readFileSync(exactBufferOutput, 'utf8')).toThrow();
    });

    it('preserves aggregate CI counts and Lighthouse scores without restoring excluded fields', () => {
        const directory = temporaryDirectory();
        const first = sanitizePlaywrightReport({
            tests: [{ status: 'passed', outcome: 'expected', retries: 0, duration: 20, retryOverheadMs: 0, attempts: 1 }],
        }, 1);
        const second = sanitizePlaywrightReport({
            tests: [{ status: 'passed', outcome: 'flaky', retries: 1, duration: 35, retryOverheadMs: 10, attempts: 2 }],
        }, 2);
        const merged = mergePlaywrightSummaries([second, first]);
        const playwrightDirectory = join(directory, 'test-results', 'playwright');
        mkdirSync(playwrightDirectory, { recursive: true });
        const playwrightPath = join(playwrightDirectory, 'results.json');
        writeFileSync(playwrightPath, JSON.stringify(merged));

        expect(aggregatePlaywright(playwrightPath)).toMatchObject({
            totalDurationMs: 55,
            retryOverheadMs: 10,
            testCount: 2,
        });
        expect(parsePlaywrightResults(directory)).toMatchObject({
            passed: 1,
            flaky: 1,
            failed: 0,
            total: 2,
        });

        const lighthouseDirectory = join(directory, 'artifacts', 'lighthouse');
        mkdirSync(lighthouseDirectory, { recursive: true });
        writeFileSync(
            join(lighthouseDirectory, 'lighthouse-summary.json'),
            JSON.stringify(sanitizeLighthouseReports([lighthouseReport()])),
        );
        expect(parseLighthouse(directory)).toEqual({
            performance: 91,
            accessibility: 95,
            bestPractices: 88,
            seo: 93,
        });
    });
});
