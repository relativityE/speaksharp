/**
 * Forensic Anchors Utility
 * 
 * SINGLE SOURCE OF TRUTH for all forensic DOM attribute writes.
 * Zero React dependencies. Zero async. Called directly from FSM listener.
 * DO NOT import this into any React component.
 * 
 * TARGET: document.documentElement (<html>) for T=0 visibility and selector consistency.
 */

import type { RuntimeState } from '../services/SpeechRuntimeController';

// Internal FSM states from TranscriptionService
export type TranscriptionState =
  | 'IDLE'
  | 'ACTIVATING_MIC'
  | 'READY'
  | 'ENGINE_INITIALIZING'
  | 'RECORDING'
  | 'PAUSED'
  | 'STOPPING'
  | 'CLEANING_UP'
  | 'DOWNLOAD_REQUIRED'
  | 'DOWNLOADING'
  | 'DOWNLOAD_COMPLETE'
  | 'FAILED'
  | 'TERMINATED';

// Map internal FSM states to the authoritative forensic contract
export function mapToRuntimeState(state: TranscriptionState): RuntimeState {
  switch (state) {
    case 'IDLE':        return 'IDLE';
    case 'ACTIVATING_MIC': return 'INITIATING';
    case 'READY':       return 'READY';
    case 'ENGINE_INITIALIZING': return 'ENGINE_INITIALIZING';
    case 'RECORDING':   return 'RECORDING';
    case 'PAUSED':      return 'RECORDING';    // Paused is still an active session
    case 'STOPPING':    return 'STOPPING';
    case 'CLEANING_UP': return 'STOPPING';
    case 'DOWNLOAD_REQUIRED': return 'IDLE';
    case 'DOWNLOADING': return 'ENGINE_INITIALIZING';
    case 'DOWNLOAD_COMPLETE': return 'IDLE';
    case 'FAILED':      return 'FAILED';
    case 'TERMINATED':  return 'TERMINATED';
    default: {
      // Exhaustiveness check — TypeScript will error if a new state is added
      // to TranscriptionState without updating this mapper
      const exhaustiveCheck: never = state;
      console.error(`[forensicAnchors] Unmapped FSM state: ${exhaustiveCheck}`);
      return 'FAILED';
    }
  }
}

/**
 * States where the system is fully operational.
 * Includes READY (idle success) and active recording/stopping states.
 */
const HEALTHY_STATES = new Set<RuntimeState>([
  'READY',
  'RECORDING',
  'STOPPING',
]);

/**
 * States that represent user-visible errors.
 */
const ERROR_STATES = new Set<RuntimeState>([
  'FAILED',
  'FAILED_VISIBLE',
]);

/**
 * States where audio is actively being processed.
 */
const RECORDING_STATES = new Set<RuntimeState>([
  'RECORDING',
  'STOPPING',
]);

/**
 * Synchronizes the current FSM state to the DOM.
 * This is called synchronously during every state transition to ensure 
 * 100% determinism for E2E infrastructure audits.
 */
export function syncForensicAnchors(state: RuntimeState): void {
  if (typeof document === 'undefined') return;
  
  const root = document.documentElement;

  // 1. data-runtime-state: Always present — reflects exact FSM state for forensic tracing
  root.setAttribute('data-runtime-state', state);

  // 2. data-app-ready: True when system is fully operational — includes active recording
  root.setAttribute(
    'data-app-ready',
    HEALTHY_STATES.has(state) ? 'true' : 'false'
  );

  // 3. data-recording-state: Reflects active audio processing phases
  root.setAttribute(
    'data-recording-state',
    RECORDING_STATES.has(state) ? 'recording' : 'idle'
  );

  // 4. data-error-visible: Explicit error visibility signal for error boundary coordination
  root.setAttribute(
    'data-error-visible',
    ERROR_STATES.has(state) ? 'true' : 'false'
  );
}
