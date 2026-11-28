/**
 * Practice confidence check pilot (spec Revision 1). Off by default: enabled only when the build sets
 * `VITE_CONFIDENCE_CHECK_PILOT_ENABLED=true` exactly. Read at call time so tests can switch it with `vi.stubEnv`.
 */
export const isConfidenceCheckPilotEnabled = (): boolean =>
  import.meta.env.VITE_CONFIDENCE_CHECK_PILOT_ENABLED === 'true';
