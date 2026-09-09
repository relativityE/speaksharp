/**
 * #1421 P1 — a receipt from a different boot must not qualify this journey.
 *
 * The readback scoped `account_identified` and `telemetry_positive_control` only by identity, release,
 * traffic class and a 24-hour window. When the controlled account boots twice in that window, the
 * SELECTED journey could be missing both of its own receipts and qualify on the other boot's — the
 * exact union the journey filter exists to close, re-opened for the two families that cannot be
 * journey-scoped.
 */
import { describe, it, expect } from 'vitest';
import {
    bootScopedReceiptFamilies,
    receiptBelongsToBoot,
    resolveBootWindow,
    type TimestampedEvent,
} from '../bootScopedReceipts';

const PRE_JOURNEY = ['account_identified', 'telemetry_positive_control'];
const at = (iso: string, event: string, journeyId: string | null = null): TimestampedEvent =>
    ({ event, timestamp: iso, journeyId });

describe('#1421 — pre-journey receipts are bound to the boot that produced the journey', () => {
    /**
     * TWO BOOTS, ONE ACCOUNT, ONE WINDOW. Boot 1 emitted both receipts and ran journey-A. Boot 2
     * emitted NEITHER and ran journey-B, the journey under selection.
     */
    const twoBoots: TimestampedEvent[] = [
        at('2026-09-09T08:00:00Z', 'account_identified'),
        at('2026-09-09T08:00:01Z', 'telemetry_positive_control'),
        at('2026-09-09T08:05:00Z', 'session_started', 'journey-A'),
        at('2026-09-09T08:09:00Z', 'session_saved', 'journey-A'),
        at('2026-09-09T09:00:00Z', 'session_started', 'journey-B'),
        at('2026-09-09T09:04:00Z', 'session_saved', 'journey-B'),
    ];

    it('CASUALTY: the selected journey cannot borrow an earlier boot\'s receipts', () => {
        const resolved = resolveBootWindow(twoBoots, 'journey-B');
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;

        expect(
            bootScopedReceiptFamilies(twoBoots, resolved.window, PRE_JOURNEY),
            "journey-B's boot produced no receipts of its own",
        ).toEqual([]);
    });

    it('CONTROL: the boot that DID emit them qualifies on its own receipts', () => {
        // Without this the casualty above would also pass if the window rejected everything.
        const resolved = resolveBootWindow(twoBoots, 'journey-A');
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;

        expect(
            bootScopedReceiptFamilies(twoBoots, resolved.window, PRE_JOURNEY).sort(),
            'journey-A owns the receipts emitted before it',
        ).toEqual(['account_identified', 'telemetry_positive_control']);
    });

    it('CASUALTY: a receipt from a LATER boot cannot qualify an earlier journey', () => {
        const laterBoot = [...twoBoots, at('2026-09-09T10:00:00Z', 'account_identified')];
        const resolved = resolveBootWindow(laterBoot, 'journey-A');
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;

        const window = resolved.window;
        expect(receiptBelongsToBoot(at('2026-09-09T10:00:00Z', 'account_identified'), window),
            'a receipt emitted after the journey began is a different boot').toBe(false);
    });

    it('a journey with no readable events HOLDS rather than matching unbounded', () => {
        expect(resolveBootWindow(twoBoots, 'journey-missing'))
            .toEqual({ ok: false, reason: expect.stringContaining('no boot to bind its receipts to') });
    });

    it('an unparseable timestamp is unusable, never in-window', () => {
        const resolved = resolveBootWindow(twoBoots, 'journey-B');
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;
        for (const bad of [null, undefined, '', 'not-a-date', Number.NaN]) {
            expect(receiptBelongsToBoot({ event: 'account_identified', timestamp: bad }, resolved.window))
                .toBe(false);
        }
    });
});
