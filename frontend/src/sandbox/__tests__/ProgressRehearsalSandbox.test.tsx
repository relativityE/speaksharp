import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ProgressRehearsalSandbox } from '../ProgressRehearsalSandbox';

// The sandbox is provider-free, so it renders with a plain RTL render (no app wrappers).
// The product journey lives in <main>; the collapsed QA panel sits OUTSIDE <main>, so "no numbers on
// the primary screen" assertions are scoped to <main>.
describe('ProgressRehearsalSandbox — journey', () => {
  beforeEach(() => {
    (window as unknown as { __SS_SANDBOX_TRACE__?: unknown[] }).__SS_SANDBOX_TRACE__ = [];
  });

  const main = () => screen.getByRole('main');

  it('opens on the Prepare screen with one obvious primary action and no numbers', () => {
    render(<ProgressRehearsalSandbox />);
    expect(within(main()).getByRole('heading', { name: /what are you rehearsing\?/i })).toBeInTheDocument();
    expect(within(main()).getByRole('button', { name: /start rehearsal/i })).toBeInTheDocument();
    expect(within(main()).queryAllByText(/%/)).toHaveLength(0);
  });

  it('Start rehearsal → the passive cockpit with an agenda, no scores/percentages while speaking', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(screen.getByRole('button', { name: /start rehearsal/i }));
    expect(within(main()).getByText(/speak naturally/i)).toBeInTheDocument();
    expect(within(main()).getByRole('list', { name: /agenda/i })).toBeInTheDocument();
    expect(within(main()).queryAllByText(/%/)).toHaveLength(0);
    expect(within(main()).queryAllByText(/WPM/)).toHaveLength(0);
  });

  it('the full request-help → remedy → recovery sequence surfaces "Recovered after guidance"', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(screen.getByRole('button', { name: /start rehearsal/i }));

    // The approval request is the scripted recovery point — target its item specifically.
    const approvalItem = screen.getByText(/request approval for two additional/i).closest('li') as HTMLElement;
    fireEvent.click(within(approvalItem).getByRole('button', { name: /help me with this point/i }));
    expect(screen.getByText(/one suggestion/i)).toBeInTheDocument(); // one concise remedy, not a list
    fireEvent.click(screen.getByRole('button', { name: /i addressed it just now/i }));

    fireEvent.click(screen.getByRole('button', { name: /finish rehearsal/i }));

    expect(screen.getByRole('heading', { name: /recovered the approval request after asking for help/i })).toBeInTheDocument();
    const outcome = screen.getByRole('list', { name: /agenda outcome/i });
    expect(within(outcome).getByText(/recovered after guidance/i)).toBeInTheDocument();
    expect(screen.getByText(/next run/i)).toBeInTheDocument();
    // Percentages/formulas stay behind disclosure, not on the primary summary.
    expect(screen.getByText(/how speaksharp determined this/i)).toBeInTheDocument();
  });

  it('general practice leads with raw movement; percentage stays behind details', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(screen.getByRole('button', { name: /skip agenda — general practice/i }));
    expect(within(main()).getByText(/you improved on your last comparable session/i)).toBeInTheDocument();
    expect(within(main()).getByText(/fewer filler words per minute than your baseline/i)).toBeInTheDocument();
    // Every percentage in the product frame lives INSIDE the collapsed "How SpeakSharp determined
    // this" disclosure — never in the primary flow.
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
    // Product is primary...
    expect(within(main()).getByRole('heading', { name: /what are you rehearsing\?/i })).toBeInTheDocument();
    // ...and the QA panel exists but outside the product frame.
    expect(screen.getByText(/review all states \(qa\)/i)).toBeInTheDocument();
    expect(within(main()).queryByText(/review all states/i)).not.toBeInTheDocument();
  });
});
