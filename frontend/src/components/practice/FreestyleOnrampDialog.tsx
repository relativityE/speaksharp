import * as React from 'react';
import { Check, Lightbulb, Mic, RotateCcw, ShieldCheck, Sparkles, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  CALIBRATION_MAX_SECONDS,
  CALIBRATION_PASSAGE,
  createCalibrationSession,
  type CalibrationSession,
  type CreateCalibrationSession,
} from '@/services/practice/calibrationSession';
import {
  getNextFreestylePrompt,
  PRACTICE_FOCUS_OPTIONS,
  type FreestyleOnrampSelection,
  type PracticeFocus,
} from '@/services/practice/practiceFocus';

type CalibrationState = 'idle' | 'starting' | 'recording' | 'stopping' | 'complete' | 'error';

interface FreestyleOnrampDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: (selection: FreestyleOnrampSelection) => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  calibrationBlocked?: boolean;
  createSession?: CreateCalibrationSession;
}

const formatRemaining = (seconds: number) => `0:${String(seconds).padStart(2, '0')}`;

export function FreestyleOnrampDialog({
  open,
  onOpenChange,
  onContinue,
  returnFocusRef,
  calibrationBlocked = false,
  createSession = createCalibrationSession,
}: FreestyleOnrampDialogProps) {
  const [focus, setFocus] = React.useState<PracticeFocus>('just-practice');
  const [promptIndex, setPromptIndex] = React.useState<number | null>(null);
  const [prompt, setPrompt] = React.useState<ReturnType<typeof getNextFreestylePrompt>['prompt'] | null>(null);
  const [calibrationOpen, setCalibrationOpen] = React.useState(false);
  const [calibrationState, setCalibrationState] = React.useState<CalibrationState>('idle');
  const [calibrationTranscript, setCalibrationTranscript] = React.useState('');
  const [calibrationError, setCalibrationError] = React.useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = React.useState(CALIBRATION_MAX_SECONDS);
  const focusRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const calibrationTriggerRef = React.useRef<HTMLButtonElement>(null);
  const calibrationRef = React.useRef<CalibrationSession | null>(null);
  const readySessionRef = React.useRef<CalibrationSession | null>(null);
  const capTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = React.useRef(0);
  const previouslyOpenRef = React.useRef(false);

  const clearTimers = React.useCallback(() => {
    if (capTimerRef.current) clearTimeout(capTimerRef.current);
    if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    capTimerRef.current = null;
    tickTimerRef.current = null;
  }, []);

  const disposeCalibration = React.useCallback(async () => {
    clearTimers();
    const session = calibrationRef.current;
    calibrationRef.current = null;
    readySessionRef.current = null;
    if (session) await session.dispose().catch(() => undefined);
  }, [clearTimers]);

  const resetCalibration = React.useCallback(() => {
    setCalibrationState('idle');
    setCalibrationTranscript('');
    setCalibrationError(null);
    setSecondsRemaining(CALIBRATION_MAX_SECONDS);
    readySessionRef.current = null;
  }, []);

  React.useEffect(() => {
    if (open && !previouslyOpenRef.current) {
      setFocus('just-practice');
      setPromptIndex(null);
      setPrompt(null);
      resetCalibration();
    }
    previouslyOpenRef.current = open;
  }, [open, resetCalibration]);

  React.useEffect(() => () => { void disposeCalibration(); }, [disposeCalibration]);

  const handleCalibrationError = React.useCallback(async (session: CalibrationSession, message: string) => {
    clearTimers();
    await session.dispose().catch(() => undefined);
    if (calibrationRef.current !== session) return;
    calibrationRef.current = null;
    readySessionRef.current = null;
    setCalibrationError(message);
    setCalibrationState('error');
  }, [clearTimers]);

  const finishCalibration = React.useCallback(async () => {
    clearTimers();
    const session = calibrationRef.current;
    if (!session) return;
    setCalibrationState('stopping');
    try {
      await session.stop();
      if (calibrationRef.current !== session) return;
      calibrationRef.current = null;
      readySessionRef.current = null;
      setCalibrationState('complete');
      setSecondsRemaining(0);
    } catch (error) {
      await handleCalibrationError(
        session,
        error instanceof Error ? error.message : 'The microphone test could not finish.',
      );
    }
  }, [clearTimers, handleCalibrationError]);

  const handleCalibrationReady = React.useCallback((session: CalibrationSession) => {
    if (calibrationRef.current !== session || readySessionRef.current === session) return;
    readySessionRef.current = session;
    startedAtRef.current = Date.now();
    setSecondsRemaining(CALIBRATION_MAX_SECONDS);
    setCalibrationState('recording');
    capTimerRef.current = setTimeout(() => { void finishCalibration(); }, CALIBRATION_MAX_SECONDS * 1000);
    tickTimerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setSecondsRemaining(Math.max(0, CALIBRATION_MAX_SECONDS - elapsed));
    }, 250);
  }, [finishCalibration]);

  const chooseFocus = (nextFocus: PracticeFocus) => setFocus(nextFocus);

  const handleFocusKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = PRACTICE_FOCUS_OPTIONS.length - 1;
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = index === last ? 0 : index + 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = index === 0 ? last : index - 1;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = last;
    if (nextIndex === null) return;
    event.preventDefault();
    chooseFocus(PRACTICE_FOCUS_OPTIONS[nextIndex].id);
    focusRefs.current[nextIndex]?.focus();
  };

  const showPrompt = () => {
    const next = getNextFreestylePrompt(promptIndex);
    setPromptIndex(next.index);
    setPrompt(next.prompt);
  };

  const startCalibration = async () => {
    await disposeCalibration();
    resetCalibration();
    setCalibrationState('starting');
    const session = createSession({
      onTranscript: setCalibrationTranscript,
      onReady: () => handleCalibrationReady(session),
      onError: (message) => { void handleCalibrationError(session, message); },
    });
    calibrationRef.current = session;
    try {
      await session.start();
    } catch (error) {
      if (calibrationRef.current !== session) return;
      await handleCalibrationError(
        session,
        error instanceof Error ? error.message : 'The microphone test could not start.',
      );
    }
  };

  const handleCalibrationOpenChange = (nextOpen: boolean) => {
    if (nextOpen && calibrationBlocked) return;
    setCalibrationOpen(nextOpen);
    if (!nextOpen) {
      void disposeCalibration();
      resetCalibration();
    }
  };

  const handleOuterOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setCalibrationOpen(false);
      void disposeCalibration();
      // Controlled dialogs can unmount their focus scope before Radix's close callback runs.
      // Restore explicitly as well as through onCloseAutoFocus so mouse, Escape, and route-owner
      // state changes all return keyboard users to the exact Freestyle CTA that opened setup.
      queueMicrotask(() => returnFocusRef.current?.focus());
    }
    onOpenChange(nextOpen);
  };

  const busy = calibrationState === 'starting' || calibrationState === 'recording' || calibrationState === 'stopping';

  return (
    <Dialog open={open} onOpenChange={handleOuterOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
        data-testid="freestyle-onramp-dialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Set up your Freestyle practice</DialogTitle>
          <DialogDescription>Pick an optional focus, use a prompt if you want one, then start practicing.</DialogDescription>
        </DialogHeader>

        <section aria-labelledby="practice-focus-heading" className="flex flex-col gap-4">
          <div>
            <h2 id="practice-focus-heading" className="text-base font-bold text-foreground">Optional practice focus</h2>
            <p className="text-sm text-muted-foreground">Choose one intention, or just start talking.</p>
          </div>

          <div role="radiogroup" aria-label="Optional practice focus" className="grid grid-cols-2 gap-2 lg:grid-cols-5" data-testid="practice-focus-options">
            {PRACTICE_FOCUS_OPTIONS.map((option, index) => {
              const selected = option.id === focus;
              return (
                <button
                  key={option.id}
                  ref={(node) => { focusRefs.current[index] = node; }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  data-testid={`practice-focus-${option.id}`}
                  onClick={() => chooseFocus(option.id)}
                  onKeyDown={(event) => handleFocusKeyDown(event, index)}
                  className={`flex min-h-11 items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-semibold transition-colors last:col-span-2 sm:last:col-span-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${selected ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-foreground hover:border-primary/50 hover:bg-muted/50'}`}
                >
                  <span>{option.label}</span>
                  {selected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          <div className="rounded-lg bg-muted/45 p-3 sm:flex sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Lightbulb className="h-4 w-4 text-accent" aria-hidden="true" />
                Not sure what to say?
              </p>
              {prompt && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-foreground/85" data-testid="freestyle-prompt" aria-live="polite">{prompt.text}</p>}
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:mt-0 sm:min-w-fit sm:flex-row">
              <Button type="button" variant="outline" onClick={showPrompt} data-testid="give-prompt-button">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Give me a prompt
              </Button>
              <Button
                ref={calibrationTriggerRef}
                type="button"
                variant="outline"
                onClick={() => { resetCalibration(); setCalibrationOpen(true); }}
                disabled={calibrationBlocked}
                aria-describedby={calibrationBlocked ? 'calibration-blocked-reason' : undefined}
                data-testid="open-calibration-button"
              >
                <Mic className="h-4 w-4" aria-hidden="true" />
                Let me test with a sample
              </Button>
            </div>
          </div>
          {calibrationBlocked && <p id="calibration-blocked-reason" className="text-xs font-medium text-muted-foreground">Finish the current recording or recovery step before testing your microphone.</p>}
        </section>

        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="ghost" onClick={() => handleOuterOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            onClick={() => onContinue({ focus, promptId: prompt?.id ?? null })}
            data-testid="continue-freestyle-button"
          >
            Continue to practice
          </Button>
        </DialogFooter>

        <Dialog open={calibrationOpen} onOpenChange={handleCalibrationOpenChange}>
          <DialogContent
            data-testid="calibration-dialog"
            className="max-h-[90vh] overflow-y-auto sm:max-w-xl"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              calibrationTriggerRef.current?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>30-second transcription test</DialogTitle>
              <DialogDescription>Check your microphone and browser transcription before a real practice session.</DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border border-emerald-700/20 bg-emerald-50 p-3 text-sm text-emerald-950">
              <p className="flex items-start gap-2 font-semibold"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Temporary test only</p>
              <p className="mt-1 pl-6">Your browser manages transcription and may use its own speech service. SpeakSharp sends no calibration data to SpeakSharp Cloud, Gemini, Supabase, or its application servers.</p>
              <p className="mt-1 pl-6">It creates no SpeakSharp session or Progress record, and the temporary transcript is discarded when you close this test.</p>
            </div>

            <section aria-labelledby="calibration-passage-heading" className="rounded-lg border border-border bg-card p-4">
              <h3 id="calibration-passage-heading" className="text-sm font-bold text-foreground">Read this passage aloud</h3>
              <blockquote className="mt-2 text-sm leading-relaxed text-foreground/90" data-testid="calibration-passage">{CALIBRATION_PASSAGE}</blockquote>
            </section>

            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3" aria-live="polite">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Calibration method</p><p className="font-bold text-foreground">Browser</p></div>
              <div className="text-right"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Maximum</p><p className="font-mono text-xl font-bold tabular-nums" data-testid="calibration-countdown">{formatRemaining(secondsRemaining)}</p></div>
            </div>

            {calibrationState === 'starting' && <div role="status" className="text-sm text-foreground">Preparing browser transcription…</div>}
            {(calibrationState === 'recording' || calibrationState === 'stopping') && (
              <div role="status" className="flex items-center gap-2 text-sm font-semibold text-rose-700">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-600" aria-hidden="true" />
                {calibrationState === 'recording' ? 'Listening—read the passage aloud.' : 'Finishing the temporary transcript…'}
              </div>
            )}
            {(calibrationTranscript || calibrationState === 'complete') && (
              <div className="min-h-24 rounded-lg border border-border bg-background p-3" data-testid="calibration-transcript">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Temporary transcript</p>
                <p className="text-sm leading-relaxed text-foreground" aria-live="polite">{calibrationTranscript || 'No words were captured. Try again and speak after the listening signal.'}</p>
              </div>
            )}
            {calibrationState === 'complete' && <p role="status" className="text-sm font-semibold text-emerald-800">Test complete. This transcript will be discarded when you close this window.</p>}
            {calibrationState === 'error' && <p role="alert" className="text-sm font-semibold text-destructive">{calibrationError ?? 'The microphone test could not run. Check microphone permission and try again.'}</p>}

            <DialogFooter className="gap-2 sm:space-x-0">
              {(calibrationState === 'idle' || calibrationState === 'error') && <Button type="button" onClick={() => { void startCalibration(); }} data-testid="start-calibration-button"><Mic className="h-4 w-4" aria-hidden="true" />Start 30-second test</Button>}
              {calibrationState === 'recording' && <Button type="button" variant="destructive" onClick={() => { void finishCalibration(); }} data-testid="stop-calibration-button"><Square className="h-4 w-4" aria-hidden="true" />Stop test</Button>}
              {calibrationState === 'complete' && <Button type="button" variant="outline" onClick={() => { void startCalibration(); }} data-testid="retry-calibration-button"><RotateCcw className="h-4 w-4" aria-hidden="true" />Test again</Button>}
              <Button type="button" variant="ghost" disabled={busy} onClick={() => handleCalibrationOpenChange(false)} data-testid="close-calibration-button">Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
