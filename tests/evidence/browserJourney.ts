import type { BrowserJourneyEvidence } from './sttEvidenceSchema';

export interface BrowserJourneyObservation {
  speechApiAvailable: boolean;
  traceEvents: string[];
  timerText: string;
  transcript: string;
  sessionProduced: boolean;
  executionMode: BrowserJourneyEvidence['executionMode'];
  applicationServerWrites: number;
  cloudProviderCalls: number;
}

/**
 * Parse a `m:ss` / `mm:ss(.f)` recording timer into seconds. Returns null for empty or malformed text so
 * an unparseable timer can never count as "advanced" — only a positive elapsed value does.
 */
export function parseTimerSeconds(text: string): number | null {
  const m = /^(\d{1,3}):([0-5]\d)(?:\.(\d+))?$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0);
}

/**
 * Fail-closed classification for the Browser/Web Speech lane. Availability,
 * start failure and a genuine supported recording are deliberately distinct.
 */
export function classifyBrowserJourney(observation: BrowserJourneyObservation): BrowserJourneyEvidence {
  const recognitionStarted = observation.traceEvents.includes('recognition_start_onstart')
    || observation.traceEvents.includes('onstart');
  // A real elapsed value beyond 00:00 — empty/malformed timer text is NOT "advanced".
  const timerSeconds = parseTimerSeconds(observation.timerText);
  const timerAdvanced = timerSeconds !== null && timerSeconds > 0;
  const startFailed = observation.traceEvents.some(event =>
    ['recognition_start_onerror', 'recognition_start_throw', 'recognition_start_timeout'].includes(event));

  return {
    supportState: !observation.speechApiAvailable
      ? 'unavailable'
      : recognitionStarted && !startFailed
        ? 'supported'
        : 'start-failure',
    executionMode: observation.executionMode,
    recognitionStarted,
    timerAdvanced,
    transcriptProduced: observation.transcript.trim().length > 0,
    sessionProduced: observation.sessionProduced,
    browserManagedTranscription: true,
    applicationServerWrites: observation.applicationServerWrites,
    cloudProviderCalls: observation.cloudProviderCalls,
  };
}
