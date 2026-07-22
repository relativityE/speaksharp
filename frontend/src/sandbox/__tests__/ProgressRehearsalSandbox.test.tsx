import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { ProgressRehearsalSandbox } from '../ProgressRehearsalSandbox';
import { SESSION_ROUTE } from '../journey/HandoffScreen';

describe('ProgressRehearsalSandbox — one product, two practice modes (Quick Practice | Guided Rehearsal)', () => {
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

  it('reads as one product with two modes: headline, decision prompt, Quick Practice + Guided Rehearsal', () => {
    render(<ProgressRehearsalSandbox />);
    expect(within(main()).getByRole('heading', { name: /practice how you speak/i })).toBeInTheDocument();
    expect(within(main()).getByText(/do you want to speak freely, or practice toward specific outcomes/i)).toBeInTheDocument();
    expect(within(main()).getByRole('heading', { name: /^Quick Practice$/i })).toBeInTheDocument();
    expect(within(main()).getByRole('heading', { name: /^Guided Rehearsal$/i })).toBeInTheDocument();
    // "Executive Rehearsal" is NOT the umbrella label at the mode-selection level.
    expect(within(main()).queryByText(/executive rehearsal/i)).not.toBeInTheDocument();
    expect(within(main()).queryAllByText(/%/)).toHaveLength(0);
    // "STT" is never shown to users.
    expect(within(main()).queryByText(/\bSTT\b/)).not.toBeInTheDocument();
  });

  it('each mode has one unmistakable primary action', () => {
    render(<ProgressRehearsalSandbox />);
    expect(btn(/start speaking/i)).toBeInTheDocument(); // Quick Practice primary → existing session
    expect(btn(/set up a rehearsal/i)).toBeInTheDocument(); // Guided Rehearsal primary
    expect(btn(/try a sample/i)).toBeInTheDocument(); // Guided Rehearsal secondary (sample)
  });

  it('the two modes can be told apart WITHOUT opening either card (four visible markers each)', () => {
    render(<ProgressRehearsalSandbox />);
    expect(within(main()).getByText(/no agenda or setup required/i)).toBeInTheDocument();
    expect(within(main()).getByText(/transcript and focused delivery feedback/i)).toBeInTheDocument();
    expect(within(main()).getByText(/passive coverage tracking/i)).toBeInTheDocument();
    expect(within(main()).getByText(/best for presentations, pitches, interviews/i)).toBeInTheDocument();
    // Nothing is "Selected" until the user chooses a card.
    expect(within(main()).queryByText(/^Selected$/i)).not.toBeInTheDocument();
  });

  it('"Start speaking" (Quick Practice) hands off to the existing /session route (represented, not navigated)', () => {
    render(<ProgressRehearsalSandbox />);
    fireEvent.click(btn(/start speaking/i));
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

  it('selecting a mode reveals its steps, marks it Selected, and is mutually exclusive across cards', () => {
    render(<ProgressRehearsalSandbox />);
    const quick = btn(/quick practice/i); // whole-header selection toggle
    const guided = btn(/guided rehearsal/i);
    fireEvent.click(guided);
    expect(guided).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/define what you.re rehearsing/i)).toBeInTheDocument();
    fireEvent.click(quick);
    expect(quick).toHaveAttribute('aria-pressed', 'true');
    expect(guided).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/define what you.re rehearsing/i)).not.toBeInTheDocument();
    expect(screen.getByText(/pick how you want to capture/i)).toBeInTheDocument();
  });

  it('the default product frame has NO QA controls or sidebar', () => {
    render(<ProgressRehearsalSandbox />);
    expect(screen.queryByText(/review all states/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/design tokens & palette/i)).not.toBeInTheDocument();
    expect(document.querySelector('aside')).toBeNull();
  });

  it('"Try a sample" launches the Guided Rehearsal journey (Ready → passive cockpit)', () => {
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

  it('help → remedy → recovery → processing → recovered summary → returning-user keeps BOTH modes', () => {
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
      expect(within(main()).getByRole('heading', { name: /^Quick Practice$/i })).toBeInTheDocument();
      expect(within(main()).getByRole('heading', { name: /^Guided Rehearsal$/i })).toBeInTheDocument();
      expect(within(main()).getByText(/welcome back/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Theme A ("Vibrant Confidence") is the selected sandbox direction, applied app-wide ───────────
  it('applies the selected Theme A on the app root by default (themes the whole journey)', () => {
    render(<ProgressRehearsalSandbox />);
    expect(document.querySelector('[data-ss-theme="a"]')).toBeInTheDocument();
    // The frozen two-mode IA is identical regardless of theme.
    expect(within(main()).getByRole('heading', { name: /^Quick Practice$/i })).toBeInTheDocument();
    expect(within(main()).getByRole('heading', { name: /^Guided Rehearsal$/i })).toBeInTheDocument();
  });

  it('?theme=b and ?theme=c still render the retained candidate themes (compare-board evidence)', () => {
    setQuery('?theme=b');
    const { unmount } = render(<ProgressRehearsalSandbox />);
    expect(document.querySelector('[data-ss-theme="b"]')).toBeInTheDocument();
    expect(within(main()).getByRole('button', { name: /start speaking/i })).toBeInTheDocument();
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
