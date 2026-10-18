Products dialog diagnostic: bounded CPU4 follow-up

Product/build baseline remains52623c6. No product source changed or rebuilt: the existing test build is reused. Sam's returned CI failure remains OPEN/UNKNOWN.

Executed 2026-10-18T09:45:35Z:
node scripts/host-interlock.mjs hold local -- pnpm exec cross-env E2E_PORT=4186 CLI_DIALOG_CPU_RATE=4 pnpm exec playwright test products-dialog-readiness.diagnostic.e2e.spec.ts --config=/private/tmp/cli-dev-products-dialog-cpu4.config.ts --project=full-suite --repeat-each=5 --workers=1 --retries=0 --max-failures=1

The local config inherits playwright.dialog-diagnostic.config.ts, resolves this worktree's testDir/tsconfig/server cwd, and writes separate report/traces at /private/tmp/cli-dev-products-dialog-cpu4. The original 10-run evidence is preserved at /private/tmp/cli-dev-products-dialog-diagnostic. No dependency download, extra build, CI rerun, forced click, sleep, extra readiness wait or provider operation.

Result:5 PASS,0 FAIL,0 FLAKY,29.554551 seconds. Exactly one visible/open modal at all five Escape captures; focus on SELECT inside it; pointer events auto. The preceding Products menu was closed in four runs and already unmounted in one. Modal closed26.62–43.35ms after Escape and unmounted207.00–237.31ms after Escape. The focused visible dialog dismissed in all five throttled runs. No original eight-second interception was reproduced.

Instrumentation adds route/modal count and Escape defaultPrevented observations. Important limitation: the capture-scheduled microtask originally labeled escape-after-dispatch is NOT a completion-of-dispatch observer: native event listener checkpoints can run it before later listeners. It was renamed escape-after-capture-microtask after this batch, with a source comment. No input, assertion, scheduling or observed number changed; no exact-final-label execution is claimed. Its false defaultPrevented value cannot establish missing Radix readiness. Close/unmount observations and the original action sequence remain the supported evidence.

Installed/locked Radix source reviewed: react-use-escape-keydown1.1.1 installs its document capture listener in React.useEffect; react-dismissable-layer1.1.11 checks whether its captured index is the highest current layer. This supplies a possible visibility/handler/layer timing boundary. It does not prove that boundary caused the historical CI failure. No speculative product handler replacement is proposed.

Original artifact12130045841 metadata was rechecked directly via gh api and still returns404. The original failure trace or a naturally captured failing trace is needed to distinguish early Escape from a failure after handler readiness. Keep the existing bounded hidden-after-Escape regression proposal explicitly separate from a demonstrated fix. Existing10 baseline passes +5 CPU4 passes are diagnostics, not acceptance or grounds to discount the failure. No full quality/CI/release qualification is claimed for this diagnostic-only branch.
