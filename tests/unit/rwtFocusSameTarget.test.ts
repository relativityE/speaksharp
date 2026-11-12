// AHT-02 / AHT-03 row `Practice again keeps the saved target` (front-run review fix 4): the harness `sameTarget` oracle for the
// Focus journey. The shown target and its stored open attempt must name the saved target of this Focus set; the source's target
// must be retained (the harness's own retention boundary); the repeat must save under the same set. Fail closed.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    FOCUS_SAME_TARGET_ROW, OPEN_ATTEMPT_KEY, PENDING_TARGET_TEXT, decidingRead, displayedTargetMatches, focusSameTargetVerdict,
    focusSetHash, instructionHash, pointHash, readTargetInPage, type FocusSameTargetInput, type FocusSet, type SessionRow, type TargetRead,
} from '../live/helpers/rwtFocusSameTarget';

const here = path.dirname(fileURLToPath(import.meta.url));
const journey = readFileSync(path.join(here, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
const OWNER = 'owner-uid';
const VERSION = 'gemini_coaching_focus_v1';
const NEXT = 'Name the budget before the timeline.';
const pair = { version: VERSION, what_worked: 'Clear opening.', what_to_try_next: `  ${NEXT}  ` };
const source: SessionRow = { id: 'src', user_id: OWNER, product: 'focus_points', ai_suggestions: pair, status: 'completed', transcript_state: 'kept' };
const focus: FocusSet = { briefId: 'brief-1', projectId: 'proj-1', topic: 'Quarterly review', labels: ['Budget', 'Timeline', 'Risks', 'Ask'] };
const attempt = (over: Record<string, unknown> = {}, focusOver: Record<string, unknown> = {}) => ({
    userId: OWNER, sourceSessionId: 'src',
    repeatTarget: {
        version: 1, criterion: 'repeat_cached_instruction_v1', product: 'focus_points', instructionHash: instructionHash(VERSION, NEXT),
        focus: { briefId: focus.briefId, projectId: focus.projectId, setHash: focusSetHash(focus.projectId, focus.briefId, focus.topic, focus.labels), ...focusOver },
        ...over,
    },
});
const ready = (o: unknown = attempt(), instruction = NEXT): TargetRead => ({ kind: 'ready', instruction, openAttempt: o });
const input = (over: Partial<FocusSameTargetInput> = {}): FocusSameTargetInput => ({
    ownerId: OWNER, source, sourceFocus: focus, reads: [{ kind: 'pending', instruction: null, openAttempt: attempt() }, ready()],
    sourceAfter: { ...source }, authority: null, repeatSessionId: 'rep', repeatFocus: { briefId: focus.briefId, labels: [...focus.labels] }, ...over,
});

describe('hashes match the product (repeatPracticeTarget.ts, crypto.subtle over JSON tuples)', () => {
    const subtle = async (tuple: unknown[]) => {
        const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(tuple)));
        return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    };
    it('instruction, set and point hashes', async () => {
        expect(instructionHash(VERSION, NEXT)).toBe(await subtle(['repeat_cached_instruction_v1', VERSION, NEXT]));
        expect(focusSetHash('p', 'b', 't', ['x', 'y'])).toBe(await subtle(['focus_set_v1', 'p', 'b', 't', ['x', 'y']]));
        expect(pointHash(['x', 'y'])).toBe(createHash('sha256').update(JSON.stringify(['x', 'y'])).digest('hex'));
    });
    it('the set hash depends on order, topic and every label', () => {
        const base = focusSetHash('p', 'b', 't', ['x', 'y']);
        expect(focusSetHash('p', 'b', 't', ['y', 'x'])).not.toBe(base);
        expect(focusSetHash('p', 'b', 'T', ['x', 'y'])).not.toBe(base);
        expect(focusSetHash('p', 'b', 't', ['x'])).not.toBe(base);
    });
});

describe('decidingRead', () => {
    it('the last ready read wins over later pending reads; with no ready read, the last read', () => {
        const a = ready(attempt(), 'first');
        const b = ready(attempt(), 'second');
        const pending: TargetRead = { kind: 'pending', instruction: null, openAttempt: null };
        expect(decidingRead([a, b, pending])).toBe(b);
        expect(decidingRead([pending, { kind: 'absent', instruction: null, openAttempt: null }])?.kind).toBe('absent');
        expect(decidingRead([])).toBeNull();
    });
});

describe('displayedTargetMatches (harness phase recording)', () => {
    it('matches the trimmed saved instruction, this owner, this source and this Focus set', () => {
        expect(displayedTargetMatches(ready(), OWNER, source, focus)).toBe(true);
    });
    it.each([
        ['another owner', attempt({}, {}), 'x', { userId: 'other' }],
        ['another source', attempt(), 'x', { sourceSessionId: 'other' }],
    ])('rejects %s', (_n, base, _i, top) => {
        expect(displayedTargetMatches(ready({ ...(base as object), ...top }), OWNER, source, focus)).toBe(false);
    });
    it.each([
        ['version', { version: 2 }], ['criterion', { criterion: 'other' }], ['product', { product: 'open_mic' }],
        ['instruction hash', { instructionHash: instructionHash(VERSION, `  ${NEXT}  `) }],
    ])('rejects a changed %s', (_n, over) => {
        expect(displayedTargetMatches(ready(attempt(over)), OWNER, source, focus)).toBe(false);
    });
    it.each([
        ['brief', { briefId: 'brief-2' }], ['project', { projectId: 'proj-2' }],
        ['set hash', { setHash: focusSetHash(focus.projectId, focus.briefId, focus.topic, [...focus.labels].reverse()) }],
    ])('rejects another Focus %s', (_n, over) => {
        expect(displayedTargetMatches(ready(attempt({}, over)), OWNER, source, focus)).toBe(false);
    });
    it('rejects shown text that is not the saved instruction, a missing attempt, and a non-ready read', () => {
        expect(displayedTargetMatches(ready(attempt(), 'Something else.'), OWNER, source, focus)).toBe(false);
        expect(displayedTargetMatches(ready(null), OWNER, source, focus)).toBe(false);
        expect(displayedTargetMatches({ kind: 'pending', instruction: NEXT, openAttempt: attempt() }, OWNER, source, focus)).toBe(false);
    });
});

describe('focusSameTargetVerdict', () => {
    it('PASS: shown and stored target match, retained unchanged, repeat under the same set (real harness retention)', () => {
        const r = focusSameTargetVerdict(input());
        expect(r).toMatchObject({ verdict: 'PASS', evidence: { shown: 'ready', targetMatches: true, retention: 'retained_target_unchanged', sameSet: true, reason: 'ok', reads: 2 } });
    });
    it('evidence carries no instruction, label, topic or id', () => {
        const text = JSON.stringify(focusSameTargetVerdict(input()));
        for (const secret of [NEXT, 'Budget', 'Quarterly review', 'src', 'brief-1', 'proj-1', OWNER]) expect(text).not.toContain(secret);
    });
    it('unreadable or missing sources HOLD before anything else', () => {
        expect(focusSameTargetVerdict(input({ source: 'error' })).evidence.reason).toBe('source-unread');
        expect(focusSameTargetVerdict(input({ sourceFocus: 'error' })).evidence.reason).toBe('source-unread');
        expect(focusSameTargetVerdict(input({ source: null })).evidence.reason).toBe('saved-target-missing');
        expect(focusSameTargetVerdict(input({ source: { ...source, user_id: 'other' } })).evidence.reason).toBe('saved-target-missing');
        expect(focusSameTargetVerdict(input({ source: { ...source, product: 'open_mic' } })).evidence.reason).toBe('saved-target-missing');
        expect(focusSameTargetVerdict(input({ source: { ...source, ai_suggestions: { version: VERSION, what_to_try_next: '   ' } } })).evidence.reason).toBe('saved-target-missing');
        expect(focusSameTargetVerdict(input({ sourceFocus: null })).evidence.reason).toBe('source-set-missing');
        expect(focusSameTargetVerdict(input({ sourceFocus: { ...focus, labels: [] } })).evidence.reason).toBe('source-set-missing');
        for (const id of [null, 'src']) expect(focusSameTargetVerdict(input({ repeatSessionId: id })).evidence.reason).toBe('no-distinct-repeat');
    });
    it('what the page showed: none read, nothing shown, never resolved HOLD; the page refusing the target FAILs', () => {
        expect(focusSameTargetVerdict(input({ reads: [] }))).toMatchObject({ verdict: 'HOLD', evidence: { reason: 'not-observed' } });
        expect(focusSameTargetVerdict(input({ reads: [{ kind: 'absent', instruction: null, openAttempt: null }] }))).toMatchObject({ verdict: 'HOLD', evidence: { reason: 'no-target-shown' } });
        expect(focusSameTargetVerdict(input({ reads: [{ kind: 'pending', instruction: null, openAttempt: attempt() }] }))).toMatchObject({ verdict: 'HOLD', evidence: { reason: 'target-pending' } });
        expect(focusSameTargetVerdict(input({ reads: [{ kind: 'unavailable', instruction: null, openAttempt: attempt() }] }))).toMatchObject({ verdict: 'FAIL', evidence: { reason: 'target-unavailable', targetMatches: false } });
    });
    it('a shown target that is not this set\'s saved target FAILs', () => {
        expect(focusSameTargetVerdict(input({ reads: [ready(attempt({}, { briefId: 'brief-2' }))] }))).toMatchObject({ verdict: 'FAIL', evidence: { reason: 'displayed-target-mismatch' } });
    });
    it('retention: re-read failure HOLDs; a changed target FAILs; lawful expiry needs the pre-expiry witness', () => {
        expect(focusSameTargetVerdict(input({ sourceAfter: 'error' })).evidence.reason).toBe('source-after-unread');
        expect(focusSameTargetVerdict(input({ sourceAfter: null })).evidence.reason).toBe('source-after-unread');
        const changed = focusSameTargetVerdict(input({ sourceAfter: { ...source, ai_suggestions: { ...pair, what_to_try_next: 'Other.' } } }));
        expect(changed).toMatchObject({ verdict: 'FAIL', evidence: { reason: 'retention', retention: 'retained_target_changed' } });
        const expired = { ...source, ai_suggestions: null, status: 'completed', transcript_state: 'expired' };
        expect(focusSameTargetVerdict(input({ sourceAfter: expired }))).toMatchObject({ verdict: 'HOLD', evidence: { retention: 'pre_expiry_independent_authority_missing' } });
        const witness = { session_id: 'src', user_id: OWNER, ai_suggestions: pair };
        expect(focusSameTargetVerdict(input({ sourceAfter: expired, authority: witness })).verdict).toBe('PASS');
        expect(focusSameTargetVerdict(input({ sourceAfter: expired, authority: { ...witness, ai_suggestions: { ...pair, what_to_try_next: 'x' } } })).verdict).toBe('FAIL');
        expect(focusSameTargetVerdict(input({ sourceAfter: { ...expired, transcript_state: 'kept' } })).verdict).toBe('FAIL');
    });
    it('the retention judge is the harness module; an injected judge\'s verdict passes through', () => {
        const judge = vi.fn(() => ({ status: 'HOLD' as const, reason: 'judge-hold' }));
        expect(focusSameTargetVerdict(input(), judge)).toMatchObject({ verdict: 'HOLD', evidence: { retention: 'judge-hold' } });
        expect(judge).toHaveBeenCalledWith(expect.objectContaining({ observedTargetMatches: true, ownerId: OWNER }));
    });
    it('the repeat\'s set: unreadable HOLDs; another brief, order or label FAILs; no objective session FAILs', () => {
        expect(focusSameTargetVerdict(input({ repeatFocus: 'error' })).evidence.reason).toBe('repeat-set-unread');
        for (const repeatFocus of [
            { briefId: 'brief-2', labels: [...focus.labels] }, { briefId: focus.briefId, labels: [...focus.labels].reverse() },
            { briefId: focus.briefId, labels: focus.labels.slice(1) }, null,
        ]) expect(focusSameTargetVerdict(input({ repeatFocus }))).toMatchObject({ verdict: 'FAIL', evidence: { reason: 'set-changed', sameSet: false } });
    });
});

describe('readTargetInPage (jsdom)', () => {
    // The shared setup replaces window.location with a writable plain object, so the route is set on it directly.
    const route = (pathname: string) => { (window.location as { pathname: string }).pathname = pathname; };
    afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); route('/'); });
    const recording = (target: string | null) => {
        route('/session');
        document.body.innerHTML = `<div data-testid="session-shell" data-session-state="during">${target ?? ''}</div>`;
    };
    it('reads nothing off /session or outside recording', () => {
        document.body.innerHTML = '<div data-testid="session-shell" data-session-state="during"></div>';
        expect(readTargetInPage()).toBeNull();
        route('/session');
        document.body.innerHTML = '<div data-testid="session-shell" data-session-state="after"></div>';
        expect(readTargetInPage()).toBeNull();
    });
    it('classifies absent, pending, unavailable and ready, with the parsed open attempt', () => {
        localStorage.setItem(OPEN_ATTEMPT_KEY, JSON.stringify(attempt()));
        recording(null);
        expect(readTargetInPage()).toEqual({ kind: 'absent', instruction: null, openAttempt: attempt() });
        recording(`<div data-testid="repeat-practice-target"><p>${PENDING_TARGET_TEXT}</p></div>`);
        expect(readTargetInPage()?.kind).toBe('pending');
        recording('<div data-testid="repeat-practice-target"><p>  </p></div>');
        expect(readTargetInPage()?.kind).toBe('pending');
        recording('<div data-testid="repeat-practice-target"><button>Try again</button></div>');
        expect(readTargetInPage()?.kind).toBe('unavailable');
        recording(`<div data-testid="repeat-practice-target"><p> ${NEXT} </p></div>`);
        expect(readTargetInPage()).toEqual({ kind: 'ready', instruction: NEXT, openAttempt: attempt() });
    });
    it('an unparseable open attempt reads as null, never thrown', () => {
        localStorage.setItem(OPEN_ATTEMPT_KEY, '{');
        recording(`<div data-testid="repeat-practice-target"><p>${NEXT}</p></div>`);
        expect(readTargetInPage()?.openAttempt).toBeNull();
    });
    it('is self-contained for page.evaluate: no module value inside its body', () => {
        const body = readTargetInPage.toString();
        expect(body).not.toMatch(/OPEN_ATTEMPT_KEY|PENDING_TARGET_TEXT|_vite|__vite/);
        expect(body).toContain(OPEN_ATTEMPT_KEY);
        expect(body).toContain(PENDING_TARGET_TEXT);
    });
});

describe('Focus journey wiring', () => {
    const step = journey.slice(journey.indexOf("test.step('Practice again — Analytics action"), journey.indexOf("test.step('next Start without a hold'"));
    it('reads the source and its set BEFORE the Practice-again take, and judges after it', () => {
        const before = step.indexOf('const sameTargetSource = await readFocusSource(persistedId)');
        expect(before).toBeGreaterThan(0);
        expect(step.indexOf('const sameTargetSet = await readFocusSet(persistedId)')).toBeGreaterThan(before);
        expect(step.indexOf('practiceAgainEvidence(page')).toBeGreaterThan(before);
        expect(step.indexOf('focusSameTargetVerdict(')).toBeGreaterThan(step.indexOf('practiceAgainEvidence(page'));
        expect(step).toContain('sourceAfter: await readFocusSource(persistedId)');
        expect(step).toContain('receipt.row(FOCUS_SAME_TARGET_ROW');
        expect(FOCUS_SAME_TARGET_ROW).toBe('Practice again keeps the saved target');
    });
    it('the page reads are passive, stop at the save take\'s Stop and are always awaited', () => {
        expect(step).toContain('page.evaluate(readTargetInPage)');
        expect(step).toMatch(/onSaveTakeStopped|\(\) => \{ saveTakeEnd = tap\.events\.length; targetWatch = false; \}/);
        expect(step).toMatch(/finally \{\s*targetWatch = false;\s*await targetWatcher;/);
    });
    it('writes a HOLD row when there is no saved first take', () => {
        const noSource = step.slice(0, step.indexOf('return;'));
        expect(noSource).toContain("receipt.row(FOCUS_SAME_TARGET_ROW, 'HOLD'");
    });
    it('the source reads are owner-scoped', () => {
        const helpers = journey.slice(journey.indexOf('const readFocusSource'), journey.indexOf('let claimed = false;'));
        expect(helpers.match(/\.eq\('user_id', owner\.uid\)/g)?.length).toBeGreaterThanOrEqual(4);
    });
    it('the repeat-metric row reads the Progress panel in its own tab; the numeric step then reads and closes it', () => {
        const from = journey.indexOf("test.step('the repeat result names the measured metric'");
        const numeric = journey.indexOf("test.step('saved and displayed comparison numbers match'");
        const metric = journey.slice(from, numeric);
        expect(metric).toContain('page.context().newPage()');
        expect(metric).toContain('receipt.row(REPEAT_METRIC_ROW');
        // A tab that left the panel's route is closed in the metric step itself, and never handed on.
        expect(metric).toMatch(/finally \{[\s\S]*pathname !== `\/progress\/\$\{persistedId\}`[\s\S]*progressPanelTab = null;\s*await progressTab\.close\(\)/);
        // The numeric step always closes whatever it was handed.
        expect(journey.slice(numeric)).toMatch(/finally \{\s*await progressPanelTab\?\.close\(\)\.catch\(\(\) => undefined\);\s*progressPanelTab = null;/);
    });
});
