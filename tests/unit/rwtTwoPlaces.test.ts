// AHT-11 (one account, two places) — fifteen-case front-run review 2026-11-10, F3 and F4: the same-browser tab is refused by
// this browser's own tab lock only (never the account lease's copy), and the displaced take's server fence stamp is read and
// required. Both rows fail closed: an unreadable observation is HOLD or FAIL, never PASS.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { BLOCKED_COPY, type TabState } from '../live/helpers/rwtAbandonTakeover';
import {
    DISPLACED_FENCE_COLUMNS, type FenceRowRead, LOCAL_TAB_LOCK_COPY, LOCAL_TAB_LOCK_WORDINGS, displacedFenceVerdict, sameBrowserRefusedVerdict,
} from '../live/helpers/rwtTwoPlaces';
import {
    ABANDON_TWO_PLACES_CONSENT_MODE, CONSENT_MODES, PRACTICE_PRIVACY_PROMPT, PRIVACY_MIGRATION_1835, captureConsentGate, settleFixedConsentOnPractice,
    type ChoiceClient,
} from '../live/helpers/rwtPracticeConsent';
import {
    ABANDON_CLOSE_TAB_SUITE, ABANDON_NAVIGATE_SUITE, TWO_TAB_SUITE, automatedEvaluation, receiptAcceptance, requiredAutomatedRows, type ReceiptRow,
} from '../live/helpers/rwtAcceptance';

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
        const press = test11.indexOf("await pressCaptureControl(sameBrowserTab, ['mic-start'], { beforeClick: () => requireGate(consentGate).confirm() });");
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

describe('J5.b/c and J6: the run\'s own account opts in before any Start (#1835; Sam, Nov 18)', () => {
    const spec = src('tests/live/rwt-abandon-and-two-tabs.live.spec.ts');
    const settleFn = spec.slice(spec.indexOf('async function settleRunConsent'), spec.indexOf('function requireGate'));
    const openFn = spec.slice(spec.indexOf('async function openOpenMic'), spec.indexOf('async function startFirstPrivateTake'));
    const firstTake = spec.slice(spec.indexOf('async function startFirstPrivateTake'), spec.indexOf('/** #1593 (live case 12)'));
    const abandon = spec.slice(spec.indexOf('async function abandonAndReturn'), spec.indexOf("test.describe('RWT — leaving a recording"));
    const test11 = spec.slice(spec.indexOf("test('one account, two places"));
    const CONSENT = 'practice privacy choice';
    /** #1835 (Sam, #1916): a direct capture-capable press reads the owner's row back INSIDE the press, at its click. */
    const pressAtClick = (page: string, ids: string) => `await pressCaptureControl(${page}, [${ids}], { beforeClick: () => requireGate(consentGate).confirm() });`;
    /** No readback runs as a statement before a press, and no capture control is clicked through a locator. */
    const STANDALONE_CONFIRM = /await requireGate\(consentGate\)\.confirm\(\);/g;
    const LOCATOR_CAPTURE_CLICK = /getByTestId\('mic-(start|download|retry)'\)\.click\(|data-testid="mic-(start|download|retry)"[^\n]*\.click\(/;

    it('the fixed mode is Save: Yes, Coaching: No, never read from the environment', () => {
        expect(CONSENT_MODES[ABANDON_TWO_PLACES_CONSENT_MODE]).toEqual({ transcriptSave: true, aiCoaching: false });
        expect(settleFn.match(/mode: ABANDON_TWO_PLACES_CONSENT_MODE, record/g)).toHaveLength(2);
        expect(spec).not.toContain('RWT_PRACTICE_CONSENT');
        expect(spec).not.toContain('consentModeFrom');
    });
    it('#1910\'s helpers settle the prompt and gate capture; the spec never writes the row itself or reads consent another way', () => {
        const settle = settleFn.indexOf('const consent = await settleFixedConsentOnPractice({ page, client, ownerId: owner.uid, migrationFiles,');
        const gate = settleFn.indexOf('return captureConsentGate({ consent, client, ownerId: owner.uid,');
        expect(settle).toBeGreaterThan(0);
        expect(settle).toBeLessThan(gate);
        expect(settleFn).toContain("readdirSync(resolvePath(process.cwd(), 'backend/supabase/migrations'))");
        expect(settleFn).toContain(`receipt.row('${CONSENT}', status, detail, evidence);`);
        // Sam (Nov 20): the old path recorded PASS when a pre-#1835 build returned choice: null. No hand-written row remains.
        expect(spec).not.toContain(`receipt.row('${CONSENT}', 'PASS'`);
        expect(spec.match(new RegExp(`receipt\\.row\\('${CONSENT}'`, 'g'))).toHaveLength(1);
        expect(spec).not.toMatch(/settlePracticeConsent\(|readPracticeChoice\(|fixedConsentBeforeStartVerdict\(|answerPracticePrivacyPrompt/);
        expect(spec).not.toContain('consent.choice');
    });
    it('the first visit is answered on the Practice page, before Products → Open Mic', () => {
        const practice = openFn.indexOf("await page.goto('/practice');");
        const first = openFn.indexOf('if (firstVisit) await firstVisit();');
        const product = openFn.indexOf("await openProductsItem(page, 'open-mic');");
        expect(practice).toBeGreaterThan(0);
        expect(practice).toBeLessThan(first);
        expect(first).toBeLessThan(product);
    });
    it('the first take: the readback runs inside the cold model helper\'s press and inside the ordinary Start, at each click; only a confirmed capture records PASS', () => {
        expect(firstTake).toMatch(/\n\s*const setup = await preparePrivateModelIfPrompted\(page, 900_000, \{ beforeClick: \(\) => gate\.confirm\(\) \}\);\n\s*if \(setup\.recordingAlreadyStarted\) \{\n\s*gate\.recordPass\(\);\n\s*return;\n\s*\}/);
        expect(firstTake).toMatch(/\n\s*await startBenchmarkRecording\(page, label, undefined, \{ beforeClick: \(\) => gate\.confirm\(\) \}\);\n\s*gate\.recordPass\(\);\n\}/);
        expect(firstTake).not.toMatch(/await gate\.confirm\(\)/);
        expect(spec.match(/preparePrivateModelIfPrompted\(/g)).toHaveLength(1);
        expect(spec.match(/await startBenchmarkRecording\(/g)).toHaveLength(1);
        expect(spec.match(/recordPass\(\)/g)).toHaveLength(2);
    });
    it('J5.b/c: the first Practice visit settles it after the claim; every Start press, first take included, is confirmed first', () => {
        const claimed = abandon.indexOf('if (!claimed) return;');
        const open = abandon.indexOf('await openOpenMic(page, async () => { consentGate = await settleRunConsent(page, receipt, owner); });');
        const take = abandon.indexOf('await startFirstPrivateTake(page, `abandon-${variant}-1`, requireGate(consentGate));');
        expect(claimed).toBeGreaterThan(0);
        expect(claimed).toBeLessThan(open);
        expect(open).toBeLessThan(take);
        expect(abandon).toContain('await openOpenMic(returned);');
        expect(abandon.match(/settleRunConsent\(/g)).toHaveLength(1);
        // The return Start and the person's second press: each reads consent back inside the press, at its click.
        expect(abandon.split(pressAtClick('returned', "'mic-start'")).length - 1).toBe(2);
        expect(abandon.match(/pressCaptureControl\(/g)).toHaveLength(2);
        expect(abandon).not.toMatch(STANDALONE_CONFIRM);
        expect(abandon).not.toMatch(LOCATOR_CAPTURE_CLICK);
    });
    it('J6: tab A\'s first visit settles it; tab A\'s take, the same-browser press, both other-device presses are confirmed first', () => {
        const claimed = test11.indexOf('if (!claimed) return;');
        const open = test11.indexOf('await openOpenMic(tabA, async () => { consentGate = await settleRunConsent(tabA, receipt, owner); });');
        const take = test11.indexOf("await startFirstPrivateTake(tabA, 'two-tab-a', requireGate(consentGate));");
        expect(claimed).toBeGreaterThan(0);
        expect(claimed).toBeLessThan(open);
        expect(open).toBeLessThan(take);
        expect(test11).toContain('await openOpenMic(sameBrowserTab);');
        expect(test11).toContain('await openOpenMic(deviceB);');
        expect(test11.match(/settleRunConsent\(/g)).toHaveLength(1);
        expect(test11).toContain(pressAtClick('sameBrowserTab', "'mic-start'"));
        expect(test11).toContain(pressAtClick('deviceB', "'mic-start', 'mic-download'"));
        // The other device's first press: the readback is the LAST thing its in-press callback does (after the windows open),
        // and that callback is handed to pressCaptureControl, which runs it immediately before the click.
        expect(test11).toMatch(/pressPrivateStartForLease\(deviceB, waitForPrivateEngineReady, async \(\) => \{\n[\s\S]*?openedB = await deviceB\.evaluate\(openObservationWindow[^\n]*\n(\s*\/\/[^\n]*\n)*\s*await requireGate\(consentGate\)\.confirm\(\);\n\s*\}, \(p, control, beforeClick\) => pressCaptureControl\(p, \[control\], \{ beforeClick, waitMs: 30_000, clickTimeoutMs: 30_000 \}\)\.then\(\(\) => undefined\)\);/);
        expect(test11.match(STANDALONE_CONFIRM), 'only the lease press\'s in-press callback').toHaveLength(1);
        expect(test11.match(/pressCaptureControl\(/g)).toHaveLength(3);
        expect(test11).not.toMatch(LOCATOR_CAPTURE_CLICK);
        expect(test11).not.toContain('.first().click()');
    });
    it('a press before the first visit settled the gate is refused', () => {
        expect(spec).toContain("if (!gate) throw new Error('HOLD practice consent: not_settled');");
        expect(spec.match(/let consentGate: CaptureConsentGate \| null = null;/g)).toHaveLength(2);
    });

    // Caller-level controls (Sam, Nov 20): the journey's order offline, with the spec's own helpers and its fixed mode. A press
    // happens only after the confirm before it passed, as in the spec; `presses` counts later presses (return Start, second
    // press, same-browser tab, other device, take-over), each confirmed first.
    const OWNER = 'owner-1';
    const ROW = { user_id: OWNER, transcript_save: true, ai_coaching: false, consent_version: 1 };
    type Table = { rows: Array<Record<string, unknown>> };
    function client(table: Table | 'absent', broken: () => boolean = () => false): ChoiceClient {
        const fail = (code: string) => ({ data: null, error: { code } });
        return {
            from: () => ({
                select: () => ({
                    eq: (_col: string, v: string) => ({
                        maybeSingle: async () => table === 'absent' ? fail('PGRST205') : broken() ? fail('57014')
                            : { data: table.rows.find((r) => r.user_id === v) ?? null, error: null },
                    }),
                    limit: async () => table === 'absent' ? fail('42P01') : { data: [], error: null },
                }),
            }),
        };
    }
    /** The #1835 prompt as the product renders it, for Save: Yes then Coaching: No (enough for the shared answerer). */
    function prompt(onContinue: () => void) {
        const state = { save: null as boolean | null, ai: null as boolean | null, open: true };
        const clicks: string[] = [];
        const P = PRACTICE_PRIVACY_PROMPT;
        const control = (id: string) => ({
            click: async () => {
                clicks.push(id);
                if (id === P.saveYes) state.save = true;
                if (id === P.aiYes || id === P.aiNo) state.ai = id === P.aiYes;
                if (id === P.continue) { state.open = false; onContinue(); }
            },
            getAttribute: async (name: string) => {
                if (name === 'aria-disabled') return null;
                if (name !== 'aria-checked') return null;
                if (id === P.aiYes || id === P.aiNo) return String(state.ai === (id === P.aiYes));
                return String(state.save === (id === P.saveYes));
            },
            isVisible: async () => id !== P.aiNeedsSave,
        });
        const root = { waitFor: async (o?: { state?: string }) => { if (o?.state === 'hidden' && state.open) throw new Error('Timeout'); }, getByTestId: control };
        return { page: { getByTestId: (id: string) => (id === P.root ? root : control(id)) } as unknown as Page, clicks };
    }
    type Row = { status: string; evidence: Record<string, string> };
    async function journey(opts: { files?: readonly string[] | null; absent?: boolean; onContinue?: (t: Table) => void;
        beforeCapture?: (t: Table) => void; beforePress?: number; change?: (t: Table) => void; broken?: () => boolean; presses?: number }) {
        const table: Table = { rows: [] };
        const { page, clicks } = prompt(() => (opts.onContinue ?? ((t) => t.rows.push({ ...ROW })))(table));
        const rows: Row[] = [];
        const record = (status: 'PASS' | 'FAIL' | 'HOLD', _detail: string, evidence: Record<string, string>) => rows.push({ status, evidence });
        const c = opts.absent ? client('absent') : client(table, opts.broken);
        let captures = 0;
        const outcome = await (async () => {
            const consent = await settleFixedConsentOnPractice({ page, client: c, ownerId: OWNER, migrationFiles: opts.files === undefined ? ['a.sql', PRIVACY_MIGRATION_1835] : opts.files,
                mode: ABANDON_TWO_PLACES_CONSENT_MODE, record });
            const gate = captureConsentGate({ consent, client: c, ownerId: OWNER, mode: ABANDON_TWO_PLACES_CONSENT_MODE, record });
            opts.beforeCapture?.(table);
            await gate.confirm();
            captures += 1; // the first take
            gate.recordPass();
            for (let i = 0; i < (opts.presses ?? 3); i++) {
                if (i === opts.beforePress) opts.change?.(table);
                await gate.confirm();
                captures += 1;
            }
            return 'all presses';
        })().catch((e: Error) => e.message);
        return { outcome, captures, rows, clicks };
    }

    it('caller PASS: the prompt is answered Save: Yes, Coaching: No; the row is PASS exactly once across every later press', async () => {
        const r = await journey({});
        expect(r.outcome).toBe('all presses');
        expect(r.captures).toBe(4);
        expect(r.clicks).toEqual([PRACTICE_PRIVACY_PROMPT.saveYes, PRACTICE_PRIVACY_PROMPT.aiNo, PRACTICE_PRIVACY_PROMPT.continue]);
        expect(r.rows).toEqual([{ status: 'PASS', evidence: { reason: 'choice_recorded', build: 'includes_1835', mode: 'save_on' } }]);
    });
    it('caller NEGATIVE (Sam, Nov 20): a pre-#1835 build, with no saved choice to read back, records FAIL and never presses Start', async () => {
        const r = await journey({ files: ['a.sql'], absent: true });
        expect(r.captures).toBe(0);
        expect(r.outcome).toBe('HOLD practice consent: legacy_build');
        expect(r.clicks).toEqual([]);
        expect(r.rows).toEqual([{ status: 'FAIL', evidence: { reason: 'legacy_build', build: 'predates_1835', mode: 'save_on' } }]);
    });
    it('caller NEGATIVE: an unknown build, or a prompt that recorded no choice, stops on Practice with a HOLD row', async () => {
        const unknown = await journey({ files: null });
        expect(unknown.captures).toBe(0);
        expect(unknown.rows).toEqual([{ status: 'HOLD', evidence: { reason: 'build_unknown', mode: 'save_on' } }]);
        const missing = await journey({ onContinue: () => undefined });
        expect(missing.captures).toBe(0);
        expect(missing.outcome).toBe('HOLD practice consent: choice_missing');
        expect(missing.rows).toEqual([{ status: 'HOLD', evidence: { reason: 'choice_missing', mode: 'save_on' } }]);
        const coachingOn = await journey({ onContinue: (t) => t.rows.push({ ...ROW, ai_coaching: true }) });
        expect(coachingOn.captures).toBe(0);
        expect(coachingOn.rows).toEqual([{ status: 'HOLD', evidence: { reason: 'choice_differs', mode: 'save_on' } }]);
    });
    it('caller NEGATIVE: a saved choice removed, changed or unreadable before the first take stops that take', async () => {
        const removed = await journey({ beforeCapture: (t) => { t.rows.length = 0; } });
        expect(removed.captures).toBe(0);
        expect(removed.rows).toEqual([expect.objectContaining({ status: 'FAIL', evidence: expect.objectContaining({ reason: 'readback_missing' }) })]);
        const changed = await journey({ beforeCapture: (t) => { t.rows[0] = { ...ROW, transcript_save: false }; } });
        expect(changed.captures).toBe(0);
        expect(changed.rows[0]).toMatchObject({ status: 'FAIL', evidence: { reason: 'readback_differs' } });
        let reads = 0;
        const unreadable = await journey({ broken: () => ++reads > 2 }); // settle reads twice; the first confirm cannot read
        expect(unreadable.captures).toBe(0);
        expect(unreadable.rows).toEqual([expect.objectContaining({ status: 'HOLD', evidence: expect.objectContaining({ reason: 'readback_unreadable' }) })]);
    });
    it('caller NEGATIVE: a saved choice removed before a later press stops that press (the first take\'s row stays its own PASS)', async () => {
        const r = await journey({ beforePress: 1, change: (t) => { t.rows.length = 0; } });
        expect(r.outcome).toBe('HOLD practice consent: readback_missing');
        expect(r.captures).toBe(2); // the first take and the return Start only; the second press never happens
        expect(r.rows).toEqual([expect.objectContaining({ status: 'PASS' })]);
    });
    for (const suite of [ABANDON_NAVIGATE_SUITE, ABANDON_CLOSE_TAB_SUITE, TWO_TAB_SUITE]) {
        const inventory = requiredAutomatedRows(suite)!;
        const rows: ReceiptRow[] = [...inventory.required, ...inventory.product].map((step) => ({ step, verdict: 'PASS', detail: 'fixture' }));
        const receipt = { suite, release: 'a'.repeat(40), rows, readback: { journeys: [], reportedJourneyIds: [] } };
        it(`${suite}: the privacy choice row is mandatory exactly once`, () => {
            expect(inventory.product.filter((x) => x === CONSENT)).toHaveLength(1);
            const evaluate = (candidate: ReceiptRow[]) => automatedEvaluation({ ...receipt, rows: candidate });
            expect(evaluate(rows).errors).toEqual([]);
            expect(receiptAcceptance(evaluate(rows).rows).acceptance).toBe('PASS');
            expect(evaluate(rows.filter((r) => r.step !== CONSENT)).errors.some((e) => e.includes(CONSENT))).toBe(true);
        });
        it(`${suite}: a HOLD or FAIL privacy choice cannot become PASS`, () => {
            for (const verdict of ['HOLD', 'FAIL'] as const) {
                const evaluated = automatedEvaluation({ ...receipt, rows: rows.map((r) => (r.step === CONSENT ? { ...r, verdict } : r)) });
                expect(evaluated.errors).toEqual([]);
                expect(receiptAcceptance(evaluated.rows).acceptance).toBe(verdict === 'FAIL' ? 'FAIL' : 'INCOMPLETE');
            }
        });
    }
});
