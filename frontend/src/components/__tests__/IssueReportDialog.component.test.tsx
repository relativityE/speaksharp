import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
import { IssueReportDialog } from '../IssueReportDialog';
import { issueReportService } from '@/services/issueReportService';
import { toast } from '@/lib/toast';
import { clearLoginSessions, recordSavedSession, setCurrentLogin, LOGIN_SESSION_LOG_KEY } from '@/services/loginSessionLog';
import { FEEDBACK_DRAFT_KEY } from '@/services/feedbackDraft';

const emitted: Array<{ event: string; props: Record<string, unknown> }> = [];
vi.mock('@/services/telemetry/safeEmit', () => ({
  safeEmit: (event: string, props: Record<string, unknown>) => { emitted.push({ event, props }); },
}));

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/issueReportService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/issueReportService')>();
  return {
    ...actual,
    issueReportService: { ...actual.issueReportService, submit: vi.fn(async () => ({ id: 'report-1' })) },
  };
});

const submit = vi.mocked(issueReportService.submit);
const UUID = '130bbc6c-5d89-465d-91e6-51f5a5951e34';

const open = async (route = '/session', userId = 'u1') => {
  const user = userEvent.setup();
  render(<IssueReportDialog userId={userId} sttMode="private" plan="pro" />, { route });
  await user.click(screen.getByTestId('nav-report-issue-button'));
  await screen.findByRole('heading', { name: 'Share feedback' });
  return user;
};

describe('#1404 Share feedback redesign', () => {
  beforeEach(() => {
    submit.mockReset();
    submit.mockResolvedValue({ id: 'report-1' });
    vi.mocked(toast.success).mockClear();
    sessionStorage.clear();
    clearLoginSessions();
    setCurrentLogin(null, null);
  });

  it('renders only the accepted questions and removes the old ticket-filing form', async () => {
    await open();
    expect(screen.getByText('What would you like to share?')).toBeInTheDocument();
    expect(screen.getAllByRole('radio', { name: /Something broke|Unclear or confusing|I have an idea|This worked well/ })).toHaveLength(4);
    expect(screen.getByTestId('issue-report-description')).toBeEnabled();
    for (const removed of ['Message', 'Where in the app?', 'Category', 'Impact', 'Title', 'Short description']) {
      expect(screen.queryByText(removed, { exact: true })).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/Tell us what.s on your mind/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('issue-report-include-audio')).not.toBeInTheDocument();
  });

  it('lets the user write first; type plus one non-space character enables Send', async () => {
    const user = await open();
    const body = screen.getByTestId('issue-report-description');
    await user.type(body, 'x');
    expect(screen.getByTestId('issue-report-submit')).toBeDisabled();
    await user.click(screen.getByTestId('feedback-type-idea'));
    expect(body).toHaveValue('x');
    expect(screen.getByTestId('issue-report-submit')).toBeEnabled();
  });

  it('submits a content-safe report with derived legacy fields and an idempotency key', async () => {
    // The report references the session saved in THIS login (preselected as "Current session (1)").
    setCurrentLogin('u1', 1000);
    recordSavedSession('u1', 1000, { key: UUID, product: 'open_mic', savedAt: Date.now() });
    const user = await open(`/analytics/${UUID}`);
    await user.click(screen.getByTestId('feedback-type-broke'));
    await user.click(screen.getByTestId('feedback-severity-slowed'));
    await user.type(screen.getByTestId('issue-report-description'), 'The chart went blank. I expected the saved session.');
    await user.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const value = submit.mock.calls[0][0];
    expect(value).toMatchObject({
      sessionId: UUID,
      category: 'analytics_sessions',
      severity: 'medium',
      title: 'The chart went blank.',
      description: 'The chart went blank. I expected the saved session.',
      pageUrl: '/analytics/:sessionId',
      includeAudio: false,
      metadata: expect.objectContaining({
        feedback_kind: 'issue',
        feedback_type: 'broke',
        feedback_severity: 'slowed',
        sttMode: 'private',
      }),
    });
    expect(value.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(JSON.stringify(value)).not.toContain('transcript');
    expect(toast.success).toHaveBeenCalledWith('Thanks — we’ve got it.');
  });

  it.each([
    ['/analytics', null, '/analytics'],
    ['/analytics/not-a-session', null, '/other'],
    [`/analytics/${UUID}`, UUID, '/analytics/:sessionId'],
  ])('derives the page context from the route without leaking a concrete session id: %s', async (route, _routeSession, pageUrl) => {
    const user = await open(route);
    await user.click(screen.getByTestId('feedback-type-idea'));
    await user.type(screen.getByTestId('issue-report-description'), 'Add a clearer next step.');
    await user.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const value = submit.mock.calls[0][0];
    // The route no longer chooses the session (PO 2026-09-28): with nothing saved in this login the default is No session.
    expect(value.sessionId).toBeNull();
    expect(value.pageUrl).toBe(pageUrl);
    expect(JSON.stringify(value.metadata)).not.toContain(UUID);
  });

  it('keeps severity optional and clears it when the user changes away from Something broke', async () => {
    const user = await open();
    await user.click(screen.getByTestId('feedback-type-broke'));
    await user.click(screen.getByTestId('feedback-severity-blocked'));
    await user.click(screen.getByTestId('feedback-type-praise'));
    expect(screen.queryByText('Did it stop you?')).not.toBeInTheDocument();
    await user.type(screen.getByTestId('issue-report-description'), 'The pacing display helped.');
    await user.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0][0]).toMatchObject({
      severity: 'not_applicable',
      metadata: expect.objectContaining({ feedback_type: 'praise', feedback_severity: null }),
    });
  });

  it('preserves a draft on Escape and clears it on explicit Cancel', async () => {
    const user = await open();
    await user.type(screen.getByTestId('issue-report-description'), 'Keep this draft');
    await user.click(screen.getByTestId('feedback-type-confused'));
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('nav-report-issue-button'));
    expect(screen.getByTestId('issue-report-description')).toHaveValue('Keep this draft');
    expect(screen.getByTestId('feedback-type-confused')).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByTestId('nav-report-issue-button'));
    expect(screen.getByTestId('issue-report-description')).toHaveValue('');
  });

  it('discards a draft older than 24 hours instead of retaining user-written text indefinitely', async () => {
    sessionStorage.setItem('feedback.draft', JSON.stringify({
      ownerId: 'u1',
      type: 'idea',
      body: 'Expired draft',
      severity: null,
      savedAt: Date.now() - (24 * 60 * 60 * 1000) - 1,
      idempotencyKey: UUID,
    }));
    await open();
    expect(screen.getByTestId('issue-report-description')).toHaveValue('');
    expect(sessionStorage.getItem('feedback.draft')).toBeNull();
  });

  it('never restores one account\'s draft for another account in the same tab', async () => {
    sessionStorage.setItem('feedback.draft', JSON.stringify({
      ownerId: 'u1',
      type: 'confused',
      body: 'Private draft from another account',
      severity: null,
      savedAt: Date.now(),
      idempotencyKey: UUID,
    }));

    await open('/session', 'u2');

    expect(screen.getByTestId('issue-report-description')).toHaveValue('');
    expect(sessionStorage.getItem('feedback.draft')).toBeNull();
  });

  it('keeps the form and draft visible when delivery fails', async () => {
    submit.mockRejectedValueOnce(new Error('network'));
    const user = await open();
    await user.click(screen.getByTestId('feedback-type-confused'));
    await user.type(screen.getByTestId('issue-report-description'), 'The next action was unclear.');
    await user.click(screen.getByTestId('issue-report-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('That didn’t go through. Try again?');
    expect(screen.getByTestId('issue-report-description')).toHaveValue('The next action was unclear.');
    expect(screen.getByTestId('issue-report-submit')).toBeEnabled();
  });

  it('shows concise provenance first and details only on request', async () => {
    const user = await open('/session');
    const provenance = screen.getByTestId('issue-report-page-context');
    // #1416 item 4 → spec §7: the bare "no transcript or audio" read as a promise that nothing the user
    // contributes is sent. The line leads with what IS sent — only what they write — and never returns to
    // the bare form.
    expect(provenance).toHaveTextContent(
      'Sent from Session · Speaking · only what you write here — no transcript or audio.',
    );
    expect(provenance.textContent ?? '').not.toMatch(/·\s*no transcript or audio/);
    expect(screen.queryByTestId('issue-report-disclosure')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: "What's included" }));
    const disclosure = screen.getByTestId('issue-report-disclosure');
    expect(disclosure).toHaveTextContent(
      /We attach an internal account reference, this screen, the app version, and basic browser and operating-system details/i,
    );
    expect(disclosure).toHaveTextContent(
      /don’t automatically attach your email, name, credentials, transcript, or audio/i,
    );
    // The half that was missing: what the user TYPES is submitted, said plainly.
    expect(disclosure).toHaveTextContent(/Anything you type in the feedback box is included in your report/i);
  });

  it('#1416 — does NOT invent an issue area', async () => {
    // This stored the first allowlisted area for the page as though the user had chosen it. With no
    // area selector in the redesigned form, every report from a screen carried the same invented
    // classification — and it looked like data. A confidently wrong field is worse than an empty one,
    // because a triage query cannot tell the two apart.
    const user = await open('/session');
    await user.click(screen.getByTestId('feedback-type-broke'));
    await user.type(screen.getByTestId('issue-report-description'), 'The next action was unclear.');
    await user.click(screen.getByTestId('issue-report-submit'));

    // Indexed rather than `.at(-1)`: this project's TS lib target predates `Array.prototype.at`, and
    // vitest transpiles happily while `tsc` — which the gate runs — does not.
    // The real input type is available, so assert against it rather than casting to a loose shape —
    // a `Record<string, unknown>` cast would also have accepted a metadata object that had lost the
    // field entirely, which is the thing being tested.
    const calls = submit.mock.calls;
    const submitted = calls[calls.length - 1]?.[0];
    expect(submitted).toBeTruthy();
    expect(submitted?.metadata?.issueArea).toBeNull();
  });

  it('does not restore the long privacy block or the audio checkbox', async () => {
    await open('/session');
    // The detail stays behind "What's included" so the default form remains short.
    expect(screen.queryByTestId('issue-report-disclosure')).not.toBeInTheDocument();
    expect(screen.queryByTestId('issue-report-include-audio')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/attach audio/i)).not.toBeInTheDocument();
  });

  it('supports arrow-key selection in the type radiogroup', async () => {
    const user = await open();
    const broke = screen.getByTestId('feedback-type-broke');
    expect(broke).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('feedback-type-confused')).toHaveFocus();
    expect(screen.getByTestId('feedback-type-confused')).toHaveAttribute('aria-checked', 'true');
  });
  it('#1416 erasing every field erases the stored draft', async () => {
    // The user typed, changed their mind, and deleted it. That is the clearest possible statement
    // that they do not want it kept — but the old guard skipped both writing AND clearing, so the
    // deleted text came back on reopen and sat in this tab for up to 24 hours.
    const user = await open('/session');
    const body = screen.getByTestId('issue-report-description');
    await user.type(body, 'Something I regret typing');
    await waitFor(() => expect(sessionStorage.getItem('feedback.draft')).toContain('regret'));

    await user.clear(body);
    await waitFor(() => expect(sessionStorage.getItem('feedback.draft')).toBeNull());

    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('nav-report-issue-button'));
    expect(await screen.findByTestId('issue-report-description')).toHaveValue('');
  });

  it('#1416 editing after a failed attempt sends under a new delivery identity', async () => {
    // The insert may have committed with the response lost. Reusing the key would let
    // ON CONFLICT DO NOTHING silently discard the correction while the UI reports success.
    const user = await open('/session');
    await user.click(screen.getByTestId('feedback-type-idea'));
    await user.type(screen.getByTestId('issue-report-description'), 'First wording.');

    submit.mockRejectedValueOnce(new Error('transport lost'));
    await user.click(screen.getByTestId('issue-report-submit'));
    await screen.findByText(/didn.t go through/i);
    const firstKey = submit.mock.calls[0][0].idempotencyKey;

    await user.type(screen.getByTestId('issue-report-description'), ' Corrected wording.');
    await user.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));

    const secondCall = submit.mock.calls[1][0];
    expect(secondCall.description).toContain('Corrected wording.');
    expect(secondCall.idempotencyKey).not.toBe(firstKey);
  });

  it('#1416 resending the same content after a failure keeps deduplicating', async () => {
    const user = await open('/session');
    await user.click(screen.getByTestId('feedback-type-idea'));
    await user.type(screen.getByTestId('issue-report-description'), 'Unchanged wording.');

    submit.mockRejectedValueOnce(new Error('transport lost'));
    await user.click(screen.getByTestId('issue-report-submit'));
    await screen.findByText(/didn.t go through/i);

    await user.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1][0].idempotencyKey).toBe(submit.mock.calls[0][0].idempotencyKey);
  });
  // #1416 — the two custom radio groups must behave like native ones.
  describe('#1416 keyboard behaviour of the custom radio groups', () => {
    const typeIds = ['feedback-type-broke', 'feedback-type-confused', 'feedback-type-idea', 'feedback-type-praise'];
    const severityIds = ['feedback-severity-minor', 'feedback-severity-slowed', 'feedback-severity-blocked'];

    const tabStops = (ids: string[]) => ids.filter((id) => screen.getByTestId(id).getAttribute('tabindex') === '0');

    it('feedback type is ONE tab stop, not four', async () => {
      await open();
      // Roving tabIndex. Without it a keyboard user tabs through every option to reach the message
      // field, while the ARIA roles promise arrows will do it.
      expect(tabStops(typeIds)).toEqual(['feedback-type-broke']);
    });

    it('the tab stop follows the selection', async () => {
      const user = await open();
      await user.click(screen.getByTestId('feedback-type-idea'));
      expect(tabStops(typeIds)).toEqual(['feedback-type-idea']);
    });

    it('Tab LEAVES the type group rather than visiting every option', async () => {
      const user = await open();
      expect(screen.getByTestId('feedback-type-broke')).toHaveFocus();
      await user.tab();
      expect(screen.getByTestId('feedback-type-confused')).not.toHaveFocus();
      expect(screen.getByTestId('feedback-type-praise')).not.toHaveFocus();
    });

    it('arrows move, select, and WRAP in the type group', async () => {
      const user = await open();
      await user.keyboard('{ArrowLeft}');
      // Backwards from the first option wraps to the last.
      expect(screen.getByTestId('feedback-type-praise')).toHaveFocus();
      expect(screen.getByTestId('feedback-type-praise')).toHaveAttribute('aria-checked', 'true');
      await user.keyboard('{ArrowRight}');
      expect(screen.getByTestId('feedback-type-broke')).toHaveFocus();
      await user.keyboard('{ArrowDown}');
      expect(screen.getByTestId('feedback-type-confused')).toHaveFocus();
      await user.keyboard('{ArrowUp}');
      expect(screen.getByTestId('feedback-type-broke')).toHaveFocus();
    });

    it('severity is ONE tab stop and its arrows move, select and wrap', async () => {
      const user = await open();
      await user.click(screen.getByTestId('feedback-type-broke'));
      expect(await screen.findByTestId('feedback-severity-minor')).toBeInTheDocument();
      expect(tabStops(severityIds)).toEqual(['feedback-severity-minor']);

      screen.getByTestId('feedback-severity-minor').focus();
      await user.keyboard('{ArrowLeft}');
      expect(screen.getByTestId('feedback-severity-blocked')).toHaveFocus();
      expect(screen.getByTestId('feedback-severity-blocked')).toHaveAttribute('aria-checked', 'true');
      expect(tabStops(severityIds)).toEqual(['feedback-severity-blocked']);

      await user.keyboard('{ArrowRight}');
      expect(screen.getByTestId('feedback-severity-minor')).toHaveFocus();
      await user.keyboard('{ArrowDown}');
      expect(screen.getByTestId('feedback-severity-slowed')).toHaveFocus();
    });

    it('Tab leaves the severity group too', async () => {
      const user = await open();
      await user.click(screen.getByTestId('feedback-type-broke'));
      screen.getByTestId('feedback-severity-minor').focus();
      await user.tab();
      for (const id of severityIds) expect(screen.getByTestId(id)).not.toHaveFocus();
    });
  });

  describe('#1416 focus follows the restored selection', () => {
    it('focuses the restored checked option, not the first one', async () => {
      // The checked option is the group's single tab stop. Focusing `broke` while `idea` was checked
      // put the focus ring on an option the user had not chosen, started arrow keys from the wrong
      // place, and announced an unchecked radio as the group's entry point — telling someone
      // returning to their own draft that they had picked something else.
      sessionStorage.setItem('feedback.draft', JSON.stringify({
        ownerId: 'u1', type: 'idea', body: 'A restored draft.', severity: null,
        savedAt: Date.now(), idempotencyKey: UUID,
      }));

      const user = await open('/session', 'u1');
      expect(screen.getByTestId('issue-report-description')).toHaveValue('A restored draft.');
      expect(screen.getByTestId('feedback-type-idea')).toHaveFocus();
      expect(screen.getByTestId('feedback-type-broke')).not.toHaveFocus();

      // One tab stop, and it is the restored option.
      const stops = ['feedback-type-broke', 'feedback-type-confused', 'feedback-type-idea', 'feedback-type-praise']
        .filter((id) => screen.getByTestId(id).getAttribute('tabindex') === '0');
      expect(stops).toEqual(['feedback-type-idea']);

      // Tab LEAVES from the restored option — checked before any arrow moves the selection, since
      // moving it legitimately moves the tab stop with it.
      await user.tab();
      for (const id of ['feedback-type-broke', 'feedback-type-confused', 'feedback-type-idea', 'feedback-type-praise']) {
        expect(screen.getByTestId(id)).not.toHaveFocus();
      }

      // Arrows originate at the restored option, not at the top of the group.
      screen.getByTestId('feedback-type-idea').focus();
      await user.keyboard('{ArrowRight}');
      expect(screen.getByTestId('feedback-type-praise')).toHaveFocus();
      expect(screen.getByTestId('feedback-type-praise')).toHaveAttribute('aria-checked', 'true');
    });
  });

  describe('#1416 the conditional severity reveal', () => {
    it('reveals downward only when the report is about something breaking', async () => {
      const user = await open();
      const reveal = screen.getByTestId('issue-report-severity-reveal');
      // Always mounted, so the transition has something to run on; collapsed to zero height with
      // nothing focusable inside.
      expect(reveal).toHaveAttribute('data-open', 'false');
      expect(screen.queryByTestId('issue-report-severity-group')).not.toBeInTheDocument();

      await user.click(screen.getByTestId('feedback-type-broke'));
      expect(reveal).toHaveAttribute('data-open', 'true');
      expect(screen.getByTestId('issue-report-severity-group')).toBeInTheDocument();

      await user.click(screen.getByTestId('feedback-type-idea'));
      expect(reveal).toHaveAttribute('data-open', 'false');
      expect(screen.queryByTestId('issue-report-severity-group')).not.toBeInTheDocument();
    });

    it('uses the approved 160ms duration', async () => {
      await open();
      expect(screen.getByTestId('issue-report-severity-reveal')).toHaveAttribute('data-reveal-ms', '160');
    });

    it('honours prefers-reduced-motion by removing the travel, not the row', async () => {
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query, onchange: null,
        addListener: vi.fn(), removeListener: vi.fn(),
        addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
      })) as unknown as typeof window.matchMedia;
      try {
        const user = await open();
        expect(screen.getByTestId('issue-report-severity-reveal')).toHaveAttribute('data-reveal-ms', '0');
        await user.click(screen.getByTestId('feedback-type-broke'));
        // The question still appears — reduced motion suppresses the animation, not the content.
        expect(screen.getByTestId('issue-report-severity-group')).toBeInTheDocument();
      } finally {
        window.matchMedia = originalMatchMedia;
      }
    });

    it('grows downward from a fixed top so the reveal cannot move Send under the pointer', async () => {
      await open();
      // A vertically centred dialog grows in BOTH directions: the type button the user just clicked
      // slides up out from under the pointer and a different one takes its place. Anchoring the top
      // means the new row only ever adds space below itself. jsdom computes no layout, so the
      // anchoring is asserted where it is decided rather than by measuring boxes.
      const content = screen.getByRole('dialog');
      expect(content.className).toContain('top-[6vh]');
      expect(content.className).toContain('translate-y-0');
      expect(content.className).not.toContain('top-[50%]');
    });

    it('keeps Send after the reveal in document order, so it never jumps above the new question', async () => {
      const user = await open();
      await user.click(screen.getByTestId('feedback-type-broke'));
      const reveal = screen.getByTestId('issue-report-severity-reveal');
      const send = screen.getByTestId('issue-report-submit');
      expect(reveal.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  describe('#1416 the derived title is Unicode-safe', () => {
    const submittedTitle = () => submit.mock.calls[0][0].title;

    it('does not split an emoji at the 80-character boundary', async () => {
      // 79 ASCII then an emoji: a UTF-16 slice(0, 80) keeps the HIGH surrogate and drops its partner.
      // A lone surrogate has no UTF-8 encoding, so the row is either mangled or rejected — after the
      // user was told it was sent.
      const body = `${'a'.repeat(79)}\u{1F600} and then more text that will not fit in the title.`;
      const user = await open('/session');
      await user.click(screen.getByTestId('feedback-type-idea'));
      await user.type(screen.getByTestId('issue-report-description'), body);
      await user.click(screen.getByTestId('issue-report-submit'));
      await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));

      const title = submittedTitle();
      // No unpaired surrogate anywhere.
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(title)).toBe(false);
      // Round-trips through UTF-8 unchanged, which is what actually crosses the wire.
      expect(new TextDecoder().decode(new TextEncoder().encode(title))).toBe(title);
      // Within what the column accepts, counted the way Postgres counts it.
      expect(Array.from(title).length).toBeLessThanOrEqual(80);
      expect(title.startsWith('a'.repeat(79))).toBe(true);
    });

    it('never derives an EMPTY title from an oversized leading grapheme', async () => {
      // A single cluster can be arbitrarily long. Keeping only whole clusters means a body that opens
      // with one produces an empty title, and `length(btrim(title)) BETWEEN 1 AND 80` rejects the
      // insert — the user is told it was sent and it never lands, triggered by the first character
      // they typed.
      const oversized = `A${'\u0301'.repeat(200)}`; // one grapheme, 201 code points
      const user = await open('/session');
      await user.click(screen.getByTestId('feedback-type-confused'));
      await user.type(screen.getByTestId('issue-report-description'), `${oversized} tail`);
      await user.click(screen.getByTestId('issue-report-submit'));
      await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));

      const title = submittedTitle();
      expect(title.trim().length).toBeGreaterThan(0);
      expect(Array.from(title).length).toBeLessThanOrEqual(80);
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(title)).toBe(false);
      expect(new TextDecoder().decode(new TextEncoder().encode(title))).toBe(title);
    });

    it('does not truncate mid-cluster when a WHOLE grapheme still fits', async () => {
      // The oversized path is a floor, not the rule: as long as something was kept, the boundary unit
      // is dropped rather than cut, so a combining mark is never separated from its base needlessly.
      const body = `${'b'.repeat(78)}A\u0301\u0302\u0303 and more.`;
      const user = await open('/session');
      await user.click(screen.getByTestId('feedback-type-confused'));
      await user.type(screen.getByTestId('issue-report-description'), body);
      await user.click(screen.getByTestId('issue-report-submit'));
      await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));

      const title = submittedTitle();
      expect(title).toBe('b'.repeat(78));
      expect(Array.from(title).length).toBeLessThanOrEqual(80);
    });

    it('keeps a whole emoji when it fits', async () => {
      const user = await open('/session');
      await user.click(screen.getByTestId('feedback-type-praise'));
      await user.type(screen.getByTestId('issue-report-description'), 'Loved this \u{1F600}');
      await user.click(screen.getByTestId('issue-report-submit'));
      await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
      expect(submittedTitle()).toContain('\u{1F600}');
    });
  });

  // G8 retheme (Designer, 18 Sep): the modal was built from a spec that still carried pre-theme colours,
  // and it inherited the slate page surface. jsdom computes no Tailwind, so each rule is asserted where it
  // is decided — the classes on the element.
  describe('G8 retheme — white surface, one selection colour, an honest disabled Send', () => {
    it('CASUALTY: the modal surface is white, never the inherited slate page ground', async () => {
      await open();
      const content = screen.getByRole('dialog');
      expect(content.className).toContain('bg-neutral-page');
      // tailwind-merge keeps the last bg-* — the primitive's `bg-background` must not survive.
      expect(content.className).not.toContain('bg-background');
    });

    it('CASUALTY: selected broke/confused/praise are signature yellow; idea is Focus Points purple; no teal', async () => {
      const user = await open();
      for (const kind of ['broke', 'confused', 'praise'] as const) {
        await user.click(screen.getByTestId(`feedback-type-${kind}`));
        const card = screen.getByTestId(`feedback-type-${kind}`);
        expect(card.className).toContain('border-signature');
        expect(card.className).toContain('bg-signature-ground');
        expect(card.className).not.toMatch(/border-status|state-success/);
      }
      await user.click(screen.getByTestId('feedback-type-idea'));
      expect(screen.getByTestId('feedback-type-idea').className).toContain('border-focus-points');
    });

    it('CASUALTY: disabled Send is its own neutral state, never the brand colour at reduced opacity', async () => {
      await open();
      const send = screen.getByTestId('issue-report-submit');
      expect(send).toBeDisabled();
      expect(send.className).toContain('disabled:bg-neutral-border');
      expect(send.className).toContain('disabled:text-neutral-muted');
      expect(send.className).not.toMatch(/opacity/);
      expect(send.className).toContain('text-ink');
    });
  });
});

/**
 * FEEDBACK_SESSION_SELECTOR_SPEC (Designer; #1541, pre-RWT) — acceptance checks S-1…S-16, as the dialog renders them.
 * Sessions come from `loginSessionLog` (this login only); the select's values are the opaque saved-session keys; the footer
 * names "Session N"; No session submits null. S-8 (server ownership) is proven against real Postgres in
 * tests/db/report-session-ownership.behavioral.test.js (migration 20260721130000, unchanged). S-10/S-11 are in
 * services/__tests__/loginSessionLog.test.ts.
 */
describe('Share feedback — which session is this about? (spec S-1…S-16)', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const C = '33333333-3333-4333-8333-333333333333';
  const LOGIN = 1_700_000_000_000;
  const t = (h: number, m: number) => new Date(2026, 8, 28, h, m).getTime();
  const time = (at: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
    .format(new Date(at)).replace(/\b(AM|PM)\b/, (x) => x.toLowerCase());
  const saveThree = () => {
    setCurrentLogin('u1', LOGIN);
    recordSavedSession('u1', LOGIN, { key: A, product: 'open_mic', savedAt: t(13, 52) });
    recordSavedSession('u1', LOGIN, { key: B, product: 'focus_points', savedAt: t(14, 18) });
    recordSavedSession('u1', LOGIN, { key: C, product: 'open_mic', savedAt: t(14, 41) });
  };
  const select = () => screen.getByTestId('feedback-session-select') as HTMLSelectElement;
  const optionTexts = () => Array.from(select().options).map((o) => o.textContent);
  const footer = () => screen.getByTestId('issue-report-page-context').textContent ?? '';
  const fill = async (user: Awaited<ReturnType<typeof open>>) => {
    await user.click(screen.getByTestId('feedback-type-idea'));
    await user.type(screen.getByTestId('issue-report-description'), 'A note.');
  };
  beforeEach(() => {
    submit.mockReset();
    submit.mockResolvedValue({ id: 'report-1' });
    sessionStorage.clear();
    clearLoginSessions();
    setCurrentLogin(null, null);
    emitted.length = 0;
  });

  it('S-1/S-2: three saves → newest first, a disabled separator, No session last; Current session (3) preselected', async () => {
    saveThree();
    await open();
    expect(optionTexts()).toEqual([
      `Current session (3) · Open Mic · ${time(t(14, 41))}`,
      `Session 2 · Focus Points · ${time(t(14, 18))}`,
      `Session 1 · Open Mic · ${time(t(13, 52))}`,
      '──────────',
      'No session',
    ]);
    expect(select().options[3].disabled).toBe(true);
    expect(select()).toHaveValue(C);
    expect(footer()).toContain('linked to Session 3');
  });

  it('S-3: no saves this login → No session preselected, helper shown and linked, select enabled', async () => {
    setCurrentLogin('u1', LOGIN);
    await open();
    expect(optionTexts()).toEqual(['No session']);
    expect(select()).toHaveValue('__none');
    expect(select()).toBeEnabled();
    expect(screen.getByText('Sessions you save after signing in will appear here.')).toHaveAttribute('id', 'feedback-session-help');
    expect(select()).toHaveAttribute('aria-describedby', 'feedback-session-help');
    expect(footer()).not.toContain('linked to');
  });

  it('S-4: no visible string contains a session id or any part of one', async () => {
    saveThree();
    const user = await open();
    await user.click(screen.getByRole('button', { name: "What's included" }));
    const visible = screen.getByRole('dialog').textContent ?? '';
    for (const id of [A, B, C]) for (const part of id.split('-')) expect(visible).not.toContain(part);
  });

  it('S-5: changing the selection updates the footer at once; No session removes the clause', async () => {
    saveThree();
    const user = await open();
    await user.selectOptions(select(), B);
    expect(footer()).toContain('linked to Session 2');
    await user.selectOptions(select(), '__none');
    expect(footer()).not.toContain('linked to');
  });

  it('S-6: Send is enabled identically for every selection', async () => {
    saveThree();
    const user = await open();
    await fill(user);
    for (const value of [C, B, A, '__none']) {
      await user.selectOptions(select(), value);
      expect(screen.getByTestId('issue-report-submit')).toBeEnabled();
    }
  });

  it('S-7: the payload carries the selected key', async () => {
    saveThree();
    const user = await open();
    await fill(user);
    await user.selectOptions(select(), A);
    await user.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0].sessionId).toBe(A);
  });

  it('S-7: an explicit No session submits null', async () => {
    saveThree();
    const user = await open();
    await fill(user);
    await user.selectOptions(select(), '__none');
    await user.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0].sessionId).toBeNull();
  });

  it('S-9: sign out, then sign in → the list is cleared and numbering restarts at 1', async () => {
    saveThree();
    clearLoginSessions();                                // AuthProvider on sign-out / account change
    setCurrentLogin('u1', LOGIN + 60_000);               // the next sign-in
    recordSavedSession('u1', LOGIN + 60_000, { key: A, product: 'focus_points', savedAt: t(15, 0) });
    await open();
    expect(optionTexts()).toEqual([`Current session (1) · Focus Points · ${time(t(15, 0))}`, '──────────', 'No session']);
    expect(sessionStorage.getItem(LOGIN_SESSION_LOG_KEY)).toContain('"n":1');
  });

  it('S-12: open then close without touching anything → no draft is written', async () => {
    saveThree();
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(sessionStorage.getItem(FEEDBACK_DRAFT_KEY)).toBeNull();
  });

  it('S-13: changing the session after a failed send uses a new idempotency key', async () => {
    saveThree();
    submit.mockRejectedValueOnce(new Error('network'));
    const user = await open();
    await fill(user);
    await user.click(screen.getByTestId('issue-report-submit'));
    await screen.findByRole('alert');
    const firstKey = submit.mock.calls[0][0].idempotencyKey;
    await user.selectOptions(select(), B);
    await user.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1][0].idempotencyKey).not.toBe(firstKey);
    expect(submit.mock.calls[1][0].sessionId).toBe(B);
  });

  it('S-14: opened on /analytics/<id> of a session in this login → that entry is preselected', async () => {
    saveThree();
    await open(`/analytics/${B}`);
    expect(select()).toHaveValue(B);
    expect(footer()).toContain('linked to Session 2');
  });

  it('§4.1: opened on /analytics/<id> of a session NOT in this login → newest preselected; the viewed id is never sent', async () => {
    saveThree();
    const user = await open(`/analytics/${UUID}`);
    expect(select()).toHaveValue(C);
    await fill(user);
    await user.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0].sessionId).toBe(C);
  });

  it('S-15: keyboard only — reach, change and submit; the accessible name includes "Optional"', async () => {
    saveThree();
    const user = await open();
    expect(screen.getByRole('combobox', { name: 'Which session is this about? Optional' })).toBe(select());
    await user.click(screen.getByTestId('feedback-type-idea'));
    await user.type(screen.getByTestId('issue-report-description'), 'Keyboard only.');
    // Spec §10 Tab order: … textarea → (severity, for "broke" only) → session select → What's included → Cancel → Send.
    await user.tab();
    expect(select()).toHaveFocus();
    // jsdom does not implement a native select's arrow keys; the browser does (spec §13 rehearsal check). Change it as the
    // native picker would, then continue by keyboard alone.
    await user.selectOptions(select(), B);
    await user.tab();
    expect(screen.getByRole('button', { name: "What's included" })).toHaveFocus();
    screen.getByTestId('issue-report-submit').focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0].sessionId).toBe(B);
  });

  it('S-16: telemetry carries field "session" transitions and hasSession — never an id, number or label', async () => {
    saveThree();
    const user = await open();
    await fill(user);
    await user.selectOptions(select(), '__none');
    await user.selectOptions(select(), A);
    await user.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const fields = emitted.filter((e) => e.event === 'feedback_field' && e.props.field === 'session').map((e) => e.props.transition);
    expect(fields).toEqual(['cleared', 'entered']);
    const ok = emitted.filter((e) => e.event === 'feedback_submit' && e.props.outcome === 'storage_ok');
    expect(ok[ok.length - 1]?.props.has_session).toBe(true);
    const all = JSON.stringify(emitted);
    for (const leak of [A, B, C, 'Current session', 'Session 1', 'Session 2']) expect(all).not.toContain(leak);
  });

  it('while sending, the select is disabled along with Send', async () => {
    saveThree();
    let release: (() => void) | null = null;
    submit.mockImplementationOnce(() => new Promise((resolveSubmit) => { release = () => resolveSubmit({ id: 'report-1' }); }));
    const user = await open();
    await fill(user);
    await user.click(screen.getByTestId('issue-report-submit'));
    expect(select()).toBeDisabled();
    (release as (() => void) | null)?.();
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  });
});

describe('#1258 Share Feedback outcome names its cause and links to its attempt', () => {
  beforeEach(() => {
    submit.mockReset();
    emitted.length = 0;
    sessionStorage.clear();
    clearLoginSessions();
    setCurrentLogin(null, null);
  });

  const send = async () => {
    const user = await open('/analytics/x');
    await user.click(screen.getByTestId('feedback-type-praise'));
    await user.type(screen.getByTestId('issue-report-description'), 'RWT automated journey check.');
    await user.click(screen.getByTestId('issue-report-submit'));
    return user;
  };
  const submits = () => emitted.filter((e) => e.event === 'feedback_submit').map((e) => e.props);

  it('a database refusal (SQLSTATE 42501) → storage_failed, error_category rls_denied, same submit_seq as its attempt', async () => {
    submit.mockRejectedValue({ code: '42501', message: 'new row violates row-level security policy' });
    await send();
    await screen.findByText('That didn’t go through. Try again?');
    const [attempted, failed] = submits();
    expect(attempted).toMatchObject({ outcome: 'attempted', submit_seq: 1 });
    expect(failed).toMatchObject({ outcome: 'storage_failed', error_category: 'rls_denied', submit_seq: 1, acknowledgement_visible: true });
    expect(typeof failed.elapsed_ms).toBe('number');
    expect(JSON.stringify(failed)).not.toMatch(/row-level|policy/);
  });

  it('a retry is the next submit_seq; success carries elapsed and no error category', async () => {
    submit.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ id: 'report-1' });
    const user = await send();
    await screen.findByText('That didn’t go through. Try again?');
    await user.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(submits().some((p) => p.outcome === 'storage_ok')).toBe(true));
    expect(submits().map((p) => [p.outcome, p.submit_seq, p.error_category])).toEqual([
      ['attempted', 1, undefined], ['storage_failed', 1, 'network'], ['attempted', 2, undefined], ['storage_ok', 2, undefined],
    ]);
  });
});
