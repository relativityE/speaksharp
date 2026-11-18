// @vitest-environment node
/**
 * #1882 live wave on the post-#1835 build (Sam's Nov 18 reset, row 3.2): each saved Focus take is read back against the
 * consent choice this run made. Saving ON: the transcript is saved. Saving OFF: metrics only, no transcript. An unknown build,
 * a choice that was not recorded as made, or a row that is not this take's is never a PASS.
 */
import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import {
    answerPracticePrivacyPrompt, CONSENT_MODES, consentModeFrom, consentReadbackVerdict, PRACTICE_PRIVACY_PROMPT, PRIVACY_MIGRATION_1835,
    privacyBuildOf, privacyChoiceVerdict, probePrivacyTable, readPracticeChoice, settlePracticeConsent, type ChoiceClient, type SavedSessionRead,
} from '../live/helpers/rwtPracticeConsent';

const OWNER = 'owner-1';
const ROW: SavedSessionRead = { id: 's1', user_id: OWNER, status: 'completed', duration: 10, transcript: 'one two three', transcript_state: 'available' };
const OFF_ROW: SavedSessionRead = { ...ROW, transcript: null, transcript_state: 'not_captured' };
const verdict = (over: Partial<Parameters<typeof consentReadbackVerdict>[0]>) => consentReadbackVerdict({
    build: 'includes_1835', choice: CONSENT_MODES.save_on, row: ROW, ownerId: OWNER, sessionId: 's1', minDurationSeconds: 9, ...over,
});

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
        const clicks: string[] = [];
        const control = (id: string) => ({ click: async () => { clicks.push(id); } });
        const prompt = { waitFor: async () => undefined, getByTestId: control };
        const page = { getByTestId: (id: string) => (id === PRACTICE_PRIVACY_PROMPT.root ? prompt : control(id)) } as unknown as Page;
        expect(await answerPracticePrivacyPrompt(page, CONSENT_MODES.save_off)).toBe(true);
        expect(clicks).toEqual(['privacy-save-no', 'privacy-ai-no', 'privacy-continue']);
        clicks.length = 0;
        expect(await answerPracticePrivacyPrompt(page, CONSENT_MODES.save_on_coaching_on)).toBe(true);
        expect(clicks).toEqual(['privacy-save-yes', 'privacy-ai-yes', 'privacy-continue']);
        await expect(answerPracticePrivacyPrompt(page, { transcriptSave: false, aiCoaching: true })).rejects.toThrow(/INVALID_SETUP/);
        const hidden = { getByTestId: () => ({ waitFor: async () => { throw new Error('Timeout'); } }) } as unknown as Page;
        expect(await answerPracticePrivacyPrompt(hidden, CONSENT_MODES.save_on, 10)).toBe(false);
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
    const promptPage = (onContinue: () => void, shown = true) => {
        const clicks: string[] = [];
        const control = (id: string) => ({ click: async () => { clicks.push(id); if (id === 'privacy-continue') onContinue(); } });
        const prompt = { waitFor: async () => { if (!shown) throw new Error('Timeout'); }, getByTestId: control };
        return { clicks, page: { getByTestId: (id: string) => (id === PRACTICE_PRIVACY_PROMPT.root ? prompt : control(id)) } as unknown as Page };
    };

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
        expect(clicks).toEqual([choice.transcriptSave ? 'privacy-save-yes' : 'privacy-save-no', 'privacy-ai-no', 'privacy-continue']);
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
