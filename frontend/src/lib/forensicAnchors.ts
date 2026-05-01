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
 * Set the global app-ready signal.
 * This is the ONLY authoritative writer for data-app-ready.
 */
export function setAppReady(ready: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-app-ready', ready ? 'true' : 'false');
}

/**
 * Synchronizes the STT readiness signal to the DOM.
 * ONLY authoritative writer for data-stt-ready.
 */
export function syncSTTReady(isReady: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-stt-ready', isReady ? 'true' : 'false');
}

export function syncRuntimeState(state: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-runtime-state', state);
}

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

  // 2. data-app-ready: Monotonic Guard — once READY, we don't regress.
  // We only set it here if it's not already true, to support late-binding services.
  if (root.getAttribute('data-app-ready') !== 'true' && HEALTHY_STATES.has(state)) {
    setAppReady(true);
  }

  // 4. data-error-visible: Explicit error visibility signal for error boundary coordination
  root.setAttribute(
    'data-error-visible',
    ERROR_STATES.has(state) ? 'true' : 'false'
  );
}

/**
 * Authoritative forensic signaling interface.
 * Standardizes all transient DOM signals for E2E infrastructure.
 */
export const forensic = {
  /**
   * Set a forensic signal on the document root.
   * @param name The signal name (e.g. 'pdf-ready')
   * @param value The value (true, 'clean', etc)
   */
  setSignal(name: string, value: string | boolean): void {
    if (typeof document === 'undefined') return;
    const attrName = name.startsWith('data-') ? name : `data-${name}`;
    document.documentElement.setAttribute(attrName, String(value));
  },

  /**
   * Get a forensic signal from the document root.
   */
  getSignal(name: string): string | null {
    if (typeof document === 'undefined') return null;
    const attrName = name.startsWith('data-') ? name : `data-${name}`;
    return document.documentElement.getAttribute(attrName);
  },

  /**
   * Remove a forensic signal from the document root.
   */
  removeSignal(name: string): void {
    if (typeof document === 'undefined') return;
    const attrName = name.startsWith('data-') ? name : `data-${name}`;
    document.documentElement.removeAttribute(attrName);
  }
};
