**Owner:** [unassigned]
**Last Reviewed:** 2026-05-26
**Version:** v0.1
**Last Updated:** 2026-05-26

# Release Backlog

> Backlog, not release status.
> Current ship posture, blockers, and latest run IDs live only in `RELEASE_STATUS.md`.

This file tracks known issues, tech debt, and deferred cleanup that should not interrupt active P0/P1 release stabilization unless explicitly promoted.

## Triage Rules

| Priority | Meaning | Release Handling |
|---|---|---|
| P0 | Blocks tester release or risks billing/privacy/data integrity. | Fix before share. |
| P1 | Should fix before broader release or if it blocks validation. | Fix after active P0s are stable. |
| P2 | Workflow, maintainability, polish, or velocity debt. | Schedule after release gates are green. |

## Recently Closed

| Closed Date | Area | Result | Evidence |
|---|---|---|---|
| 2026-05-28 | CI artifact hygiene | Closed. Health-check now writes explicit Playwright infra artifacts and CI treats missing evidence as an error instead of a warning. | Commit `abd3f713` updated `scripts/test-audit.sh` and `.github/workflows/ci.yml`; `CI - Test Audit` run `26585424353` passed. |
| 2026-05-27 | Free baseline restoration | Closed locally. Runtime code, Edge Functions, migrations, workflows, tests, and launch docs now use `free` for the unpaid baseline while retaining `basic` only for future paid Basic compatibility. | Migration `20260527162000_restore_free_user_type.sql` restores `free`, preserves future paid Basic, and blocks paid Basic checkout with `paid_basic_future`. |
| 2026-05-15 | GitHub Actions maintenance | Closed. Artifact actions now run on Node 24-compatible versions. | Commit `1066ba6d` upgraded `actions/upload-artifact` to `v6` and `actions/download-artifact` to `v7`; `CI - Test Audit` run `25944598514` passed without the prior Node 20 artifact annotation. |

## Current Backlog

| Priority | Area | Issue | Impact | Recommended Action |
|---|---|---|---|---|
| P1 | Semantic AI Coaching | Upgrade and prove app coaching goes beyond pace/fillers into structure, vocabulary, audience impact, and next-practice drills. | Strongest near-term Pro retention lever after release evidence is clean. | Keep prompt categories explicit, add tests that assert semantic coaching instructions reach Gemini, and collect example outputs before broad launch. |
| P1 | Native STT claim evidence | Run a live human Native Browser STT pass before making any accuracy claim stronger than "instant, browser-dependent transcription." | Prevents overpromising the Free path and gives us evidence for onboarding copy, support notes, and competitor comparisons. | Use the planned human tester script with a known phrase, capture transcript/WER notes, browser/version, room condition, and whether the result supports or limits the claim. |
| P1 | Live Call Companion Overlay | Implement a compact, borderless "Companion Mode" layout/widget that floats on top of Zoom/Teams calls. | Expands utility from practice preparation to live execution, justifying the Pro tier pricing. | Create a dedicated `/companion` route that renders a minimized, high-contrast, overlay-friendly widget containing pacing dials and filler counters. |
| P2 | Trial workflows | Trial setup now lives in the database entitlement layer and live-release matrix. | No separate tester-code workflow remains after automatic trial cutover. | Closed by automatic trial cutover. |
| P2 | CI performance | Split setup actions into minimal paths: `setup-node-pnpm`, `setup-playwright`, `setup-supabase`, `setup-deno-edge`, and `setup-report`. | CI Audit can exceed the improved target when edge/report setup drags, slowing iteration without implying product failure. | Optimize after release correctness gates are green. |
| P2 | Workflow consolidation | Previously, `create-user.yml`, `query-users.yml`, and `setup-test-users.yml` split test-user administration across three workflows. | Some evidence could be mislabeled if admin-created accounts were confused with public signup/trial evidence. | Consolidated into `setup-test-users.yml` as `Test User Admin` with `setup`, `query`, and `create` actions. |
| P2 | RC/CI reporting performance | Final report aggregation and RC Gate 3 setup can take longer than the actual product test work. | Slows release feedback even when all product gates are green. | Include report-job minimization in the CI setup split: install only report dependencies and avoid unnecessary Playwright/Supabase setup for report-only work. |
| P2 | Session UI polish | Session page still has post-release polish opportunities around exact hierarchy density, mobile screenshots, and final visual tuning beyond the controlled-tester flow. | The page can be improved, but current controlled desktop tester gates are no longer blocked by Session layout/status. | Schedule after controlled-tester release. Keep any follow-up visual work separate from STT lifecycle changes and validate with screenshots. |
| P2 | Manual mic proof environment | Agent-run Chrome CDP evidence is not the same as a normal human speaking into a physical mic. | Public-launch claims should not overstate CDP proof as `manual-real-mic`. | Keep evidence labels explicit. Reserve `manual-real-mic` for a visible Chrome pass using a human-spoken phrase and normal browser mic settings. |
| P2 | Manual validation tooling | During the Free/Pro live walkthrough, the Codex in-app browser became wedged on `/session`; navigation away and creating a clean tab timed out at `about:blank`. A later dedicated Chrome CDP session on port `9222` allowed Free and Pro UI operation, but it still needs clear evidence labeling because Chrome was launched with mic permission auto-allow and speech stimulus came from macOS `say`. | Tool choice can change the apparent STT result, and mislabeled evidence can create false confidence or false blockers. | Prefer the dedicated Chrome CDP session for agent-operated live UI checks. Label evidence as `Chrome CDP live UI`, include account source, media setup, and artifact paths. Reserve `manual-real-mic` for a visible Chrome pass using a human-spoken phrase and normal browser mic settings. |
