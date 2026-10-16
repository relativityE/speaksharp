// @vitest-environment node
/**
 * #1258 R1 (row 15) — the Retry Save live spec's verdicts, each with the failing controls a real run could produce, and
 * the guards that keep the spec, its helper, the acceptance map and the banner component in step.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    RECOVERY_COPY, SAVE_RETRY_SUITE, type SessionRowFacts, completionDropDisposition, nextTakeRetentionVerdict,
    recoveryBannerVerdict, savedTakeReadbackVerdict,
} from '../live/helpers/rwtSaveRetry';
import {
    SAVE_RETRY_REQUEST_LOST_SUITE, SAVE_RETRY_RESPONSE_LOST_SUITE, requiredAutomatedRows, requiredHumanObservations,
} from '../live/helpers/rwtAcceptance';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const row = (over: Partial<SessionRowFacts> = {}): SessionRowFacts => ({
    id: 's1', status: 'completed', hasIdempotencyKey: true, transcriptState: 'available', transcriptLength: 120, ...over,
});

describe('completionDropDisposition — the fault was actually exercised', () => {
    it('request lost: dropped and nothing saved → PASS; a completed row anyway → HOLD; never dropped → HOLD', () => {
        const dropped = { completionPosts: 1, droppedStatus: null, dropped: true };
        expect(completionDropDisposition('request-lost', dropped, [row({ status: 'in_progress', transcriptState: null, transcriptLength: 0 })]).status).toBe('PASS');
        expect(completionDropDisposition('request-lost', dropped, [row()]).status).toBe('HOLD');
        expect(completionDropDisposition('request-lost', { ...dropped, dropped: false, completionPosts: 0 }, []).status).toBe('HOLD');
    });

    it('response lost: the server answered 2xx and saved one row → PASS; a server error or no saved row → HOLD', () => {
        const dropped = { completionPosts: 1, droppedStatus: 200, dropped: true };
        expect(completionDropDisposition('response-lost', dropped, [row()]).status).toBe('PASS');
        expect(completionDropDisposition('response-lost', { ...dropped, droppedStatus: 500 }, [row({ status: 'in_progress' })]).status).toBe('HOLD');
        expect(completionDropDisposition('response-lost', dropped, [row({ status: 'in_progress' })]).status).toBe('HOLD');
    });
});

describe('recoveryBannerVerdict — every claim is true of the page', () => {
    const ok = {
        bannerShown: true, resolution: 'full_save', retryOffered: true, wordsOnPage: 80,
        message: `${RECOVERY_COPY.full_save} ${RECOVERY_COPY.words}`,
    };
    it('the truthful banner → PASS', () => { expect(recoveryBannerVerdict(ok).status).toBe('PASS'); });
    it('no banner, the attribution state, or no Retry Save → FAIL', () => {
        expect(recoveryBannerVerdict({ ...ok, bannerShown: false }).status).toBe('FAIL');
        expect(recoveryBannerVerdict({ ...ok, resolution: 'attribution' }).detail).toMatch(/wrong unresolved state/);
        expect(recoveryBannerVerdict({ ...ok, retryOffered: false }).status).toBe('FAIL');
    });
    it('copy for the other state, no words claim, or a words claim with no words on the page → FAIL', () => {
        expect(recoveryBannerVerdict({ ...ok, resolution: 'initial_save' }).detail).toMatch(/does not match/);
        expect(recoveryBannerVerdict({ ...ok, message: RECOVERY_COPY.full_save }).detail).toMatch(/words are still here/);
        expect(recoveryBannerVerdict({ ...ok, wordsOnPage: 0 }).detail).toMatch(/none are on the page/);
    });
});

describe('savedTakeReadbackVerdict — one saved session for the take', () => {
    it('one completed, bound, keyed row with its transcript → PASS', () => {
        expect(savedTakeReadbackVerdict([row()], 's1').status).toBe('PASS');
    });
    it('a duplicate row (the replay saved twice) → FAIL', () => {
        expect(savedTakeReadbackVerdict([row(), row({ id: 's2' })], 's1').detail).toBe('2 session rows exist for one take');
    });
    it('unbound, a different row, not completed, no key, or no transcript → FAIL', () => {
        expect(savedTakeReadbackVerdict([row()], null).status).toBe('FAIL');
        expect(savedTakeReadbackVerdict([row()], 's9').status).toBe('FAIL');
        expect(savedTakeReadbackVerdict([row({ status: 'failed' })], 's1').status).toBe('FAIL');
        expect(savedTakeReadbackVerdict([row({ hasIdempotencyKey: false })], 's1').status).toBe('FAIL');
        expect(savedTakeReadbackVerdict([row({ transcriptState: 'expired', transcriptLength: 0 })], 's1').status).toBe('FAIL');
    });
});

describe('nextTakeRetentionVerdict — the next take saves only itself', () => {
    const older = row({ id: 's1', transcriptState: 'expired', transcriptLength: 0 });
    const newer = row({ id: 's2' });
    it('two completed rows, only the newest keeps its transcript → PASS', () => {
        expect(nextTakeRetentionVerdict([older, newer], 's1', 's2').status).toBe('PASS');
    });
    it('no new session, an extra row, or the older take still keeping its transcript → FAIL', () => {
        expect(nextTakeRetentionVerdict([older, newer], 's1', 's1').status).toBe('FAIL');
        expect(nextTakeRetentionVerdict([older, newer, row({ id: 's3' })], 's1', 's2').status).toBe('FAIL');
        expect(nextTakeRetentionVerdict([row({ id: 's1' }), newer], 's1', 's2').detail).toMatch(/newest-one retention/);
        expect(nextTakeRetentionVerdict([older, row({ id: 's2', status: 'failed' })], 's1', 's2').status).toBe('FAIL');
    });
});

describe('guards — the spec, the acceptance map and the banner stay in step', () => {
    const spec = src('tests/live/rwt-save-retry-recovery.live.spec.ts');
    const banner = src('frontend/src/components/session/UnresolvedRecoveryBanner.tsx');

    it('the banner copy the verdict checks is the component\'s own copy and test ids', () => {
        for (const copy of Object.values(RECOVERY_COPY)) expect(banner).toContain(copy);
        for (const id of ['session-unresolved-recovery', 'session-unresolved-message', 'session-retry-save', 'session-discard']) {
            expect(banner.includes(`"${id}"`) || banner.includes(`'${id}'`)).toBe(true);
            expect(spec).toContain(`'${id}'`);
        }
        expect(banner).toContain('data-resolution={pendingResolutionKind}');
    });

    it('both variant suites are known, fully automated, and require every row the spec writes plus its own cleanup', () => {
        expect(SAVE_RETRY_REQUEST_LOST_SUITE).toBe(`${SAVE_RETRY_SUITE}-request-lost`);
        expect(SAVE_RETRY_RESPONSE_LOST_SUITE).toBe(`${SAVE_RETRY_SUITE}-response-lost`);
        expect(spec).toContain('`${SAVE_RETRY_SUITE}-${variant}`');
        for (const suite of [SAVE_RETRY_REQUEST_LOST_SUITE, SAVE_RETRY_RESPONSE_LOST_SUITE]) {
            expect(requiredHumanObservations({ suite } as never)).toEqual([]);
            const inv = requiredAutomatedRows(suite)!;
            expect(inv.required).toContain('run-owned cleanup');
            expect(inv.absent).toContain('journey telemetry received');
            for (const step of inv.product) expect({ step, written: spec.includes(`'${step}'`) || step === 'coaching request budget' }).toEqual({ step, written: true });
        }
    });

    it('only the first completion request is altered; Retry Save\'s replay reaches the server untouched', () => {
        expect(spec).toContain("const COMPLETION_RPC = '**/rest/v1/rpc/complete_session_v2';");
        expect(spec).toContain('if (drop.dropped) return route.fallback();');
        expect(spec).toContain("if (variant === 'request-lost') return route.abort('failed');");
        expect(spec).toMatch(/const response = await route\.fetch\(\);\s+drop\.droppedStatus = response\.status\(\);\s+return route\.abort\('failed'\);/);
    });

    it('the receipt stays content-free: rows record lengths, never transcript or banner text', () => {
        expect(spec).toContain('transcriptLength: typeof row.transcript === \'string\' ? row.transcript.length : 0');
        expect(spec).toContain('messageLength: message.length');
        expect(spec).not.toMatch(/message: message|transcript: row\.transcript/);
    });
});
