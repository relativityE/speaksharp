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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    sanitizePrivateTelemetryProps, PRIVATE_TELEMETRY_ALLOWED_PROPS,
} from '../privateTelemetrySanitizer';

/** Exactly the property set the acquisition events emit. */
const ACQUISITION_FIELDS = [
    'candidate_id', 'model_identity', 'asset_pin_digest', 'release_id', 'trigger',
    'cache_result', 'network_used', 'network_bytes', 'asset_count',
    'download_ms', 'init_ms', 'total_ms', 'outcome', 'error_code',
] as const;

const fullPayload = () => ({
    candidate_id: 'moonshine:streaming-medium',
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

describe('#1259s the production path actually calls the telemetry', () => {
    /**
     * INTEGRATION CASUALTY. This reads the real engine source and fails if the production call sites
     * are removed. The previous head passed every unit test while nothing imported the module at all,
     * so "the helper works" was true and "the product emits anything" was false.
     */
    const engineSrc = () => readFileSync(
        resolve(process.cwd(), 'frontend/src/services/transcription/engines/PrivateSTT.ts'), 'utf8');
    const authSrc = () => readFileSync(
        resolve(process.cwd(), 'frontend/src/contexts/AuthProvider.tsx'), 'utf8');

    it('CASUALTY: the shared engine-init routine records start, success and failure', () => {
        const src = engineSrc();
        expect(src, 'nothing imported the module on the returned head').toMatch(/modelAcquisitionTelemetry/);
        expect(src).toMatch(/recordAcquisitionStart\(/);
        expect(src).toMatch(/recordAcquisitionSuccess\(/);
        expect(src).toMatch(/recordAcquisitionFailure\(/);
    });

    it('CASUALTY: the cache is probed BEFORE the load, not inferred from elapsed time', () => {
        const src = engineSrc();
        const probeAt = src.indexOf('probeCache(');
        const startAt = src.indexOf('performance.now()', probeAt);
        expect(probeAt, 'the loader must probe the cache').toBeGreaterThan(-1);
        expect(probeAt, 'the probe must precede the timing').toBeLessThan(startAt);
    });

    it('instrumentation sits on the SHARED routine, so all three candidates are covered', () => {
        // v2, v4 distil and Moonshine all initialise through initSelectedEngine; instrumenting each
        // engine separately would leave whichever one someone forgot silently unmeasured.
        const src = engineSrc();
        const at = src.indexOf('private async initSelectedEngine(');
        const body = src.slice(at, at + 2600);
        expect(body).toMatch(/recordAcquisitionStart\(/);
        expect(body).toMatch(/initSelectedEngineInner\(/);
    });

    it('CASUALTY: authentication releases the queue, identifying FIRST', () => {
        const src = authSrc();
        expect(src).toMatch(/markIdentitySettled\(\)/);
        const identifyAt = src.indexOf('analyticsBuffer.identify(');
        expect(identifyAt).toBeGreaterThan(-1);
        expect(src.indexOf('markIdentitySettled()', identifyAt),
            'release must follow identify, or the cold load lands under anonymous').toBeGreaterThan(identifyAt);

        // Searching FORWARD from identify is not enough: a release added BEFORE it still finds the later
        // one and passes. The authenticated branch must contain no release between retiring the previous
        // settlement and identifying the new account.
        const resetAt = src.indexOf('resetIdentitySettlement()');
        expect(resetAt).toBeGreaterThan(-1);
        const beforeIdentify = src.slice(resetAt, identifyAt);
        expect(beforeIdentify, 'nothing may release the queue before identify')
            .not.toMatch(/markIdentitySettled\(\)/);
    });

    it('CASUALTY: a signed-out visitor also settles, so events are not queued forever', () => {
        const src = authSrc();
        const resetAt = src.indexOf('analyticsBuffer.resetIdentity()');
        const settleAfterReset = src.indexOf('markIdentitySettled()', resetAt);
        expect(resetAt).toBeGreaterThan(-1);
        expect(settleAfterReset, 'the signed-out branch must release the queue').toBeGreaterThan(resetAt);
    });

    it('CASUALTY: an account transition retires the previous settlement', () => {
        // Otherwise an acquisition beginning after a switch is released under the account that left.
        expect(authSrc()).toMatch(/resetIdentitySettlement\(\)/);
    });
});
