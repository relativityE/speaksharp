# One-time bounded SpeakSharp comparison

> Current PR #1760 checkpoint: [handover and finding status](../../docs/model-evaluation-handover/README.md).
> Original run guard expired 2026-10-31 at 14:02:19.005 UTC. One recording Start was consumed,
> zero valid measurements obtained. Do not execute the historical packet; future live work
> needs new bounded authorization. This document's earlier setup/status claims are historical.

Refs #1565 / PR1760. Prepared source and offline controls are not live-run authority.
Reuse the existing `attachProductEvidence` collector and `wordErrorRate` scorer;
there is no second evaluator. Current product default stays `v2:base.en`.

This successor corrects two source-contract defects: registration now declares the
captured warmed service's modelName (missing metadata never substitutes Whisper),
and the existing collector reads canonical exact-session authority rather than the
legacy sessions.attribution_status field, which remains pending. The authority
table already grants authenticated own-user SELECT. It must match attrib_v1,
Private class/engine, generic transformers-js provider, exact selected model/version,
browser device, frozen session and actual completion/save/reopen content hashes.
No Granite/Parakeet provider rejection was observed: the actual client sends generic
transformers-js and deployed policy accepts it. No provider-policy/schema change,
new database grant, response rewriting or production selector change is needed here.
The authority records declared identity, not server introspection of loaded weights.

The launcher requires a separate SHA-bound read-only backend-contract receipt with
status COMPATIBLE, exact client source/API binding, matching selected-model
declarations and `canonicalAuthorityExactSessionRead:true` for all three models.
The old `sessionRowVerifiedFromAuthority` predicate is rejected. The retained old
receipt remains BLOCKED; it is not made compatible by this patch. Independent
review of the corrected exact source/API binding must precede execution.

## Valid test-user setup (known factory; not executed by this source task)

Read `scripts/make-test-user.sh` and `.github/workflows/setup-test-users.yml`.
When separately authorized, `pnpm make:test-user free|pro` uses hosted Admin –
Test Users `action=create`; the service-role key stays in GitHub Secrets. Default
output is local gitignored `frontend/.env.test`: Free `FREE_TEST_EMAIL/PASSWORD`,
Pro `E2E_PRO_EMAIL/PASSWORD`. This evaluator instead consumes `EVAL_TEST_EMAIL`
and `EVAL_TEST_PASSWORD`; map only the selected disposable identity into that
process securely, never dump the env file or print values. No `--print-password`,
maintained password hunting, secret export, setup/default action, sync_reviewers,
password rotation, delete/recreate or SOAK_TEST_PASSWORD change.

The wrapper sleeps six seconds then picks the newest run, which can be another
dispatch. Verify gh/api.github.com connectivity before an authorized dispatch and
correlate its exact run, inputs, source and result; do not trust latest-run selection
or wrapper success alone. A connectivity failure is not account creation.
`action=verify, verify_target=reviewers, password_action=use_existing` inspects
auth/profile/stored tier/history; it does not establish actual sign-in/effective
entitlement. Stored Free can have an active Pro trial. Verify selected account,
effective usage/entitlement and empty retained history before a measurement;
deletion/recreation does not renew a trial. Verify runtime/browser/cache prerequisites.

Also inspected at fbfa9d6711458fc0b382e65dd1d4d39d2d44580b:
`.github/workflows/setup-throwaway-test-user.yml` uses secret-backed
`THROWAWAY_TEST_EMAIL/PASSWORD`, create-only `throwaway_free` via
`scripts/lib/canaryAccountAdmin.mjs`, refuses existing/uncertain identities and
verifies authenticated identity/account foundation. This is another established
provisioning route, not authorization to dispatch it or export its protected
secrets. Its hosted workflow does not launch this local evaluator or inject its
EVAL_* contract. A hosted consumer would need separate reviewed integration;
this source task does not add one. Account factory availability is not a blocker;
selection/authorization, exact consumer binding and retention approval are pending.

## Timing evidence

The passive collector captures trusted native Start/Stop clicks before handlers;
the driver never timestamps intent after click() returns. Start-to-RECORDING uses
one page clock; Stop-to-completion uses page timeOrigin plus the native click and
the completed request's full-body network timing. Invalid/missing clocks stay null
and aggregate as NOT RUN, never clamp into a fast measurement. Exact persisted
read round trip and reopen navigation-to-matching-transcript hydration are separate
harness wall times. Reopen uses the harness monotonic clock, avoiding page resets.
Before navigation, fresh same-capture __PRIVATE_TIMING__ supplies finalize decode,
wait/prep, decodedUtteranceSeconds and RTF; raw utteranceSeconds is not its ruler.
peakBufferedSeconds is buffer duration, not memory. Acquisition data is projected
inside the page from fresh matching candidate/release analytics queue entries;
only content-free totals, completeness/cache and complete init measurements leave
the page. No queue flush or analytics send is initiated. Missing/drained telemetry
is NOT RUN. Total/init include acquisition/cache/pinning/warmup; selector wall time
is distinct. Fresh contexts do not prove isolated cold/warm performance. Memory,
Focus and coaching remain NOT RUN. Each aggregate includes actual sample count.

## Population and enforced ceilings (proposed for explicit approval)

18 Open Mic takes = 3 registered models × 3 existing synthetic fixtures × 2 trials.
Order: trial, clip, then incumbent / Parakeet / Granite; installed headed Chrome,
sandbox enabled, fresh context per take, one worker, no retries, stop on first failure.
The existing case limit is 420 seconds. Whole run is capped at 7,680 seconds (128
minutes), including source checks and disposal. The approval expires no later than
128 minutes after admission. No failed login is automatically retried.

At most 180 API requests / 120 mutation requests per take, and 3,240 / 2,160 for
the run. Endpoint ceilings per take, including retries:

Loopback application/source GETs are separately capped at 3,000 per take / 54,000
total, verified cached-asset requests (including redirects) at 100 / 1,800, and
the loopback HMR WebSocket at 4 / 72. Thus all admitted HTTP requests are bounded
by 59,040, plus at most 72 loopback WebSocket connections. No external model
request is forwarded: exact registry-pinned URLs are fulfilled solely from the
hash-verified retained asset receipt through a temporary loopback byte server.
HTTP/WebSocket admission is installed on the entire fresh browser context,
including dedicated-worker requests; service workers are blocked.
Every admitted HTTP transfer uses route.fetch(maxRedirects:0,maxRetries:0); all
3xx responses are rejected before browser fulfilment. There is no route.continue
or browser-visible cached-asset redirect. Cache delivery explicitly admits both
the intercepted pinned request and its local transfer, then fulfils the original
request directly from the non-redirecting cache response. Real installed-Chrome
loopback controls exercise 301/302/303/307/308 and a redirecting cache endpoint.

| Endpoint / operation | Cap | Mutation |
| --- | ---: | --- |
| Password login / token refresh | 1 / 2 | Auth only |
| API REST/auth GET reads combined | 40 | No |
| CORS preflights for allowed methods/endpoints | 40 | No; included in aggregate API cap |
| check-usage-limit | 8 | No (source access check) |
| attest-session-engine register / bind / terminal evidence | 1 / 1 / 2 | Yes |
| acquire / heartbeat / release recording lease | 1 / 85 / 2 | Yes |
| create_session_and_update_usage / complete_session_v2 | 1 / 2 | Yes |
| heartbeat_session | 14 | Yes |
| record_progress_evaluation / record_progress_recommendation | 4 / 2 | Yes, run-owned sessions only |
| get_progress_obligations / get_analytics_summary / get_practice_streak | 10 / 2 / 2 | No |

These maxima are reviewed safety ceilings, not estimates or claims of actual
request counts. The stricter aggregate ceiling applies even if individual budgets
remain. Blocked requests poison the result and are not forwarded. Unknown RPCs,
all other Edge calls, explicit DELETE/PATCH/PUT, account creation, force-taking a
lease, settings, provider HTTP/WebSockets, external model/CDN requests and unbound
session mutations are refused. Only the bound loopback root Vite HMR socket is
permitted; all external or other WebSockets fail closed. No progress gate is bypassed. If normal product
behavior needs another operation, stop and review it; do not widen automatically.

The first take requires an existing, dedicated, authorized test account with zero
sessions. Later preflights admit only this run's previously completed IDs. Select
that account through secure injection; never print credentials or read the old
invalid local credential files. Auth response and own-user check must match the
approved private user ID before any recording operation. No service-role key.

## Retention is a real effect requiring approval

No account/session deletion or cleanup command is implemented. Session creation
and completion write rows, usage, lease/attribution and ordinary product Progress
state. `complete_session_v2` also applies the existing server newest-one retention:
earlier run transcripts/PDFs may be stripped as later takes complete. A shared
account's prior transcript must not be put at risk; hence the empty-account guard.
The deployed expiration routine also deletes recovery tombstones. Eighteen
successful replacements can irreversibly expire 17 earlier run transcripts;
there is no tombstone-based recovery promise. This is unresolved under the current
no-deletion instruction and still needs a separately explicit decision.
Approve this normal server retention effect explicitly for the 18 synthetic takes.
Retain resulting session/usage/Progress rows; do not promise 18 durable transcripts.
Each take is read/reopened before the next completion. Private artifacts retain
hashes, counters and scores, not raw audio, text, tokens or account IDs.

## Minimum secure binding / exact-source packet

The parent must provide a reviewed approval JSON with `schemaVersion:1`,
`decision:"APPROVED"`, a unique runId, sourceHead, sourceDeltaSha256,
sourceUntrackedSha256, driverSha256, assetReceiptSha256, backendContractSha256, appOrigin, apiOrigin, expectedUserId,
an opaque accountReference, expiresAt, takes:18,
retention:"EMPTY_EXISTING_TEST_ACCOUNT_NORMAL_NEWEST_ONE", maxApiRequests:3240,
maxMutations:2160, wholeRunMs:7680000. Null/missing/PENDING fields refuse execution.
This is an execution input, not an authorization minted by the runner.

Securely inject EVAL_TEST_EMAIL/PASSWORD for that existing account in the bound
HTTPS API project. Bind the loopback app to localhost or 127.0.0.1 port 5173/5174
(the existing CORS allowlist). Set EVAL_APP_URL, EVAL_API_ORIGIN, EVAL_SOURCE_ROOT,
EVAL_RELEASE_SHA, EVAL_SOURCE_DELTA_SHA256, EVAL_SOURCE_UNTRACKED_SHA256,
EVAL_EXECUTION_APPROVAL_FILE, EVAL_ASSET_CACHE_RECEIPT, EVAL_BACKEND_CONTRACT_RECEIPT, VITE_SUPABASE_ANON_KEY
(existing public project key) and a fresh absolute EVAL_PRIVATE_OUTPUT outside the
source tree. The launcher owns a fresh strict-port Vite child on the approved
loopback origin with BUILD_ID=HEAD, VITE_INTERNAL_BUILD=true, real auth/persistence,
no mock handlers, disabled telemetry keys, and existing
approved pinned cached model assets. The private asset receipt maps the complete
28-entry current registry inventory to retained local files and is SHA-bound in
approval. All byte sizes and hashes are verified before serving; application
loaders retain their own pin checks. Only original exact pinned requests may
receive verified cache bytes, without a browser-visible redirect. External asset fetches are blocked; this
does not authorize downloads or dependency installation. Confirm cached inventories
and frozen dependency readiness before slot handback. Do not copy real env files.

SHA conventions: delta = SHA256 of `git diff HEAD --binary`; untracked = SHA256 of
sorted nonignored `relative_path:file_sha256\n` lines. Driver SHA256 is over these
alphabetically sorted relative filenames and file hashes, using the same line
formula: all fifteen declared files under tests/model-dropin, in alphabetic
basename order (the exact array is retained in inAppComparison.live.spec.ts).

Invoke from the fixed shared coordinator `/Users/fibonacci/Documents/Codex/2026-10-29`:

```sh
node <candidate>/scripts/host-interlock.mjs hold benchmark -- \
  node --import <candidate>/node_modules/tsx/dist/loader.mjs \
  <candidate>/tests/model-dropin/run-bounded-comparison.mjs
```

The launcher and its Vite/Playwright children are protected by the same ancestor-held
host-wide slot. An occupied app port is refused before spawning; no existing server
is reused or killed. Do not claim a checkout-local lock. Signals terminate only
owned process groups. Chrome is launched through launchServer so its separate
process group is explicitly owned and registered, then Playwright connects to that
temporary loopback browser. A durable cleanup-exclusion record is created before
any job. Existing interlock checks refuse it even if the launcher/outer wrapper
dies. Workload caps are unchanged; timeout stops work, not cleanup exclusion.
Cleanup may return only when every registered group is verified absent and
ownership is complete. Unknown/EPERM/incomplete ownership retains the barrier and
parent process; it never returns cleanupUncertain and exits. Removing an uncertain
barrier requires an explicit guarded operator handoff after proof of owned absence.
No monitor, deployment, merge or public post is included.

## Evidence and offline validation

The driver checks release and served raw source against the existing source-binding
inventory before login, plus Git delta/untracked identity before execution and
source equality after each take. It attaches the existing collector before Start,
calls freezeTake after save before navigation, reopens the exact saved ID, calls
observeReopened and finish, and requires PASS. A matching saved transcript without
the complete verified engine/version/model/device tuple cannot pass. Declared
identity is not loaded-weight introspection. Tiny clips may lack required live
partials; retain HOLD/failure rather than relaxing collector assertions.

Run the existing repository Vitest configuration over comparisonBounds.test.ts and
productCollectorIntegration.test.ts, plus the existing product collector controls.
Negative controls cover missing/wrong attribution, save/reopen substitution,
foreign account/session/lease operations, provider/download escape, excess endpoint
and take counts, deadline expiry and incomplete populations. They are synthetic
controls, not product or model evidence. Live output has 18 complete expected keys
or it is INCOMPLETE_OR_FAILED; aggregate WER is null without six verified rows per
model. Qualification always remains HOLD pending real corpus/policy acceptance.

Completion content comes from the real complete_session_v2 request and retained
response outcome; selectedForSaveLength is diagnostic only and is not compared as
content. The existing collector still requires exact completion/persisted/reopened
hash equality, including same-length substitution controls. Node transport controls
use synthetic loopback HTTP servers and isolated installed Chrome with no model or
account. Node cleanup controls exercise a TERM-resistant detached descendant,
uncertain ownership and a killed runner whose outer host wrapper exits while the
durable exclusion remains. Those controls are not live product proof.
