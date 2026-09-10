/**
 * #1421 P1 — a receipt belongs to a BOOT, and a boot is declared, not inferred.
 *
 * Two earlier corrections inferred the boot from journey ORDERING and were wrong in both directions:
 * one let another boot's receipts qualify the selected journey, the other rejected the boot's own
 * receipts because an earlier journey of the SAME boot became the lower bound. `ensureJourneyBoundary()`
 * starts a new journey on every non-product -> product transition, so one boot legitimately contains
 * several journeys while the receipts are emitted once per boot. Ordering cannot separate "new boot"
 * from "re-entered the product". These drive the declared-authority rule that replaced it.
 */
import { describe, expect, it } from 'vitest';
import {
    __resetBootIdentityForTests,
    beginJourney,
    currentBootId,
} from '../journeyIdentity';
import {
    bootScopedReceiptFamilies,
    buildReadbackQuery,
    resolveBootAuthority,
    receiptBelongsToBoot,
} from '../bootScopedReceipts';

const RECEIPTS = ['account_identified', 'telemetry_positive_control'];
const row = (event: string, journeyId: string | null, bootId: string | null) =>
    ({ event, timestamp: '2026-09-09T10:00:00Z', journeyId, bootId });

describe('#1421 P1 — the boot authority is declared, not inferred from journey ordering', () => {
    it('POSITIVE CONTROL: one ordinary controlled boot with its own receipts QUALIFIES', () => {
        /**
         * The case that must keep working. Every HOLD below is only worth having if the normal path
         * still passes — a rule that refuses everything is not a gate, it is an outage, and the
         * previous correction was exactly that for any second journey.
         */
        const rows = [
            row('account_identified', 'pre-product', 'boot-1'),
            row('telemetry_positive_control', 'pre-product', 'boot-1'),
            row('recording_started', 'journey-A', 'boot-1'),
        ];

        const boot = resolveBootAuthority(rows, 'journey-A');
        expect(boot.ok, 'an ordinary boot resolves its authority').toBe(true);
        if (!boot.ok) return;
        expect(bootScopedReceiptFamilies(rows, boot.bootId, RECEIPTS).sort(),
            'and both of its own receipt families qualify').toEqual([...RECEIPTS].sort());
    });

    it('CASUALTY: ONE boot, TWO journeys — both associate with that boot and keep its receipts', () => {
        /**
         * The regression the position rule introduced. A tab leaves the product and re-enters without
         * reloading, so `ensureJourneyBoundary()` mints journey B inside the same boot. The receipts
         * were emitted once, at sign-in, BEFORE journey A. Under the window rule journey A became
         * B's lower bound and excluded them, so an otherwise complete second journey always HELD.
         */
        const rows = [
            row('account_identified', 'pre-product', 'boot-1'),
            row('telemetry_positive_control', 'pre-product', 'boot-1'),
            row('recording_started', 'journey-A', 'boot-1'),
            row('recording_started', 'journey-B', 'boot-1'),
        ];

        for (const journey of ['journey-A', 'journey-B']) {
            const boot = resolveBootAuthority(rows, journey);
            expect(boot.ok, `${journey} resolves its boot`).toBe(true);
            if (!boot.ok) continue;
            expect(boot.bootId).toBe('boot-1');
            expect(bootScopedReceiptFamilies(rows, boot.bootId, RECEIPTS).sort(),
                `${journey} keeps the receipts its own boot emitted`).toEqual([...RECEIPTS].sort());
        }
    });

    it('CASUALTY: TWO boots, same account/release/class — the other boot\'s receipts do not qualify', () => {
        /**
         * The original defect, and the one the position rule was supposed to close. Boot 2's journey
         * has no receipts of its own; boot 1's must not stand in for them.
         */
        const rows = [
            row('account_identified', 'pre-product', 'boot-1'),
            row('telemetry_positive_control', 'pre-product', 'boot-1'),
            row('recording_started', 'journey-A', 'boot-1'),
            row('recording_started', 'journey-B', 'boot-2'),
        ];

        const boot = resolveBootAuthority(rows, 'journey-B');
        expect(boot.ok).toBe(true);
        if (!boot.ok) return;
        expect(boot.bootId).toBe('boot-2');
        expect(bootScopedReceiptFamilies(rows, boot.bootId, RECEIPTS),
            "boot 1's receipts are not evidence about boot 2").toEqual([]);
    });

    it('CASUALTY: a journey with NO boot identity HOLDs', () => {
        // Fails closed. A qualification that cannot establish which boot produced the evidence has not
        // qualified anything, and an absent id is unusable authority — never a wildcard that matches all.
        const rows = [row('recording_started', 'journey-A', null)];
        const boot = resolveBootAuthority(rows, 'journey-A');
        expect(boot.ok).toBe(false);
        if (boot.ok) return;
        expect(boot.reason).toMatch(/no boot identity/);
    });

    it('CASUALTY: a journey whose rows CONFLICT about the boot HOLDs', () => {
        const rows = [
            row('recording_started', 'journey-A', 'boot-1'),
            row('recording_stopped', 'journey-A', 'boot-2'),
        ];
        const boot = resolveBootAuthority(rows, 'journey-A');
        expect(boot.ok).toBe(false);
        if (boot.ok) return;
        expect(boot.reason).toMatch(/more than one boot identity/);
    });

    it('CASUALTY: a BLANK boot id is refused, not silently skipped', () => {
        // Skipping the blank row and accepting the rest would let one well-formed row speak for a
        // journey whose other rows disagree — the conflict case, wearing a different mask.
        const rows = [
            row('recording_started', 'journey-A', 'boot-1'),
            row('recording_stopped', 'journey-A', '   '),
        ];
        expect(resolveBootAuthority(rows, 'journey-A').ok).toBe(false);
        expect(receiptBelongsToBoot(row('account_identified', null, '  '), 'boot-1'),
            'a blank id matches nothing').toBe(false);
    });

    it('CASUALTY: another boot\'s receipts INSIDE the same timestamp window still do not qualify', () => {
        /**
         * The position rule's whole premise was that timing separates boots. It does not, and this
         * pins that the replacement does not quietly depend on timing either: every row here carries
         * the SAME instant, so a window-based rule has nothing to work with and only the declared
         * authority can decide. Account, release and traffic class are identical by construction.
         */
        const at = '2026-09-09T10:00:00Z';
        const rows = [
            { event: 'account_identified', timestamp: at, journeyId: 'pre-product', bootId: 'boot-1' },
            { event: 'telemetry_positive_control', timestamp: at, journeyId: 'pre-product', bootId: 'boot-1' },
            { event: 'recording_started', timestamp: at, journeyId: 'journey-B', bootId: 'boot-2' },
        ];

        const boot = resolveBootAuthority(rows, 'journey-B');
        expect(boot.ok).toBe(true);
        if (!boot.ok) return;
        expect(bootScopedReceiptFamilies(rows, boot.bootId, RECEIPTS),
            'identical timestamps do not make another boot\'s receipts ours').toEqual([]);
    });

    it('CASUALTY: a journey with no readable events HOLDs', () => {
        const boot = resolveBootAuthority([row('recording_started', 'journey-Z', 'boot-9')], 'journey-A');
        expect(boot.ok).toBe(false);
        if (boot.ok) return;
        expect(boot.reason).toMatch(/no readable events/);
    });
});

describe('#1421 P1 — the readback fetches what the boot authority depends on', () => {
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
        // The receipts are emitted under the PRE-PRODUCT journey, so a query scoped to the selected
        // journey id cannot return them at all — and the boot authority would have nothing to match.
        expect(query()).not.toMatch(/journey_id\s*=/);
    });

    it('CASUALTY: it still binds identity, release, traffic class and the governed vocabulary', () => {
        // Widening the scope must not widen it past the person, the build or the allowlist.
        const q = query();
        expect(q).toContain("distinct_id = 'person-1'");
        expect(q).toContain("properties.release_sha = 'abc123'");
        expect(q).toContain("properties.traffic_type = 'controlled'");
        expect(q).toContain("event IN ('account_identified', 'telemetry_positive_control', 'recording_started')");
    });
});

describe('#1421 P1 — the boot id identifies a boot, and a reload is a new boot', () => {
    it('CASUALTY: it is stable within a boot and DIFFERENT after a reload', () => {
        /**
         * Both halves matter. A value that changed mid-boot would be indistinguishable from a second
         * boot and would reintroduce the ambiguity this replaced; a value that survived a reload would
         * let the previous boot's receipts qualify the new one, which is the original defect.
         *
         * `beginJourney()` deliberately does NOT touch it — that is the entire point of the fix.
         */
        __resetBootIdentityForTests();
        const first = currentBootId();
        expect(currentBootId(), 'stable within one boot').toBe(first);
        beginJourney();
        expect(currentBootId(), 'a new journey is NOT a new boot').toBe(first);

        // A reload is the only thing that ends a boot.
        __resetBootIdentityForTests();
        expect(currentBootId(), 'a reload mints a different boot').not.toBe(first);
    });
});
