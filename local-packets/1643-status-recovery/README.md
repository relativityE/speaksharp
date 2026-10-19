# #1643 owner-status recovery source increment

Base: `31724ec84142967f24b2bd5bc20a44e0dd270fd6` (#1658, containing main
`ecce3e8d9e154ddb12f7238a514f0ec85d4b75b4`). Reuses the retained deletion
page, route-lifetime attempt guard and one-use token capture from
`530b3ff47e0ee464d4e62a420f1f2733481aeab2`; no old backend implementation is replayed.

The retained page accepted only legacy destructive replies and did not read owner
status. Its parser classified the actual #1658 `202 pending` response as unverified
deletion, while a fresh page could expose confirmation without reading durable intent.

This increment adds an authenticated owner-status read before offering any write.
The read verifies the local session owner and pins its bearer for that request; the
server independently authenticates that bearer. A generation fences results after
account changes, unmount, replacement reads and the 15-second local deadline. A
deadline does not cancel server work or prove that a write did not commit.

Only the exact inactive `pending` / `not_pending` contract is accepted. Pending
responses retain their immutable request identity; malformed, unavailable or
contradictory results block confirmation. A remembered pending request, or an
uncertain local confirmation, cannot be reopened by a later `not_pending` result.
Known request identity cannot silently change. The one-use emailed token is never
included in a status request, restored by status recovery, persisted or logged.

An explicit confirmation's `202 pending` reply is displayed as pending without
claiming deletion or signing out. Lost/unknown confirmation responses keep the
existing replay guard. The recovery button sends only `action: status`; no automatic
confirm, token issuance, provider operation or destructive retry exists in recovery.

## Evidence

Command:

```
pnpm exec vitest run --config frontend/vitest.config.mjs --coverage.enabled=false --reporter=dot tests/unit/accountDeletionStatus.component.test.tsx tests/unit/accountDeletionAttempts.test.ts frontend/src/pages/__tests__/AccountDeletionPage.component.test.tsx tests/unit/accountDeletionVerification.test.ts tests/unit/accountClosureRequest.test.ts
```

80/80 PASS: 16 new status component controls, 3 attempt-interleaving controls, 37 retained UI/token controls,
24 existing request-handler controls. One new component control invokes the actual
`handleClosureRequest` function with its inactive pending adapter and checks the
`202` payload consumption and no-store response. Auth, transport and durable storage
are deterministic test seams; this is not a real database, browser/JWT or live proof.

The two principal new tests were also executed against the verbatim retained
`530b3ff4` page via a test-only alias: both RED (missing reload hydration and rejected
actual pending reply), with the remaining 12 new controls deliberately skipped.
The retained source and temporary alias configuration are local ignored artifacts.
An additional remount-during-confirmation control was RED on the initial increment
`55722527`: status learned the committed request ID before the original HTTP reply,
but late reply reconciliation discarded it. The successor preserves that identity
both while the confirmation is in flight and when its reply settles unknown.
Sam's adjacent late-refusal finding was reproduced in the exact attempt helper and
two simultaneously mounted real pages: late `ready/refused` must not override the
already observed durable pending intent. Both were RED before the correction; the
genuine refusal control still permits a fresh explicit request when no pending was
observed. The successor preserves the pending phase and its identity through both
unknown and refused replies.

Scoped ESLint passes. Full default `pnpm quality` passes (exit 0), including product
contract, repository lint, frontend/live/evidence typechecks and eslint-disable guard.
No CI or independent source acceptance is implied by local controls.

## Integration boundary and remaining work

This is isolated source preparation, not a second implementation PR or an enabled
customer feature. The page is deliberately not registered in `App.tsx` here, nor is
the token capture imported into startup or a pricing entry point exposed. Reuse the
retained integration wiring when the complete account-exit increment is ready.

Remaining #1643 work includes server-side account-only admission for Start, coaching,
portal and background work; completion/settlement of previously accepted operations;
the final settlement-to-deletion executor; legacy checkout cutover reconciliation;
App's teardown integration; exact-head qualification and authorized live acceptance.
Ordinary deletion does not require global worker shutdown. #1658 remains the active
implementation PR; App owns selected landing and operational execution. No migration
apply, merge, deployment, feature activation, provider call or live deletion occurred.
