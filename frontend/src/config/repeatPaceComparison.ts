/**
 * Open Mic practice loop: the repeat pace comparison on a linked repeat's Progress page.
 *
 * Off by default. Enabled only when the build sets `VITE_REPEAT_PACE_COMPARISON_ENABLED=true` exactly; any other
 * value or unset keeps today's page byte-identical (no extra read, no extra line). Read at call time (not a
 * module-load constant) so tests can switch it with `vi.stubEnv` without module resets.
 */
export const isRepeatPaceComparisonEnabled = (): boolean =>
  import.meta.env.VITE_REPEAT_PACE_COMPARISON_ENABLED === 'true';
