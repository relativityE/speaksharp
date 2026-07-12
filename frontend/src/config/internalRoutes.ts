/**
 * Gate for internal, non-user-facing routes (e.g. the design system at `/design`).
 * These stay hidden in a production build unless explicitly enabled at build time
 * via `VITE_ENABLE_INTERNAL_ROUTES=true`.
 *
 * Read at call time (not a module-load constant) so the gate is deterministically
 * testable without module resets or env juggling.
 *
 * IMPORTANT: `/admin/ops-status` is intentionally NOT gated by this flag. It is
 * protected in production by HTTP Basic auth at the Vercel edge (`middleware.js`,
 * env `OPS_STATUS_PASSWORD`) — that middleware is its sole production gate. Do not
 * route the ops page through this flag: enabling `VITE_ENABLE_INTERNAL_ROUTES` in
 * production would also expose `/design`, which the edge middleware does NOT cover.
 */
export const areInternalRoutesEnabled = (): boolean =>
  !import.meta.env.PROD ||
  import.meta.env.VITE_ENABLE_INTERNAL_ROUTES === 'true';
