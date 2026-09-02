/**
 * #1401 — attribution belongs to the MOMENT THE EVENT HAPPENED, not to the moment the queue drained.
 *
 * The envelope was built inside `send()`. The buffer can hold an event across a flush delay or an
 * in-page model switch, so a queued event acquired whichever engine was globally resolved when the
 * queue drained: a take recorded on Moonshine and flushed after a switch to v2 was filed under v2, and
 * nothing about the stored event looked wrong afterwards.
 *
 * That is the same class as the arm that recorded itself as its competitor — a model's results landing
 * under another model's name — arriving through the telemetry buffer instead of through the selector.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import posthog from 'posthog-js';
import { analyticsBuffer } from '../AnalyticsBuffer';

vi.mock('posthog-js', () => ({ default: { capture: vi.fn(), __loaded: true } }));

const captured = () => (posthog.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls;

describe('a queued event keeps the attribution it was created with', () => {
    const Ctor = (analyticsBuffer as unknown as { constructor: { setEnvelopeSources: (p: () => unknown) => void } }).constructor;
    const setSources = (p: () => unknown) => Ctor.setEnvelopeSources(p);
    const buffer = analyticsBuffer as unknown as {
        push: (e: string, p?: Record<string, unknown>) => void;
        flush: () => void;
        queue: unknown[]; ready: boolean; isFlushing: boolean;
    };

    beforeEach(() => {
        vi.clearAllMocks();
        buffer.queue = [];
        buffer.ready = false;
        buffer.isFlushing = false;
    });
    afterEach(() => { setSources(() => ({})); });

    it('CASUALTY: an event pushed under Moonshine and flushed after a switch to v2 stays Moonshine', async () => {
        setSources(() => ({
            engineMetadata: { candidateId: 'moonshine:streaming-medium' },
        } as never));
        buffer.push('session_saved', { ok: true });

        // The switch happens while the event is still queued.
        setSources(() => ({
            engineMetadata: { candidateId: 'v2:base.en' },
        } as never));

        buffer.flush();
        await vi.waitFor(() => expect(captured().length).toBeGreaterThan(0));

        const props = captured()[0][1] as Record<string, unknown>;
        expect(props.candidate_id, 'the take was decoded by Moonshine').toBe('moonshine:streaming-medium');
        expect(props.candidate_id).not.toBe('v2:base.en');
    });

    it('POSITIVE CONTROL: with no switch the attribution is unchanged', async () => {
        setSources(() => ({
            engineMetadata: { candidateId: 'v4:distil:q4' },
        } as never));
        buffer.push('session_started', {});
        buffer.flush();
        await vi.waitFor(() => expect(captured().length).toBeGreaterThan(0));
        expect((captured()[0][1] as Record<string, unknown>).candidate_id).toBe('v4:distil:q4');
    });

    it('CASUALTY: an event produced before ANY engine resolved is null, never backfilled by a later one', async () => {
        // Backfilling would invent attribution for an event that genuinely had none — worse than null,
        // because null is legible as "unattributed" and a wrong id is not.
        setSources(() => ({}));
        buffer.push('session_started', {});

        setSources(() => ({
            engineMetadata: { candidateId: 'moonshine:streaming-medium' },
        } as never));

        buffer.flush();
        await vi.waitFor(() => expect(captured().length).toBeGreaterThan(0));
        expect((captured()[0][1] as Record<string, unknown>).candidate_id).toBeNull();
    });
});
