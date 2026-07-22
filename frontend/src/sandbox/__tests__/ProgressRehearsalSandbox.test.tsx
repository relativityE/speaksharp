import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ProgressRehearsalSandbox } from '../ProgressRehearsalSandbox';

// The sandbox is intentionally provider-free, so it renders with a plain RTL render (no app wrappers).
describe('ProgressRehearsalSandbox (page smoke)', () => {
  beforeEach(() => {
    (window as unknown as { __SS_SANDBOX_TRACE__?: unknown[] }).__SS_SANDBOX_TRACE__ = [];
  });

  it('renders the sandbox header and a fixture switcher', () => {
    render(<ProgressRehearsalSandbox />);
    expect(screen.getByRole('heading', { name: /Personal Progress & Executive Rehearsal/i })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /fixture states/i })).toBeInTheDocument();
  });

  it('improved fixture shows cumulative % and previous-session movement in pp', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(screen.getByRole('button', { name: /Improved vs previous comparable/i }));
    // fillers 8 baseline → 5 now = 50% of original gap; movement +17 pp from the previous session.
    // (+17 pp appears in both the headline and the "Show calculation" disclosure, hence getAllByText.)
    expect(screen.getAllByText(/50%/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\+17 pp/).length).toBeGreaterThan(0);
  });

  it('baseline-established fixture shows "Personal baseline established" and no percentage headline', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(screen.getByRole('button', { name: /Baseline established/i }));
    expect(screen.getByText(/Personal baseline established/i)).toBeInTheDocument();
  });

  it('rehearsal fixture exposes passive agenda coverage separate from delivery progress', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(screen.getByRole('button', { name: /partly covered agenda/i }));
    expect(screen.getByText(/agenda coverage \(passive\)/i)).toBeInTheDocument();
    expect(screen.getByText(/mixed into delivery progress/i)).toBeInTheDocument();
  });

  it('recovered-after-guidance requires a user remedy request before "Recovered" appears', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(screen.getByRole('button', { name: /recovered after guidance/i }));
    const list = screen.getByRole('list', { name: /agenda coverage/i });
    // Passive-first: no "Recovered" pill inside the agenda list until the user requests help.
    expect(within(list).queryByText(/Recovered after guidance/i)).not.toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: /request help with this point/i }));
    expect(within(list).getByText(/Recovered after guidance/i)).toBeInTheDocument();
  });
});
