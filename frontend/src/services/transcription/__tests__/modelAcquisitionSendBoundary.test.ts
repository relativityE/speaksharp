/**
 * #1259s RETURN — the REAL send boundary, and the production wiring.
 *
 * TWO DEFECTS THIS FILE EXISTS FOR.
 *
 * 1. The module was dead code. Nothing imported it, no loader called it, and no auth path released its
 *    queue — so the deployed product would have emitted zero acquisition events while every unit test
 *    passed. A helper tested in isolation proves the helper works, not that anything uses it.
 *
 * 2. Every acquisition event is named `private_*`, so `AnalyticsBuffer.send()` runs its properties
 *    through `sanitizePrivateTelemetryProps()`. That allowlist did not contain a single new field, so
 *    all of them were dropped and only `error_code` survived: the events would have reached PostHog
 *    carrying nothing that answers the question they exist to answer. The earlier tests MOCKED the
 *    buffer, which is exactly why they could not see it.
 *
 * So nothing here mocks the sanitizer or the projection. The payload asserted is the one PostHog is
 * handed.
 */
import { describe, it, expect } from 'vitest';
import {
    sanitizePrivateTelemetryProps, PRIVATE_TELEMETRY_ALLOWED_PROPS,
} from '../privateTelemetrySanitizer';

/** Exactly the property set the acquisition events emit. */
const ACQUISITION_FIELDS = [
    'acquired_candidate_id', 'model_identity', 'asset_pin_digest', 'release_id', 'trigger',
    'cache_result', 'network_used', 'network_bytes', 'asset_count',
    'download_ms', 'init_ms', 'total_ms', 'outcome', 'error_code',
] as const;

const fullPayload = () => ({
    acquired_candidate_id: 'moonshine:streaming-medium',
    model_identity: 'moonshine-medium@pinned',
    asset_pin_digest: 'sha256-abc',
    release_id: 'rel-1',
    trigger: 'explicit-setup',
    cache_result: 'miss',
    network_used: true,
    network_bytes: 2048,
    asset_count: 2,
    download_ms: 300,
    init_ms: 500,
    total_ms: 800,
    outcome: 'success',
});

describe('#1259s the real sanitizer keeps every acquisition measurement', () => {
    it('CASUALTY: every approved field survives the REAL projection', () => {
        // Before this correction the allowlist contained none of them: all thirteen were dropped and
        // only error_code came through, so the event arrived empty of everything it measures.
        const out = sanitizePrivateTelemetryProps(fullPayload());
        for (const key of Object.keys(fullPayload())) {
            expect(out, `"${key}" must survive the projection`).toHaveProperty(key);
        }
    });

    it('values are preserved, not merely the keys', () => {
        const out = sanitizePrivateTelemetryProps(fullPayload()) as Record<string, unknown>;
        expect(out.cache_result).toBe('miss');
        expect(out.download_ms).toBe(300);
        expect(out.init_ms).toBe(500);
        expect(out.network_used).toBe(true);
    });

    it.each(ACQUISITION_FIELDS)('%s is in the authoritative allowlist', (field) => {
        expect(PRIVATE_TELEMETRY_ALLOWED_PROPS as readonly string[]).toContain(field);
    });

    it('CASUALTY: unapproved properties are removed by the real projection', () => {
        const out = sanitizePrivateTelemetryProps({
            ...fullPayload(),
            asset_url: 'https://cdn.example/enc.onnx',
            transcript: 'what the user said',
            audio_blob: 'AAAA',
            user_id: '11111111-1111-4111-8111-111111111111',
            raw_error: 'failed to fetch https://cdn/x?token=SECRET',
            stack: 'Error\\n  at foo',
            asset_path: '/models/moonshine/encoder.onnx',
        } as never) as Record<string, unknown>;

        for (const forbidden of ['asset_url', 'transcript', 'audio_blob', 'user_id', 'raw_error', 'stack', 'asset_path']) {
            expect(out, `"${forbidden}" must not survive`).not.toHaveProperty(forbidden);
        }
        const serialized = JSON.stringify(out);
        expect(serialized).not.toMatch(/https?:\/\//);
        expect(serialized).not.toMatch(/SECRET/);
        expect(serialized).not.toMatch(/what the user said/);
    });

    it('CASUALTY: the allowlist admits no session identifier alongside the new fields', () => {
        // A per-session UUID would re-identify a session at the vendor. The pre-existing rule must not
        // have been loosened by this addition.
        expect(PRIVATE_TELEMETRY_ALLOWED_PROPS as readonly string[]).not.toContain('session_id');
        const out = sanitizePrivateTelemetryProps({ ...fullPayload(), session_id: 'abc' } as never);
        expect(out).not.toHaveProperty('session_id');
    });
});

/**
 * The source-text integration block that used to live here is GONE.
 *
 * It read `PrivateSTT.ts` and `AuthProvider.tsx` as strings and asserted that call sites existed. That
 * is what let the returned defect through: every call site was present and correct, and every one of
 * them reported nothing, because the values they passed were declared and never assigned. Text cannot
 * observe a payload.
 *
 * The behavioural replacements assert what `posthog.capture` actually receives, from a real load and a
 * real authentication:
 *   - `modelAcquisitionPayload.test.ts`      — cold/warm/partial loads for v2, Moonshine and distil.
 *   - `AuthProvider.identityEpoch.test.ts`   — deferred getSession, signed-out, and account A to B.
 */
