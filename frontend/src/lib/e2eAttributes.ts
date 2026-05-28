// src/lib/e2eAttributes.ts

/**
 * FORENSIC ANCHORS — present in ALL environments, ALL render phases
 * These are observability primitives. Removing them blinds monitoring.
 */
export const FORENSIC_ANCHORS = [
  'data-runtime-state',   // FSM state: IDLE | DOWNLOADING | READY | FAILED
  'data-app-ready',       // React boot/render-path signal
  'data-app-visible-ready', // Visible route-shell committed signal
  'data-recording',       // Active recording state
] as const;

/**
 * SENSITIVE ATTRIBUTES — stripped from production builds at compile time
 * These encode privilege or internal system state not for user consumption
 */
export const SENSITIVE_ATTRS = import.meta.env.DEV ? ([
  'data-user-tier',       // Subscription tier override (E2E only)
  'data-account-id',      // Internal account reference
  'data-auth-state',      // Auth debug state
] as const) : ([] as const);

export type ForensicAnchor = typeof FORENSIC_ANCHORS[number];
export type SensitiveAttr = typeof SENSITIVE_ATTRS[number];
