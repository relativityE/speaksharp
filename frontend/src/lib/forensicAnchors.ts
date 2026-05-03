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

/**
 * 👑 Master Control Object (MCA)
 * Centralized diagnostic hub for E2E infrastructure audits.
 * NO UI coupling. Diagnostic ONLY.
 */
export interface SSMasterControl {
  fsm: {
    state: RuntimeState;
    lastTransition: number;
    heartbeat: 'ok' | 'stale' | 'none';
  };
  auth: {
    userType: 'free' | 'pro' | 'unknown';
    isMock: boolean;
  };
  engine: {
    active: string;
    initialized: boolean;
    ready: boolean;
  };
  diag: {
    bootDuration: number;
    signals: Record<string, string | boolean>;
  };
}

// Initialize global bridge if in browser
if (typeof window !== 'undefined') {
  const win = window as unknown as { __SS_MASTER_CONTROL__?: SSMasterControl };
  win.__SS_MASTER_CONTROL__ = win.__SS_MASTER_CONTROL__ || {
    fsm: { state: 'IDLE', lastTransition: Date.now(), heartbeat: 'none' },
    auth: { userType: 'unknown', isMock: true },
    engine: { active: 'none', initialized: false, ready: false },
    diag: { bootDuration: 0, signals: {} }
  };
}

const getMCA = (): SSMasterControl | null => {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { __SS_MASTER_CONTROL__: SSMasterControl }).__SS_MASTER_CONTROL__;
};

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
    case 'IDLE': return 'IDLE';
    case 'ACTIVATING_MIC': return 'INITIATING';
    case 'READY': return 'READY';
    case 'ENGINE_INITIALIZING': return 'ENGINE_INITIALIZING';
    case 'RECORDING': return 'RECORDING';
    case 'PAUSED': return 'RECORDING';    // Paused is still an active session
    case 'STOPPING': return 'STOPPING';
    case 'CLEANING_UP': return 'STOPPING';
    case 'DOWNLOAD_REQUIRED': return 'IDLE';
    case 'DOWNLOADING': return 'ENGINE_INITIALIZING';
    case 'DOWNLOAD_COMPLETE': return 'IDLE';
    case 'FAILED': return 'FAILED';
    case 'TERMINATED': return 'TERMINATED';
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

  const mca = getMCA();
  if (mca) {
    mca.engine.ready = isReady;
  }
}

/**
 * Synchronizes the STT identity (negotiation result) to the DOM.
 * MUST be called at negotiation time, NOT after engine initialization.
 * This is the authoritative signal for E2E identity verification.
 */
export function syncSTTIdentity(mode: string, isMock: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-stt-mode', mode);
  document.documentElement.setAttribute('data-stt-is-mock', String(isMock));
}



/**
 * Synchronizes the current FSM state to the DOM.
 * This is called synchronously during every state transition to ensure 
 * 100% determinism for E2E infrastructure audits.
 */
export function syncForensicAnchors(state: RuntimeState, mode?: string | null): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;

  // 1. data-runtime-state: Always present — reflects exact FSM state for forensic tracing
  root.setAttribute('data-runtime-state', state);

  // 1.5 data-stt-policy: Optional — reflects active transcription mode for forensic tracing
  if (mode) {
    document.body.setAttribute('data-stt-policy', mode);
  } else {
    document.body.removeAttribute('data-stt-policy');
  }

  // MCA Sync
  const mca = getMCA();
  if (mca) {
    mca.fsm.state = state;
    mca.fsm.lastTransition = Date.now();
  }

  // 2. data-app-ready: Monotonic Guard — once READY, we don't regress.
  // We only set it here if it's not already true, to support late-binding services.
  if (root.getAttribute('data-app-ready') !== 'true' && HEALTHY_STATES.has(state)) {
    setAppReady(true);
  }

  // 3. data-error-visible: Explicit error visibility signal for error boundary coordination
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

    const mca = getMCA();
    if (mca) {
      mca.diag.signals[name] = value;
    }
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

/**
 * Invariant I3: Engine Readiness Contract
 * Ensures data-engine-ready attribute is 1:1 with controller state.
 */
export function syncEngineReady(ready: boolean): void {
  if (typeof document === 'undefined') return;
  if (ready) {
    document.documentElement.setAttribute('data-engine-ready', 'true');
  } else {
    document.documentElement.removeAttribute('data-engine-ready');
  }
}

/**
 * Invariant I4: Session Persistence Contract
 * Signals when a session has been successfully saved to the database.
 */
export function syncSessionPersisted(persisted: boolean): void {
  if (typeof document === 'undefined') return;
  console.info(`[FORENSIC] syncSessionPersisted: ${persisted}`);
  if (persisted) {
    document.documentElement.setAttribute('data-session-persisted', 'true');
  } else {
    document.documentElement.removeAttribute('data-session-persisted');
  }
}
