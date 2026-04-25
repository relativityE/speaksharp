// src/lib/e2eProbe.ts
import logger from './logger';
import { ENV } from '../config/TestFlags';

/**
 * Deterministic Evidence Probe (v0.6.3)
 * 
 * Isolates and measures fail mechanisms by populating a structured global buffer.
 * Only active in E2E environments to maintain zero production overhead.
 */
let sequenceCounter = 0;

export function probe(event: string, payload: Record<string, unknown> = {}) {
  // Guard: Zero overhead in production
  if (typeof window === 'undefined' || !ENV.isE2E) {
    return;
  }

  // 1. App-Side Structured Log (SSOT)
  const win = (window as unknown as Record<string, unknown>);
  const seq = sequenceCounter++;

  logger.info({ event, seq, ...payload }, `[PROBE] ${event} (#${seq})`);

  // 2. Global Evidence Buffer for Playwright Capture
  const buffer = win.__E2E_PROBE__ as Array<Record<string, unknown>> | undefined;
  const entry = {
    event,
    payload: { ...payload, seq },
    ts: Date.now()
  };
  
  if (!buffer) {
    win.__E2E_PROBE__ = [entry];
  } else {
    buffer.push(entry);
  }
}

// 🛡️ Persistence Guard: Ensure the buffer survives soft reloads if required
if (typeof window !== 'undefined' && ENV.isE2E) {
  (window as unknown as Record<string, unknown>).probe = probe;
}

/**
 * 🌉 E2E Bridge Signaling
 * Unifies forensic bridge signaling across services.
 */
export function isBridgeActive(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as unknown as { __SS_E2E__?: { isActive: boolean } }).__SS_E2E__?.isActive;
}

export function pushE2EEvent(
  event: string,
  payload: Record<string, unknown> = {}
): void {
  if (typeof window === 'undefined') return;
  
  // Forward to standard probe for global logging buffer
  probe(event, payload);

  const bridge = (window as unknown as { __SS_E2E__?: { pushEvent?: (e: string, p: Record<string, unknown>) => void } }).__SS_E2E__;
  if (!bridge?.pushEvent) return;
  
  // Backward compatibility: the legacy bridge uses a different signature
  // and expects a flat payload with a timestamp.
  bridge.pushEvent(event, {
    ...payload,
    timestamp: Date.now(),
  });
}

