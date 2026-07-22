import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { ProgressRehearsalSandbox } from '../ProgressRehearsalSandbox';
import { SESSION_ROUTE } from '../journey/HandoffScreen';

describe('ProgressRehearsalSandbox — two-column chooser (SpeakSharp Session | Executive Rehearsal)', () => {
  beforeEach(() => {
    (window as unknown as { __SS_SANDBOX_TRACE__?: unknown[] }).__SS_SANDBOX_TRACE__ = [];
  });
  afterEach(() => {
    // Reset any ?theme= / ?compare= query used by a test so it cannot leak into the next one.
    // (tests/setup.ts replaces window.location with a writable plain object, so set search directly.)
    (window.location as unknown as { search: string }).search = '';
  });
  const setQuery = (q: string) => { (window.location as unknown as { search: string }).search = q; };

  const main = () => screen.getByRole('main');
  const btn = (name: RegExp) => within(main()).getByRole('button', { name });

  it('truthful identity: "Choose how you want to practice" with exactly two choices', () => {
    render(<ProgressRehearsalSandbox />);
    expect(within(main()).getByRole('heading', { name: /choose how you want to practice/i })).toBeInTheDocument();
    expect(within(main()).getByRole('heading', { name: /^SpeakSharp Session$/i })).toBeInTheDocument();
    expect(within(main()).getByRole('heading', { name: /^Executive Rehearsal$/i })).toBeInTheDocument();
    // No "Quick Practice" primary mode anywhere.
    expect(within(main()).queryByText(/quick practice/i)).not.toBeInTheDocument();
    expect(within(main()).queryAllByText(/%/)).toHaveLength(0);
    // "STT" is never shown to users.
    expect(within(main()).queryByText(/\bSTT\b/)).not.toBeInTheDocument();
  });

  it('first column is SpeakSharp Session (a doorway to the existing session), second is Executive Rehearsal', () => {
    render(<ProgressRehearsalSandbox />);
    expect(btn(/start a session/i)).toBeInTheDocument(); // column 1 primary
    expect(btn(/try a sample/i)).toBeInTheDocument(); // column 2 primary
    expect(btn(/create rehearsal/i)).toBeInTheDocument(); // column 2 secondary
  });

  it('"Start a session" hands off to the existing /session route (represented, not navigated)', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(btn(/start a session/i));
    expect(within(main()).getByRole('heading', { name: /opening your speaksharp session/i })).toBeInTheDocument();
    expect(within(main()).getByText(new RegExp(SESSION_ROUTE))).toBeInTheDocument();
    expect(SESSION_ROUTE).toBe('/session');
    // The sandbox represents the handoff and does not open production.
    expect(within(main()).getByText(/does not open the production app/i)).toBeInTheDocument();
  });

  it('Review My Progress is a subordinate link, NOT a third choice', () => {
    render(<ProgressRehearsalSandbox />);
    expect(within(main()).queryByRole('heading', { name: /review my progress/i })).not.toBeInTheDocument();
    expect(btn(/view past progress/i)).toBeInTheDocument();
  });

  it('numbered rows are mutually exclusive within and ACROSS the two columns', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(btn(/^prepare$/i)); // Executive Rehearsal row
    expect(btn(/^prepare$/i)).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/define the presentation or conversation/i)).toBeInTheDocument();
    fireEvent.click(btn(/^choose your session mode$/i)); // SpeakSharp Session row
    expect(btn(/^choose your session mode$/i)).toHaveAttribute('aria-expanded', 'true');
    expect(btn(/^prepare$/i)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/define the presentation or conversation/i)).not.toBeInTheDocument();
  });

  it('completed rows collapse to a checkmark rollup and reopen with state preserved', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(btn(/^review and recover$/i)); // opens exec row 3 → rows 1,2 become rollups
    expect(screen.getByText(/3 agenda points prepared/i)).toBeInTheDocument();
    fireEvent.click(btn(/^prepare$/i));
    expect(screen.getByText(/define the presentation or conversation/i)).toBeInTheDocument();
  });

  it('the default product frame has NO QA controls or sidebar', () => {
    render(<ProgressRehearsalSandbox />);
    expect(screen.queryByText(/review all states/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/design tokens & palette/i)).not.toBeInTheDocument();
    expect(document.querySelector('aside')).toBeNull();
  });

  it('"Try a sample" launches the Executive Rehearsal journey (Ready → passive cockpit)', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(btn(/try a sample/i));
    expect(within(main()).getByText(/ready when you are/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /begin speaking/i }));
    expect(within(main()).getByText(/speak naturally/i)).toBeInTheDocument();
    expect(within(main()).getByRole('list', { name: /agenda/i })).toBeInTheDocument();
    expect(within(main()).queryAllByText(/%/)).toHaveLength(0);
  });

  it('supports Pause and Resume', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(btn(/try a sample/i));
    fireEvent.click(screen.getByRole('button', { name: /begin speaking/i }));
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(within(main()).getAllByText(/paused/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /resume/i }));
    expect(within(main()).getByText(/speak naturally/i)).toBeInTheDocument();
  });

  it('help → remedy → recovery → processing → recovered summary → returning-user keeps BOTH choices', () => {
    vi.useFakeTimers();
    try {
      render(<ProgressRehearsalSandbox />);
      fireEvent.click(btn(/try a sample/i));
      fireEvent.click(screen.getByRole('button', { name: /begin speaking/i }));

      const approvalItem = screen.getByText(/request approval for two additional/i).closest('li') as HTMLElement;
      fireEvent.click(within(approvalItem).getByRole('button', { name: /help me with this point/i }));
      expect(screen.getByText(/one suggestion/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /i addressed it just now/i }));

      fireEvent.click(screen.getByRole('button', { name: /finish rehearsal/i }));
      expect(screen.getByText(/finalizing your rehearsal/i)).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(1800); });

      expect(screen.getByRole('heading', { name: /recovered the approval request after asking for help/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /rehearse again/i }));
      expect(within(main()).getByRole('heading', { name: /SpeakSharp Session/i })).toBeInTheDocument();
      expect(within(main()).getByRole('heading', { name: /Executive Rehearsal/i })).toBeInTheDocument();
      expect(within(main()).getByText(/welcome back/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Theme A ("Vibrant Confidence") is the selected sandbox direction, applied app-wide ───────────
  it('applies the selected Theme A on the app root by default (themes the whole journey)', () => {
    render(<ProgressRehearsalSandbox />);
    expect(document.querySelector('[data-ss-theme="a"]')).toBeInTheDocument();
    // The frozen two-column IA is identical regardless of theme.
    expect(within(main()).getByRole('heading', { name: /^SpeakSharp Session$/i })).toBeInTheDocument();
    expect(within(main()).getByRole('heading', { name: /^Executive Rehearsal$/i })).toBeInTheDocument();
  });

  it('?theme=b and ?theme=c still render the retained candidate themes (compare-board evidence)', () => {
    setQuery('?theme=b');
    const { unmount } = render(<ProgressRehearsalSandbox />);
    expect(document.querySelector('[data-ss-theme="b"]')).toBeInTheDocument();
    expect(within(main()).getByRole('button', { name: /start a session/i })).toBeInTheDocument();
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
