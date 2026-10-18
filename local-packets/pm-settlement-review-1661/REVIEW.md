# #1661 independent settlement-order review

Browser PM · 18 October 2026. Reviewed product head: `889d7b217b5401e591b6ddda05bb64a577243391`.
This branch contains only independent review tests/documentation over that head. No App-owned branch or product source was changed.

## Result

The original seven abort-order/component/real-tree probes passed on889d. Twelve additional settlement-order controls executed: **8 PASS / 4 FAIL**. The four failures reproduce a once-only lifecycle-terminal race:

| Retirement boundary | Response | Settles before deferred tick | Settles after deferred tick |
|---|---|---|---|
| Real-tree Practice again, same page | successful result | FAIL: unmounted instead of superseded_session | PASS |
| Real-tree Practice again, same page | FunctionsFetchError | FAIL: unmounted instead of superseded_session | PASS |
| Practice again then immediate route exit | successful result | FAIL: unmounted instead of superseded_session | PASS |
| Practice again then immediate route exit | FunctionsFetchError | FAIL: unmounted instead of superseded_session | PASS |
| Actual route exit | successful result | PASS: unmounted | PASS: unmounted |
| Actual route exit | FunctionsFetchError | PASS: unmounted | PASS: unmounted |

The tests render the actual AISuggestions component. Repeat scenarios use the actual SessionOverhaulView + AISuggestions composition and click verdict-practice-again. Only transport is mocked; inputs are synthetic. Fake timers deterministically choose whether the actual deferred callback runs before or after the mocked request settles. No provider, Production account, deletion, migration or live run is used.

## Mechanism and bounded return

Cleanup captures leftRoute at teardown (~582) and uses it in its later callback. The response/error paths still call notCurrentReason (~632), which returns unmounted solely from mountedRef=false. Success (~722) or error (~762) can reach endLifecycle first. Its once-only guard (~342) then prevents the deferred callback from correcting that terminal to superseded_session.

Reproduction: render an after-state with a pending invoke; click Practice again and assert shell=during; optionally exit immediately; resolve a successful result or FunctionsFetchError while timer0 is paused; flush microtasks; then drain timer0. The single recorded terminal remains unmounted. Drain timer0 first and the same retirement records superseded_session.

Recommendation: use the same captured retirement cause for success/error settlement and deferred cleanup, preserving StrictMode and the accepted superseded-request policy. Sam owns source disposition; App owns correction/qualification/landing. This return does not assert the server aborted, lost persistence, or rendered stale content. The passing original abort-order controls remain valid within their scope.

## Reproduce

From a checkout of this branch with repository dependencies already installed:

```bash
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false --maxWorkers=1 \
  frontend/src/components/session/__tests__/BrowserPm.unmountIndependent1661.test.tsx \
  -t 'settlement-order controls'
```

Expected on889d:12 executed,8 pass,4 fail,7 other controls skipped. Omit the name filter to run the original seven controls too. Follow the repository host interlock when executing locally. No test configuration or thresholds were edited.

[Independent finding receipt](https://speaksharp.slack.com/archives/C0C9RE8KNHG/p1792363418426049). The test source is the adjacent committed frontend test; raw local JSON reports contain synthetic test results only and remain local.
