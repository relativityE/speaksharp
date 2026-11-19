// @vitest-environment node
/**
 * #1882 live wave on the post-#1835 build (Sam's Nov 18 reset, row 3.2): each saved Focus take is read back against the
 * consent choice this run made. Saving ON: the transcript is saved. Saving OFF: metrics only, no transcript. An unknown build,
 * a choice that was not recorded as made, or a row that is not this take's is never a PASS.
 */
import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import {
    aiControlsVerdict, answerPracticePrivacyPrompt, CONSENT_MODES, consentModeFrom, consentReadbackVerdict, PRACTICE_PRIVACY_PROMPT, PRIVACY_MIGRATION_1835,
    privacyBuildOf, privacyChoiceVerdict, probePrivacyTable, readPracticeChoice, settlePracticeConsent, type ChoiceClient, type SavedSessionRead,
} from '../live/helpers/rwtPracticeConsent';

const OWNER = 'owner-1';
const ROW: SavedSessionRead = { id: 's1', user_id: OWNER, status: 'completed', duration: 10, transcript: 'one two three', transcript_state: 'available' };
const OFF_ROW: SavedSessionRead = { ...ROW, transcript: null, transcript_state: 'not_captured' };
const verdict = (over: Partial<Parameters<typeof consentReadbackVerdict>[0]>) => consentReadbackVerdict({
    build: 'includes_1835', choice: CONSENT_MODES.save_on, row: ROW, ownerId: OWNER, sessionId: 's1', minDurationSeconds: 9, ...over,
});

/**
 * A model of #1835's PracticePrivacyPrompt (204a183d) under Playwright's click rule. The component renders each AI option
 * with `aria-disabled="true"` while "Don't save" is chosen and ignores a press on it; Playwright refuses to click a control
 * that is aria-disabled ("element is not enabled") and waits until its timeout. Continue is enabled only once both answers
 * are settled, and "Don't save" settles the AI answer to off by itself.
 */
function modelPrompt(opts: { aiStaysAvailable?: boolean; hideNeedsSave?: boolean; aiPressIgnored?: boolean; onContinue?: () => void; shown?: boolean } = {}) {
    const state = { save: null as boolean | null, ai: null as boolean | null, open: true };
    const clicks: string[] = [];
    let submitted: { save: boolean; ai: boolean } | null = null;
    const aiUnavailable = () => state.save === false && !opts.aiStaysAvailable;
    const ready = () => state.save !== null && (state.save === false ? true : state.ai !== null);
    const attrs = (id: string): Record<string, string | null> => {
        if (id === 'privacy-ai-yes' || id === 'privacy-ai-no') {
            const value = id === 'privacy-ai-yes';
            return { 'aria-disabled': aiUnavailable() ? 'true' : null, 'aria-checked': String(!aiUnavailable() && state.ai === value) };
        }
        if (id === 'privacy-save-yes' || id === 'privacy-save-no') return { 'aria-disabled': null, 'aria-checked': String(state.save === (id === 'privacy-save-yes')) };
        if (id === 'privacy-continue') return { disabled: ready() ? null : '' };
        return {};
    };
    const notEnabled = (id: string) => (id.startsWith('privacy-ai-') && aiUnavailable()) || (id === 'privacy-continue' && !ready());
    const control = (id: string) => ({
        click: async () => {
            if (notEnabled(id)) throw new Error(`locator.click: Timeout exceeded. element is not enabled (${id})`);
            clicks.push(id);
            if (id === 'privacy-save-yes') state.save = true;
            if (id === 'privacy-save-no') { state.save = false; state.ai = null; }
            if ((id === 'privacy-ai-yes' || id === 'privacy-ai-no') && !opts.aiPressIgnored) state.ai = id === 'privacy-ai-yes';
            if (id === 'privacy-continue') { submitted = { save: state.save as boolean, ai: state.save ? state.ai as boolean : false }; state.open = false; opts.onContinue?.(); }
        },
        getAttribute: async (name: string) => attrs(id)[name] ?? null,
        isVisible: async () => id === 'privacy-ai-needs-save' ? state.save === false && !opts.hideNeedsSave : true,
    });
    const prompt = {
        waitFor: async (o?: { state?: string }) => {
            if (o?.state === 'hidden' ? state.open : opts.shown === false) throw new Error('Timeout');
        },
        getByTestId: control,
    };
    const page = { getByTestId: (id: string) => (id === PRACTICE_PRIVACY_PROMPT.root ? prompt : control(id)) } as unknown as Page;
    return { page, clicks, get submitted() { return submitted; } };
}

describe('#1882 consent — the build and the choice', () => {
    it('the run\'s mode comes only from the three named modes', () => {
        expect(consentModeFrom('save_on')).toBe('save_on');
        expect(consentModeFrom('save_off')).toBe('save_off');
        expect(consentModeFrom('save_on_coaching_on')).toBe('save_on_coaching_on');
        expect(consentModeFrom(undefined)).toBeNull();
        expect(consentModeFrom('on')).toBeNull();
        expect(consentModeFrom('toString')).toBeNull();
        expect(CONSENT_MODES.save_off).toEqual({ transcriptSave: false, aiCoaching: false });
    });

    it('the #1835 state needs the migration listing AND the table to agree; anything else is unknown', () => {
        expect(privacyBuildOf(['a.sql', PRIVACY_MIGRATION_1835], 'present')).toBe('includes_1835');
        expect(privacyBuildOf(['a.sql'], 'absent')).toBe('predates_1835');
        expect(privacyBuildOf(['a.sql', PRIVACY_MIGRATION_1835], 'absent')).toBe('unknown'); // listed, not applied
        expect(privacyBuildOf(['a.sql'], 'present')).toBe('unknown'); // a schema that is not the tested build's
        expect(privacyBuildOf([], 'absent')).toBe('unknown');
        expect(privacyBuildOf(null, 'absent')).toBe('unknown');
        expect(privacyBuildOf(['a.sql'], 'unreadable')).toBe('unknown');
    });

    it('the owner\'s server row must record exactly the choice made', () => {
        const row = { user_id: OWNER, transcript_save: false, ai_coaching: false, consent_version: 1 };
        expect(privacyChoiceVerdict({ state: 'read', row }, OWNER, CONSENT_MODES.save_off)).toEqual({ verdict: 'PASS', reason: 'recorded' });
        expect(privacyChoiceVerdict({ state: 'read', row }, OWNER, CONSENT_MODES.save_on).reason).toBe('differs');
        expect(privacyChoiceVerdict({ state: 'read', row: { ...row, user_id: 'other' } }, OWNER, CONSENT_MODES.save_off).reason).toBe('wrong_owner');
        expect(privacyChoiceVerdict({ state: 'read', row: { ...row, consent_version: 2 } }, OWNER, CONSENT_MODES.save_off).reason).toBe('malformed');
        expect(privacyChoiceVerdict({ state: 'read', row: null }, OWNER, CONSENT_MODES.save_off).reason).toBe('missing');
        expect(privacyChoiceVerdict({ state: 'absent' }, OWNER, CONSENT_MODES.save_off).reason).toBe('missing');
        expect(privacyChoiceVerdict({ state: 'unreadable' }, OWNER, CONSENT_MODES.save_off).reason).toBe('unreadable');
    });

    it('answers the prompt with the chosen controls, and refuses coaching without saving', async () => {
        const save_off = modelPrompt();
        expect(await answerPracticePrivacyPrompt(save_off.page, CONSENT_MODES.save_off, 50)).toBe(true);
        // #1835's disabled-control contract: Save No settles AI off; the unavailable AI options are never pressed.
        expect(save_off.clicks).toEqual(['privacy-save-no', 'privacy-continue']);
        expect(save_off.submitted).toEqual({ save: false, ai: false });
        const on = modelPrompt();
        expect(await answerPracticePrivacyPrompt(on.page, CONSENT_MODES.save_on, 50)).toBe(true);
        expect(on.clicks).toEqual(['privacy-save-yes', 'privacy-ai-no', 'privacy-continue']);
        expect(on.submitted).toEqual({ save: true, ai: false });
        const coaching = modelPrompt();
        expect(await answerPracticePrivacyPrompt(coaching.page, CONSENT_MODES.save_on_coaching_on, 50)).toBe(true);
        expect(coaching.clicks).toEqual(['privacy-save-yes', 'privacy-ai-yes', 'privacy-continue']);
        expect(coaching.submitted).toEqual({ save: true, ai: true });
        await expect(answerPracticePrivacyPrompt(modelPrompt().page, { transcriptSave: false, aiCoaching: true })).rejects.toThrow(/INVALID_SETUP/);
        const hidden = { getByTestId: () => ({ waitFor: async () => { throw new Error('Timeout'); } }) } as unknown as Page;
        expect(await answerPracticePrivacyPrompt(hidden, CONSENT_MODES.save_on, 10)).toBe(false);
    });

    it('#1897 review 1: a prompt that does not show the disabled-control contract stops before Continue', async () => {
        // Save No that leaves the AI options available (a build without #1835's contract): never Continue.
        const enabledAfterSaveNo = modelPrompt({ aiStaysAvailable: true });
        await expect(answerPracticePrivacyPrompt(enabledAfterSaveNo.page, CONSENT_MODES.save_off, 50))
            .rejects.toThrow('HOLD practice consent: ai_controls_not_unavailable');
        expect(enabledAfterSaveNo.clicks).toEqual(['privacy-save-no']);
        const noReason = modelPrompt({ hideNeedsSave: true });
        await expect(answerPracticePrivacyPrompt(noReason.page, CONSENT_MODES.save_off, 50)).rejects.toThrow('ai_needs_save_reason_missing');
        // An AI press that did not take: the chosen option is not checked, so no Continue.
        const ignoredPress = modelPrompt({ aiPressIgnored: true });
        await expect(answerPracticePrivacyPrompt(ignoredPress.page, CONSENT_MODES.save_on, 50)).rejects.toThrow('ai_choice_not_checked');
        expect(ignoredPress.clicks).not.toContain('privacy-continue');
    });

    it('#1897 review 1: the AI controls verdict, both ways', () => {
        const off = { ariaDisabled: 'true', ariaChecked: 'false' };
        const on = (checked: boolean) => ({ ariaDisabled: null, ariaChecked: String(checked) });
        expect(aiControlsVerdict(CONSENT_MODES.save_off, { yes: off, no: off, needsSaveShown: true }, 'before_ai')).toEqual({ ok: true });
        expect(aiControlsVerdict(CONSENT_MODES.save_off, { yes: off, no: on(false), needsSaveShown: true }, 'before_ai'))
            .toEqual({ ok: false, reason: 'ai_controls_not_unavailable' });
        expect(aiControlsVerdict(CONSENT_MODES.save_off, { yes: off, no: { ...off, ariaChecked: 'true' }, needsSaveShown: true }, 'before_ai'))
            .toEqual({ ok: false, reason: 'ai_option_checked_while_off' });
        expect(aiControlsVerdict(CONSENT_MODES.save_on, { yes: on(false), no: on(false), needsSaveShown: false }, 'before_ai')).toEqual({ ok: true });
        expect(aiControlsVerdict(CONSENT_MODES.save_on, { yes: on(false), no: on(true), needsSaveShown: false }, 'after_ai')).toEqual({ ok: true });
        expect(aiControlsVerdict(CONSENT_MODES.save_on, { yes: on(true), no: on(false), needsSaveShown: false }, 'after_ai'))
            .toEqual({ ok: false, reason: 'ai_choice_not_checked' });
        expect(aiControlsVerdict(CONSENT_MODES.save_on, { yes: off, no: off, needsSaveShown: false }, 'before_ai'))
            .toEqual({ ok: false, reason: 'ai_controls_unavailable_while_saving' });
        expect(aiControlsVerdict(CONSENT_MODES.save_on, { yes: on(false), no: on(false), needsSaveShown: true }, 'before_ai'))
            .toEqual({ ok: false, reason: 'ai_needs_save_reason_while_saving' });
    });
});

describe('#1882 consent — each saved take read back against the choice', () => {
    it('SAVING ON: the take\'s own completed row with its transcript PASSes; a missing transcript FAILs', () => {
        expect(verdict({})).toEqual({ verdict: 'PASS', reason: 'transcript_saved' });
        expect(verdict({ row: OFF_ROW }).reason).toBe('transcript_missing_while_on');
        expect(verdict({ row: { ...ROW, transcript: '   ' } }).reason).toBe('transcript_missing_while_on');
        expect(verdict({ row: { ...ROW, transcript_state: 'expired' } }).reason).toBe('transcript_missing_while_on');
    });

    it('SAVING OFF: metrics only with no transcript PASSes; any saved transcript FAILs', () => {
        expect(verdict({ choice: CONSENT_MODES.save_off, row: OFF_ROW })).toEqual({ verdict: 'PASS', reason: 'metrics_only' });
        expect(verdict({ choice: CONSENT_MODES.save_off, row: ROW }).reason).toBe('transcript_saved_while_off');
        expect(verdict({ choice: CONSENT_MODES.save_off, row: { ...OFF_ROW, transcript: '' } }).reason).toBe('transcript_saved_while_off');
        expect(verdict({ choice: CONSENT_MODES.save_off, row: { ...OFF_ROW, duration: 0 } }).reason).toBe('no_metrics');
    });

    it('binds the row to the take: its id, its owner, completed, and at least the measured live seconds', () => {
        expect(verdict({ row: null }).reason).toBe('row_missing');
        expect(verdict({ row: { ...ROW, id: 's2' } }).reason).toBe('wrong_row');
        expect(verdict({ row: { ...ROW, user_id: 'other' } }).reason).toBe('wrong_row');
        expect(verdict({ row: { ...ROW, status: 'active' } }).reason).toBe('not_completed');
        expect(verdict({ row: { ...ROW, duration: 7 } }).reason).toBe('no_metrics'); // 9 measured live seconds, 7 stored
        expect(verdict({ row: { ...ROW, duration: 8 } }).verdict).toBe('PASS'); // one second of rounding
        expect(verdict({ row: { ...ROW, duration: '10' } }).reason).toBe('no_metrics');
    });

    it('a verified pre-#1835 build always saved; an unknown build or a missing choice is HOLD', () => {
        expect(verdict({ build: 'predates_1835', choice: null })).toEqual({ verdict: 'PASS', reason: 'transcript_saved' });
        expect(verdict({ build: 'unknown' })).toEqual({ verdict: 'HOLD', reason: 'build_unknown' });
        expect(verdict({ choice: null })).toEqual({ verdict: 'HOLD', reason: 'build_unknown' });
    });
});

/** A service client over one in-memory choices table (or none), recording what the prompt writes. */
function clientOf(table: { rows: Array<Record<string, unknown>> } | 'absent' | 'broken'): ChoiceClient {
    const fail = (code: string) => ({ data: null, error: { code } });
    return {
        from: () => ({
            select: () => ({
                eq: (_col: string, v: string) => ({
                    maybeSingle: async () => table === 'absent' ? fail('PGRST205') : table === 'broken' ? fail('57014')
                        : { data: table.rows.find((r) => r.user_id === v) ?? null, error: null },
                }),
                limit: async () => table === 'absent' ? fail('42P01') : table === 'broken' ? fail('57014') : { data: [], error: null },
            }),
        }),
    };
}

describe('#1882 consent — settled on the Practice page before any take', () => {
    const listing = ['a.sql', PRIVACY_MIGRATION_1835];
    const promptPage = (onContinue: () => void, shown = true) => modelPrompt({ onContinue, shown });

    it('reads the table and the owner\'s row; a missing table is absent, any other error unreadable', async () => {
        expect(await probePrivacyTable(clientOf({ rows: [] }))).toBe('present');
        expect(await probePrivacyTable(clientOf('absent'))).toBe('absent');
        expect(await probePrivacyTable(clientOf('broken'))).toBe('unreadable');
        expect(await probePrivacyTable({ from: () => { throw new Error('x'); } } as unknown as ChoiceClient)).toBe('unreadable');
        expect(await readPracticeChoice(clientOf({ rows: [] }), OWNER)).toEqual({ state: 'read', row: null });
        expect(await readPracticeChoice(clientOf('absent'), OWNER)).toEqual({ state: 'absent' });
        expect(await readPracticeChoice(clientOf('broken'), OWNER)).toEqual({ state: 'unreadable' });
        expect(await readPracticeChoice({ from: () => { throw new Error('x'); } } as unknown as ChoiceClient, OWNER)).toEqual({ state: 'unreadable' });
    });

    it.each(['save_on', 'save_off'] as const)('%s: a fresh owner answers the prompt and the server row records it', async (mode) => {
        const table = { rows: [] as Array<Record<string, unknown>> };
        const choice = CONSENT_MODES[mode];
        const { page, clicks } = promptPage(() => table.rows.push({ user_id: OWNER, transcript_save: choice.transcriptSave, ai_coaching: choice.aiCoaching, consent_version: 1 }));
        const settled = await settlePracticeConsent({ page, client: clientOf(table), ownerId: OWNER, migrationFiles: listing, mode });
        expect(settled).toEqual({ build: 'includes_1835', choice, mode });
        // Saving off: the owner's recorded row is false/false, reached through the disabled-control contract (no AI press).
        expect(clicks).toEqual(choice.transcriptSave ? ['privacy-save-yes', 'privacy-ai-no', 'privacy-continue'] : ['privacy-save-no', 'privacy-continue']);
    });

    it('stops before any take on an unknown build, an unset mode, an existing choice, no prompt, or a choice not recorded', async () => {
        const noop = promptPage(() => undefined).page;
        await expect(settlePracticeConsent({ page: noop, client: clientOf('broken'), ownerId: OWNER, migrationFiles: listing, mode: 'save_on' }))
            .rejects.toThrow(/HOLD practice consent: build_unknown/);
        await expect(settlePracticeConsent({ page: noop, client: clientOf({ rows: [] }), ownerId: OWNER, migrationFiles: listing, mode: null }))
            .rejects.toThrow(/mode_unset/);
        const existing = { rows: [{ user_id: OWNER, transcript_save: true, ai_coaching: false, consent_version: 1 }] };
        await expect(settlePracticeConsent({ page: noop, client: clientOf(existing), ownerId: OWNER, migrationFiles: listing, mode: 'save_off' }))
            .rejects.toThrow(/choice_already_recorded/);
        await expect(settlePracticeConsent({ page: promptPage(() => undefined, false).page, client: clientOf({ rows: [] }), ownerId: OWNER, migrationFiles: listing, mode: 'save_on' }))
            .rejects.toThrow(/prompt_not_shown/);
        await expect(settlePracticeConsent({ page: noop, client: clientOf({ rows: [] }), ownerId: OWNER, migrationFiles: listing, mode: 'save_on' }))
            .rejects.toThrow(/choice_missing/);
        const wrong = { rows: [] as Array<Record<string, unknown>> };
        const saysOn = promptPage(() => wrong.rows.push({ user_id: OWNER, transcript_save: true, ai_coaching: false, consent_version: 1 })).page;
        await expect(settlePracticeConsent({ page: saysOn, client: clientOf(wrong), ownerId: OWNER, migrationFiles: listing, mode: 'save_off' }))
            .rejects.toThrow(/choice_differs/);
    });

    it('a verified pre-#1835 build has no choice to make', async () => {
        const { page, clicks } = promptPage(() => undefined);
        expect(await settlePracticeConsent({ page, client: clientOf('absent'), ownerId: OWNER, migrationFiles: ['a.sql'], mode: null }))
            .toEqual({ build: 'predates_1835', choice: null, mode: null });
        expect(clicks).toEqual([]);
    });
});
