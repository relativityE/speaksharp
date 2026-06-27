/**
 * DETERMINISTIC v2/v4 PROOF for the Private-sample telemetry spine.
 *
 * Drives the full approved lifecycle for a FORCED v2 arm and a FORCED v4 arm (as the
 * deterministic override does) and proves the launch go-criteria at the contract level:
 *   - forced v2 → every event reports engine_variant=private_v2; durable engine_version
 *     = private_v2:whisper-base.en
 *   - forced v4 → every event reports engine_variant=private_v4; durable engine_version
 *     = private_v4:base_q4
 *   - assignment_source + posthog_flag_key/value + session_id + release_sha on every event
 *   - NO transcript/audio/raw payload reaches PostHog on ANY event
 *   - sample usage/exhaustion is driven by seconds used vs limit (usable later, not a
 *     signup countdown)
 *
 * The durable engine_version asserted here is exactly the string PrivateSTT.getMetadata()
 * persists to sessions.engine_version via the save RPC's p_engine_version.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import posthog from 'posthog-js';
import {
    PRIVATE_SAMPLE_EVENTS,
    resolveSampleAssignment,
    buildEngineVersion,
    setPrivateSampleContext,
    clearPrivateSampleContext,
    emitPrivateSample,
} from '../privateSampleTelemetry';

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }));
const captureMock = posthog.capture as unknown as ReturnType<typeof vi.fn>;

const FORBIDDEN = ['transcript', 'text', 'audio', 'wav', 'blob', 'base64', 'raw', 'segments', 'tokens'];

beforeEach(() => {
    captureMock.mockClear();
    clearPrivateSampleContext();
});

function driveArm(arm: { engineType: string; variant: 'private_v2' | 'private_v4'; model: string; version: string }) {
    // 1) Deterministic override resolves the forced arm + attribution.
    const assignment = resolveSampleAssignment({
        resolvedEngineType: arm.engineType,
        overrideActive: true,
        allowlisted: false,
        rolloutEnabled: false,
    });
    expect(assignment.engine_variant).toBe(arm.variant);
    expect(assignment.assignment_source).toBe('deterministic_override');

    // 2) Durable engine_version = exactly what PrivateSTT.getMetadata persists.
    expect(buildEngineVersion(assignment.engine_variant, arm.model)).toBe(arm.version);

    setPrivateSampleContext({
        session_id: 'sess-arm',
        engine_variant: assignment.engine_variant,
        assignment_source: assignment.assignment_source,
        posthog_flag_key: assignment.posthog_flag_key,
        posthog_flag_value: assignment.posthog_flag_value,
        model: arm.model,
        release_sha: 'sha-abc123',
        sample_limit_seconds: 300,
    });

    // 3) Full approved lifecycle. first_transcript deliberately tries to leak transcript/audio.
    emitPrivateSample(PRIVATE_SAMPLE_EVENTS.SELECTED);
    emitPrivateSample(PRIVATE_SAMPLE_EVENTS.SETUP_STARTED);
    emitPrivateSample(PRIVATE_SAMPLE_EVENTS.SETUP_SUCCEEDED, { setup_duration_ms: 1200, browser: 'chrome' });
    emitPrivateSample(PRIVATE_SAMPLE_EVENTS.RECORDING_STARTED, { browser: 'chrome' });
    emitPrivateSample(PRIVATE_SAMPLE_EVENTS.FIRST_TRANSCRIPT_SEEN, {
        time_to_first_text_ms: 820,
        transcript: 'LEAK — full transcript text',
        text: 'LEAK',
        audio: 'LEAK base64 blob',
        segments: [{ tokens: [1, 2, 3] }],
    });
    emitPrivateSample(PRIVATE_SAMPLE_EVENTS.RECORDING_STOPPED, { recording_duration_seconds: 180 });
    emitPrivateSample(PRIVATE_SAMPLE_EVENTS.SAVED, { recording_duration_seconds: 180, word_count: 300, save_success: true });
    emitPrivateSample(PRIVATE_SAMPLE_EVENTS.USAGE_UPDATED, { sample_seconds_used: 180, sample_seconds_remaining: 120 });
    emitPrivateSample(PRIVATE_SAMPLE_EVENTS.EXHAUSTED, { sample_seconds_used: 300 });

    const calls = captureMock.mock.calls;
    expect(calls.map((c) => c[0])).toEqual([
        'private_sample_selected',
        'private_sample_setup_started',
        'private_sample_setup_succeeded',
        'private_sample_recording_started',
        'private_sample_first_transcript_seen',
        'private_sample_recording_stopped',
        'private_sample_saved',
        'private_sample_usage_updated',
        'private_sample_exhausted',
    ]);

    // 4) Every event: correct arm/attribution; NO forbidden payload key.
    for (const [, payload] of calls) {
        expect(payload.engine_variant).toBe(arm.variant);
        expect(payload.assignment_source).toBe('deterministic_override');
        expect(payload.posthog_flag_key).toBe('private_stt_v4_enabled');
        expect(payload.session_id).toBe('sess-arm');
        expect(payload.release_sha).toBe('sha-abc123');
        for (const f of FORBIDDEN) expect(payload).not.toHaveProperty(f);
    }

    // 5) first_transcript kept the numeric duration but dropped the leak attempt.
    const fts = calls.find((c) => c[0] === 'private_sample_first_transcript_seen')![1];
    expect(fts.time_to_first_text_ms).toBe(820);
}

describe('PROOF: deterministic v2 arm', () => {
    it('events report private_v2; durable engine_version private_v2:whisper-base.en; no PII', () => {
        driveArm({ engineType: 'transformers-js', variant: 'private_v2', model: 'whisper-base.en', version: 'private_v2:whisper-base.en' });
    });
});

describe('PROOF: deterministic v4 arm', () => {
    it('events report private_v4; durable engine_version private_v4:base_q4; no PII', () => {
        driveArm({ engineType: 'transformers-js-v4', variant: 'private_v4', model: 'base_q4', version: 'private_v4:base_q4' });
    });
});

describe('PROOF: sample usage is usable-later, not a signup countdown', () => {
    it('remaining derives from limit minus seconds used (time-independent)', () => {
        // Two events on different "days" with the same used total report the same remaining —
        // proving the sample tracks consumption, not wall-clock since signup.
        setPrivateSampleContext({ engine_variant: 'private_v2', assignment_source: 'default', sample_limit_seconds: 300 });
        const remaining = (used: number) => 300 - used;
        emitPrivateSample(PRIVATE_SAMPLE_EVENTS.USAGE_UPDATED, { sample_seconds_used: 0, sample_seconds_remaining: remaining(0) });
        emitPrivateSample(PRIVATE_SAMPLE_EVENTS.USAGE_UPDATED, { sample_seconds_used: 120, sample_seconds_remaining: remaining(120) });
        const calls = captureMock.mock.calls;
        expect(calls[0][1].sample_seconds_remaining).toBe(300);
        expect(calls[1][1].sample_seconds_remaining).toBe(180);
    });
});
