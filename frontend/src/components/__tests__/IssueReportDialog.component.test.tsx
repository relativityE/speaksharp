import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '../../../tests/support/test-utils';
import userEvent from '@testing-library/user-event';
import { IssueReportDialog } from '../IssueReportDialog';
import { issueReportService } from '@/services/issueReportService';
import { toast } from '@/lib/toast';

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
  });

  it('renders only the accepted questions and removes the old ticket-filing form', async () => {
    await open();
    expect(screen.getByText('What would you like to share?')).toBeInTheDocument();
    expect(screen.getAllByRole('radio', { name: /Something broke|Something confused me|I have an idea|This worked well/ })).toHaveLength(4);
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
  ])('derives the report link from the route without leaking a concrete session id: %s', async (route, sessionId, pageUrl) => {
    const user = await open(route);
    await user.click(screen.getByTestId('feedback-type-idea'));
    await user.type(screen.getByTestId('issue-report-description'), 'Add a clearer next step.');
    await user.click(screen.getByTestId('issue-report-submit'));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const value = submit.mock.calls[0][0];
    expect(value.sessionId).toBe(sessionId);
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
    // #1416 item 4 — "no automatic transcript or audio" read as a promise that nothing the user
    // contributes is sent. The collapsed line now scopes the claim to what is not attached
    // AUTOMATICALLY.
    expect(provenance).toHaveTextContent(
      'Sent from Session · Speaking · transcript and audio aren’t attached automatically.',
    );
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

    it('keeps a whole emoji when it fits', async () => {
      const user = await open('/session');
      await user.click(screen.getByTestId('feedback-type-praise'));
      await user.type(screen.getByTestId('issue-report-description'), 'Loved this \u{1F600}');
      await user.click(screen.getByTestId('issue-report-submit'));
      await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
      expect(submittedTitle()).toContain('\u{1F600}');
    });
  });
});
