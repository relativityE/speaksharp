import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { ProgressRehearsalSandbox } from '../ProgressRehearsalSandbox';

// The sandbox is provider-free, so it renders with a plain RTL render (no app wrappers).
// The product journey lives in <main>; the collapsed QA panel sits OUTSIDE <main>, so "no numbers on
// the primary screen" assertions are scoped to <main>.
describe('ProgressRehearsalSandbox — journey', () => {
  beforeEach(() => {
    (window as unknown as { __SS_SANDBOX_TRACE__?: unknown[] }).__SS_SANDBOX_TRACE__ = [];
  });

  const main = () => screen.getByRole('main');
  const beginSpeaking = () => {
    fireEvent.click(screen.getByRole('button', { name: /start rehearsal/i }));
    fireEvent.click(screen.getByRole('button', { name: /begin speaking/i }));
  };

  it('opens on the Prepare screen with one obvious primary action and no numbers', () => {
    render(<ProgressRehearsalSandbox />);
    expect(within(main()).getByRole('heading', { name: /what are you rehearsing\?/i })).toBeInTheDocument();
    expect(within(main()).getByRole('button', { name: /start rehearsal/i })).toBeInTheDocument();
    expect(within(main()).queryAllByText(/%/)).toHaveLength(0);
  });

  it('Rehearse opens in a Ready state before listening', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(screen.getByRole('button', { name: /start rehearsal/i }));
    expect(within(main()).getByText(/ready when you are/i)).toBeInTheDocument();
    expect(within(main()).getByRole('button', { name: /begin speaking/i })).toBeInTheDocument();
  });

  it('Begin speaking → passive cockpit with an agenda, no scores/percentages while speaking', () => {
    render(<ProgressRehearsalSandbox />);
    beginSpeaking();
    expect(within(main()).getByText(/speak naturally/i)).toBeInTheDocument();
    expect(within(main()).getByRole('list', { name: /agenda/i })).toBeInTheDocument();
    expect(within(main()).queryAllByText(/%/)).toHaveLength(0);
    expect(within(main()).queryAllByText(/WPM/)).toHaveLength(0);
  });

  it('supports Pause and Resume', () => {
    render(<ProgressRehearsalSandbox />);
    beginSpeaking();
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(within(main()).getAllByText(/paused/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /resume/i }));
    expect(within(main()).getByText(/speak naturally/i)).toBeInTheDocument();
  });

  it('request-help → remedy → recovery → processing → recovered summary', () => {
    vi.useFakeTimers();
    try {
      render(<ProgressRehearsalSandbox />);
      beginSpeaking();

      // The approval request is the scripted recovery point — target its item specifically.
      const approvalItem = screen.getByText(/request approval for two additional/i).closest('li') as HTMLElement;
      fireEvent.click(within(approvalItem).getByRole('button', { name: /help me with this point/i }));
      expect(screen.getByText(/one suggestion/i)).toBeInTheDocument(); // one concise remedy, not a list
      fireEvent.click(screen.getByRole('button', { name: /i addressed it just now/i }));

      fireEvent.click(screen.getByRole('button', { name: /finish rehearsal/i }));
      // Processing (Finalizing…) then auto-advances to the summary.
      expect(screen.getByText(/finalizing your rehearsal/i)).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(1800); });

      expect(screen.getByRole('heading', { name: /recovered the approval request after asking for help/i })).toBeInTheDocument();
      const outcome = screen.getByRole('list', { name: /agenda outcome/i });
      expect(within(outcome).getByText(/recovered after guidance/i)).toBeInTheDocument();
      expect(screen.getByText(/next run/i)).toBeInTheDocument();
      expect(screen.getByText(/how speaksharp determined this/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('general practice leads with raw movement; percentage stays behind details', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(screen.getByRole('button', { name: /skip agenda — general practice/i }));
    expect(within(main()).getByText(/you improved on your last comparable session/i)).toBeInTheDocument();
    expect(within(main()).getByText(/fewer filler words per minute than your baseline/i)).toBeInTheDocument();
    const details = within(main()).getByText(/how speaksharp determined this/i).closest('details');
    expect(details).toBeTruthy();
    within(main()).queryAllByText(/\d+%/).forEach((el) => expect(details!.contains(el)).toBe(true));
  });

  it('general practice can show the first-session baseline state (not a grade)', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(screen.getByRole('button', { name: /skip agenda — general practice/i }));
    fireEvent.click(screen.getByRole('button', { name: /first-session \(baseline\) example/i }));
    expect(within(main()).getByText(/personal baseline set/i)).toBeInTheDocument();
    expect(within(main()).getByText(/not a grade/i)).toBeInTheDocument();
  });

  it('the QA fixture switcher is a separate, collapsed Review-all-states panel (not the product frame)', () => {
    render(<ProgressRehearsalSandbox />);
    expect(within(main()).getByRole('heading', { name: /what are you rehearsing\?/i })).toBeInTheDocument();
    expect(screen.getByText(/review all states \(qa\)/i)).toBeInTheDocument();
    expect(within(main()).queryByText(/review all states/i)).not.toBeInTheDocument();
  });
});
