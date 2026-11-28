/**
 * Default-off gate for the Focus Points meaning-based (NLI) matcher.
 *
 * Only the exact string `'true'` enables it. With the flag OFF nothing about Focus Points changes:
 * no worker is created, no model is fetched, no opt-in control is shown, and the keyword matcher's
 * outputs are what they were before this flag existed.
 *
 * Read at call time (not a module-load constant) so the gate is deterministically testable with
 * `vi.stubEnv` and no module resets — same pattern as `internalRoutes.ts`.
 */
export const isFocusMeaningMatcherEnabled = (): boolean =>
    import.meta.env.VITE_FOCUS_MEANING_MATCHER_ENABLED === 'true';
