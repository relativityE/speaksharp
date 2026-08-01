// @vitest-environment node
/**
 * #1037 — the offline validator (`scripts/validate-stt-evidence.mjs`) is the runtime boundary for
 * ARBITRARY JSON artifacts, so it must independently enforce the browser_journey contract, not trust that
 * a producer built the row honestly. These tests feed crafted artifacts directly to the validator.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const VALIDATOR = fileURLToPath(new URL('../../../scripts/validate-stt-evidence.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

function browserRow(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        comparability_class: 'browser_journey', engine: 'browser-webspeech',
        engine_version: 'web-speech-api/system-chrome', model_name: 'browser-managed-unreported',
        attribution_status: 'unverified', browser: 'Google Chrome', browser_version: '148.0',
        os: 'macOS 15.0', device: 'arm64 desktop', network_condition: 'unreported',
        fixture_id: 'browser-system-tts-v1', audio_route_proven: false, run_validity: 'valid',
        invalid_reason: null, wer: null, first_partial_latency_ms: 120, finalization_latency_ms: 800,
        failure_class: 'none', release_sha: 'a'.repeat(40),
        audio_route_evidence: { fixtureSha256: '', adapterInputPayloadSha256: '', adapterInputBytes: 0, decodedSampleCount: 0, decodedDurationSeconds: 0 },
        runtime_capability: { requestedThreads: null, configuredThreads: null, workerReportedThreads: null, runtimePath: 'browser-webspeech', crossOriginIsolated: false, sharedArrayBufferAvailable: false, fallbackReason: null },
        comparability_inputs: { fixtureHash: '', groundTruthVersion: 'not-scored', normalizationVersion: 'not-scored', decodeConfiguration: 'system-chrome/web-speech/browser-managed/live-mic', modelRevision: 'browser-managed-unreported-v1', runtimeVersions: { chrome: '148.0', 'web-speech-api': 'browser-managed' } },
        browser_journey_evidence: { supportState: 'supported', executionMode: 'manual-assisted', recognitionStarted: true, timerAdvanced: true, transcriptProduced: true, sessionProduced: true, browserManagedTranscription: true, applicationServerWrites: 0, cloudProviderCalls: 0, forbiddenEngineInvocations: [] },
        ...over,
    };
}

function validate(rows: Record<string, unknown>[]): { status: number; out: string } {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stt-val-'));
    const file = path.join(dir, 'artifact.json');
    writeFileSync(file, JSON.stringify({ rows }));
    try {
        const out = execFileSync('node', [VALIDATOR, file], { cwd: REPO, encoding: 'utf8' });
        return { status: 0, out };
    } catch (e: unknown) {
        const x = e as { status?: number; stdout?: string };
        return { status: x.status ?? 1, out: x.stdout ?? '' };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('#1037 validate-stt-evidence — browser_journey runtime boundary', () => {
    it('admits an honest browser row (unverified, no route, wer null)', () => {
        expect(validate([browserRow()]).status).toBe(0);
    });

    it.each([
        ['audio_route_proven true', { audio_route_proven: true }],
        ['attribution verified', { attribution_status: 'verified' }],
        ['attribution pending', { attribution_status: 'pending' }],
        ['attribution nonsense', { attribution_status: 'nonsense' }],
        ['non-canonical engine', { engine: 'cloud' }],
        ['a WER present', { wer: 0.05 }],
        ['a Cloud call', { browser_journey_evidence: { supportState: 'supported', executionMode: 'manual-assisted', recognitionStarted: true, timerAdvanced: true, transcriptProduced: true, sessionProduced: true, browserManagedTranscription: true, applicationServerWrites: 0, cloudProviderCalls: 1 } }],
        ['browserManagedTranscription false', { browser_journey_evidence: { supportState: 'supported', executionMode: 'manual-assisted', recognitionStarted: true, timerAdvanced: true, transcriptProduced: true, sessionProduced: true, browserManagedTranscription: false, applicationServerWrites: 0, cloudProviderCalls: 0 } }],
        ['a non-closed executionMode', { browser_journey_evidence: { supportState: 'supported', executionMode: 'totally-made-up', recognitionStarted: true, timerAdvanced: true, transcriptProduced: true, sessionProduced: true, browserManagedTranscription: true, applicationServerWrites: 0, cloudProviderCalls: 0, forbiddenEngineInvocations: [] } }],
        ['a MISSING forbidden-engine tripwire proof', { browser_journey_evidence: { supportState: 'supported', executionMode: 'manual-assisted', recognitionStarted: true, timerAdvanced: true, transcriptProduced: true, sessionProduced: true, browserManagedTranscription: true, applicationServerWrites: 0, cloudProviderCalls: 0 } }],
        ['a recorded forbidden-engine construction', { browser_journey_evidence: { supportState: 'supported', executionMode: 'manual-assisted', recognitionStarted: true, timerAdvanced: true, transcriptProduced: true, sessionProduced: true, browserManagedTranscription: true, applicationServerWrites: 0, cloudProviderCalls: 0, forbiddenEngineInvocations: [{ key: 'assemblyai', phase: 'start', at: 1 }] } }],
    ] as const)('rejects a crafted browser row with %s', (_label, over) => {
        expect(validate([browserRow(over)]).status).toBe(1);
    });
});
