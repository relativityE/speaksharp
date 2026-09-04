import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { analyticsBuffer } from '../../AnalyticsBuffer';
import {
    emitRecordingIntent, emitRecordingState, emitStageLatency,
    markRuntimeReady, clearRuntimeReady, msSinceReady, msSinceIntent,
    __resetJourneyEventsForTests,
} from '../journeyEvents';
import { beginJourney, currentAttemptSeq, __resetJourneyIdentityForTests } from '../journeyIdentity';
import { projectEventProps } from '../../telemetryAllowlist';
import posthog from 'posthog-js';

vi.mock('posthog-js', () => ({
    default: { capture: vi.fn(), identify: vi.fn(), reset: vi.fn(), reloadFeatureFlags: vi.fn() },
}));
vi.mock('@sentry/react', () => ({ setUser: vi.fn(), captureException: vi.fn() }));

const calls = () => (posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls;
const captured = (name: string) => calls().filter((c) => c[0] === name).map((c) => c[1] as Record<string, unknown>);
const drain = () => analyticsBuffer.push('session_started', { mode: 'private' }, 'CRITICAL');

beforeEach(() => {
    vi.clearAllMocks();
    __resetJourneyEventsForTests();
    __resetJourneyIdentityForTests();
    analyticsBuffer.queue.length = 0;
    analyticsBuffer.ready = true;
    beginJourney();
});
afterEach(() => vi.useRealTimers());

describe('F01 — the four outcomes must be distinguishable', () => {
    it('one click accepted, then a long silent wait, is a SINGLE intent', () => {
        markRuntimeReady();
        emitRecordingIntent({ kind: 'start', outcome: 'accepted', runtimeState: 'READY', modelReady: true });
        drain();
        const intents = captured('recording_intent');
        expect(intents).toHaveLength(1);
        expect(intents[0].intent_outcome).toBe('accepted');
        // No RECORDING transition follows — the silent wait. The absence is the evidence, and it is only
        // legible because the accepted intent was recorded.
        expect(captured('recording_state')).toHaveLength(0);
    });

    it('TWO CLICKS REQUIRED — the first is suppressed and says why', () => {
        markRuntimeReady();
        emitRecordingIntent({ kind: 'start', outcome: 'suppressed_in_flight', runtimeState: 'INITIATING', modelReady: false });
        emitRecordingIntent({ kind: 'start', outcome: 'accepted', runtimeState: 'READY', modelReady: true });
        drain();
        const intents = captured('recording_intent');
        expect(intents.map((i) => i.intent_outcome)).toEqual(['suppressed_in_flight', 'accepted']);
        // Before this, the suppressed click returned with no log and no event, so this sequence and the
        // one above produced identical telemetry.
        expect(intents[0].runtime_state_at_intent).toBe('INITIATING');
        expect(intents[0].model_ready).toBe(false);
    });

    it('TWO STARTS — two accepted intents, separated by attempt ordinal', () => {
        emitRecordingIntent({ kind: 'start', outcome: 'accepted', runtimeState: 'READY', modelReady: true });
        drain();
        const first = captured('recording_intent')[0].attempt_seq;
        // A real recording opens the attempt.
        emitRecordingState('READY', 'RECORDING', null);
        emitRecordingIntent({ kind: 'start', outcome: 'accepted', runtimeState: 'READY', modelReady: true });
        drain();
        const intents = captured('recording_intent');
        expect(intents).toHaveLength(2);
        expect(first).toBe(0);
        expect(intents[1].attempt_seq).toBe(currentAttemptSeq());
    });

    it('every refusal reason is carried, not collapsed into one "blocked"', () => {
        for (const outcome of ['suppressed_in_flight', 'suppressed_finalizing', 'blocked_usage_limit',
            'blocked_stale_client', 'blocked_lock_held', 'failed'] as const) {
            emitRecordingIntent({ kind: 'start', outcome, runtimeState: 'READY', modelReady: true });
        }
        drain();
        expect(captured('recording_intent').map((i) => i.intent_outcome)).toEqual([
            'suppressed_in_flight', 'suppressed_finalizing', 'blocked_usage_limit',
            'blocked_stale_client', 'blocked_lock_held', 'failed',
        ]);
    });

    it('attaches the READINESS WAIT to the click — the 113s Production already shows', () => {
        vi.useFakeTimers();
        markRuntimeReady();
        vi.advanceTimersByTime(113_000);
        emitRecordingIntent({ kind: 'start', outcome: 'accepted', runtimeState: 'READY', modelReady: true });
        drain();
        expect(captured('recording_intent')[0].ms_since_ready).toBe(113_000);
    });

    it('a TORN-DOWN engine stops dating the next intent — clearing must actually clear', () => {
        // This previously called clearRuntimeReady() on an already-null mark, so a no-op implementation
        // passed it. Set a real mark first: without clearing, the next intent reports a wait that began
        // before the engine was torn down.
        markRuntimeReady();
        clearRuntimeReady();
        emitRecordingIntent({ kind: 'start', outcome: 'accepted', runtimeState: 'IDLE', modelReady: false });
        drain();
        // A torn-down engine's stale readiness would otherwise date the next intent as a huge wait.
        expect(captured('recording_intent')[0].ms_since_ready).toBeNull();
    });
});

describe('F16 — stages stay apart', () => {
    it('emits one row per stage, never a collapsed total', () => {
        emitStageLatency('model_acquisition', 134_000);
        emitStageLatency('ready_to_intent', 113_000);
        emitStageLatency('intent_to_recording', 1_600);
        drain();
        const rows = captured('stage_latency');
        expect(rows.map((r) => r.stage)).toEqual(['model_acquisition', 'ready_to_intent', 'intent_to_recording']);
        expect(rows.map((r) => r.duration_ms)).toEqual([134_000, 113_000, 1_600]);
    });

    it('refuses a negative or non-finite duration instead of emitting a nonsense measurement', () => {
        emitStageLatency('model_acquisition', -5);
        emitStageLatency('model_acquisition', Number.NaN);
        drain();
        expect(captured('stage_latency')).toHaveLength(0);
    });

    it('a stale mark yields null, not a day-long duration', () => {
        vi.useFakeTimers();
        markRuntimeReady();
        vi.advanceTimersByTime(86_400_001);
        expect(msSinceReady()).toBeNull();
    });
});

describe('transitions, not polls', () => {
    it('carries from/to and the time since the intent', () => {
        vi.useFakeTimers();
        emitRecordingIntent({ kind: 'start', outcome: 'accepted', runtimeState: 'READY', modelReady: true });
        vi.advanceTimersByTime(1_600);
        emitRecordingState('READY', 'RECORDING', null);
        drain();
        const t = captured('recording_state')[0];
        expect(t.from_state).toBe('READY');
        expect(t.to_state).toBe('RECORDING');
        expect(t.ms_since_intent).toBe(1_600);
        expect(msSinceIntent()).toBe(1_600);
    });

    it('every emitted field survives its schema — an event that ships nothing proves nothing', () => {
        for (const [event, props] of [
            ['recording_intent', {
                intent_kind: 'start', intent_outcome: 'suppressed_in_flight',
                runtime_state_at_intent: 'INITIATING', model_ready: false, ms_since_ready: 113_000,
            }],
            ['recording_state', {
                from_state: 'READY', to_state: 'RECORDING', transition_cause: 'NotReadableError',
                ms_since_intent: 1_600,
            }],
            ['stage_latency', { stage: 'ready_to_intent', duration_ms: 113_000 }],
        ] as [string, Record<string, unknown>][]) {
            const { props: kept, dropped } = projectEventProps(event, props);
            expect({ event, dropped }).toEqual({ event, dropped: [] });
            expect(Object.keys(kept).sort()).toEqual(Object.keys(props).sort());
        }
    });

    it('rejects a runtime state the machine cannot produce', () => {
        const { dropped } = projectEventProps('recording_intent', {
            intent_kind: 'start', intent_outcome: 'accepted',
            runtime_state_at_intent: 'ready', model_ready: true,   // lowercase — not a RuntimeState
        });
        expect(dropped).toEqual(['runtime_state_at_intent']);
    });
});
