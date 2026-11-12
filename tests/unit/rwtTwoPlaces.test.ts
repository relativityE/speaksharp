// AHT-11 (one account, two places) — fifteen-case front-run review 2026-11-10, F3 and F4: the same-browser tab is refused by
// this browser's own tab lock only (never the account lease's copy), and the displaced take's server fence stamp is read and
// required. Both rows fail closed: an unreadable observation is HOLD or FAIL, never PASS.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BLOCKED_COPY, type TabState } from '../live/helpers/rwtAbandonTakeover';
import {
    DISPLACED_FENCE_COLUMNS, type FenceRowRead, LOCAL_TAB_LOCK_COPY, LOCAL_TAB_LOCK_WORDINGS, displacedFenceVerdict, sameBrowserRefusedVerdict,
} from '../live/helpers/rwtTwoPlaces';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(path.resolve(here, '..', '..', rel), 'utf8');

const recordingA: TabState = { runtimeState: 'RECORDING', recorderVisible: true, liveTracks: 1 };
const idleB: TabState = { runtimeState: 'READY', recorderVisible: false, liveTracks: 0 };
const local = { localCopyShown: true, leaseCopyShown: false, tabB: idleB, tabA: recordingA } as const;

describe('same-browser-refused — only this browser\'s own tab lock refuses', () => {
    it('PASS: the local tab-lock copy, no lease copy, no engine on the refused tab, and tab A still recording', () => {
        expect(sameBrowserRefusedVerdict(local).status).toBe('PASS');
    });
    it('FAIL: the account lease\'s copy on the same-browser tab, even with the local copy also present', () => {
        const v = sameBrowserRefusedVerdict({ ...local, localCopyShown: false, leaseCopyShown: true });
        expect(v.status).toBe('FAIL');
        expect(v.detail).toMatch(/account lease/);
        expect(sameBrowserRefusedVerdict({ ...local, leaseCopyShown: true }).status).toBe('FAIL');
    });
    it('FAIL: no refusal copy at all', () => {
        expect(sameBrowserRefusedVerdict({ ...local, localCopyShown: false }).status).toBe('FAIL');
    });
    it('FAIL: the refused tab started an engine, or tab A stopped recording', () => {
        expect(sameBrowserRefusedVerdict({ ...local, tabB: { ...idleB, liveTracks: 1 } }).status).toBe('FAIL');
        expect(sameBrowserRefusedVerdict({ ...local, tabB: recordingA }).status).toBe('FAIL');
        expect(sameBrowserRefusedVerdict({ ...local, tabA: { ...recordingA, liveTracks: 0 } }).status).toBe('FAIL');
        expect(sameBrowserRefusedVerdict({ ...local, tabA: idleB }).status).toBe('FAIL');
    });
    it('HOLD: a look that could not be made is never a pass', () => {
        expect(sameBrowserRefusedVerdict({ ...local, localCopyShown: null }).status).toBe('HOLD');
        expect(sameBrowserRefusedVerdict({ ...local, leaseCopyShown: null }).status).toBe('HOLD');
    });
    it('the local copy matches both product wordings whole, and never the lease copy or a longer line', () => {
        for (const w of LOCAL_TAB_LOCK_WORDINGS) expect(LOCAL_TAB_LOCK_COPY.test(w)).toBe(true);
        const lease = 'A recording is active on another device. Stop it there, or press Start again to take over here — that stops the recording there, and what it recorded so far is saved.';
        expect(BLOCKED_COPY.test(lease)).toBe(true);
        expect(LOCAL_TAB_LOCK_COPY.test(lease)).toBe(false);
        expect(LOCAL_TAB_LOCK_COPY.test(`${lease} Active session in another tab.`)).toBe(false);
        expect(LOCAL_TAB_LOCK_COPY.test('⛔ Active session in another tab.')).toBe(false);
    });
    it('both local wordings are the product\'s own (status line strips the leading emoji)', () => {
        expect(src('frontend/src/hooks/useSessionLifecycle.ts')).toContain(`'⛔ ${LOCAL_TAB_LOCK_WORDINGS[0]}'`);
        expect(src('frontend/src/services/SpeechRuntimeController.ts')).toContain(`'⛔ ${LOCAL_TAB_LOCK_WORDINGS[1]}'`);
        expect(src('frontend/src/components/session/StatusNotificationBar.tsx')).toContain("status.message?.replace(/^(?:⛔|⚠️|🚫)\\s*/u, '').trim()");
    });
});

const OWNER = 'owner-uid';
const ROW = { id: 'displaced-id', user_id: OWNER, recording_fenced_at: '2026-11-10T12:00:00.123+00:00', recording_fenced_reason: 'displaced' };
const read = (...rows: unknown[]): FenceRowRead => ({ state: 'observed', rows });
const fence = (over: Partial<Parameters<typeof displacedFenceVerdict>[0]> = {}) =>
    displacedFenceVerdict({ read: read(ROW), displacedId: 'displaced-id', takeOverId: 'takeover-id', ownerId: OWNER, ...over });

describe('takeover-fences-old-owner — the displaced take\'s server fence stamp', () => {
    it('PASS: the displaced take\'s own row on this account carries a timestamp and reason displaced', () => {
        const v = fence();
        expect(v.status).toBe('PASS');
        expect(v.evidence).toEqual({ fenceRead: 'observed', fencedAtSet: true, fencedReason: 'displaced' });
    });
    it('FAIL: never fenced, fenced for another reason, or a reason with no stamp', () => {
        expect(fence({ read: read({ ...ROW, recording_fenced_at: null, recording_fenced_reason: null }) }).status).toBe('FAIL');
        const saveOnly = fence({ read: read({ ...ROW, recording_fenced_reason: 'save_only' }) });
        expect(saveOnly.status).toBe('FAIL');
        expect(saveOnly.evidence.fencedReason).toBe('save_only');
        expect(fence({ read: read({ ...ROW, recording_fenced_reason: null }) }).status).toBe('FAIL');
        expect(fence({ read: read({ ...ROW, recording_fenced_reason: 'something-else' }) }).evidence.fencedReason).toBe('other');
        expect(fence({ read: read({ ...ROW, recording_fenced_at: null }) }).status).toBe('FAIL');
    });
    it('FAIL: the row is missing, belongs to another account, or both tabs bound the same session', () => {
        expect(fence({ read: read() }).status).toBe('FAIL');
        expect(fence({ read: read({ ...ROW, user_id: 'someone-else' }) }).status).toBe('FAIL');
        expect(fence({ takeOverId: 'displaced-id' }).status).toBe('FAIL');
    });
    it('HOLD: unreadable, unbound, ambiguous or malformed reads are never a pass', () => {
        expect(fence({ read: { state: 'unreadable', reason: 'fence read timed out' } }).status).toBe('HOLD');
        expect(fence({ displacedId: null }).status).toBe('HOLD');
        expect(fence({ ownerId: '' }).status).toBe('HOLD');
        expect(fence({ read: read(ROW, ROW) }).status).toBe('HOLD');
        expect(fence({ read: read({ ...ROW, id: 'another-id' }) }).status).toBe('HOLD');
        expect(fence({ read: read(null) }).status).toBe('HOLD');
        expect(fence({ read: read({ ...ROW, recording_fenced_at: 'not a time' }) }).status).toBe('HOLD');
        expect(fence({ read: read({ ...ROW, recording_fenced_at: 12 }) }).status).toBe('HOLD');
        const noColumn: Record<string, unknown> = { ...ROW };
        delete noColumn.recording_fenced_at;
        expect(fence({ read: read(noColumn) }).status).toBe('HOLD');
    });
    it('the columns read are the #1476 schema\'s, the same the harness reads', () => {
        const migration = src('backend/supabase/migrations/20260923120000_one_active_engine_per_account_1476.sql');
        expect(migration).toContain('ADD COLUMN IF NOT EXISTS recording_fenced_at timestamptz');
        expect(migration).toContain('ADD COLUMN IF NOT EXISTS recording_fenced_reason text');
        expect(migration).toContain("SET recording_fenced_at = now(), recording_fenced_reason = 'displaced'");
        expect(DISPLACED_FENCE_COLUMNS.split(',')).toEqual(['id', 'user_id', 'recording_fenced_at', 'recording_fenced_reason']);
        expect(src('tools/cloud-test/harness/draft-adapters/oracles/index.cjs')).toContain("old.recording_fenced_reason==='displaced'");
    });
});

describe('the AHT-11 spec wiring', () => {
    const spec = src('tests/live/rwt-abandon-and-two-tabs.live.spec.ts');
    const test11 = spec.slice(spec.indexOf("test('one account, two places"));

    it('the same-browser tab is judged by its own copy observation and the case-only verdict, never the lease-or-local locator', () => {
        const press = test11.indexOf("await sameBrowserTab.getByTestId('mic-start').click();");
        const look = test11.indexOf('const localRefusal = await sameBrowserRefusalCopy(sameBrowserTab);');
        const verdict = test11.indexOf('const local = sameBrowserRefusedVerdict({ ...localRefusal, tabB: refusedLocal, tabA: stillA });');
        const row = test11.indexOf("receipt.row('same-browser tab is refused', local.status");
        expect(press).toBeGreaterThan(0);
        expect(press).toBeLessThan(look);
        expect(look).toBeLessThan(verdict);
        expect(verdict).toBeLessThan(row);
        expect(test11).not.toContain('refusalShown(sameBrowserTab)');
        expect(test11).not.toContain('secondTabBlockedVerdict(');
        const helper = spec.slice(spec.indexOf('async function sameBrowserRefusalCopy'), spec.indexOf('async function readDisplacedFence'));
        expect(helper).toContain('page.getByText(LOCAL_TAB_LOCK_COPY)');
        expect(helper).toContain('page.getByText(BLOCKED_COPY)');
        expect(helper).not.toContain('SAME_BROWSER_TAB_COPY');
    });
    it('the fence is read by the service role for the displaced take, after both takes saved, inside the journey', () => {
        const bound = test11.indexOf('const displacedId = await persistedId(tabA);');
        const saved = test11.indexOf("receipt.row('both takes saved, none left active'");
        const read = test11.indexOf('read: await readDisplacedFence(displacedId), displacedId, takeOverId, ownerId: owner.uid');
        const row = test11.indexOf("receipt.row('displaced take is permanently fenced', oldOwnerFence.status");
        const caught = test11.indexOf('} catch (error) {');
        expect(bound).toBeGreaterThan(0);
        expect(bound).toBeLessThan(saved);
        expect(saved).toBeLessThan(read);
        expect(read).toBeLessThan(row);
        expect(row).toBeLessThan(caught);
        const reader = spec.slice(spec.indexOf('async function readDisplacedFence'), spec.indexOf('async function readRows'));
        expect(reader).toContain("admin.from('sessions').select(DISPLACED_FENCE_COLUMNS).eq('id', id)");
        expect(reader).toContain('30_000');
        // Fail closed: exactly one path reports an observed read; every other path (no client, no id, error, timeout, throw) is unreadable.
        expect(reader.match(/state: 'observed'/g)).toHaveLength(1);
        expect(reader.match(/state: 'unreadable'/g)?.length).toBeGreaterThanOrEqual(5);
    });
    it('the AHT-09/10 return Start still uses the lease-or-local locator (unchanged)', () => {
        expect(spec).toContain('refusalCopyShown = await refusalShown(returned);');
    });
});
