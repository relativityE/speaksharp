// @vitest-environment node
/**
 * #1258 (PM 5944997435) — run 36955422629 could not say WHY Share Feedback showed no acknowledgement or why
 * "Practice this again" did not open the session page. These reads name the product branch with closed enums and
 * booleans only, inside one outer deadline.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFeedbackUiState, readPracticeActionState, routeClass, type DiagnosticPage } from '../live/helpers/rwtStepDiagnostics';
import { practiceActionEvidence } from '../live/helpers/rwtJourney';

const never = <T>() => new Promise<T>(() => {});
const opts = { boundMs: 60, readTimeoutMs: 20 };

type El = { visible?: boolean | 'never'; enabled?: boolean; attrs?: Record<string, string | null>; text?: string; count?: number; alert?: El };
function stubPage(url: string, els: Record<string, El>): DiagnosticPage {
    const locator = (el: El | undefined): ReturnType<DiagnosticPage['getByTestId']> => ({
        isVisible: () => (el?.visible === 'never' ? never() : Promise.resolve(el?.visible === true)),
        isEnabled: async () => el?.enabled === true,
        getAttribute: async (name: string) => el?.attrs?.[name] ?? null,
        innerText: async () => el?.text ?? '',
        count: async () => el?.count ?? (el ? 1 : 0),
        first: () => locator(el),
        getByRole: () => locator(el?.alert),
    });
    return { url: () => url, getByTestId: (id: string) => locator(els[id]) };
}

const FEEDBACK = { ...opts, kindTestId: 'feedback-type-praise' };

describe('#1258 Share Feedback: which branch the dialog is in', () => {
    it('a failed insert: the dialog stays open with its own failure line, the kind still chosen', async () => {
        const page = stubPage('https://x/analytics/abc', {
            'issue-report-dialog': { visible: true, alert: { visible: true, text: 'That didn’t go through. Try again?' } },
            'issue-report-submit': { enabled: true },
            'feedback-type-praise': { attrs: { 'aria-checked': 'true' } },
        });
        await expect(readFeedbackUiState(page, FEEDBACK)).resolves.toEqual({ errorShown: true, dialogOpen: true, submitEnabled: true, kindChosen: true, timedOut: false });
    });

    it('a refused submit: the kind never registered, so Submit is disabled and there is no failure line', async () => {
        const page = stubPage('https://x/analytics/abc', {
            'issue-report-dialog': { visible: true },
            'issue-report-submit': { enabled: false },
            'feedback-type-praise': { attrs: { 'aria-checked': 'false' } },
        });
        await expect(readFeedbackUiState(page, FEEDBACK)).resolves.toEqual({ errorShown: false, dialogOpen: true, submitEnabled: false, kindChosen: false, timedOut: false });
    });

    it('the dialog closed (success path) with no acknowledgement seen: no field reads inside a closed dialog', async () => {
        const page = stubPage('https://x/analytics/abc', {});
        await expect(readFeedbackUiState(page, FEEDBACK)).resolves.toEqual({ errorShown: false, dialogOpen: false, submitEnabled: null, kindChosen: null, timedOut: false });
    });

    it('a stalled renderer ends in a bounded timeout with every field null', async () => {
        const began = Date.now();
        const page = stubPage('https://x/analytics/abc', { 'issue-report-dialog': { visible: 'never' } });
        await expect(readFeedbackUiState(page, FEEDBACK)).resolves.toEqual({ errorShown: null, dialogOpen: null, submitEnabled: null, kindChosen: null, timedOut: true });
        expect(Date.now() - began).toBeLessThan(1_000);
    });
});

describe('#1258 Practice again: which click branch the saved review was in', () => {
    it('route class only — never the path (it carries ids), query strings ignored', () => {
        expect(routeClass('https://x/session')).toBe('session');
        expect(routeClass('https://x/session/')).toBe('session');
        expect(routeClass('https://x/practice?product=focus-points')).toBe('practice');
        expect(routeClass('https://x/analytics/0b8c-uuid')).toBe('analytics_detail');
        expect(routeClass('https://x/analytics')).toBe('analytics');
        expect(routeClass('https://x/sign-in')).toBe('other');
        expect(routeClass('not a url')).toBe('other');
    });

    it.each([
        ['error', 'Try again', 'error', 'try_again'],
        ['linked', 'Linking repeat…', 'linked', 'linking'],
        ['pending', 'Checking your next practice…', 'pending', 'checking'],
        ['direct', 'Practice this again', 'direct', 'practice_again'],
        ['someday-new', 'Something new', 'other', 'other'],
    ] as const)('link state %s / label "%s" → %s / %s', async (raw, text, linkState, label) => {
        const page = stubPage('https://x/analytics/abc', { 'saved-review-practice': { attrs: { 'data-link-state': raw }, text, enabled: true } });
        await expect(readPracticeActionState(page, opts)).resolves.toEqual({ route: 'analytics_detail', linkState, label, enabled: true, timedOut: false });
    });

    it('no practice action on the page → absent; the route still reads', async () => {
        await expect(readPracticeActionState(stubPage('https://x/practice', {}), opts))
            .resolves.toEqual({ route: 'practice', linkState: 'absent', label: 'absent', enabled: null, timedOut: false });
    });

    it('receipt evidence is flat closed values only — no text, no id, no URL', () => {
        const evidence = practiceActionEvidence({
            actionBefore: { route: 'analytics_detail', linkState: 'error', label: 'try_again', enabled: true, timedOut: false },
            actionAfter: { route: 'analytics_detail', linkState: 'error', label: 'try_again', enabled: true, timedOut: false },
        });
        expect(evidence).toEqual({
            beforeLinkState: 'error', beforeLabel: 'try_again',
            afterRoute: 'analytics_detail', afterLinkState: 'error', afterLabel: 'try_again', afterEnabled: true,
            diagnosticTimedOut: false,
        });
        expect(practiceActionEvidence({ actionBefore: null, actionAfter: null })).toEqual({
            beforeLinkState: null, beforeLabel: null, afterRoute: null, afterLinkState: null, afterLabel: null, afterEnabled: null, diagnosticTimedOut: false,
        });
    });
});

describe('#1258 wiring: the journey records the branch where the rows were ambiguous', () => {
    const journey = readFileSync(path.resolve(__dirname, '../live/helpers/rwtJourney.ts'), 'utf8');
    it('Practice again: state read before the click and again when /session did not open', () => {
        expect(journey).toMatch(/ev\.actionBefore = await readPracticeActionState\(page,[^\n]*\n\s*await practice\.click\(\);/);
        expect(journey).toMatch(/if \(!ev\.analyticsActionOpened\) \{\s*ev\.actionAfter = await readPracticeActionState\(page,/);
        expect(journey).toMatch(/\{ sameSetPending: ev\.sameSetPending, \.\.\.practiceActionEvidence\(ev\) \}/);
    });
    it('Share Feedback: the dialog state is read only when no acknowledgement showed', () => {
        expect(journey).toMatch(/const ui = acknowledged \? null\s*: await readFeedbackUiState\(page,/);
    });
});
