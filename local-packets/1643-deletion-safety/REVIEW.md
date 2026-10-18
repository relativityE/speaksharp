# #1643 deletion-safety design and local evidence

**Disposition: proposal delivered; production drain, settlement and activation remain HOLD.**

This answers Sam's 2026-10-18 09:58 assignment. Source baseline is the delivered readback increment `56180c26449ce95d26e1947a9f1e70cff1b75171` (main base `3540103e`); UI references are the separately delivered `06a481a47f973a7fe13feba1488a054b68dc150e`. These historical source pins are not claims about the currently deployed frontend. No application, collector, migration, credential or provider behavior is changed. RWT remains the delivery priority.

## 1. Source-bounded writer and credential inventory

This inventory identifies inspected paths and threat boundaries. It does not establish all historical deployments, external operator sessions, provider dashboards, credential copies or regional workers. Exact scope completeness requires independent authority.

| Inspected path | Effect that can survive a local fence | Credential or authority role, names only |
| --- | --- | --- |
| `backend/supabase/functions/stripe-checkout/index.ts:366–443` | Reserves `begin_account_checkout`, creates a provider Checkout Session with operation idempotency key and SDK retries zero, then records its ID. A create accepted before a lost reply can leave `issuing`/`unknown` and no known session ID. Existing hosted sessions can complete later. | Edge `STRIPE_SECRET_KEY`; `SUPABASE_SERVICE_ROLE_KEY` for operation RPCs; authenticated user JWT for subject identity; `PAYMENTS_ENABLED` is an application switch, not revocation of already-held authority. |
| `backend/supabase/functions/stripe-billing-portal/index.ts:147–173` | Creates a hosted billing/cancellation session for a known customer/subscription. Previously issued portal URLs and actions already accepted through them belong in reconciliation. | Edge `STRIPE_SECRET_KEY`, authenticated JWT and stored billing IDs. Current drain collector pins only checkout/closure, so it must not imply portal/other writers were globally accounted for. |
| `backend/supabase/functions/stripe-webhook/index.ts:74–204` | Delayed, duplicated or reordered events hydrate current subscription data, apply a DB snapshot and settle checkout in separate durable operations. A delivery/ack gap is not proof all accepted billing work settled. | `STRIPE_WEBHOOK_SECRET` authenticates event delivery; `STRIPE_SECRET_KEY` reads provider objects; service role writes snapshots/settlement. Signature verification is separate from writer revocation. |
| `backend/supabase/functions/account-closure/index.ts:31–279` and `_shared/accountClosure.ts` | Cancels subscriptions, deletes customer, retains trial email, removes storage, deletes Auth and verifies residue. Authority checks surround irreversible calls; expiry/revocation after an external call starts cannot retract an accepted call. Auth uncertainty is journaled before DELETE and must not be replayed. | Edge `STRIPE_SECRET_KEY`, service role for DB/storage/Auth, user JWT and single-use emailed action token, pinned runtime attestation/generation. |
| `scripts/billing-qualification/{runner,commercialRunner}.ts` | Test-mode runner source can create/update customers and subscriptions and exercise cancellation. Its source is not evidence these operations ran in production. All independently authorized callers still belong in the role inventory. | Injected qualification Stripe client/credential, deliberately distinct from live Edge ownership. No credential read or execution performed here. |
| `scripts/setup-test-users.mjs`, deployment/maintenance and operator recovery paths | Administrative Auth deletion, schema/deployment/config changes, and request-specific reconciliation may invalidate the context or bypass an application-only wrapper if broadly privileged credentials remain usable. | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, protected production workflow/operator roles. Runtime secret ownership remains Ops-managed per `product_release/OPERATIONS_AND_SECURITY.md`. |

Public browser keys, anon configuration, payment switches, deployment SHAs and evidence hashes do not grant or revoke the privileged write capabilities above. No secret-store query, credential discovery or credential rotation was performed.

## 2. Accepted/in-flight work that must be reconciled

Reconcile the union of durable DB operations, independently enumerated provider objects and independently verified admitted requests. Preserve identities and discrepancies in protected evidence:

1. Checkout `issuing` with no response/session ID; `unknown` transport outcomes; `open` hosted sessions; reused sessions; provider-only sessions; DB-linked sessions absent from the list; objects with conflicting subject/customer/subscription ownership.
2. Checkout completion or other provider processing already accepted before cutoff, including follow-on objects/recovery paths. A `complete`, `paid` or `expired` Session is not a blanket settlement receipt. The current readback deliberately retains these gaps rather than promoting them.
3. Previously issued portal sessions and already accepted cancellation/change requests. Closing new portal creation does not by itself reconcile earlier issued authority.
4. Pending webhook deliveries and a snapshot applied before the corresponding operation-settlement RPC; reconciliation must remain idempotent and must not recreate deleted customer state.
5. Cancellation, customer deletion, storage removal and Auth DELETE with a lost acknowledgment; retained `auth_unknown` records survive Auth removal and require exact-request independent readback.
6. Any other independently identified operator/automation writer. An empty source search, quiet logs or matching supplied inventories cannot prove there were no such callers.

Unknown/open/admitted work remains quarantined. Never reset an ambiguous operation to admit a retry or treat absence from one bounded response as proof of absence. The existing readback bound of 32 direct Session reads explicitly preserves unread IDs and `complete:false`.

## 3. Two designs and the decision boundary

| Design | Required authority | What it could establish | What remains unproven today |
| --- | --- | --- | --- |
| Genuine platform drain/config authority | Authenticated complete deployment/region/writer inventory; authoritative last possible start; effective execution and background lifetimes; verified termination through those bounds; protected effective configuration and before-change invalidation. | The inventoried legacy workers cannot resume privileged effects after the observation boundary. | Current function metadata and responding-instance config probes do not provide that completeness or termination guarantee. A self-authored `terminationVerified` flag/hash is insufficient. |
| Enforced capability boundary | A separately reviewed authority that prevents legacy code from making a privileged external write: exclusive provider-facing broker or equivalent enforcement, per-subject/operation/generation authorization, revocation receipts for every older bypass credential/path, and durable admitted-request records. | Legacy code may remain running but cannot obtain acceptance for a new unauthorized privileged effect through the proven boundary. | No such exclusive boundary or provider-side revocation guarantee is implemented/verified here. Adding an SDK wrapper or checking the DB before a call is insufficient while old workers retain usable direct credentials. |

**Recommendation:** pursue a bounded feasibility/source contract for the capability alternative if genuine platform completeness is unavailable. This is a design proposal, not selection or permission to rotate credentials, deploy a broker, change networking or weaken the present attestation schema. Keep both routes HOLD until their actual enforcement/provenance contract is reviewed.

Capability cutover must be more than a generation number:

- Establish every legacy write path and privileged credential role; prove old direct paths denied at the actual external authority. Revocation must cover existing isolates and credentials they captured, not merely a changed environment for new instances. Out-of-band/admin bypass uncertainty keeps HOLD.
- Authenticate broker callers and bind exact target, provider account/mode, user/customer/subscription, operation, allowed action and current generation. No caller-selected URL, arbitrary provider payload or cross-account operation.
- Commit admission and an operation/idempotency identity durably before dispatch. Revoke new admission under the same authoritative subject fence; keep already admitted calls in a durable outstanding set until independently reconciled. A response timeout must remain unknown, with no blind replay.
- Treat enforcement and external acceptance as distinct moments. A request accepted before revocation can finish afterward; no deletion-success/no-future-effect claim is allowed until those admitted effects are settled. Crash recovery must preserve that set.
- Cover DB/storage/Auth effects as well as Stripe if they can violate deletion finality. Narrow provider credentials alone do not retire a legacy service-role writer. Existing hosted sessions/portal actions and webhook producers also need a reviewed disposition.
- Bind each verified transition to release/config/generation; invalidate before supported change; reject stale, partial, wrong-account or unavailable proof. Keep independent evidence acquisition separate from structural validation and registration.

## 4. Implementation boundaries and acceptance invariants

Do not alter `accountClosureCurrentFacts.collectCurrentFacts` to return complete context from its partial observations. Its unconditional refusal is intentional. Keep acquisition/readback, independent provenance verification, structural validation, registration, activation and customer deletion separate.

Suggested sequential increments, after design selection: (1) reviewed authority/enforcement contract and source-complete role inventory; (2) one exclusive admission/revocation boundary plus durable outstanding-call journal; (3) independent provider/DB accepted-call reconciliation, preserving provider-only objects; (4) authenticated producer integration with the existing ten-second transport, generation recheck and one-mutation/no-replay semantics; (5) separately qualified customer UI and scoped live acceptance. Each requires its own concrete scope/review; this proposal does not authorize implementation changes to production surfaces.

Fail-closed invariants: no unknown scope silently excluded; no elapsed-time/log-silence drain inference; no digest substitutes for independent truth; no accepted call disappears from reconciliation; no DB phase alone proves settlement; no context drift permits registration; no uncertain irreversible action is automatically replayed; no REGISTERED/offline-valid result authorizes activation. Global absence/finality is never inferred from a sample.

## 5. Executable local evidence and missing successor tests

Run from the repository root:

```sh
node --test local-packets/1643-deletion-safety/negative-cases.test.mjs
```

This uses the actual existing structural validator and registration service with synthetic fixtures, no network and no credentials. It covers verified-termination absence, guessed lifetime, background execution exceeding observation, omitted/new legacy scopes, incomplete provider pages, optimistic settlement of unknown work, DB-settled without provider disposition, enabled payment switch and unavailable independent authority with zero registration calls. Positive control preserves quarantine and `activationAuthorized:false`. A characterization deliberately supplies a fabricated empty operation inventory: structural validation alone accepts it as OFFLINE_VALID, still with no activation. That illustrates why independently authenticated completeness is indispensable; it is not a new collector bypass or a live proof.

Executed 2026-10-18 at this packet checkpoint: **12/12 PASS**, runner exit 0, with no network or live mutation. The first runner launch exposed a packet import-path typo, corrected before the passing run. No production source was changed. These checks qualify the bounded evidence packet only, not the proposed unimplemented capability system.

Existing unchanged source/test evidence: 186 boundary tests plus full quality on `56180c26` ([receipt6248385002](https://github.com/relativityE/speaksharp/issues/1643#issuecomment-6248385002)); UI 59 focused tests, two browser journeys and quality/build on `06a481a4` ([receipt6248300893](https://github.com/relativityE/speaksharp/issues/1643#issuecomment-6248300893)). These prior checks were not repeated or relabeled as current-main/production qualification.

Required executable adversarial cases for a future capability implementation are explicitly **not yet implemented**: legacy direct-key call after revocation; request paused between admission and external acceptance; acknowledgment lost after acceptance; crash after durable admission; stale/cross-subject/duplicate capability; credential/config change without generation invalidation; provider-only follow-on object; retained portal action; webhook arriving after deletion fence; legacy service-role DB/storage/Auth write. Their assertions must measure denial at the actual mocked provider boundary and preserve every admitted unknown in the real journal. A toy model passing cannot establish the proposed system exists. Live enforcement still needs separately scoped verification.

## 6. Customer entry while backend HOLD

UI increment `06a481a4` adds `/account/delete` and a Pricing entry for a signed-in profile. It does not contain a global capability/readiness gate that would make a backend HOLD disappear. Request/confirm errors remain unverified; a proven refusal is distinct from deletion; pending/unknown confirmation suppresses both replay and a new link across SPA remounts; late responses cannot sign out a later account. The guard is in-memory SPA state, not durable cross-reload/backend reconciliation.

Therefore the delivered UI must not be described as an operational deletion service merely because it passes local tests. Keep it unpublished while backend HOLD unless the release owner explicitly accepts and qualifies an unavailable entry behavior/copy. If that unavailable experience is selected, implement a separate reviewed readiness surface that states deletion is unavailable before offering verification; do not disguise missing global proof as an expired token or promise a successful deletion. Membership cancellation remains distinct and never schedules account deletion.

Actual email delivery/token use, hosted cancellation/period-end/no-future-charge, Auth/sign-in refusal, DB/FK/storage residue and human/device acceptance remain open. No issue acceptance checkbox is closed by this packet.
