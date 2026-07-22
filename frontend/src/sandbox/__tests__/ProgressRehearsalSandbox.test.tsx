import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { ProgressRehearsalSandbox } from '../ProgressRehearsalSandbox';

describe('ProgressRehearsalSandbox — two-column practice chooser + journey', () => {
  beforeEach(() => {
    (window as unknown as { __SS_SANDBOX_TRACE__?: unknown[] }).__SS_SANDBOX_TRACE__ = [];
  });

  const main = () => screen.getByRole('main');
  const btn = (name: RegExp) => within(main()).getByRole('button', { name });

  it('truthful identity: "How would you like to practice?" with exactly two practice choices', () => {
    render(<ProgressRehearsalSandbox />);
    expect(within(main()).getByRole('heading', { name: /how would you like to practice\?/i })).toBeInTheDocument();
    expect(within(main()).getByText(/^SpeakSharp Practice$/)).toBeInTheDocument();
    expect(within(main()).getByRole('heading', { name: /^Quick Practice$/i })).toBeInTheDocument();
    expect(within(main()).getByRole('heading', { name: /^Executive Rehearsal$/i })).toBeInTheDocument();
    // No number/% on the chooser.
    expect(within(main()).queryAllByText(/%/)).toHaveLength(0);
  });

  it('Review My Progress is a subordinate link, NOT a third practice choice', () => {
    render(<ProgressRehearsalSandbox />);
    // No "Review My Progress" heading/card.
    expect(within(main()).queryByRole('heading', { name: /review my progress/i })).not.toBeInTheDocument();
    // A subordinate "View past progress" link exists.
    expect(btn(/view past progress/i)).toBeInTheDocument();
    // The two primary actions are the practice starters, not a third mode.
    expect(btn(/start quick practice/i)).toBeInTheDocument();
    expect(btn(/try a sample/i)).toBeInTheDocument();
  });

  it('numbered rows are mutually exclusive WITHIN a column', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(btn(/^prepare$/i));
    expect(screen.getByText(/define the presentation or conversation/i)).toBeInTheDocument();
    fireEvent.click(btn(/^rehearse naturally$/i));
    expect(screen.getByText(/speak while your agenda is tracked passively/i)).toBeInTheDocument();
    expect(screen.queryByText(/define the presentation or conversation/i)).not.toBeInTheDocument();
  });

  it('only one row is open ACROSS both columns (selecting the other column collapses the first)', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(btn(/^prepare$/i));
    expect(btn(/^prepare$/i)).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(btn(/^start speaking$/i)); // a row in Quick Practice
    expect(btn(/^start speaking$/i)).toHaveAttribute('aria-expanded', 'true');
    expect(btn(/^prepare$/i)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/define the presentation or conversation/i)).not.toBeInTheDocument();
  });

  it('completed rows collapse to a checkmark rollup and reopen with state preserved', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(btn(/^rehearse naturally$/i)); // opens row 2, so row 1 (Prepare) is "done"
    expect(screen.getByText(/3 agenda points prepared/i)).toBeInTheDocument(); // rollup
    fireEvent.click(btn(/^prepare$/i)); // reopen row 1
    expect(screen.getByText(/define the presentation or conversation/i)).toBeInTheDocument();
  });

  it('the default product frame has NO QA controls or sidebar', () => {
    render(<ProgressRehearsalSandbox />);
    expect(screen.queryByText(/review all states/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/design tokens & palette/i)).not.toBeInTheDocument();
    expect(document.querySelector('aside')).toBeNull();
  });

  it('“Try a sample” launches the sample journey (Ready → passive cockpit, no numbers while speaking)', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(btn(/try a sample/i));
    expect(within(main()).getByText(/ready when you are/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /begin speaking/i }));
    expect(within(main()).getByText(/speak naturally/i)).toBeInTheDocument();
    expect(within(main()).getByRole('list', { name: /agenda/i })).toBeInTheDocument();
    expect(within(main()).queryAllByText(/%/)).toHaveLength(0);
    expect(within(main()).queryAllByText(/WPM/)).toHaveLength(0);
  });

  it('Quick Practice is a distinct, agenda-free flow', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(btn(/start quick practice/i));
    fireEvent.click(screen.getByRole('button', { name: /begin speaking/i }));
    expect(within(main()).getByText(/speak freely — no agenda to track/i)).toBeInTheDocument();
    expect(within(main()).queryByRole('list', { name: /agenda/i })).not.toBeInTheDocument();
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
      const outcome = screen.getByRole('list', { name: /agenda outcome/i });
      expect(within(outcome).getByText(/recovered after guidance/i)).toBeInTheDocument();

      // Rehearse again → returning-user landing keeps the same TWO choices (exec is "Last used").
      fireEvent.click(screen.getByRole('button', { name: /rehearse again/i }));
      expect(within(main()).getByRole('heading', { name: /Quick Practice/i })).toBeInTheDocument();
      expect(within(main()).getByRole('heading', { name: /Executive Rehearsal/i })).toBeInTheDocument();
      expect(within(main()).getByText(/welcome back/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('“View past progress” shows raw movement; percentage stays behind details', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(btn(/view past progress/i));
    expect(within(main()).getByText(/you improved on your last comparable session/i)).toBeInTheDocument();
    expect(within(main()).getByText(/fewer filler words per minute than your baseline/i)).toBeInTheDocument();
    const details = within(main()).getByText(/how speaksharp determined this/i).closest('details');
    expect(details).toBeTruthy();
    within(main()).queryAllByText(/\d+%/).forEach((el) => expect(details!.contains(el)).toBe(true));
  });
});
