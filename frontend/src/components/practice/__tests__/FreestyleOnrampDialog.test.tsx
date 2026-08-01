import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '../../../../tests/support/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FreestyleOnrampDialog } from '../FreestyleOnrampDialog';
import { CALIBRATION_MAX_SECONDS, type CreateCalibrationSession } from '@/services/practice/calibrationSession';
import { FREESTYLE_PROMPTS, PRACTICE_FOCUS_OPTIONS } from '@/services/practice/practiceFocus';

function createFakeCalibration() {
  const start = vi.fn().mockResolvedValue(undefined);
  const stop = vi.fn().mockResolvedValue(undefined);
  const dispose = vi.fn().mockResolvedValue(undefined);
  const factory: CreateCalibrationSession = vi.fn((callbacks) => ({
    start: async () => {
      callbacks.onTranscript('A temporary calibration transcript.');
      await start();
    },
    stop,
    dispose,
  }));
  return { factory, start, stop, dispose };
}

function Harness({
  createSession,
  calibrationBlocked = false,
  onContinue = vi.fn(),
}: {
  createSession?: CreateCalibrationSession;
  calibrationBlocked?: boolean;
  onContinue?: ReturnType<typeof vi.fn>;
}) {
  const [open, setOpen] = React.useState(false);
  const trigger = React.useRef<HTMLButtonElement>(null);
  return <>
    <button ref={trigger} type="button" onClick={() => setOpen(true)}>Start Freestyle</button>
    <FreestyleOnrampDialog
      open={open}
      onOpenChange={setOpen}
      onContinue={onContinue}
      returnFocusRef={trigger}
      calibrationBlocked={calibrationBlocked}
      createSession={createSession}
    />
  </>;
}

describe('FreestyleOnrampDialog', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('offers exactly the approved optional focuses with accessible roving keyboard behavior', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Freestyle' }));
    const radios = within(screen.getByRole('radiogroup', { name: 'Optional practice focus' })).getAllByRole('radio');
    expect(radios.map((radio) => radio.textContent?.trim())).toEqual(PRACTICE_FOCUS_OPTIONS.map(({ label }) => label));
    expect(radios).toHaveLength(5);
    const first = screen.getByRole('radio', { name: 'Just practice' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Be more concise' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Be more concise' }), { key: 'End' });
    expect(screen.getByRole('radio', { name: 'Deliver clearly' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Deliver clearly' }), { key: 'ArrowRight' });
    expect(first).toHaveFocus();
  });

  it('cycles only through the approved prompt corpus and returns stable IDs', () => {
    const onContinue = vi.fn();
    render(<Harness onContinue={onContinue} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Freestyle' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Reduce filler words' }));
    const trigger = screen.getByRole('button', { name: 'Give me a prompt' });
    for (const prompt of FREESTYLE_PROMPTS) {
      fireEvent.click(trigger);
      expect(screen.getByTestId('freestyle-prompt')).toHaveTextContent(prompt.text);
    }
    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId('continue-freestyle-button'));
    expect(onContinue).toHaveBeenCalledWith({ focus: 'fillers', promptId: FREESTYLE_PROMPTS[0].id });
  });

  it('uses Browser only, tells the truth about storage, and hard-stops at 30 seconds', async () => {
    vi.useFakeTimers();
    const calibration = createFakeCalibration();
    render(<Harness createSession={calibration.factory} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Freestyle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Let me test with a sample' }));
    expect(screen.getByText('Browser', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Uses your browser’s speech recognition. Nothing from this test is saved to SpeakSharp.')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/Cloud/);
    fireEvent.click(screen.getByRole('button', { name: 'Start 30-second test' }));
    await act(async () => { await Promise.resolve(); });
    expect(calibration.factory).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(CALIBRATION_MAX_SECONDS * 1000 - 1);
      await Promise.resolve();
    });
    expect(calibration.stop).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(calibration.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('calibration-countdown')).toHaveTextContent('0:00');
  });

  it('blocks calibration while recording state is unresolved', () => {
    render(<Harness calibrationBlocked />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Freestyle' }));
    expect(screen.getByRole('button', { name: 'Let me test with a sample' })).toBeDisabled();
    expect(screen.getByText(/Finish the current recording or recovery step/)).toBeInTheDocument();
  });

  it('restores focus to the calibration trigger and then the originating Freestyle CTA', async () => {
    render(<Harness />);
    const origin = screen.getByRole('button', { name: 'Start Freestyle' });
    origin.focus();
    fireEvent.click(origin);
    const calibrationTrigger = screen.getByRole('button', { name: 'Let me test with a sample' });
    fireEvent.click(calibrationTrigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () => { await Promise.resolve(); });
    expect(calibrationTrigger).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => { await Promise.resolve(); });
    expect(origin).toHaveFocus();
  });
});
