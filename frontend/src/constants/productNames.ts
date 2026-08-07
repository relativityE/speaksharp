/**
 * #1149 N2.1 — Central product-name authority.
 *
 * The ONE place customer-facing product/mode names live. Internal tokens (DB columns,
 * RPC names, telemetry events, code identifiers) are function-based and defined elsewhere;
 * they NEVER track these labels. A brand rename touches only this file — the backend and
 * telemetry never learn about it.
 *
 * Keys are the stable function tokens (freeform = open/unstructured practice,
 * objective = structured practice with declared objectives). Values are the current,
 * changeable product names (trial 2026-08-07).
 */
export const PRODUCT_NAMES = {
  /** Application name. Reserved / not yet finalized (#1149). */
  app: 'SpeakSharp',
  /** Open, unstructured practice mode. */
  freeform: 'Open Floor',
  /** Structured practice against declared focus points. */
  objective: 'Focus Points',
} as const;

export type ProductNameKey = keyof typeof PRODUCT_NAMES;
