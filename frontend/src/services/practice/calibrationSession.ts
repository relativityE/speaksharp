import type { ITranscriptionEngine, Transcript, TranscriptionModeOptions } from '@/services/transcription/modes/types';
import { DistributedLock } from '@/lib/DistributedLock';
import { useSessionStore } from '@/stores/useSessionStore';

export const CALIBRATION_MAX_SECONDS = 30;

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
 * This first-release module imports only the Browser leaf engine.
 * It never imports the production TranscriptionService, Supabase, session/history
 * persistence, Progress, or a Cloud provider. A calibration therefore cannot create
 * product evidence or a billable provider request through this seam.
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
  let disposed = false;

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

  const options: TranscriptionModeOptions = {
    onTranscriptUpdate,
    onReady: () => { if (!disposed) callbacks.onReady?.(); },
    onError: (error) => { if (!disposed) callbacks.onError?.(error.message); },
    serviceId: 'freestyle-calibration',
    runId: 'ephemeral-calibration',
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

  return {
    start() {
      if (disposed) return Promise.reject(new Error('Calibration is no longer available.'));
      if (startPromise) return startPromise;
      startPromise = (async () => {
        finalTranscript = '';
        partialTranscript = '';
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
        if (!disposed) callbacks.onError?.(message);
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
      await ensureStopped();
    },
  };
}
