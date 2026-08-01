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
 * Fail-closed classification for the Browser/Web Speech lane. Availability,
 * start failure and a genuine supported recording are deliberately distinct.
 */
export function classifyBrowserJourney(observation: BrowserJourneyObservation): BrowserJourneyEvidence {
  const recognitionStarted = observation.traceEvents.includes('recognition_start_onstart')
    || observation.traceEvents.includes('onstart');
  const timerAdvanced = !/^00:00(?:\.0+)?$/.test(observation.timerText.trim());
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
