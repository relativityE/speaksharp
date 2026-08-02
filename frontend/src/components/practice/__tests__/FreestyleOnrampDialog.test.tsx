import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '../../../../tests/support/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FreestyleOnrampDialog } from '../FreestyleOnrampDialog';
import {
  CALIBRATION_MAX_SECONDS,
  CALIBRATION_PASSAGE,
  type CalibrationSessionCallbacks,
  type CreateCalibrationSession,
} from '@/services/practice/calibrationSession';
import { FREESTYLE_PROMPTS, PRACTICE_FOCUS_OPTIONS } from '@/services/practice/practiceFocus';

function createFakeCalibration(finalTranscript = 'A temporary calibration transcript.') {
  const start = vi.fn().mockResolvedValue(undefined);
  const stop = vi.fn().mockResolvedValue(finalTranscript);
  const dispose = vi.fn().mockResolvedValue(undefined);
  let activeCallbacks: CalibrationSessionCallbacks | null = null;
  const factory: CreateCalibrationSession = vi.fn((callbacks) => ({
    start: async () => {
      activeCallbacks = callbacks;
      callbacks.onTranscript('A temporary calibration transcript.');
      await start();
    },
    stop,
    dispose,
  }));
  return {
    factory,
    start,
    stop,
    dispose,
    signalReady: () => activeCallbacks?.onReady?.(),
    signalError: (message: string) => activeCallbacks?.onError?.(message),
  };
}

function Harness({
  createSession,
  calibrationBlocked = false,
  canStartCalibration,
  onContinue = vi.fn(),
}: {
  createSession?: CreateCalibrationSession;
  calibrationBlocked?: boolean;
  canStartCalibration?: () => boolean;
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
      canStartCalibration={canStartCalibration}
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

  it('shows the approved passage, discloses the Browser boundary, and starts the 30-second cap only when ready', async () => {
    vi.useFakeTimers();
    const calibration = createFakeCalibration();
    render(<Harness createSession={calibration.factory} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Freestyle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Let me test with a sample' }));
    expect(screen.getByText('Browser', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByTestId('calibration-passage')).toHaveTextContent(CALIBRATION_PASSAGE);
    expect(screen.getByText(/Your browser manages transcription and may use its own speech service/)).toBeInTheDocument();
    expect(screen.getByText(/SpeakSharp does not send this calibration transcript to its application servers or save it to your account/)).toBeInTheDocument();
    expect(screen.getByTestId('calibration-dialog')).not.toHaveTextContent(/SpeakSharp Cloud|Gemini|Supabase/i);
    expect(screen.getByText(/It creates no SpeakSharp session or Progress record/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cloud/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start 30-second test' }));
    await act(async () => { await Promise.resolve(); });
    expect(calibration.factory).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Preparing browser transcription…')).toBeInTheDocument();
    expect(screen.getByTestId('calibration-countdown')).toHaveTextContent('0:30');
    await act(async () => {
      vi.advanceTimersByTime(CALIBRATION_MAX_SECONDS * 1000);
      await Promise.resolve();
    });
    expect(calibration.stop).not.toHaveBeenCalled();

    act(() => calibration.signalReady());
    expect(screen.getByText('Listening—read the passage aloud.')).toBeInTheDocument();
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

  it('treats an empty manual stop as insufficient evidence with a retry, never success', async () => {
    const calibration = createFakeCalibration('   ');
    render(<Harness createSession={calibration.factory} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Freestyle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Let me test with a sample' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start 30-second test' }));
    await act(async () => { await Promise.resolve(); });
    act(() => calibration.signalReady());
    fireEvent.click(screen.getByRole('button', { name: 'Stop test' }));

    expect(await screen.findByText(/Not enough evidence to confirm transcription/)).toBeInTheDocument();
    expect(screen.getByText('No words were captured.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText(/Test complete/)).not.toBeInTheDocument();
  });

  it('treats an empty 30-second cap as insufficient evidence, never success', async () => {
    vi.useFakeTimers();
    const calibration = createFakeCalibration('');
    render(<Harness createSession={calibration.factory} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Freestyle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Let me test with a sample' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start 30-second test' }));
    await act(async () => { await Promise.resolve(); });
    act(() => calibration.signalReady());
    await act(async () => {
      vi.advanceTimersByTime(CALIBRATION_MAX_SECONDS * 1000);
      await Promise.resolve();
    });

    expect(screen.getByText(/Not enough evidence to confirm transcription/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText(/Test complete/)).not.toBeInTheDocument();
  });

  it('keeps the calibration dialog open until an active test has stopped cleanly', async () => {
    const calibration = createFakeCalibration();
    render(<Harness createSession={calibration.factory} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Freestyle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Let me test with a sample' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start 30-second test' }));
    await act(async () => { await Promise.resolve(); });
    act(() => calibration.signalReady());

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('calibration-dialog')).toBeInTheDocument();
    expect(calibration.dispose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Stop test' }));
    expect(await screen.findByText(/Test complete/)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('calibration-dialog')).not.toBeInTheDocument();
  });

  it('disposes and shows a runtime recognition error without later reporting success', async () => {
    vi.useFakeTimers();
    const calibration = createFakeCalibration();
    let finishDispose: (() => void) | undefined;
    calibration.dispose.mockImplementationOnce(() => new Promise<void>((resolve) => { finishDispose = resolve; }));
    render(<Harness createSession={calibration.factory} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Freestyle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Let me test with a sample' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start 30-second test' }));
    await act(async () => { await Promise.resolve(); });
    act(() => calibration.signalReady());

    await act(async () => {
      calibration.signalError('Browser recognition stopped.');
      await Promise.resolve();
    });

    expect(calibration.dispose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Test complete/)).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(CALIBRATION_MAX_SECONDS * 1000);
      await Promise.resolve();
    });
    expect(calibration.stop).not.toHaveBeenCalled();
    expect(screen.queryByText(/Test complete/)).not.toBeInTheDocument();

    await act(async () => {
      finishDispose?.();
      await Promise.resolve();
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Browser recognition stopped.');
  });

  it('blocks calibration while recording state is unresolved', () => {
    render(<Harness calibrationBlocked />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Freestyle' }));
    expect(screen.getByRole('button', { name: 'Let me test with a sample' })).toBeDisabled();
    expect(screen.getByText(/Finish the current recording or recovery step/)).toBeInTheDocument();
  });

  it('reruns the recovery preflight at Start before constructing an engine', async () => {
    const calibration = createFakeCalibration();
    let canStart = true;
    render(<Harness createSession={calibration.factory} canStartCalibration={() => canStart} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Freestyle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Let me test with a sample' }));
    canStart = false;

    fireEvent.click(screen.getByRole('button', { name: 'Start 30-second test' }));

    expect(calibration.factory).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Finish the current recording or recovery step/);
  });

  it('reruns recovery preflight after awaited disposal closes the cross-tab race', async () => {
    const calibration = createFakeCalibration();
    let canStart = true;
    render(<Harness createSession={calibration.factory} canStartCalibration={() => canStart} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Freestyle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Let me test with a sample' }));

    fireEvent.click(screen.getByRole('button', { name: 'Start 30-second test' }));
    canStart = false;
    await act(async () => { await Promise.resolve(); });

    expect(calibration.factory).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Finish the current recording or recovery step/);
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
