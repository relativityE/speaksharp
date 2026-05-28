**Owner:** [unassigned]
**Last Reviewed:** 2026-05-26
**Last Updated:** 2026-05-26

# Agent Instructions for SpeakSharp Repository

This file is the working guide for agents in the SpeakSharp repo. It should stay durable and procedural. Do not use it for current release status, run IDs, or go/no-go decisions.

## Current Release Truth

- Current release posture, blockers, and latest workflow run IDs live only in [product_release/RELEASE_STATUS.md](./product_release/RELEASE_STATUS.md).
- Release gate definitions live in [product_release/RC_GATES.md](./product_release/RC_GATES.md).
- Counted test/workflow inventory lives in [product_release/RC_TEST_INVENTORY.md](./product_release/RC_TEST_INVENTORY.md).
- Human tester protocol lives in [product_release/SOFT_RELEASE_TESTER_INSTRUCTIONS.md](./product_release/SOFT_RELEASE_TESTER_INSTRUCTIONS.md).
- Ops dashboard scope lives in [product_release/OPS_HEALTH_DASHBOARD.md](./product_release/OPS_HEALTH_DASHBOARD.md).
- Historical reports and second-opinion packets are evidence only. If they conflict with `RELEASE_STATUS.md`, the status file wins.

## Operating Principles

Follow the sequence:

1. Observe the failure with logs, browser evidence, or a focused test.
2. Prove the likely boundary before changing code.
3. Fix the narrowest thing that explains the evidence.
4. Confirm with the original reproduction or the closest gate-quality proof.

Do not revert user work. The worktree may be dirty; inspect before editing and only touch files relevant to the task.

## Testing And Gates

Use package scripts instead of inventing runners.

| Purpose | Command |
|---|---|
| Local development | `pnpm dev` |
| Production build | `pnpm build` |
| Fast checks | `pnpm test` or `pnpm test:infra` |
| Unit truth | `pnpm test:unit` |
| E2E suite | `pnpm test:e2e` |
| Full local CI parity | `pnpm ci:local` |
| Release candidate gates | `pnpm rc:gates` |
| Individual RC gates | `pnpm rc:gate:1:product` through `pnpm rc:gate:5:ux` |

`ci:local` is daily CI confidence. `rc:gates` is release-candidate confidence. If a release-critical change lands after a green run, rerun the relevant gate or document the evidence gap in `RELEASE_STATUS.md`.

If a local browser proof emits `sandbox_eperm_preview_bind`, that artifact is invalid release evidence. Re-run the proof from a normal terminal or GitHub Actions; sandbox EPERM artifacts cannot close RC gates.

## STT Release Boundaries

- Private v2, Private v4, and Cloud are the benchmarkable STT paths in our control.
- Native Browser STT is browser-dependent convenience transcription. Chrome desktop is recommended. Do not treat Native fixture/WER output as release benchmark evidence unless the exact browser audio route is separately proven.
- Native Chrome desktop uses dictation-style Web Speech configuration: `continuous=true`, `interimResults=true`, `maxAlternatives=1`.
- Cloud may only be entered by explicit user selection. Private must never silently fall back to Cloud because that changes privacy and cost posture.
- Private model download must remain explicit user intent: visible download CTA, progress/readiness status, and no silent auto-download.

## Signal And Readiness Discipline

- Signals are observable app outputs. They must not change behavior.
- Flags are inputs/test knobs. They may change behavior.
- Selectors identify UI elements. They are not readiness proof.
- Prefer the centralized E2E signal contract when adding or consuming readiness/diagnostic signals.
- `data-app-ready` means React boot/render path reached. User-visible browser tests must wait for `data-app-visible-ready` through the shared visible-readiness helper.
- Route helpers should wait for route-specific controls, not only global readiness, when a test needs a specific page to be interactive.

## Environment And Safety

- Use `rg`/`rg --files` for repository searches.
- Use `apply_patch` for manual file edits.
- Do not run destructive cleanup such as `git reset --hard`, broad `git checkout --`, or recovery scripts unless the user explicitly asks.
- `pnpm reset:clean` is acceptable for local environment instability. Avoid `pnpm reset:env` in dev mode because it can restore files.
- Secrets are managed through GitHub/Vercel/Supabase systems, not committed `.env` files. Use `gh secret list` only when checking availability.

## Documentation Rules

- Changing release status, latest run IDs, or current blockers: update only [product_release/RELEASE_STATUS.md](./product_release/RELEASE_STATUS.md).
- Changing stable product promises: update `product_release/PRD.operational.md`.
- Changing technical invariants: update `product_release/ARCHITECTURE.operational.md`.
- Changing launch risk/backlog posture: update `product_release/ROADMAP.operational.md` or `product_release/BACKLOG.md`.
- Keep archived docs as historical context; do not revive them as current truth.

## Escalation Format

When blocked, report:

1. One-line result.
2. Evidence: logs, artifacts, screenshots, and file references.
3. Hypotheses ranked by likelihood.
4. Two or three next options with pros/cons.
5. The option you recommend.
