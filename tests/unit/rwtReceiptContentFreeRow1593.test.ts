// @vitest-environment node
/**
 * #1593 (live run 2026-10-18, cases 4 and 8) — the finalizer requires `receipt content-free` on EVERY suite
 * (`ALWAYS_AUTOMATED_ROWS`), documented as written by `RwtReceipt.write()`. It was not: only the suites with their own
 * content scan wrote it, so a passing `feedback-association-boundaries-no-session` journey (run 39165658192) failed
 * finalization on a missing row. `write()` now records the row from its own leak guard — and only when the guard found
 * nothing, because a leak replaces the whole receipt with the redacted failure receipt.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RwtReceipt } from '../live/helpers/rwtJourney';
import { validateReceipt } from '../live/helpers/rwtAcceptance';

const PLAN = { journeys: [], reportedJourneyIds: [], missingBindings: [] };
const TEST_INFO = { status: 'passed' } as never;
let cwd: string;
let dir: string;

beforeEach(() => {
    cwd = process.cwd();
    dir = mkdtempSync(path.join(tmpdir(), 'rwt-content-free-'));
    process.chdir(dir);
});
afterEach(() => process.chdir(cwd));

const written = (suite: string) => JSON.parse(readFileSync(path.join(dir, 'test-results', 'rwt', `${suite}.receipt.json`), 'utf8'));
const contentFreeRows = (body: { rows?: { step: string; verdict: string }[] }) => (body.rows ?? []).filter((r) => r.step === 'receipt content-free');

describe('RwtReceipt.write() — every suite carries exactly one receipt content-free row', () => {
    it('a suite with no content scan of its own gets the guard\'s PASS row', () => {
        const r = new RwtReceipt('pending-start-navigation');
        r.row('run-owned signup', 'PASS', 'fresh account');
        r.write(TEST_INFO, PLAN, ['canary']);
        expect(contentFreeRows(written('pending-start-navigation'))).toEqual([
            expect.objectContaining({ step: 'receipt content-free', verdict: 'PASS' }),
        ]);
    });

    it('a suite\'s own content-free row is kept and never duplicated', () => {
        // (A FAIL row asserts inside `row()` by design, so the suite's own FAIL never reaches write() as a passing test.)
        const r = new RwtReceipt('open-mic-first-session');
        r.row('receipt content-free', 'PASS', 'the suite\'s own scan');
        r.write(TEST_INFO, PLAN, ['canary']);
        const rows = contentFreeRows(written('open-mic-first-session'));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ verdict: 'PASS', detail: 'the suite\'s own scan' });
    });

    it('a leak publishes the redacted failure receipt — with no PASS content-free row — and fails the test', () => {
        const r = new RwtReceipt('pending-start-navigation');
        r.forbid('person@example.test');
        r.row('run-owned signup', 'PASS', 'signed up person@example.test');
        expect(() => r.write(TEST_INFO, PLAN, ['canary'])).toThrow(/RWT receipt contaminated/);
        const body = written('pending-start-navigation');
        expect(body).toMatchObject({ contaminated: true, acceptance: 'FAIL' });
        expect(contentFreeRows(body)).toEqual([]);
        expect(JSON.stringify(body)).not.toContain('person@example.test');
    });

    it('the written receipt no longer fails validation for a missing content-free row', () => {
        const r = new RwtReceipt('pending-start-navigation');
        r.row('run-owned signup', 'PASS', 'fresh account');
        r.write(TEST_INFO, PLAN, ['canary']);
        expect(validateReceipt(written('pending-start-navigation')).errors.join(' ')).not.toMatch(/"receipt content-free"/);
    });
});
