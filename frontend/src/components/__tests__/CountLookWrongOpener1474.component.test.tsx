/**
 * #1474 — "Count look wrong?" opens the EXISTING Share Feedback dialog from both real THIS RUN callers (Browser PM
 * opener disposition 6239720648, Sam GO 6239797815).
 *
 * Each caller is rendered for real beside the Navigation-owned dialog, under the one typed, owner-scoped request path.
 * The dialog keeps all of its own behaviour: its opening initialization and visible session selector, restored-choice
 * precedence, snapshot-on-open, explicit Send, idempotency and account reset. Opening never submits and never copies the
 * transcript or counts into the report.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
import { IssueReportDialog } from '../IssueReportDialog';
import { FeedbackOpenerProvider } from '@/contexts/FeedbackOpenerContext';
import { SessionOverhaulView, type SessionOverhaulViewProps } from '../session/SessionOverhaulView';
import { issueReportService } from '@/services/issueReportService';
import { clearLoginSessions, recordSavedSession, setCurrentLogin } from '@/services/loginSessionLog';
import { rememberCoachingDiagnostic } from '@/services/coachingDiagnosticLink';
import { useSessionStore } from '@/stores/useSessionStore';
import type { SttStatus } from '@/types/transcription';
import type { PracticeSession } from '@/types/session';

vi.mock('@/services/telemetry/safeEmit', () => ({ safeEmit: vi.fn() }));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/issueReportService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/issueReportService')>();
    return { ...actual, issueReportService: { ...actual.issueReportService, submit: vi.fn(async () => ({ id: 'report-1' })) } };
});
// The restored review's network-backed children are not this test's subject.
vi.mock('@/components/analytics/SavedPracticeLoopReview', () => ({ SavedPracticeLoopReview: () => <section data-testid="saved-review" /> }));
vi.mock('@/components/analytics/SavedFocusPointsCoverage', () => ({ SavedFocusPointsCoverage: () => <div /> }));

const { SavedSessionReturn } = await import('../session/SavedSessionReturn');

const submit = vi.mocked(issueReportService.submit);
const LOGIN = 1_700_000_000_000;
const OLDER = '11111111-1111-4111-8111-111111111111';
const NEWER = '22222222-2222-4222-8222-222222222222';
const OLDER_DIAGNOSTIC = 'a1111111-1111-4111-8111-111111111111';
const NEWER_DIAGNOSTIC = 'a2222222-2222-4222-8222-222222222222';

const live: SessionOverhaulViewProps = {
    authUserId: 'u1', isListening: false, sttStatus: { type: 'idle' } as SttStatus, elapsedTime: 30, micLevel: 0,
    transcriptContent: 'so um I think we should start', showAnalyticsPrompt: true, metricsFillerCount: 1,
    onStartStop: vi.fn(), history: [],
    reviewTranscript: { kind: 'available', text: 'so um I think we should start' },
};
const savedRow = { id: OLDER, user_id: 'u1', created_at: '2026-10-17T18:12:00Z', duration: 95, total_words: 190, wpm: 120,
    filler_counts: { um: 2, uh: 1 }, transcript_state: 'available', transcript: 'The saved words.' } as unknown as PracticeSession;

type Caller = 'live after-state review (SessionOverhaulView)' | 'restored review /session?review= (SavedSessionReturn)';
const CALLERS: Caller[] = ['live after-state review (SessionOverhaulView)', 'restored review /session?review= (SavedSessionReturn)'];

/** The dialog beside one real caller, both under the one opener provider — as App mounts them. */
function renderWith(caller: Caller, { dialogUser = 'u1', ownerId = 'u1' as string | null } = {}) {
    const page = caller.startsWith('live')
        ? <SessionOverhaulView {...live} authUserId={ownerId} />
        : <SavedSessionReturn session={savedRow} onSeeAllSessions={vi.fn()} ownerId={ownerId} />;
    const route = caller.startsWith('live') ? '/session' : `/session?review=${OLDER}`;
    render(<FeedbackOpenerProvider><IssueReportDialog userId={dialogUser} sttMode="private" plan="pro" />{page}</FeedbackOpenerProvider>, { route });
    return userEvent.setup();
}
const link = () => screen.getByRole('button', { name: 'Count look wrong?' });
const select = () => screen.getByTestId('feedback-session-select') as HTMLSelectElement;
const heading = () => screen.queryByRole('heading', { name: 'Share feedback' });

beforeEach(() => {
    useSessionStore.setState({ captureLive: false });
    submit.mockClear();
    sessionStorage.clear();
    clearLoginSessions();
    setCurrentLogin(null, null);
});

describe.each(CALLERS)('#1474 "Count look wrong?" from the %s', (caller) => {
    it('keyboard: Enter on the link opens exactly one Share Feedback dialog; closing returns focus to the link; nothing is sent', async () => {
        const user = renderWith(caller);
        link().focus();
        await user.keyboard('{Enter}');
        expect(await screen.findByRole('heading', { name: 'Share feedback' })).toBeInTheDocument();
        expect(screen.getAllByRole('dialog')).toHaveLength(1);
        await user.keyboard('{Escape}');
        await waitFor(() => expect(heading()).toBeNull());
        expect(link()).toHaveFocus();
        expect(submit).not.toHaveBeenCalled();
    });

    it('Escape keeps the draft for the next opening; Cancel clears it', async () => {
        const user = renderWith(caller);
        await user.click(link());
        await user.type(await screen.findByTestId('issue-report-description'), 'The filler count missed two ums.');
        await user.keyboard('{Escape}');
        await waitFor(() => expect(heading()).toBeNull());
        await user.click(link());
        expect(await screen.findByTestId('issue-report-description')).toHaveValue('The filler count missed two ums.');
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(heading()).toBeNull());
        await user.click(link());
        expect(await screen.findByTestId('issue-report-description')).toHaveValue('');
        expect(submit).not.toHaveBeenCalled();
    });

    it('the visible selector keeps its own rules: an older take chosen explicitly sends ITS session and ITS diagnostic', async () => {
        setCurrentLogin('u1', LOGIN);
        recordSavedSession('u1', LOGIN, { key: OLDER, product: 'open_mic', savedAt: LOGIN + 1_000 });
        recordSavedSession('u1', LOGIN, { key: NEWER, product: 'open_mic', savedAt: LOGIN + 2_000 });
        rememberCoachingDiagnostic(OLDER, OLDER_DIAGNOSTIC);
        rememberCoachingDiagnostic(NEWER, NEWER_DIAGNOSTIC);
        const user = renderWith(caller);
        await user.click(link());
        await screen.findByRole('heading', { name: 'Share feedback' });
        // The default is the dialog's own: newest eligible. Neither route is a path the selector reads as "being viewed".
        expect(select().value).toBe(NEWER);
        await user.selectOptions(select(), OLDER);
        await user.click(screen.getByTestId('feedback-type-broke'));
        await user.type(screen.getByTestId('issue-report-description'), 'Count look wrong.');
        await user.click(screen.getByTestId('issue-report-submit'));
        await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
        const sent = submit.mock.calls[0][0];
        expect(sent.sessionId).toBe(OLDER);
        expect(sent.metadata.coaching_diagnostic_ref).toBe(OLDER_DIAGNOSTIC);
        // Opening copies nothing: no transcript, no count values.
        expect(JSON.stringify(sent)).not.toMatch(/saved words|I think we should start|"fillers"|"wpm"/);
    });

    it('No session sends no session and no diagnostic', async () => {
        setCurrentLogin('u1', LOGIN);
        recordSavedSession('u1', LOGIN, { key: NEWER, product: 'open_mic', savedAt: LOGIN + 2_000 });
        rememberCoachingDiagnostic(NEWER, NEWER_DIAGNOSTIC);
        const user = renderWith(caller);
        await user.click(link());
        await screen.findByRole('heading', { name: 'Share feedback' });
        await user.selectOptions(select(), '__none');
        await user.click(screen.getByTestId('feedback-type-broke'));
        await user.type(screen.getByTestId('issue-report-description'), 'General count issue.');
        await user.click(screen.getByTestId('issue-report-submit'));
        await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
        expect(submit.mock.calls[0][0].sessionId).toBeNull();
        expect(submit.mock.calls[0][0].metadata.coaching_diagnostic_ref).toBeNull();
    });

    it('owner-scoped: a request filed for a different account never opens this dialog', async () => {
        const user = renderWith(caller, { dialogUser: 'u1', ownerId: 'u2' });
        await user.click(link());
        await new Promise((r) => setTimeout(r, 50));
        expect(heading()).toBeNull();
    });

    it('no signed-in owner: no link at all (a link that opens nothing is worse than an absent one)', () => {
        renderWith(caller, { ownerId: null });
        expect(screen.queryByRole('button', { name: 'Count look wrong?' })).toBeNull();
    });
});
