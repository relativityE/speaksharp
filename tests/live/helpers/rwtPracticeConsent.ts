/**
 * #1882 live wave on the post-#1835 build (Sam's Nov 18 reset, row 3.2): run the Focus journey with transcript saving ON and
 * with it OFF, and read each saved take back against that choice.
 *
 * #1835 (PO-approved, 17 Nov): saving is OFF until the owner opts in; AI coaching is a separate opt-in that requires saving;
 * an owner with no recorded choice is asked on the next Practice visit. The server enforces it: `practice_privacy_choices`
 * holds the owner's row, and a trigger refuses any transcript for an owner who has not opted in, so a take saved with saving
 * off is a normal metrics-only completion with a null transcript.
 *
 * Fail closed everywhere: an unknown build, an unreadable choice, a foreign or malformed row, or a row that does not match
 * the choice this run made is a named stop or FAIL, never a PASS.
 */
import type { Page } from '@playwright/test';

/** The #1835 migration, by exact file name (backend/supabase/migrations on the #1835 branch). */
export const PRIVACY_MIGRATION_1835 = '20261117105700_practice_privacy_choices_1835.sql';

/** PracticePrivacyPrompt.tsx's own controls on the #1835 branch. */
export const PRACTICE_PRIVACY_PROMPT = Object.freeze({
    root: 'practice-privacy-prompt',
    saveYes: 'privacy-save-yes',
    saveNo: 'privacy-save-no',
    aiYes: 'privacy-ai-yes',
    aiNo: 'privacy-ai-no',
    /** Shown only while "Don't save" is chosen: AI coaching needs saving in v1, so both AI options are unavailable. */
    aiNeedsSave: 'privacy-ai-needs-save',
    continue: 'privacy-continue',
});

export type PrivacyBuild = 'includes_1835' | 'predates_1835' | 'unknown';
export interface PracticeChoice { transcriptSave: boolean; aiCoaching: boolean }
export type ConsentMode = 'save_on' | 'save_on_coaching_on' | 'save_off';

export const CONSENT_MODES: Readonly<Record<ConsentMode, PracticeChoice>> = Object.freeze({
    save_on: { transcriptSave: true, aiCoaching: false },
    save_on_coaching_on: { transcriptSave: true, aiCoaching: true },
    save_off: { transcriptSave: false, aiCoaching: false },
});

/**
 * Save retry (J4.a / J4.b) expects a saved transcript, so its own run-owned account opts in to saving, with coaching off
 * (Sam, Nov 18). Fixed, never read from the environment: the app's default stays off and only this test account opts in.
 */
export const SAVE_RETRY_CONSENT_MODE: ConsentMode = 'save_on';

/**
 * J1 (Open Mic first session) reviews the take's saved transcript and its AI coaching, so its own fresh run-owned account opts
 * in to both through the Practice prompt (Save: Yes, Coaching: Yes). Fixed, never read from the environment: the app's
 * default stays off and only this test account opts in.
 */
export const OPEN_MIC_FIRST_SESSION_CONSENT_MODE: ConsentMode = 'save_on_coaching_on';

/**
 * Pure: the owner's choice, read back from the server immediately before capture, is exactly the run's FIXED mode on a #1835 build.
 * A pre-#1835 build or another mode FAILs; an unknown build or a missing or unreadable readback HOLDs. Only PASS lets the
 * journey go on to capture.
 */
export function fixedConsentBeforeStartVerdict(o: {
    build: PrivacyBuild; mode: ConsentMode | null; expected: ConsentMode; readback: ChoiceRead | null; ownerId: string | null;
}): { status: 'PASS' | 'FAIL' | 'HOLD'; reason: string; detail: string } {
    const want = CONSENT_MODES[o.expected];
    const label = `Save: ${want.transcriptSave ? 'Yes' : 'No'}, Coaching: ${want.aiCoaching ? 'Yes' : 'No'}`;
    if (o.build === 'predates_1835') return { status: 'FAIL', reason: 'legacy_build', detail: 'the build predates #1835 and shows no privacy prompt; this journey runs only on a post-#1835 build' };
    if (o.build !== 'includes_1835') return { status: 'HOLD', reason: 'build_unknown', detail: 'the build\'s #1835 state is unknown, so the owner consent cannot be proven' };
    if (o.mode !== o.expected) return { status: 'FAIL', reason: 'wrong_mode', detail: `the run did not choose ${label}` };
    if (!o.ownerId || o.readback === null) return { status: 'HOLD', reason: 'readback_missing', detail: 'the owner\'s consent was not read back before capture' };
    const v = privacyChoiceVerdict(o.readback, o.ownerId, want);
    if (v.verdict === 'PASS') return { status: 'PASS', reason: 'choice_recorded', detail: `this run's own account chose ${label} in the Practice prompt, read back from the server immediately before the first capture-capable call` };
    if (v.reason === 'unreadable') return { status: 'HOLD', reason: 'readback_unreadable', detail: 'the owner\'s consent row could not be read before capture' };
    return { status: 'FAIL', reason: `readback_${v.reason}`, detail: `the owner's consent row read back before capture is ${v.reason}` };
}

/**
 * J5.b / J5.c (leaving a recording) and J6 (one account, two places) save takes, so each run's own run-owned account opts in
 * the same way: Save: Yes, Coaching: No (Sam, Nov 18: test bots opt in their own test account before Start). Fixed, never read
 * from the environment, so a shared dispatch input meant for another journey can never switch coaching on here.
 */
export const ABANDON_TWO_PLACES_CONSENT_MODE: ConsentMode = 'save_on';

/** The run's consent mode from its environment; null when unset or not one of the three. */
export function consentModeFrom(value: string | undefined): ConsentMode | null {
    return value !== undefined && Object.prototype.hasOwnProperty.call(CONSENT_MODES, value) ? value as ConsentMode : null;
}

/**
 * The build's #1835 state from TWO independent reads: the tested checkout's migration file names and whether the target's
 * `practice_privacy_choices` table answers. They must agree; an empty or unreadable listing, an unreadable table, or a
 * disagreement is `unknown`, never "predates".
 */
export function privacyBuildOf(migrationFiles: readonly string[] | null, table: 'present' | 'absent' | 'unreadable'): PrivacyBuild {
    if (!Array.isArray(migrationFiles) || migrationFiles.length === 0 || table === 'unreadable') return 'unknown';
    const listed = migrationFiles.includes(PRIVACY_MIGRATION_1835);
    if (listed && table === 'present') return 'includes_1835';
    if (!listed && table === 'absent') return 'predates_1835';
    return 'unknown';
}

export type ChoiceRead = { state: 'read'; row: unknown } | { state: 'absent' } | { state: 'unreadable' };

/** Pure: the owner's server row records exactly `choice` (consent version 1). */
export function privacyChoiceVerdict(read: ChoiceRead, ownerId: string, choice: PracticeChoice):
    { verdict: 'PASS' | 'FAIL'; reason: 'recorded' | 'unreadable' | 'missing' | 'wrong_owner' | 'malformed' | 'differs' } {
    if (read.state === 'absent') return { verdict: 'FAIL', reason: 'missing' };
    if (read.state !== 'read') return { verdict: 'FAIL', reason: 'unreadable' };
    const row = read.row as { user_id?: unknown; transcript_save?: unknown; ai_coaching?: unknown; consent_version?: unknown } | null;
    if (!row) return { verdict: 'FAIL', reason: 'missing' };
    if (row.user_id !== ownerId) return { verdict: 'FAIL', reason: 'wrong_owner' };
    if (row.consent_version !== 1 || typeof row.transcript_save !== 'boolean' || typeof row.ai_coaching !== 'boolean') {
        return { verdict: 'FAIL', reason: 'malformed' };
    }
    return row.transcript_save === choice.transcriptSave && row.ai_coaching === choice.aiCoaching
        ? { verdict: 'PASS', reason: 'recorded' } : { verdict: 'FAIL', reason: 'differs' };
}

/** One AI option as the page renders it: `aria-disabled` and `aria-checked` read from the control itself. */
export interface AiOptionRead { ariaDisabled: string | null; ariaChecked: string | null }
export interface AiControlsRead { yes: AiOptionRead; no: AiOptionRead; needsSaveShown: boolean }

/**
 * Pure: the #1835 prompt's AI controls are in the state this choice requires (PracticePrivacyPrompt.tsx on the #1835 branch).
 *   - "Don't save" chosen: AI coaching can only be off, so the prompt itself settles it. BOTH AI options are unavailable
 *     (`aria-disabled="true"`), neither is checked, and the needs-saving reason is shown. Neither is pressed: a press on an
 *     unavailable option does nothing, and Playwright refuses it as not enabled, so the old helper never reached Continue.
 *   - "Save transcripts" chosen: both AI options are available; after the press, exactly the chosen one is checked.
 * `stage` says which reading this is: `before_ai` (after the save press) or `after_ai` (after the AI press, saving on only).
 */
export function aiControlsVerdict(choice: PracticeChoice, read: AiControlsRead, stage: 'before_ai' | 'after_ai'):
    { ok: true } | { ok: false; reason: 'ai_controls_not_unavailable' | 'ai_option_checked_while_off' | 'ai_needs_save_reason_missing'
        | 'ai_controls_unavailable_while_saving' | 'ai_needs_save_reason_while_saving' | 'ai_choice_not_checked' } {
    const unavailable = (o: AiOptionRead) => o.ariaDisabled === 'true';
    const checked = (o: AiOptionRead) => o.ariaChecked === 'true';
    if (!choice.transcriptSave) {
        if (!unavailable(read.yes) || !unavailable(read.no)) return { ok: false, reason: 'ai_controls_not_unavailable' };
        if (checked(read.yes) || checked(read.no)) return { ok: false, reason: 'ai_option_checked_while_off' };
        if (!read.needsSaveShown) return { ok: false, reason: 'ai_needs_save_reason_missing' };
        return { ok: true };
    }
    if (unavailable(read.yes) || unavailable(read.no)) return { ok: false, reason: 'ai_controls_unavailable_while_saving' };
    if (read.needsSaveShown) return { ok: false, reason: 'ai_needs_save_reason_while_saving' };
    if (stage === 'after_ai') {
        const chosen = choice.aiCoaching ? read.yes : read.no;
        const other = choice.aiCoaching ? read.no : read.yes;
        if (!checked(chosen) || checked(other)) return { ok: false, reason: 'ai_choice_not_checked' };
    }
    return { ok: true };
}

type PromptLocator = ReturnType<Page['getByTestId']>;

async function readAiControls(prompt: PromptLocator): Promise<AiControlsRead> {
    const option = async (testId: string): Promise<AiOptionRead> => {
        const control = prompt.getByTestId(testId);
        return { ariaDisabled: await control.getAttribute('aria-disabled').catch(() => null),
            ariaChecked: await control.getAttribute('aria-checked').catch(() => null) };
    };
    return { yes: await option(PRACTICE_PRIVACY_PROMPT.aiYes), no: await option(PRACTICE_PRIVACY_PROMPT.aiNo),
        needsSaveShown: await prompt.getByTestId(PRACTICE_PRIVACY_PROMPT.aiNeedsSave).isVisible().catch(() => false) };
}

/** Re-read the AI controls until they match (React commits the press asynchronously), or the last reading's reason. */
async function awaitAiControls(prompt: PromptLocator, choice: PracticeChoice, stage: 'before_ai' | 'after_ai', timeoutMs: number,
    pollMs = 100): Promise<ReturnType<typeof aiControlsVerdict>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const verdict = aiControlsVerdict(choice, await readAiControls(prompt), stage);
        if (verdict.ok || Date.now() >= deadline) return verdict;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
}

/**
 * Answer the Practice prompt as a user would. Only a FRESH owner (no recorded choice) is answered: the caller must not
 * rewrite an existing choice. Returns false when the prompt never showed.
 *
 * #1882 (Sam, Nov 18, review point 1): "Don't save" uses #1835's disabled-control contract. Both AI options become
 * unavailable and the prompt settles coaching off by itself, so they are checked, not pressed, and Continue is next. The
 * owner's recorded false/false row is then verified by the caller (`settlePracticeConsent`). A prompt that does not show
 * that contract stops with `HOLD practice consent: <reason>` before Continue.
 */
export async function answerPracticePrivacyPrompt(page: Page, choice: PracticeChoice, timeoutMs = 30_000): Promise<boolean> {
    if (choice.aiCoaching && !choice.transcriptSave) throw new Error('INVALID_SETUP AI coaching requires transcript saving (#1835)');
    const prompt = page.getByTestId(PRACTICE_PRIVACY_PROMPT.root);
    const shown = await prompt.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true, () => false);
    if (!shown) return false;
    await prompt.getByTestId(choice.transcriptSave ? PRACTICE_PRIVACY_PROMPT.saveYes : PRACTICE_PRIVACY_PROMPT.saveNo).click({ timeout: timeoutMs });
    const afterSave = await awaitAiControls(prompt, choice, 'before_ai', timeoutMs);
    if (!afterSave.ok) throw new Error(`HOLD practice consent: ${afterSave.reason}`);
    if (choice.transcriptSave) {
        await prompt.getByTestId(choice.aiCoaching ? PRACTICE_PRIVACY_PROMPT.aiYes : PRACTICE_PRIVACY_PROMPT.aiNo).click({ timeout: timeoutMs });
        const afterAi = await awaitAiControls(prompt, choice, 'after_ai', timeoutMs);
        if (!afterAi.ok) throw new Error(`HOLD practice consent: ${afterAi.reason}`);
    }
    await prompt.getByTestId(PRACTICE_PRIVACY_PROMPT.continue).click({ timeout: timeoutMs });
    await prompt.waitFor({ state: 'hidden', timeout: timeoutMs }).catch(() => undefined);
    return true;
}

export interface SavedSessionRead {
    id?: unknown; user_id?: unknown; status?: unknown; duration?: unknown; transcript?: unknown; transcript_state?: unknown;
}

export interface ConsentReadback {
    verdict: 'PASS' | 'FAIL' | 'HOLD';
    reason: 'transcript_saved' | 'metrics_only' | 'build_unknown' | 'row_missing' | 'wrong_row' | 'not_completed'
        | 'no_metrics' | 'transcript_missing_while_on' | 'transcript_saved_while_off';
}

/**
 * Pure. A saved take read back by its exact id and owner:
 *   - saving ON (or a verified pre-#1835 build, which always saved): completed, a positive duration, and a non-empty
 *     available transcript;
 *   - saving OFF: completed, a positive duration (the metrics), and NO transcript (null, not available).
 * `minDurationSeconds` binds the row to the measured take: the stored duration must be at least the take's measured live
 * seconds, floored, minus one second of rounding.
 */
export function consentReadbackVerdict(input: {
    build: PrivacyBuild; choice: PracticeChoice | null; row: SavedSessionRead | null; ownerId: string; sessionId: string;
    minDurationSeconds: number;
}): ConsentReadback {
    if (input.build === 'unknown' || (input.build === 'includes_1835' && !input.choice)) return { verdict: 'HOLD', reason: 'build_unknown' };
    const row = input.row;
    if (!row) return { verdict: 'FAIL', reason: 'row_missing' };
    if (row.id !== input.sessionId || row.user_id !== input.ownerId) return { verdict: 'FAIL', reason: 'wrong_row' };
    if (row.status !== 'completed') return { verdict: 'FAIL', reason: 'not_completed' };
    const floor = Math.max(0, Math.floor(input.minDurationSeconds) - 1);
    if (typeof row.duration !== 'number' || !Number.isFinite(row.duration) || row.duration <= 0 || row.duration < floor) {
        return { verdict: 'FAIL', reason: 'no_metrics' };
    }
    const hasTranscript = typeof row.transcript === 'string' && row.transcript.trim() !== '' && row.transcript_state === 'available';
    const saving = input.build === 'predates_1835' ? true : input.choice!.transcriptSave;
    if (saving) return hasTranscript ? { verdict: 'PASS', reason: 'transcript_saved' } : { verdict: 'FAIL', reason: 'transcript_missing_while_on' };
    const noTranscript = row.transcript === null && row.transcript_state !== 'available';
    return noTranscript ? { verdict: 'PASS', reason: 'metrics_only' } : { verdict: 'FAIL', reason: 'transcript_saved_while_off' };
}

/** The few calls of a Supabase service client this module uses (the journey's own admin client). */
export interface ChoiceClient {
    from(table: string): {
        select(cols: string): { eq(col: string, v: string): { maybeSingle(): PromiseLike<{ data: unknown; error: { code?: string } | null }> };
            limit(n: number): PromiseLike<{ data: unknown; error: { code?: string } | null }> };
    };
}

const MISSING_TABLE = new Set(['42P01', 'PGRST205']);

/** Reads the owner's own choice row through the service client; a missing table is `absent`, any other error `unreadable`. */
export async function readPracticeChoice(client: ChoiceClient, ownerId: string): Promise<ChoiceRead> {
    try {
        const r = await client.from('practice_privacy_choices').select('user_id,transcript_save,ai_coaching,consent_version').eq('user_id', ownerId).maybeSingle();
        if (r.error) return MISSING_TABLE.has(r.error.code ?? '') ? { state: 'absent' } : { state: 'unreadable' };
        return { state: 'read', row: r.data };
    } catch { return { state: 'unreadable' }; }
}

/** Whether the target answers for `practice_privacy_choices` at all (the build's applied schema, independent of any owner). */
export async function probePrivacyTable(client: ChoiceClient): Promise<'present' | 'absent' | 'unreadable'> {
    try {
        const r = await client.from('practice_privacy_choices').select('user_id').limit(1);
        if (r.error) return MISSING_TABLE.has(r.error.code ?? '') ? 'absent' : 'unreadable';
        return 'present';
    } catch { return 'unreadable'; }
}

export interface SettledConsent {
    build: PrivacyBuild;
    /** The choice this run recorded; null on a verified pre-#1835 build, where there is no choice to make. */
    choice: PracticeChoice | null;
    mode: ConsentMode | null;
}

/**
 * On the Practice page, before any recording: settle the run's consent for a FRESH run-owned owner.
 *   - verified pre-#1835 build: nothing to answer, `choice: null`;
 *   - #1835 build: the run's mode is required; the owner must have NO recorded choice (never rewritten); the prompt is
 *     answered as a user would; the owner's own server row must then record exactly that choice;
 *   - unknown build: stops.
 * Every stop throws `HOLD practice consent: <reason>` before any take exists.
 */
export async function settlePracticeConsent(input: {
    page: Page; client: ChoiceClient; ownerId: string; migrationFiles: readonly string[] | null; mode: ConsentMode | null;
}): Promise<SettledConsent> {
    const build = privacyBuildOf(input.migrationFiles, await probePrivacyTable(input.client));
    if (build === 'unknown') throw new Error('HOLD practice consent: build_unknown');
    if (build === 'predates_1835') return { build, choice: null, mode: input.mode };
    if (!input.mode) throw new Error('HOLD practice consent: mode_unset (RWT_PRACTICE_CONSENT is save_on, save_on_coaching_on or save_off)');
    const choice = CONSENT_MODES[input.mode];
    const before = await readPracticeChoice(input.client, input.ownerId);
    if (before.state !== 'read') throw new Error(`HOLD practice consent: choice_${before.state}`);
    if (before.row !== null && before.row !== undefined) throw new Error('HOLD practice consent: choice_already_recorded');
    if (!(await answerPracticePrivacyPrompt(input.page, choice))) throw new Error('HOLD practice consent: prompt_not_shown');
    const recorded = privacyChoiceVerdict(await readPracticeChoice(input.client, input.ownerId), input.ownerId, choice);
    if (recorded.verdict !== 'PASS') throw new Error(`HOLD practice consent: choice_${recorded.reason}`);
    return { build, choice, mode: input.mode };
}

/** One receipt row, as the caller records it (content-free: reasons and states only, never a thrown message). */
export type ConsentRowRecorder = (status: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence: Record<string, string>) => void;

/**
 * J1.a, on the Practice page before anything else there (Sam, Nov 20): settle this run's FIXED consent for its fresh run-owned
 * owner through the prompt. A failure records the required `practice privacy choice` row as HOLD with its reason and rethrows,
 * so the journey never leaves Practice. Success records nothing yet: the row's PASS belongs to the final readback, which
 * `captureConsentGate` takes immediately before the first capture-capable call.
 */
export async function settleFixedConsentOnPractice(input: {
    page: Page; client: ChoiceClient; ownerId: string; migrationFiles: readonly string[] | null; mode: ConsentMode; record: ConsentRowRecorder;
}): Promise<SettledConsent> {
    try {
        return await settlePracticeConsent({ page: input.page, client: input.client, ownerId: input.ownerId, migrationFiles: input.migrationFiles, mode: input.mode });
    } catch (error) {
        const reason = /^HOLD practice consent: ([a-z0-9_]+)/.exec(error instanceof Error ? error.message : '')?.[1] ?? 'not_settled';
        input.record('HOLD', `the Practice prompt was not settled for this run's account before capture (${reason})`, { reason, mode: input.mode });
        throw error;
    }
}

export interface CaptureConsentGate {
    /** Read the owner's row back NOW and require exactly the fixed choice; call it immediately before a capture-capable call. */
    confirm(): Promise<void>;
    /** Record the required row as PASS once capture has begun after a confirm; a capture with no fresh confirm is a HOLD. */
    recordPass(): void;
}

/**
 * The final consent check (Sam, Nov 20: "right before Start" means before the first capture-capable call, not before navigation).
 * The cold model helper can itself start capture, so the journey confirms immediately before it, and again immediately before
 * an ordinary Start if that helper did not record. Each confirm reads the owner's own row from the server; anything but the
 * fixed choice for this owner on a #1835 build records the row with its reason and throws `HOLD practice consent: <reason>`.
 * The row is recorded exactly once.
 */
export function captureConsentGate(input: {
    consent: SettledConsent; client: ChoiceClient; ownerId: string; mode: ConsentMode; record: ConsentRowRecorder;
}): CaptureConsentGate {
    let confirmed: ReturnType<typeof fixedConsentBeforeStartVerdict> | null = null;
    let recorded = false;
    const evidence = (reason: string) => ({ reason, build: input.consent.build, mode: input.consent.mode ?? 'none' });
    const once = (status: 'PASS' | 'FAIL' | 'HOLD', detail: string, reason: string) => {
        if (recorded) return;
        recorded = true;
        input.record(status, detail, evidence(reason));
    };
    return {
        async confirm() {
            confirmed = null;
            const readback = input.consent.build === 'includes_1835' ? await readPracticeChoice(input.client, input.ownerId) : null;
            const v = fixedConsentBeforeStartVerdict({ build: input.consent.build, mode: input.consent.mode, expected: input.mode, readback,
                ownerId: input.ownerId || null });
            if (v.status !== 'PASS') { once(v.status, v.detail, v.reason); throw new Error(`HOLD practice consent: ${v.reason}`); }
            confirmed = v;
        },
        recordPass() {
            const v = confirmed;
            confirmed = null; // a later capture needs its own fresh confirm
            if (!v) {
                once('HOLD', 'capture began without a consent readback immediately before it', 'not_confirmed_before_capture');
                throw new Error('HOLD practice consent: not_confirmed_before_capture');
            }
            once('PASS', v.detail, v.reason);
        },
    };
}
