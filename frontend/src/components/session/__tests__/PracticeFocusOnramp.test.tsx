import { act, cleanup, fireEvent, render, screen, within } from '../../../../tests/support/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PracticeFocusOnramp } from '../PracticeFocusOnramp';
import { CALIBRATION_MAX_SECONDS, type CreateCalibrationSession } from '@/services/practice/calibrationSession';
import { FREESTYLE_PROMPTS, PRACTICE_FOCUS_OPTIONS } from '@/services/practice/practiceFocus';

function createFakeCalibration() {
  const start = vi.fn().mockResolvedValue(undefined);
  const stop = vi.fn().mockResolvedValue(undefined);
  const dispose = vi.fn().mockResolvedValue(undefined);
  const factory: CreateCalibrationSession = vi.fn((_mode, callbacks) => ({
    start: async () => {
      callbacks.onTranscript('A temporary calibration transcript.');
      await start();
    },
    stop,
    dispose,
  }));
  return { factory, start, stop, dispose };
}

describe('PracticeFocusOnramp', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('offers the five optional focus choices with Just practice selected by default', () => {
    render(<PracticeFocusOnramp available transcriptionMode="native" />);

    const group = screen.getByRole('radiogroup', { name: 'Optional practice focus' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(radios.map((radio) => radio.textContent?.trim())).toEqual(
      PRACTICE_FOCUS_OPTIONS.map((option) => option.label),
    );
    expect(screen.getByRole('radio', { name: 'Just practice' })).toHaveAttribute('aria-checked', 'true');
  });

  it('uses roving focus and Arrow/Home/End keyboard behavior', () => {
    const onFocusChange = vi.fn();
    render(<PracticeFocusOnramp available transcriptionMode="native" onFocusChange={onFocusChange} />);

    const first = screen.getByRole('radio', { name: 'Just practice' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const concise = screen.getByRole('radio', { name: 'Be more concise' });
    expect(concise).toHaveFocus();
    expect(concise).toHaveAttribute('aria-checked', 'true');

    fireEvent.keyDown(concise, { key: 'End' });
    const clarity = screen.getByRole('radio', { name: 'Deliver clearly' });
    expect(clarity).toHaveFocus();
    expect(clarity).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(clarity, { key: 'ArrowRight' });
    expect(first).toHaveFocus();
    expect(onFocusChange).toHaveBeenLastCalledWith('just-practice');
  });

  it('cycles through only the approved short prompt corpus', () => {
    render(<PracticeFocusOnramp available transcriptionMode="native" />);
    const trigger = screen.getByRole('button', { name: 'Give me a prompt' });

    for (const expectedPrompt of FREESTYLE_PROMPTS) {
      fireEvent.click(trigger);
      expect(screen.getByTestId('freestyle-prompt')).toHaveTextContent(expectedPrompt);
    }
    fireEvent.click(trigger);
    expect(screen.getByTestId('freestyle-prompt')).toHaveTextContent(FREESTYLE_PROMPTS[0]);
  });

  it('uses Private only when Private is selected and never selects Cloud for calibration', async () => {
    const privateCalibration = createFakeCalibration();
    const { rerender } = render(
      <PracticeFocusOnramp available transcriptionMode="private" createSession={privateCalibration.factory} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Let me test with a sample' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start 30-second test' }));
    await act(async () => { await Promise.resolve(); });
    expect(privateCalibration.factory).toHaveBeenCalledWith('private', expect.any(Object));

    fireEvent.click(screen.getByRole('button', { name: 'Stop test' }));
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByTestId('close-calibration-button'));
    const cloudCalibration = createFakeCalibration();
    rerender(<PracticeFocusOnramp available transcriptionMode="cloud" createSession={cloudCalibration.factory} />);
    fireEvent.click(screen.getByRole('button', { name: 'Let me test with a sample' }));
    expect(screen.getByText('Browser', { selector: 'p.font-bold' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start 30-second test' }));
    await act(async () => { await Promise.resolve(); });
    expect(cloudCalibration.factory).toHaveBeenCalledWith('browser', expect.any(Object));
  });

  it('hard-stops accepted calibration audio at 30 seconds', async () => {
    vi.useFakeTimers();
    const calibration = createFakeCalibration();
    render(<PracticeFocusOnramp available transcriptionMode="native" createSession={calibration.factory} />);

    fireEvent.click(screen.getByRole('button', { name: 'Let me test with a sample' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start 30-second test' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('status')).toHaveTextContent('Listening');

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
    expect(screen.getByText(/Test complete/)).toBeInTheDocument();
  });

  it('discloses ephemerality and disables every on-ramp action while a take is active', () => {
    render(<PracticeFocusOnramp available={false} transcriptionMode="cloud" />);
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Give me a prompt' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Let me test with a sample' })).toBeDisabled();

    cleanup();
    render(<PracticeFocusOnramp available transcriptionMode="native" />);
    fireEvent.click(screen.getByRole('button', { name: 'Let me test with a sample' }));
    expect(screen.getByText(/Nothing is saved to Sessions, History, or Progress/)).toBeInTheDocument();
    expect(screen.getByText(/SpeakSharp Cloud is never used/)).toBeInTheDocument();
  });
});
