# Gap Analysis – Phase 1 (Stabilize & Harden MVP)

**Purpose**: Verify the current state of the codebase against the Phase 1 goals defined in `docs/ROADMAP.md`. This is the gating check required before moving to Phase 2.

## Phase 1 Requirements (from ROADMAP)
| Requirement | Description | Current Status |
|-------------|-------------|----------------|
| Refactor Integration Tests | Slim down component tests that duplicate E2E coverage. | 🔴 Not Started |
| Create Troubleshooting Guide | Document error‑recovery steps for developers and CI. | 🔴 Not Started |
| Harden Supabase Security | Shorten OTP expiry, enable leaked‑password protection, upgrade Postgres. | 🔴 Not Started |
| Gap Analysis (this document) | Verify that all Phase 1 items are either completed or have a clear plan. | ✅ Completed |
| Build‑Time Environment Variable Validation | Validate required env vars before build. | ✅ Completed (see `scripts/validate-env.mjs`). |
| Use Vite `loadEnv` for env vars | Load env vars via Vite instead of `process.env`. | ✅ Completed (see `vite.config.mjs`). |
| Simplify & Document `package.json` scripts | Consolidate duplicate scripts and add JSDoc comments. | 🟡 In Progress (README updated, scripts still need cleanup). |
| ESLint `no‑unused‑vars` in catch blocks | Allow unused catch variables. | ✅ Completed (updated `eslint.config.js`). |
| Lighthouse CI integration | Run Lighthouse performance audit in CI. | ✅ Completed (see `ci.yml` lighthouse job). |

## Findings
- **Completed items**: Environment validation, Vite env loading, ESLint config, Lighthouse CI, most of the technical‑debt fixes.
- **In‑progress items**: Script consolidation (still a few duplicate entries) and documentation.
- **Open items**: Integration‑test refactor, troubleshooting guide, Supabase security hardening.

## Next Steps (Gating Check)
1. **Finalize script cleanup** – remove `test:unit` and duplicate E2E scripts.
2. **Create the troubleshooting guide** (see `docs/troubleshooting_guide.md`).
3. **Address Supabase security** – update OTP expiry, enable leaked‑password protection, plan Postgres upgrade.
4. **Refactor integration tests** – identify redundant tests and remove them.
5. Once items 1‑4 are completed, mark Phase 1 as ✅ and proceed to Phase 2.

*This document should be reviewed by the engineering lead and merged into `docs/`.*
