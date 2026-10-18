# #1643: account-only pending → settlement → deletion

Not ready for live deletion. The final policy is settled; the required admission and
settlement implementation is incomplete. This packet delivers the narrowed source
sequence requested by Sam, not a completed implementation or operational approval.

Requirement: https://github.com/relativityE/speaksharp/issues/1643#issuecomment-6251767298
Source inspected: UI reconciliation `79575fdcda70c0e038df5121872fe02667b285fb`,
which contains main `968e67a45604cab23cb2aa5b82035471182c3ee1` and the existing UI work.
Reuse design `9b0392e2d7bfcd1851cd9518740c0571930036f5` only where consistent with the
final requirement. Earlier global worker-death prerequisites are superseded.
No UI rebase, competing App lifecycle patch, production mutation or new PR in this packet.

## Actual navigation and confirmation story

| Boundary | Implemented/source evidence | Missing or unverified |
| --- | --- | --- |
| Enter deletion page | `frontend/src/App.tsx:433`: `/account/delete` is outside `TranscriptionProvider`; Session is wrapped at line 444. `AccountDeletionPage.tsx` invokes only account closure, not STT/coaching. | Globally mounted `ProgressReconciler` at `App.tsx:369` can still start account background reconciliation. Page navigation is not a server admission fence. |
| Leave Session | `useSessionLifecycle.ts:109` awaits the controller's bounded stop/save/retirement before releasing that take's lease. Its unmount effect starts this asynchronously at line 1315. `SpeechRuntimeController.ts:5083` retires pending Start, attempts stop/save and checks actual engine termination. | React route completion does not await this promise. Engine-terminal evidence alone does not prove every pending save/provider operation settled. App owns the shared teardown/telemetry contract; CLI consumes it. |
| Verification and destructive confirmation | `AccountDeletionPage.tsx:57` requires owner, emailed token and checked acknowledgment; sends `confirmIrreversible: true`. Core SQL verifies confirmed normalized email, unused token and expiry. Issuance alone does not mark pending. | The UI attempt store is in memory. Reload/other tab needs authenticated server status; no destructive confirm replay. |
| Durable pending | Core `claim_account_closure_token` in migration `20261013180000_account_closure_tokens.sql:300` locks profile then account advisory lock, validates token and checks outstanding checkout **before** creating the closing fence/attempt. Enforcement wrapper in `20261016180000_account_closure_drain_enforcement.sql:154` delegates to it. Edge `account-closure/index.ts:117` additionally performs checkout readback before claiming. | Busy/unknown checkout can refuse before any durable pending intent exists. `finish_account_closure_attempt` at core line 340 marks failed and reopens admission; final policy requires confirmed pending to remain pending through uncertainty. |
| New activity versus completion | `begin_account_checkout` serializes using profile row → account advisory lock and rejects closing accounts. Checkout operations already record issuing/open/settled/unknown. | Existing closing guards also reject admitted expiry/completion/profile attachment. They cannot simply be moved earlier. Start, portal, coaching and background work lack equivalent deletion-pending admission/settlement enforcement. |
| Delete and verify | `_shared/accountClosure.ts:64` verifies checkouts, cancels/re-reads subscriptions, settles billing, deletes customer, preserves trial identity, removes storage, journals Auth uncertainty and checks residue. Edge rechecks request-bound authority around irreversible calls. | No proof that already accepted save/Gemini/portal/background work is settled before these stages. Existing billing settlement, Auth-unknown journal and residue checks must remain. No live acceptance is established here. |

## Smallest complete implementation sequence

One coherent source increment must distinguish **new admission**, **completion of
previously admitted work**, and **final deletion**. Do not enable a pending-only slice
that still admits unfenced work or rejects the completions needed to finish deletion.

1. **Persist verified intent before waiting.** Add a forward migration extending the
   existing account fence/closure attempt, not an unrelated global capability system.
   Under the existing profile-row → account advisory lock order, verify account/email,
   token and explicit destructive intent, consume that verification once and atomically
   persist account-only pending with immutable request ownership. Pending can outlive
   the token's original expiry; a new authenticated status read is not another destructive
   confirmation. Missing billing identity, unresolved provider work, timeout and lost HTTP
   response retain pending. Replace the normal `finish` reopening behavior for confirmed
   intent; preserve the stronger `auth_unknown`/`auth_deleted` journal and no-replay rules.
   Rework the request-bound enforcement wrapper so routine deletion does not require
   unrelated users or globally all workers to stop. Never bypass existing checks by
   setting a legacy drained boolean as proof of the new policy.

2. **Make admission atomic and account-scoped; retain admitted completion.** Reuse
   `account_checkout_operations`, request-bound billing permits and recording/session
   identities. The pending transaction and each new admission must use a consistent
   account lock order, so one wins; a preflight `SELECT` followed by provider invocation
   is insufficient. Checkpoint the following concrete writers together:

   | Writer | Admission boundary / accepted operation | Required narrow change |
   | --- | --- | --- |
   | New Start | `acquire_recording_lease` in `20260607040000_active_recording_lease.sql`; client `recordingLease.ts:48` | Reject pending on the server before engine preparation, bind accepted take to existing lease/intent. Review direct authenticated lease-row RLS mutation and legacy missing-RPC fallback so clients cannot bypass the invariant. A 15-second heartbeat expiry is not proof a save or provider task finished. |
   | Save, attribution, Progress | Existing take/session identity; `SpeechRuntimeController.ts`, session-save RPCs, `attest-session-engine/index.ts`, `services/progress/recordProgress.ts` RPCs | Permit terminal writes for an admitted take/session; reject new unrelated account activity. Preserve Retry Save evidence. Ordinary transaction/FK-protected writes do not need a global worker-death proof. Inspect direct table/storage policies as well as RPCs. |
   | Checkout | `begin_account_checkout`, record/reconcile/settle functions and canonical webhook billing trigger in core migration | Reject new reservations/reuse after pending. Allow only exact operations admitted before pending to finish, reconcile and attach their authenticated canonical billing result. Preserve ownership, idempotency and complete provider readback. The current closing guard blocks those completions and must be split from final destructive freeze. |
   | Billing portal | `stripe-billing-portal/index.ts:160` creates a Stripe portal session after auth/profile lookup | Reserve a request-bound account operation before provider create; reject new portal admission while pending. Account for an already issued portal session's later external actions; an HTTP URL response is not proof that provider-side billing authority has ended. Reconcile/revoke with supported provider semantics before deletion; unknown remains pending. |
   | Coaching | `get-ai-suggestions/index.ts:762` usage check, provider invocation around 828, persistence around 995 | Bind an account/request operation before sending provider work; reject new request/retry admission after pending, including cache/fallback paths as appropriate. Record provider response plus persistence or independently reconciled terminal failure. Keep accepted requests able to finish. Diagnostic lifecycle telemetry is correlation evidence, not the durable settlement authority. |
   | Background recovery | `useProgressReconciliation.ts` and its RPCs | On deletion entry stop scheduling new recovery for that account. Keep exact previously admitted completion/reconciliation possible. Re-read durable account status on reload/other tabs and enforce on server; browser broadcasts only improve UI responsiveness. |

   Where existing identities do not cover an external operation (coaching/portal),
   add only the bounded per-account operation record needed to establish admission,
   provider identity and settlement. No elapsed-time or process-exit shortcut to settled.

3. **Connect navigation and durable status.** Reuse `AccountDeletionPage.tsx` and
   `accountDeletionAttempts.ts` from `79575fdc`. Add pending/settling/status handling,
   keep explicit confirmation separate from email issuance, and hydrate server status
   on owner change/reload. Consume App's owner/take-bound teardown promise and correlated
   coaching lifecycle; do not implement a second Session lifecycle. Entering deletion
   starts no STT/LLM or new background work. A user can read pending status while accepted
   work finishes. An unmount, StrictMode replay, delayed response or lost response never
   restarts destructive execution. Keep the page factual while billing/provider state is
   unknown; no premature success or automatic account reopening.

4. **Close only after account settlement.** Under the same admission fence, verify
   no unsettled admitted operations and complete billing readback. Then advance to a
   final destructive phase, retain existing irreversible-call authority checks and run
   the existing billing → customer → storage/Auth → residue flow. Check final DB/storage/
   Auth absence and sign-in failure using the separately authorized acceptance account.
   A durable resumable executor may continue the same confirmed request after settlement;
   it must reconcile the journal before any retry, especially an unknown Auth outcome.
   Account B's admissions and accepted work remain independent throughout.

## Bounded legacy checkout exception

The specific exception is a direct Stripe checkout worker admitted by an older route
without `begin_account_checkout`, potentially before a customer exists. Before enabling
this source increment: identify the exact legacy checkout producer/revisions and cutover,
stop new admissions through that producer, bound its previously accepted requests, and
reconcile their Stripe sessions by verified account ownership (including customer-null
cases). Unknown legacy ownership/outcomes hold affected deletion pending. Record exact
cutover and reconciliation evidence. This is not a shutdown of STT/coaching or other
users, and does not repeat the completed 44-account cleanup. No cutover was executed here.

## Evidence delivered and required regression

Executed five deterministic PGlite controls against the **verbatim core migration**,
with the minimal schema fixture used by the existing integration suite. Command:

```
node scripts/host-interlock.mjs hold local -- node --test --test-concurrency=1 --test-reporter=tap --test-reporter-destination=local-packets/1643-account-pending-sequence/source-characterization.tap local-packets/1643-account-pending-sequence/source-characterization.test.mjs
```

5/5 PASS. Saved TAP is adjacent. These are characterizations of current behavior:
email-only leaves admission open; busy checkout leaves no pending intent; settled
checkout allows closing A while B admits; current finish reopens A; merely moving
the existing closing fence earlier blocks admitted expiry settlement. They do not
demonstrate the proposed fix, execute the full 118/119 wrapper chain, prove concurrent
production locking, or establish live customer-exit acceptance.

Reuse the existing UI 71-test/quality evidence at `79575fdc` as historical evidence
for that UI surface, not proof of the new backend semantics. New implementation needs:

- Real PostgreSQL two-connection races: pending versus Start/checkout/portal/coaching;
  either admission wins and is counted, or pending wins and no provider call begins.
- A pending while B continues each relevant path; no global coordination gate.
- Delayed accepted save/Gemini/checkout/webhook/portal completion settles under pending;
  final deletion waits; duplicate callbacks cannot reopen or double settle.
- Route away during recording/preparing/save/coaching; actual teardown joined to deletion
  readiness, no new route work, background recovery distinguished from admitted completion.
- Other tab, reload, old bundle/direct RPC/RLS/storage calls and retries cannot admit new
  work for A. Server-read status preserves pending after lost confirmation reply/token expiry.
- Provider timeout/lost response and Auth-unknown stay pending without automatic destructive
  replay or reopening; existing billing settlement/trial retention/residue regressions stay.
- Exact candidate migration dry-run/full-chain checks, focused UI/Edge/DB integration,
  repository quality and required exact-head CI/review, then scoped authorized live
  DB/storage/Auth/sign-in acceptance. None of that live evidence is claimed by this packet.

App dependency: Session stop/save/teardown and coaching lifecycle contract. CLI owns
the deletion/admission/settlement integration and this sequence. No interactive permission
block prevents source work; no migration apply, deployment or live deletion is authorized
by this evidence packet itself.
