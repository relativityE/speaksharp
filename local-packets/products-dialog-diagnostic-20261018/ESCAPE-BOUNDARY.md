# Products dialog Escape boundary, 2026-10-18

The original CI failure (run 39108537487, shard 2, attempt 1) spent eight seconds trying to click the header Products button while the Objective setup dialog remained `data-state="open"` and intercepted pointer events. The preserved job log identifies the click at `productsMenu.ts:34`; its original trace artifact 12129811717 is unavailable (404). The log cannot tell whether Escape arrived before Radix's listener was ready or a ready listener failed to dismiss the modal.

The existing `products-menu-back-to-back` regression now requires `objective-setup-dialog` count zero within one second after the real Escape key press and before its next Products click. A missed dismissal fails at that assertion; a normally closing dialog gets to finish unmounting. There is no product change, click override, retry, fixed sleep, or wider Products-menu wait.

Executed against the existing local fake test build, one worker, zero retries:

```text
node scripts/host-interlock.mjs hold local -- pnpm exec cross-env E2E_PORT=4186 pnpm exec playwright test tests/e2e/products-menu-back-to-back.e2e.spec.ts --config=playwright.dialog-diagnostic.config.ts --project=full-suite --repeat-each=10 --workers=1 --retries=0 --max-failures=1 --output=/private/tmp/cli-dev-products-dismiss-boundary/results --reporter=line
10 passed (39.1s)
```

This validates the test's normal path and diagnostic boundary locally; it does not reproduce or fix the CI race. The source test build remains baseline 52623c6, so current release qualification is also separate. A naturally captured failing trace or an instrumented CI failure is still needed to identify why Escape was missed. Finding remains OPEN/UNKNOWN.
