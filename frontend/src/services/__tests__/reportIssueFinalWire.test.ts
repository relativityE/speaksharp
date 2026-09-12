/**
 * #1401 — what actually reaches PostHog, not what the producer emitted.
 *
 * The producer already withheld `engine_variant` for an unverifiable link. The envelope then attached
 * `candidate_id`, `engine`, `runtime_version` and `asset_digest` from ambient `resolvedEngine()` on the
 * way to the wire, so a report about a Moonshine session filed after switching to v2 arrived attributed
 * to v2 — with the honest null sitting next to it.
 *
 * The earlier tests asserted `window.__SS_PRIVATE_EVENTS__`, which is UPSTREAM of the buffer, so they
 * could not have caught this. Asserting at the boundary that does not exercise the defect is the same
 * mistake as testing an engine directly instead of through the facade.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import posthog from 'posthog-js';
import { analyticsBuffer } from '../AnalyticsBuffer';
import { emitPrivateTelemetry, PRIVATE_TELEMETRY_EVENTS } from '../transcription/privateTelemetry';

vi.mock('posthog-js', () => ({ default: { capture: vi.fn(), __loaded: true } }));

const captures = () => (posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls;
const lastProps = () => captures()[captures().length - 1][1] as Record<string, unknown>;

const MODEL_FIELDS = ['candidate_id', 'engine', 'runtime_version', 'asset_digest'] as const;

describe('an unattributable Report Issue reaches the wire with NO model', () => {
    const buffer = analyticsBuffer as unknown as {
        queue: unknown[]; ready: boolean; isFlushing: boolean; flush: () => void;
    };
    const Ctor = (analyticsBuffer as unknown as { constructor: { setEnvelopeSources: (p: () => unknown) => void } }).constructor;

    beforeEach(() => {
        vi.clearAllMocks();
        buffer.queue = []; buffer.ready = false; buffer.isFlushing = false;
        // The tab is live on a DIFFERENT model than the report concerns.
        Ctor.setEnvelopeSources(() => ({
            releaseSha: 'deadbeef',
            engineMetadata: {
                candidateId: 'v2:base.en',
                modelIdentity: {
                    engine: 'transformers-js',
                    configuredRuntime: { version: '2.17.2' },
                    configuredAssets: { pinDigest: 'v2digest' },
                },
            },
        }));
    });
    afterEach(() => { Ctor.setEnvelopeSources(() => ({})); });

    it('CASUALTY: an UNVERIFIED report carries null model fields on the actual capture', async () => {
        emitPrivateTelemetry(PRIVATE_TELEMETRY_EVENTS.REPORT_ISSUE_SUBMITTED, {
            issue_category: 'recording_transcription',
            issue_severity: 'medium',
            report_linked_to_session: false,
            model_attribution_verified: false,
            engine_variant: null,
            release_sha: null,
        });
        buffer.flush();
        await vi.waitFor(() => expect(captures().length).toBeGreaterThan(0));

        const props = lastProps();
        for (const field of MODEL_FIELDS) {
            expect(props[field], `${field} was supplied from ambient state`).toBeNull();
        }
        expect(props.engine_variant).toBeNull();
        // The tab's live model must not appear anywhere on the wire payload.
        expect(JSON.stringify(props)).not.toContain('v2:base.en');
        expect(JSON.stringify(props)).not.toContain('v2digest');
        // Release and traffic type are independently known and stay.
        expect(props.release_sha).toBe('deadbeef');
    });

    it('CASUALTY: a switch AFTER push but before flush cannot repopulate the model', async () => {
        emitPrivateTelemetry(PRIVATE_TELEMETRY_EVENTS.REPORT_ISSUE_SUBMITTED, {
            issue_category: 'recording_transcription',
            issue_severity: 'medium',
            report_linked_to_session: true,
            model_attribution_verified: false,
            engine_variant: null,
            release_sha: null,
        });
        // The tab moves to Moonshine while the event is still queued.
        Ctor.setEnvelopeSources(() => ({
            releaseSha: 'deadbeef',
            engineMetadata: { candidateId: 'moonshine:streaming-medium' },
        }));
        buffer.flush();
        await vi.waitFor(() => expect(captures().length).toBeGreaterThan(0));

        for (const field of MODEL_FIELDS) expect(lastProps()[field]).toBeNull();
        expect(JSON.stringify(lastProps())).not.toContain('moonshine');
    });

    it('POSITIVE CONTROL: a VERIFIED report carries the model fields it was produced with', async () => {
        Ctor.setEnvelopeSources(() => ({
            releaseSha: 'deadbeef',
            engineMetadata: {
                candidateId: 'moonshine:streaming-medium',
                modelIdentity: {
                    engine: 'moonshine-streaming',
                    configuredRuntime: { version: '0.1.5' },
                    configuredAssets: { pinDigest: 'moonshinedigest' },
                },
            },
        }));
        emitPrivateTelemetry(PRIVATE_TELEMETRY_EVENTS.REPORT_ISSUE_SUBMITTED, {
            issue_category: 'recording_transcription',
            issue_severity: 'medium',
            report_linked_to_session: true,
            model_attribution_verified: true,
            engine_variant: 'private_moonshine',
            release_sha: 'deadbeef',
        });
        buffer.flush();
        await vi.waitFor(() => expect(captures().length).toBeGreaterThan(0));

        const props = lastProps();
        expect(props.candidate_id).toBe('moonshine:streaming-medium');
        expect(props.engine).toBe('moonshine-streaming');
        expect(props.runtime_version).toBe('0.1.5');
        expect(props.asset_digest).toBe('moonshinedigest');
        expect(props.engine_variant).toBe('private_moonshine');
    });

    it('an ordinary private event is unaffected — this narrows nothing else', async () => {
        emitPrivateTelemetry(PRIVATE_TELEMETRY_EVENTS.ERROR, { error_code: 'SetupError' });
        buffer.flush();
        await vi.waitFor(() => expect(captures().length).toBeGreaterThan(0));
        expect(lastProps().candidate_id).toBe('v2:base.en');
    });
});
