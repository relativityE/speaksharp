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
    buildReadbackQuery,
} from '../bootScopedReceipts';

const PRE_JOURNEY = ['account_identified', 'telemetry_positive_control'];
const at = (iso: string, event: string, journeyId: string | null = null): TimestampedEvent =>
    ({ event, timestamp: iso, journeyId });

describe('#1421 — pre-journey receipts are bound to the boot that produced the journey', () => {
    /**
     * TWO BOOTS, ONE ACCOUNT, ONE WINDOW. Boot 1 emitted both receipts and ran journey-A. Boot 2
     * emitted NEITHER and ran journey-B, the journey under selection.
     */
    // PRODUCTION ENVELOPE: the receipts carry the PRE-PRODUCT journey id that exists before the
    // selected journey is minted. Giving them `journeyId: null` — as my first fixture did — hid a P1
    // in which the receipts became their own lower bound and every legitimate run HELD.
    const twoBoots: TimestampedEvent[] = [
        at('2026-09-09T08:00:00Z', 'account_identified', 'pre-product-1'),
        at('2026-09-09T08:00:01Z', 'telemetry_positive_control', 'pre-product-1'),
        at('2026-09-09T08:05:00Z', 'session_started', 'journey-A'),
        at('2026-09-09T08:09:00Z', 'session_saved', 'journey-A'),
        at('2026-09-09T09:00:00Z', 'session_started', 'journey-B'),
        at('2026-09-09T09:04:00Z', 'session_saved', 'journey-B'),
    ];

    it('CASUALTY: the selected journey cannot borrow an earlier boot\'s receipts', () => {
        const resolved = resolveBootWindow(twoBoots, 'journey-B', PRE_JOURNEY);
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;

        expect(
            bootScopedReceiptFamilies(twoBoots, resolved.window, PRE_JOURNEY),
            "journey-B's boot produced no receipts of its own",
        ).toEqual([]);
    });

    it('CONTROL: the boot that DID emit them qualifies on its own receipts', () => {
        // Without this the casualty above would also pass if the window rejected everything.
        const resolved = resolveBootWindow(twoBoots, 'journey-A', PRE_JOURNEY);
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;

        expect(
            bootScopedReceiptFamilies(twoBoots, resolved.window, PRE_JOURNEY).sort(),
            'journey-A owns the receipts emitted before it',
        ).toEqual(['account_identified', 'telemetry_positive_control']);
    });

    it('CASUALTY: a receipt from a LATER boot cannot qualify an earlier journey', () => {
        const laterBoot = [...twoBoots, at('2026-09-09T10:00:00Z', 'account_identified')];
        const resolved = resolveBootWindow(laterBoot, 'journey-A', PRE_JOURNEY);
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;

        const window = resolved.window;
        expect(receiptBelongsToBoot(at('2026-09-09T10:00:00Z', 'account_identified'), window),
            'a receipt emitted after the journey began is a different boot').toBe(false);
    });

    it('a journey with no readable events HOLDS rather than matching unbounded', () => {
        expect(resolveBootWindow(twoBoots, 'journey-missing', PRE_JOURNEY))
            .toEqual({ ok: false, reason: expect.stringContaining('no boot to bind its receipts to') });
    });

    it('an unparseable timestamp is unusable, never in-window', () => {
        const resolved = resolveBootWindow(twoBoots, 'journey-B', PRE_JOURNEY);
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;
        for (const bad of [null, undefined, '', 'not-a-date', Number.NaN]) {
            expect(receiptBelongsToBoot({ event: 'account_identified', timestamp: bad }, resolved.window))
                .toBe(false);
        }
    });
});

describe('#1421 P1 — the readback fetches what the boot window depends on', () => {
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
    const query = () => buildReadbackQuery({
        windowHours: 24,
        releaseSha: 'abc123',
        trafficType: 'controlled',
        qualifyingIdentity: 'person-1',
        governedEvents: ['account_identified', 'telemetry_positive_control', 'recording_started'],
        quote,
    });

    it('CASUALTY: it does NOT restrict rows to the selected journey', () => {
        /**
         * The query restricted to `journey_id = <selected> OR event IN <receipt families>` — the only
         * two things `resolveBootWindow` may not use as a boundary. The one input that produces
         * `window.after`, an EARLIER product journey by the same identity, was never fetched, so the
         * lower bound was always null and an earlier boot's receipts still qualified the later journey.
         *
         * The binding was inert in production while the resolver's own casualties, which are handed
         * rows directly, stayed green. That is why this asserts the QUERY and not the resolver.
         */
        expect(query()).not.toMatch(/journey_id\s*=/);
    });

    it('CASUALTY: it still binds identity, release, traffic class and the governed vocabulary', () => {
        // Widening the scope must not widen it past the person, the build or the allowlist: those are
        // what make a receipt evidence about THIS run rather than about somebody else's.
        const q = query();
        expect(q).toContain("distinct_id = 'person-1'");
        expect(q).toContain("properties.release_sha = 'abc123'");
        expect(q).toContain("properties.traffic_type = 'controlled'");
        expect(q).toContain("event IN ('account_identified', 'telemetry_positive_control', 'recording_started')");
    });

    it('CASUALTY: an earlier product journey now bounds the boot, so its receipts are refused', () => {
        // The end-to-end consequence, driven through the resolver with the rows the corrected query
        // returns: boot A's receipt must not qualify boot B's journey.
        const rows = [
            { event: 'account_identified', timestamp: '2026-09-09T10:00:00Z', journeyId: 'pre-product' },
            { event: 'recording_started', timestamp: '2026-09-09T10:05:00Z', journeyId: 'journey-A' },
            { event: 'recording_started', timestamp: '2026-09-09T12:00:00Z', journeyId: 'journey-B' },
        ];
        const window = resolveBootWindow(rows, 'journey-B', ['account_identified']);
        expect(window.ok).toBe(true);
        if (!window.ok) return;
        expect(window.window.after, "journey A's row is the lower bound").not.toBeNull();
        expect(bootScopedReceiptFamilies(rows, window.window, ['account_identified']),
            "boot A's receipt is not evidence about boot B").toEqual([]);
    });
});
