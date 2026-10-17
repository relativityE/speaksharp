// #1407 / #1491 6180077610 — the Focus FIRST take is saved exactly once, and the one completed save is the take the page bound.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { firstTakeSavedExactlyOnceVerdict } from '../live/helpers/rwtOracles';
import { requiredAutomatedRows } from '../live/helpers/rwtAcceptance';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('firstTakeSavedExactlyOnceVerdict', () => {
    it('one completed session that is the bound take → PASS', () => {
        expect(firstTakeSavedExactlyOnceVerdict({ persistedId: 's1', completedIds: ['s1'] }).verdict).toBe('PASS');
    });
    it('a duplicate completed save under a different primary key → FAIL', () => {
        const v = firstTakeSavedExactlyOnceVerdict({ persistedId: 's1', completedIds: ['s1', 's1-dup'] });
        expect(v.verdict).toBe('FAIL');
        expect(v.detail).toMatch(/duplicate/);
    });
    it('the one completed row is not the take the page bound → FAIL', () => {
        expect(firstTakeSavedExactlyOnceVerdict({ persistedId: 's1', completedIds: ['other'] }).verdict).toBe('FAIL');
    });
    it('no completed row → FAIL', () => {
        expect(firstTakeSavedExactlyOnceVerdict({ persistedId: 's1', completedIds: [] }).verdict).toBe('FAIL');
    });
    it('a missing page identity cannot pass', () => {
        expect(firstTakeSavedExactlyOnceVerdict({ persistedId: null, completedIds: ['s1'] }).verdict).toBe('FAIL');
    });
    it('a query error fails closed', () => {
        expect(firstTakeSavedExactlyOnceVerdict({ persistedId: 's1', completedIds: null }).verdict).toBe('FAIL');
    });
});

describe('wiring — the accepted receipt carries the row, not only an unused helper', () => {
    const journey = readFileSync(path.join(here, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
    it('the shared Focus journey writes "saved exactly once" from the verdict at the first take\'s save', () => {
        expect(journey).toContain("receipt.row('saved exactly once', once.verdict, once.detail");
        expect(journey).toContain('firstTakeSavedExactlyOnceVerdict({');
        const saved = journey.indexOf("receipt.row('session saved'");
        const once = journey.indexOf("receipt.row('saved exactly once'");
        expect(saved).toBeGreaterThan(-1);
        expect(once, 'recorded right after the first take saves').toBeGreaterThan(saved);
    });
    it('both Focus suites (full and partial) REQUIRE the row for acceptance', () => {
        for (const suite of ['focus-points-session', 'focus-points-partial'] as const) {
            expect(requiredAutomatedRows(suite)?.product ?? []).toContain('saved exactly once');
        }
    });
});
