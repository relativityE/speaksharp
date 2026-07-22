import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { ProgressRehearsalSandbox } from '../ProgressRehearsalSandbox';
import { SESSION_ROUTE } from '../journey/HandoffScreen';

describe('ProgressRehearsalSandbox — three-level journey (landing → overview → working)', () => {
  beforeEach(() => {
    (window as unknown as { __SS_SANDBOX_TRACE__?: unknown[] }).__SS_SANDBOX_TRACE__ = [];
  });
  afterEach(() => {
    // tests/setup.ts replaces window.location with a writable plain object — set search directly.
    (window.location as unknown as { search: string }).search = '';
  });
  const setQuery = (q: string) => { (window.location as unknown as { search: string }).search = q; };

  const main = () => screen.getByRole('main');
  const btn = (name: RegExp) => within(main()).getByRole('button', { name });
  // Navigate landing → mode overview (the whole entry card is a button).
  const openQuick = () => fireEvent.click(btn(/quick practice/i));
  const openGuided = () => fireEvent.click(btn(/guided rehearsal/i));
  // Guided overview → the sample rehearsal journey.
  const gotoRehearse = () => { openGuided(); fireEvent.click(btn(/try a sample/i)); fireEvent.click(screen.getByRole('button', { name: /begin speaking/i })); };

  it('overall landing (level 1): brand tagline is the umbrella promise, plus the decision prompt + two modes', () => {
    render(<ProgressRehearsalSandbox />);
    expect(within(main()).getByRole('heading', { name: /private practice\. public impact/i })).toBeInTheDocument();
    expect(within(main()).getByText(/you decide when your work is ready to be shared/i)).toBeInTheDocument();
    expect(within(main()).getByText(/do you want to speak freely, or practice toward specific outcomes/i)).toBeInTheDocument();
    expect(within(main()).getByRole('heading', { name: /^Quick Practice$/i })).toBeInTheDocument();
    expect(within(main()).getByRole('heading', { name: /^Guided Rehearsal$/i })).toBeInTheDocument();
    // "Executive Rehearsal" is not the umbrella label; no scores/percentages/STT jargon on the landing.
    expect(within(main()).queryByText(/executive rehearsal/i)).not.toBeInTheDocument();
    expect(within(main()).queryAllByText(/%/)).toHaveLength(0);
    expect(within(main()).queryByText(/\bSTT\b/)).not.toBeInTheDocument();
  });

  it('the two modes are distinguishable on the landing without opening anything', () => {
    render(<ProgressRehearsalSandbox />);
    expect(within(main()).getByText(/no agenda required/i)).toBeInTheDocument();
    expect(within(main()).getByText(/agenda and outcome guided/i)).toBeInTheDocument();
  });

  it('Quick Practice card opens its overview (level 2): specialized hero + numbered journey + disclosure', () => {
    render(<ProgressRehearsalSandbox />);
    openQuick();
    expect(within(main()).getByRole('heading', { name: /speak freely\. see how you.re progressing/i })).toBeInTheDocument();
    expect(within(main()).getAllByRole('button', { name: /start speaking/i }).length).toBeGreaterThan(0);
    expect(within(main()).getByText(/choose your transcription mode/i)).toBeInTheDocument(); // journey step 1
    // Truthful data-processing disclosure — the tagline does not imply on-device for every mode.
    expect(within(main()).getByText(/on your device or via a secure cloud service/i)).toBeInTheDocument();
  });

  it('Guided Rehearsal card opens its overview with its own hero, 7-step journey, and correction loop', () => {
    render(<ProgressRehearsalSandbox />);
    openGuided();
    expect(within(main()).getByRole('heading', { name: /prepare what matters\. rehearse until it lands/i })).toBeInTheDocument();
    expect(within(main()).getAllByRole('button', { name: /set up a rehearsal/i }).length).toBeGreaterThan(0);
    expect(within(main()).getByText(/describe the occasion and audience/i)).toBeInTheDocument(); // step 1
    expect(within(main()).getByText(/rehearse again and prove improvement/i)).toBeInTheDocument(); // step 7
    expect(within(main()).getByText(/the correction loop/i)).toBeInTheDocument();
  });

  it('overview journey discloses one step at a time (mutually exclusive, keyboard-operable buttons)', () => {
    render(<ProgressRehearsalSandbox />);
    openGuided();
    const s1 = btn(/describe the occasion and audience/i);
    const s2 = btn(/add the points or outcomes you must cover/i);
    fireEvent.click(s1);
    expect(s1).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(s2);
    expect(s2).toHaveAttribute('aria-expanded', 'true');
    expect(s1).toHaveAttribute('aria-expanded', 'false');
  });

  it('"Start speaking" (Quick overview) hands off to the existing /session route (represented, not navigated)', () => {
    render(<ProgressRehearsalSandbox />);
    openQuick();
    fireEvent.click(within(main()).getAllByRole('button', { name: /start speaking/i })[0]);
    expect(within(main()).getByRole('heading', { name: /opening your speaksharp session/i })).toBeInTheDocument();
    expect(within(main()).getByText(new RegExp(SESSION_ROUTE))).toBeInTheDocument();
    expect(SESSION_ROUTE).toBe('/session');
    expect(within(main()).getByText(/does not open the production app/i)).toBeInTheDocument();
  });

  it('View past progress is a subordinate link, NOT a third choice', () => {
    render(<ProgressRehearsalSandbox />);
    expect(within(main()).queryByRole('heading', { name: /review my progress/i })).not.toBeInTheDocument();
    expect(btn(/view past progress/i)).toBeInTheDocument();
  });

  it('the default product frame has NO QA controls or sidebar', () => {
    render(<ProgressRehearsalSandbox />);
    expect(screen.queryByText(/review all states/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/design tokens & palette/i)).not.toBeInTheDocument();
    expect(document.querySelector('aside')).toBeNull();
  });

  it('"Try a sample" (Guided overview) launches the passive rehearsal cockpit', () => {
    render(<ProgressRehearsalSandbox />);
    openGuided();
    fireEvent.click(btn(/try a sample/i));
    expect(within(main()).getByText(/ready when you are/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /begin speaking/i }));
    expect(within(main()).getByText(/speak naturally/i)).toBeInTheDocument();
    expect(within(main()).getByRole('list', { name: /agenda/i })).toBeInTheDocument();
    expect(within(main()).queryAllByText(/%/)).toHaveLength(0);
  });

  it('supports Pause and Resume', () => {
    render(<ProgressRehearsalSandbox />);
    gotoRehearse();
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(within(main()).getAllByText(/paused/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /resume/i }));
    expect(within(main()).getByText(/speak naturally/i)).toBeInTheDocument();
  });

  it('help → remedy → recovery → processing → recovered summary → returning user gets a direct Start now', () => {
    vi.useFakeTimers();
    try {
      render(<ProgressRehearsalSandbox />);
      gotoRehearse();

      const approvalItem = screen.getByText(/request approval for two additional/i).closest('li') as HTMLElement;
      fireEvent.click(within(approvalItem).getByRole('button', { name: /help me with this point/i }));
      expect(screen.getByText(/one suggestion/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /i addressed it just now/i }));

      fireEvent.click(screen.getByRole('button', { name: /finish rehearsal/i }));
      expect(screen.getByText(/finalizing your rehearsal/i)).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(1800); });

      expect(screen.getByRole('heading', { name: /recovered the approval request after asking for help/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /rehearse again/i }));
      expect(within(main()).getByRole('heading', { name: /private practice\. public impact/i })).toBeInTheDocument();
      expect(within(main()).getByText(/welcome back/i)).toBeInTheDocument();
      expect(btn(/start now/i)).toBeInTheDocument(); // returning users skip the walkthrough
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Theme A ("Vibrant Confidence") is the selected sandbox direction, applied app-wide ───────────
  it('applies the selected Theme A on the app root by default (themes the whole journey)', () => {
    render(<ProgressRehearsalSandbox />);
    expect(document.querySelector('[data-ss-theme="a"]')).toBeInTheDocument();
    expect(within(main()).getByRole('heading', { name: /^Quick Practice$/i })).toBeInTheDocument();
    expect(within(main()).getByRole('heading', { name: /^Guided Rehearsal$/i })).toBeInTheDocument();
  });

  it('?theme=b and ?theme=c still render the retained candidate themes (compare-board evidence)', () => {
    setQuery('?theme=b');
    const { unmount } = render(<ProgressRehearsalSandbox />);
    expect(document.querySelector('[data-ss-theme="b"]')).toBeInTheDocument();
    expect(within(main()).getByRole('button', { name: /quick practice/i })).toBeInTheDocument();
    unmount();
    setQuery('?theme=c');
    render(<ProgressRehearsalSandbox />);
    expect(document.querySelector('[data-ss-theme="c"]')).toBeInTheDocument();
  });

  it('?compare=1 retains all three themes as decision evidence (Theme A selected)', () => {
    setQuery('?compare=1');
    render(<ProgressRehearsalSandbox />);
    expect(within(main()).getByTitle(/Theme A/i)).toBeInTheDocument();
    expect(within(main()).getByTitle(/Theme B/i)).toBeInTheDocument();
    expect(within(main()).getByTitle(/Theme C/i)).toBeInTheDocument();
    expect(screen.getByText(/theme a — vibrant confidence was selected/i)).toBeInTheDocument();
  });

  it('"View past progress" shows raw movement; percentage stays behind details', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(btn(/view past progress/i));
    expect(within(main()).getByText(/you improved on your last comparable session/i)).toBeInTheDocument();
    expect(within(main()).getByText(/fewer filler words per minute than your baseline/i)).toBeInTheDocument();
    const details = within(main()).getByText(/how speaksharp determined this/i).closest('details');
    expect(details).toBeTruthy();
    within(main()).queryAllByText(/\d+%/).forEach((el) => expect(details!.contains(el)).toBe(true));
  });
});
