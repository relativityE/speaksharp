import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { ProgressRehearsalSandbox } from '../ProgressRehearsalSandbox';

// The sandbox is provider-free, so it renders with a plain RTL render (no app wrappers).
describe('ProgressRehearsalSandbox — first-use launcher + journey', () => {
  beforeEach(() => {
    (window as unknown as { __SS_SANDBOX_TRACE__?: unknown[] }).__SS_SANDBOX_TRACE__ = [];
  });

  const main = () => screen.getByRole('main');
  // Scope category lookups to <main> — the collapsed QA panel (outside <main>) has fixture buttons
  // whose labels also mention "Executive Rehearsal".
  const catButton = (name: RegExp) => within(main()).getByRole('button', { name });

  it('opens on the activity launcher: preamble + three prominent categories, no numbers', () => {
    render(<ProgressRehearsalSandbox />);
    expect(within(main()).getByRole('heading', { name: /improve how you speak/i })).toBeInTheDocument();
    expect(catButton(/quick practice/i)).toBeInTheDocument();
    expect(catButton(/executive rehearsal/i)).toBeInTheDocument();
    expect(catButton(/review my progress/i)).toBeInTheDocument();
    expect(within(main()).queryAllByText(/%/)).toHaveLength(0);
  });

  it('categories are a mutually-exclusive accordion (opening one closes the other)', () => {
    render(<ProgressRehearsalSandbox />);
    // Executive Rehearsal is open by default.
    expect(catButton(/executive rehearsal/i)).toHaveAttribute('aria-expanded', 'true');
    expect(catButton(/quick practice/i)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/define the presentation or conversation/i)).toBeInTheDocument();

    fireEvent.click(catButton(/quick practice/i));
    expect(catButton(/quick practice/i)).toHaveAttribute('aria-expanded', 'true');
    expect(catButton(/executive rehearsal/i)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/just begin — no agenda to set up/i)).toBeInTheDocument();
    expect(screen.queryByText(/define the presentation or conversation/i)).not.toBeInTheDocument();
  });

  it('numbered steps are a mutually-exclusive accordion within a category', () => {
    render(<ProgressRehearsalSandbox />);
    // Prepare open by default; Rehearse collapsed.
    expect(screen.getByText(/define the presentation or conversation/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /rehearse naturally/i }));
    expect(screen.getByText(/speak while your agenda is tracked passively/i)).toBeInTheDocument();
    expect(screen.queryByText(/define the presentation or conversation/i)).not.toBeInTheDocument();
  });

  it('reopening a completed/other step preserves the launcher (no state loss)', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(screen.getByRole('button', { name: /review and recover/i }));
    expect(screen.getByText(/inspect one suggested remedy/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^prepare$/i }));
    expect(screen.getByText(/define the presentation or conversation/i)).toBeInTheDocument();
  });

  it('“Try a sample rehearsal” launches the sample (Ready → passive cockpit, no numbers while speaking)', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(screen.getByRole('button', { name: /try a sample rehearsal/i }));
    expect(within(main()).getByText(/ready when you are/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /begin speaking/i }));
    expect(within(main()).getByText(/speak naturally/i)).toBeInTheDocument();
    expect(within(main()).getByRole('list', { name: /agenda/i })).toBeInTheDocument();
    expect(within(main()).queryAllByText(/%/)).toHaveLength(0);
    expect(within(main()).queryAllByText(/WPM/)).toHaveLength(0);
  });

  it('Quick Practice is a distinct, agenda-free flow', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(catButton(/quick practice/i));
    fireEvent.click(screen.getByRole('button', { name: /start speaking/i }));
    fireEvent.click(screen.getByRole('button', { name: /begin speaking/i }));
    expect(within(main()).getByText(/speak freely — no agenda to track/i)).toBeInTheDocument();
    expect(within(main()).queryByRole('list', { name: /agenda/i })).not.toBeInTheDocument();
  });

  it('supports Pause and Resume', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(screen.getByRole('button', { name: /try a sample rehearsal/i }));
    fireEvent.click(screen.getByRole('button', { name: /begin speaking/i }));
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(within(main()).getAllByText(/paused/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /resume/i }));
    expect(within(main()).getByText(/speak naturally/i)).toBeInTheDocument();
  });

  it('request-help → remedy → recovery → processing → recovered summary → returning-user landing', () => {
    vi.useFakeTimers();
    try {
      render(<ProgressRehearsalSandbox />);
      fireEvent.click(screen.getByRole('button', { name: /try a sample rehearsal/i }));
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

      // Rehearse again → the returning-user compact landing.
      fireEvent.click(screen.getByRole('button', { name: /rehearse again/i }));
      expect(within(main()).getByText(/welcome back/i)).toBeInTheDocument();
      expect(within(main()).getByText(/how executive rehearsal works/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Review My Progress leads with raw movement; percentage stays behind details', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(catButton(/review my progress/i));
    fireEvent.click(screen.getByRole('button', { name: /review my sessions/i }));
    expect(within(main()).getByText(/you improved on your last comparable session/i)).toBeInTheDocument();
    expect(within(main()).getByText(/fewer filler words per minute than your baseline/i)).toBeInTheDocument();
    const details = within(main()).getByText(/how speaksharp determined this/i).closest('details');
    expect(details).toBeTruthy();
    within(main()).queryAllByText(/\d+%/).forEach((el) => expect(details!.contains(el)).toBe(true));
  });

  it('the QA fixture switcher is a separate, collapsed Review-all-states panel (not the product frame)', () => {
    render(<ProgressRehearsalSandbox />);
    expect(within(main()).getByRole('heading', { name: /improve how you speak/i })).toBeInTheDocument();
    expect(screen.getByText(/review all states \(qa\)/i)).toBeInTheDocument();
    expect(within(main()).queryByText(/review all states/i)).not.toBeInTheDocument();
  });
});
