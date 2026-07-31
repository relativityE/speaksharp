import type { ITranscriptionEngine, Transcript, TranscriptionModeOptions } from '@/services/transcription/modes/types';
import type { MicStream } from '@/services/transcription/utils/types';

export const CALIBRATION_MAX_SECONDS = 30;

export type CalibrationMode = 'browser' | 'private';

export interface CalibrationSessionCallbacks {
  onTranscript: (transcript: string) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
  onModelLoadProgress?: (progress: number | null) => void;
}

export interface CalibrationSession {
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

export type CreateCalibrationSession = (
  mode: CalibrationMode,
  callbacks: CalibrationSessionCallbacks,
) => CalibrationSession;

function joinTranscript(left: string, right: string): string {
  return [left.trim(), right.trim()].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * A deliberately isolated mic/transcription path for #1116's short calibration.
 *
 * This module imports only the leaf Browser/Private engines and microphone helper.
 * It never imports the production TranscriptionService, Supabase, session/history
 * persistence, Progress, or a Cloud provider. A calibration therefore cannot create
 * product evidence or a billable provider request through this seam.
 */
export function createCalibrationSession(
  mode: CalibrationMode,
  callbacks: CalibrationSessionCallbacks,
): CalibrationSession {
  let engine: ITranscriptionEngine | null = null;
  let mic: MicStream | null = null;
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
    onModelLoadProgress: (progress) => { if (!disposed) callbacks.onModelLoadProgress?.(progress); },
    serviceId: 'freestyle-calibration',
    runId: 'ephemeral-calibration',
  };

  const stopResources = async () => {
    // End capture synchronously before a Private whole-utterance decode. The hard
    // 30-second limit applies to accepted audio, not the time needed to finalize it.
    const activeMic = mic;
    mic = null;
    const activeEngine = engine;
    engine = null;
    let cleanupError: unknown;
    try {
      activeMic?.stop();
    } catch (error) {
      cleanupError = error;
    }
    if (activeEngine) {
      try {
        await activeEngine.stop();
        const transcript = await activeEngine.getTranscript();
        if (transcript.trim()) {
          finalTranscript = transcript.trim();
          partialTranscript = '';
          emit();
        }
      } catch (error) {
        cleanupError ??= error;
      } finally {
        try {
          await activeEngine.terminate();
        } catch (error) {
          cleanupError ??= error;
        }
      }
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

        if (mode === 'private') {
          const [{ default: PrivateWhisper }, { createMicStream }] = await Promise.all([
            import('@/services/transcription/modes/PrivateWhisper'),
            import('@/services/transcription/utils/audioUtils'),
          ]);
          assertActive();
          engine = new PrivateWhisper(options);
          const availability = await engine.checkAvailability();
          assertActive();
          if (!availability.isAvailable) {
            throw new Error(availability.message ?? 'Private transcription is not available on this device.');
          }
          const initialized = await engine.init(120_000);
          assertActive();
          if (!initialized.isOk) throw initialized.error;
          mic = await createMicStream();
          assertActive();
          await engine.start(mic);
          return;
        }

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
