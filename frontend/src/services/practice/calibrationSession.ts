import type { ITranscriptionEngine, Transcript, TranscriptionModeOptions } from '@/services/transcription/modes/types';
import { DistributedLock } from '@/lib/DistributedLock';
import { useSessionStore } from '@/stores/useSessionStore';

export const CALIBRATION_MAX_SECONDS = 30;
export const CALIBRATION_PASSAGE = 'Good communication starts with a clear purpose. Today I want to explain one small change that could make our work easier. The change is simple: agree on the next step before each meeting ends. That gives everyone a clear owner, a deadline, and fewer follow-up questions. I would start with our next team meeting and review the result after one week.';

export interface CalibrationSessionCallbacks {
  onTranscript: (transcript: string) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
}

export interface CalibrationSession {
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

export type CreateCalibrationSession = (
  callbacks: CalibrationSessionCallbacks,
) => CalibrationSession;

function joinTranscript(left: string, right: string): string {
  return [left.trim(), right.trim()].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * A deliberately isolated mic/transcription path for #1116's short calibration.
 *
 * This first-release module imports only the Browser leaf engine. The browser owns
 * SpeechRecognition and may manage that capability through its own service. SpeakSharp
 * does not route calibration through its production TranscriptionService, Supabase,
 * session/history persistence, Progress, Gemini, or SpeakSharp Cloud/application servers.
 *
 * It does share the production recording mutex and authoritative same-tab lifecycle
 * projection. Calibration cannot overlap an unresolved recording in this tab or a
 * live recording/calibration in another tab.
 */
export function createCalibrationSession(
  callbacks: CalibrationSessionCallbacks,
): CalibrationSession {
  let engine: ITranscriptionEngine | null = null;
  let lock: DistributedLock | null = null;
  let lockAcquired = false;
  let finalTranscript = '';
  let partialTranscript = '';
  let startPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let runtimeErrorCleanup: Promise<void> | null = null;
  let disposed = false;
  let readySignaled = false;
  let errorNotified = false;

  const assertActive = () => {
    if (disposed) throw new Error('Calibration was closed.');
  };

  const emit = () => {
    if (!disposed) callbacks.onTranscript(joinTranscript(finalTranscript, partialTranscript));
  };
  const onTranscriptUpdate = ({ transcript }: { transcript: Transcript }) => {
    if (transcript.final?.trim()) {
      finalTranscript = transcript.replacesRollingTranscript
        ? transcript.final.trim()
        : joinTranscript(finalTranscript, transcript.final);
      partialTranscript = '';
    }
    if (transcript.partial !== undefined) partialTranscript = transcript.partial.trim();
    emit();
  };

  const stopResources = async () => {
    const activeEngine = engine;
    engine = null;
    let cleanupError: unknown;
    try {
      if (activeEngine) {
        await activeEngine.stop();
        const transcript = await activeEngine.getTranscript();
        if (transcript.trim()) {
          finalTranscript = transcript.trim();
          partialTranscript = '';
          emit();
        }
      }
    } catch (error) {
      cleanupError = error;
    } finally {
      try {
        if (activeEngine) await activeEngine.terminate();
      } catch (error) {
        cleanupError ??= error;
      }
      if (lockAcquired && lock) {
        try {
          lock.updateState('TERMINATED');
          lock.release();
        } catch (error) {
          cleanupError ??= error;
        }
      }
      lockAcquired = false;
      lock = null;
    }
    if (cleanupError) throw cleanupError;
  };

  const ensureStopped = () => {
    if (!stopPromise) stopPromise = stopResources();
    return stopPromise;
  };

  const notifyErrorOnce = (message: string) => {
    if (disposed || errorNotified) return;
    errorNotified = true;
    callbacks.onError?.(message);
  };

  const options: TranscriptionModeOptions = {
    onTranscriptUpdate,
    onReady: () => {
      if (disposed || stopPromise || readySignaled) return;
      readySignaled = true;
      callbacks.onReady?.();
    },
    onError: (error) => {
      if (disposed || errorNotified) return;
      const message = error.message || 'Browser transcription stopped unexpectedly.';
      runtimeErrorCleanup ??= ensureStopped()
        .catch(() => undefined);
      notifyErrorOnce(message);
    },
    serviceId: 'freestyle-calibration',
    runId: 'ephemeral-calibration',
  };

  return {
    start() {
      if (disposed) return Promise.reject(new Error('Calibration is no longer available.'));
      if (startPromise) return startPromise;
      startPromise = (async () => {
        finalTranscript = '';
        partialTranscript = '';
        readySignaled = false;
        errorNotified = false;
        emit();

        const sessionState = useSessionStore.getState();
        if (sessionState.engineSelectionLocked || sessionState.pendingResolutionKind !== null) {
          throw new Error('Finish the current recording or recovery step before testing your microphone.');
        }

        lock = new DistributedLock();
        lockAcquired = lock.acquire('CALIBRATION');
        if (!lockAcquired) throw new Error('A recording or microphone test is active in another tab.');

        const { default: NativeBrowser } = await import('@/services/transcription/modes/NativeBrowser');
        assertActive();
        engine = new NativeBrowser(options);
        const availability = await engine.checkAvailability();
        assertActive();
        if (!availability.isAvailable) {
          throw new Error(availability.message ?? 'Browser transcription is not available in this browser.');
        }
        const initialized = await engine.init(30_000);
        assertActive();
        if (!initialized.isOk) throw initialized.error;
        await engine.start();
      })().catch(async (error: unknown) => {
        await ensureStopped().catch(() => undefined);
        const message = error instanceof Error ? error.message : 'Calibration could not start.';
        notifyErrorOnce(message);
        throw error;
      });
      return startPromise;
    },

    stop() {
      return ensureStopped();
    },

    async dispose() {
      disposed = true;
      // If setup is still in flight, let its disposed check route through the
      // same cleanup promise before returning. No worker or microphone survives
      // closing the dialog during model initialization.
      await startPromise?.catch(() => undefined);
      await runtimeErrorCleanup?.catch(() => undefined);
      await ensureStopped();
    },
  };
}
