# AHT-07 crash-safe cleanup: a durable run ID recorded in Supabase first (2026-11-11, rev 6 on 2026-11-12)

Status: design only. Read from `main` at 01b125c and draft PR #1811 at 6faef30. Nothing was run, written or pushed; no production read. Rev 2 checks the design against Sam's Slack conditions (2:21 PM ET). Rev 3 inventories the ids the app and Supabase already create at app or session start (section 3) and adds a session-based design, D, that needs no new table (section 4). Rev 4 merges A and D into one design, E, after Sam's review (section 0), and proves the fence on a local PostgreSQL. Rev 5 closed Sam's second review (section 00). Rev 6 follows Sam's answer of 2026-11-12 that a Supabase login session id is not a safe recovery key: **design F (section 000) is the recommendation; sections 00, 0 and 2 to 4 are history.**

## 000. Rev 6: design F, a run-owned id tied to the exact report idempotency keys

Sam (relayed 2026-11-12): "A Supabase login session ID alone isn't a safe recovery key and adds unnecessary linkability. Use a run-owned ID tied to the exact report idempotency keys and a durable settlement record; don't store login tokens." F does exactly that and drops the login session id E stored.

Local only: branch `aht07-run-fence-proof`, head `7b03d310a53ee6bbc226007622ddc2f0aaa834c6` (three commits on 01b125c, not pushed). `timeout 400 node --test tests/db/aht07-run-fence.realpg.mjs` on PostgreSQL 16.15: 10 of 10 pass; 15 of 15 single-guard mutants caught. Files, full diff, outputs and mutants: `speaksharp/aht07-run-fence/` (E rev 2 kept under `rev-e2/`).

How F works:
- **Run record (`ct_runs`)**: registered by the service role before the account exists (repository, workflow, run id, attempt, test id, email, key cap). Signup records the account uid on it inside the account-creation transaction (trigger on `auth.users`, as in E). No FK, so it outlives the account and becomes the tombstone. States: registered, open, fenced, settled.
- **Exact keys (`ct_run_keys`)**: the app already gives every Share feedback draft a random `idempotency_key` (unique index, `20260904150000_share_feedback_redesign.sql`) and keeps it in the tab's `sessionStorage` under `feedback.draft` before Send. The runner reads that key and registers it on the run (service role) before pressing Send. Up to the cap; null, duplicate, already-used or post-fence keys are refused.
- **Admission**: a report insert by a run-owned uid (the request's own uid, not `user_id`) is admitted only while the run is open and only under a key registered to that run; any other identity, including the service role, is refused a run key. Admitted inserts hold the run's shared lock to commit. No session, token or JWT value is stored or compared.
- **Fence**: takes the run's exclusive lock and closes key registration; it returns only after every admitted insert has ended, and every later insert by that uid is refused (any session, user_id NULL, after deletion).
- **Settlement**: after the account is deleted, one transaction deletes exactly the rows holding the run's keys and records each key as `deleted` or `absent`, plus totals on the run. The inventory is the pre-registered keys; the caller supplies none. A second settler gets the recorded result. That per-key record is the durable settlement record, including the zero-key run.
- **No new column on `user_issue_reports`**: the link is the existing unique key, so the report table gains only a trigger. Keys of run rows can't be changed by any role.

What it fixes from E: no login session id (linkability), and lost responses are now exact: a key registered but never committed settles as `absent`, a committed one whose response was lost settles as `deleted`.

Mapping to Sam's negatives: run-owned user_id NULL insert (T6, T2); signup or other-session token before keys, after fence, after deletion (T2, T6, T7); token with no session claim (T2, T6, T9); forged or foreign key, including a real user or the service role using a run key (T2, T8); admitted insert during fence and delayed insert (T3); client killed mid-write (T4); fence timeout HOLD (T5); key immutability under a permissive UPDATE policy (T6); signup crash and fence racing signup (T7); lost response, two fencers, two settlers, crash after deletion, N vs N+1, zero keys, real user untouched (T8); excess keys at cap (T2); grants, `search_path`, PUBLIC execute, no session or token columns (T1).

Mutants caught (first failing test): m01 writer without shared lock (T3); m02 state read before lock (T3); m03 unregistered key admitted (T2); m04 fence without exclusive lock (T3); m05 keyed on user_id (T2); m06 run key usable by others (T2); m07 key registration after fence (T2, T3); m08 steps client-executable (T1); m09 key mutable (T6); m10 settle while account exists (T7); m11 signup onto a fenced email (T7); m12 registration without email lock (T2); m13 no account-gone check (T6); m14 key cap unchecked (T2); m15 settle not serialized (T8).

Still open, not claimed:
- **Harness change (not built)**: read `sessionStorage['feedback.draft'].idempotencyKey`, register it, press Send; optionally assert the outgoing insert carries that key. If the app rotates the key (a failed Send then an edit), the database refuses the new key and the runner registers again or holds. Inferred from `IssueReportDialog.tsx` and `feedbackDraft.ts`, not run.
- **Hosted gates**: GoTrue inserts `auth.users` in a transaction that a failing AFTER trigger aborts; the migration owner can create that trigger (repo precedent exists); current grants on reports. Read-only checks.
- **The run record holds the test account's uid** (needed to refuse that account's unkeyed writes). It is a disposable account's id, not a login session or token; Sam should confirm that is acceptable linkability.
- **Scope**: two tables, an `auth.users` trigger, a reports trigger and six service functions, beyond Elon's column-and-trigger approval (though F adds no report column).
- **Sam's item 1** asks for a durable private test-runner store for AHT-07. F keeps the record in Supabase, per Akin's earlier "not a shadow storage". Whether F's record is that store is for Akin and Sam to settle.
- AHT-08 needs its own code changes; F covers AHT-07 only.

## 00. Rev 5: E rev 2 after Sam's second review, and the local proof

Local only: branch `aht07-run-fence-proof`, head `637fe2def020bc0007a94fcaaeadbae9f5079fa5` (base 01b125c, two commits, not pushed, no upstream). Files: `tests/db/aht07-run-fence.{proposed.sql,fixture.sql,realpg.mjs}`; copies, the full diff (`aht07-run-fence.patch`), the test and mutation output and the 13 mutants are in `speaksharp/aht07-run-fence/`. PostgreSQL 16.15, Node 22.23.4, `timeout 400 node --test tests/db/aht07-run-fence.realpg.mjs` gives 10 of 10 pass (9 subtests). Nothing touched #1811, any hosted database or Slack.

What changed from rev 4:
- **Identity is the request's uid, recorded at signup.** An `AFTER INSERT OR UPDATE OF email` trigger on `auth.users` (repo precedent: `on_auth_user_created_trial_profile`, `account_save_delete_guard`) writes the new uid onto the registered run inside the account-creation transaction, state `claimed`. No token for a run-owned account can exist before the database knows it is run-owned, and the uid stays on the run (no FK) after deletion. The report trigger keys only on `auth.uid()`, never on `user_id`.
- **Every non-permitted token is refused for a run-owned uid, in every state:** claimed (prebinding/signup token) gives `ct_run_unbound`; open with another session or no `session_id` claim gives `ct_run_session_mismatch`; fenced or closed gives `ct_run_fenced`; open with the account already deleted gives `ct_run_account_gone`. The old email join, which fell through to ordinary-user behaviour after deletion, is gone.
- **Serialization.** Registration and signup take the same per-email transaction lock, so an account can't appear for a run unrecorded. Bind and fence take the run's exclusive lock and the run row lock; signup's claim updates the same row, so a fence racing signup waits and then records the uid, and a signup after the fence is refused (`ct_run_email_not_claimable`). Writers re-read the state after their shared lock. A refused insert holds no lock (Postgres releases it when the statement fails), so it can't delay a bind or fence.
- **Grants.** The fixture now simulates Supabase's default grants (every new public table and function granted to anon, authenticated, service_role). Every `ct_` function revokes PUBLIC, anon and authenticated (internal ones also service_role), and pins `search_path = ''`. Table-level UPDATE on `user_issue_reports` is held by authenticated under those defaults, so column grants protect nothing; what protects `ct_run` is no client UPDATE policy plus the immutability trigger for every role, proven even under a permissive probe policy. The service role's supplied `ct_run` is nulled too (it has no request identity).
- **Service steps take no identity or state.** `ct_bind_run(run, session)` takes the uid from the claim; `ct_run_account(run)` returns the recorded uid as the only deletion target; `ct_close_run` refuses malformed inventory (NULL array or element, duplicates, 2-D, more ids than the cap) before reading or deleting anything.
- **Signup crash before binding.** With the claim inside the account-creation transaction, the run holds the exact uid: the sweeper fences, deletes that uid and closes with 0. The email is never deletion proof. If the `auth.users` trigger is not accepted, this case stays an explicit HOLD with manual reconciliation (email only as a discovery key).

Mapping to Sam's required negatives (T = subtest):

| Required negative | Where |
|---|---|
| Run-owned anonymous (user_id NULL) insert | T6 admitted and stamped while open; refused for other session, no claim, after fence, after deletion; T2 refused while claimed |
| Signup/prebinding JWT after mark (claim) | T2, T7A |
| Signup/prebinding JWT after fence | T6, T7A, T7C |
| Another session without the claim | T2, T6 (open and fenced) |
| Ordinary user insert with forged protected value | T9; also service role in T6 |
| Two competing finalizers | T8 (two fencers, two closers) |
| Malformed or excess inventory | T8 (8 shapes, nothing deleted); five reports at cap 4 |
| Admitted insert during fence | T3 |
| Delayed insert | T3 (arrives while fence waits, refused), T2 (arrives during bind, re-reads) |
| Stale JWT | T6, T8 (after close) |
| Attempt N vs N+1 | T8 |
| Crash after deletion | T8 (fresh sweeper re-captures), T7A |
| Two sweepers | T8 |
| Fence timeout | T5 |
| Five reports | T8 |
| Lost client response | T8 (committed then connection killed, still captured); T4 (killed mid-write, nothing) |
| Grants, search_path, PUBLIC execute | T1 |
| Registration/binding serialization | T2, T7C |

Mutation controls (one guard removed each; first failing check shown): m01 writer without shared lock (T2 bind ordering); m02 state read before the lock (T2, queued insert wrongly refused); m03 client value kept (T6); m04 fence without exclusive lock (T3); m05 keyed on `user_id` instead of request identity (T2, prebinding anonymous insert admitted); m06 missing session claim accepted (T2); m07 prebinding falls through to ordinary user (T2); m08 service steps executable by clients (T1); m09 binding mutable (T6); m10 inventory shape unchecked (T8; the exact-id check would still refuse these, so this one is defence in depth); m11 signup allowed onto a fenced run's email (T7); m12 registration without the email lock (T2); m13 no account-gone check (T6). 13 of 13 caught.

Still open, not claimed:
- **Hosted Auth behaviour is a separate gate.** The fixture's `auth.sessions`, `auth.jwt()` and GoTrue's signup transaction are stand-ins. To confirm on a hosted project, read-only: the JWT `session_id` claim equals `auth.sessions.id`; GoTrue inserts `auth.users` in a transaction that a failing AFTER trigger aborts; the migration owner can read `auth.sessions` and create the `auth.users` trigger; current grants (`has_table_privilege('authenticated','public.user_issue_reports','UPDATE')`).
- **Scope beyond Elon's approval.** Elon approved a column and trigger on reports. E rev 2 adds the `ct_runs` table, an `auth.users` trigger and six service functions; that needs his and Sam's say.
- The sweeper and harness changes are not built; the proof is the database contract only.

## 0. Rev 4: combined design E, and the local proof

Sam's review of D (2:46 PM ET, to Jack) asked for three things D lacked: (1) proof that an admitted report write ends before cleanup and nothing gets in afterwards, including after account deletion; (2) a durable closed-run record even when a run wrote no reports; (3) a plan for a crash between signup and the binding. Elon approved a column and trigger on `user_issue_reports` as their own migration, provided the binding comes only from server-set data, client values are always overwritten, and real users are unaffected.

E keeps A's run record and D's login-session binding:
- **Registered before the account exists** (service-only function): one `ct_runs` row with exact repository, workflow path, run id, attempt, test id, the run-owned email and a report cap. No FK to Auth, so it survives deletion and becomes the closed tombstone. This covers (3): a crash after signup leaves an account whose exact email was registered, before it existed, by the service role.
- **Bound after the fresh sign-in** (service-only): the account uid, checked against the registered email and created after registration, and the one Supabase login session allowed to write, checked against `auth.sessions`.
- **Report writes:** a trigger finds the run by `auth.uid()`, takes the run's shared transaction lock, reads the state after holding it, and stamps `ct_run` only when the run is open and the token's session is the bound one. Client values are always overwritten. Real users have no run row: no lock, no change. `ct_run` cannot be changed afterwards, even by the service role.
- **Fence:** an exclusive lock on the run that waits for every admitted writer to commit or abort, then marks the run fenced. A writer arriving while the fence waits queues behind it and is refused. Lock timeout = HOLD; the run stays open.
- **Close:** after the account is deleted and the retention read has passed, delete exactly the captured ids (all of the run's reports, owner null, under the cap) and mark the run closed with its report count, 0 included. That record covers (2).

Proof: `tests/db/aht07-run-fence.realpg.mjs` (copies and a patch in `speaksharp/aht07-run-fence/`) runs a disposable local PostgreSQL 16 with fixture Auth, the real seven-migration `user_issue_reports` chain and the proposal, and drives independent sessions. 8 of 8 pass:

| Check | Result |
|---|---|
| Registered but unbound account writes | refused |
| Admitted write while the fence waits | fence blocks on it; it commits, stamped, before the fence returns |
| Write arriving while the fence waits | queues behind the fence, then refused |
| Write after the fence | refused |
| Admitted write that aborts | nothing lands; fence returns |
| Fence lock timeout | HOLD, run stays open, nothing lost |
| Second login session while open; new login or stale token after fence | refused |
| Anonymous report (`user_id` NULL) from the bound login | stamped, so findable |
| Forged `ct_run` from a client | overwritten |
| Changing `ct_run` (even service role) | refused |
| Stale token after account deletion | refused; reports kept with owner null and their binding |
| Close before account deletion | HOLD |
| Wrong id set | HOLD |
| Two sweepers closing at once | both succeed, one deletes |
| Rerun attempt N+1 | untouched by N's close |
| Five reports, cap 4 | HOLD, nothing deleted |
| Zero-report run | closed with a durable count of 0 |
| Real user | report saved, `ct_run` null; can't read the run table or call the functions |

Mutation controls (each broke the proposal on purpose; the suite caught all four): writer without the shared lock, state read before the lock, client value not overwritten, fence without the exclusive lock.

Still open:
1. **New surface beyond what Elon approved:** a table and five service-only functions, besides the column and trigger.
2. **Hosted Supabase privileges:** the migration owner must be able to read `auth.users` (used by existing migrations) and `auth.sessions` (not yet used anywhere here; unverified).
3. **The fixture is not Supabase:** `auth.uid()`/`auth.jwt()` and Auth tables are stand-ins; PostgREST, GoTrue deletion and the real `session_id` claim are not exercised.
4. **Crash between signup and binding:** the account's email was registered before it existed, but whether that exact-email record is deletion authority is Sam's call; otherwise it is retained for manual reconciliation. Zero-residue for the whole journey is not claimed for that window.
5. **Sweeper:** GitHub-attempt completion as eligibility, then the same fence; not built.
6. **Not built either:** harness changes and the production migration, which need their own review and authority.

## Summary to share with Sam and Elon

Every row AHT-07 writes is deleted with its test account except feedback reports, which are kept by design when an account is deleted. So the only thing a crashed runner can strand is a feedback report that has lost its owner.

No id we already create knows which GitHub run it belongs to. Supabase's own login session id is the best existing one: the server mints it at every sign-in and puts it in every token, and nobody can forge it. So the recommendation (rev 3, design D) is: the harness's existing canary-claim write also records the exact repository, workflow, run id and attempt on the test account; the fresh sign-in that follows carries that binding and Supabase's session id in its token; a database trigger stamps both onto every feedback report and refuses inserts once the run is fenced. Cleanup fences the run, waits on a database lock until every admitted insert has finished, deletes the account (retention test intact), deletes only that run's verified report ids under a cap, and reads residue independently. A sweep does the same for runs whose GitHub attempt has completed. No new table, no app code change; one column, one trigger and one service-only function. PostHog and Sentry ids were checked and can't be deletion authority (section 3).

## 1. What actually needs a durable ID (verified)

| Row type AHT-07 writes | Linked to the account by | On account delete | Findable after a crash today? |
|---|---|---|---|
| `auth.users` (email `rwt-journey-<label>-<ms>-<GITHUB_RUN_ID>@…`) | itself | deleted | yes, by email prefix (`rwtJourney.ts:206-209`); no sweep exists yet |
| `user_profiles`, `sessions`, transcripts/retention rows, coaching receipts, Focus/objective rows, progress rows | `user_id` FK, ON DELETE CASCADE | deleted | yes, through the account (`runOwnedCleanup.ts:66-117` inventory) |
| `trial_entitlements` | `user_id` SET NULL, plus `email` | pre-deleted by uid, residue-checked by email (`runOwnedCleanup.ts:124,217-221`) | yes, by email |
| `user_issue_reports` | `user_id` and `session_id`, both ON DELETE SET NULL (`20260605080000_user_issue_reports.sql:6-7`) | kept, owner and take nulled | **no**: after deletion nothing on the row says it was a test |

Verified details:
- The only `auth.users` FKs that are not CASCADE are `trial_entitlements` and `user_issue_reports` (grep of migrations; `usage_checkpoints` was fixed to CASCADE in 20260625120000).
- Session ids are minted on save and read back from the page (`rwt-feedback-association-boundaries.live.spec.ts:120-121`); sessions cascade, so they need no tag.
- The report row carries nothing test-specific: `metadata` is client-built (route, browser, release id, feedback kind…, `issueReportService.ts:38-80`), and the description is typed text (`spec:155`). Both are writable by any signed-in client.
- RLS lets any signed-in session insert a report with `user_id` null (`20260605120000_user_issue_reports_optional_user.sql:14-19`), and deleting an auth user does not revoke its live token. So a late insert from a crashed run can land with no owner at all.
- `auth.audit_log_entries` is Supabase-internal, can be pruned, and records sign-ins, never report inserts. Not a usable anchor.
- #1811's answer is a runner-external directory (`RWT_RECOVERY_DIR`, `feedbackRecoveryInventory.ts`, 315 lines) holding idempotency keys, plus key-union capture (`feedbackReportCleanup.ts`). That is the shadow storage Akin rejected.

## 2. Candidate designs

### A. Run ledger row in Supabase + server-stamped `ct_run` + database write fence (rev 2)

What is written, and when:
1. **Before signup** (the run-owned email is minted before the form is touched, `rwtJourney.ts:206-209`): service role inserts `ct_runs(ct_run, repository, workflow_ref, run_id, run_attempt, test_id, account_email, account_uid null, state 'open', created_at)`. `ct_run` is a random id. `account_uid` is a plain uuid, not an FK, so the row survives account deletion. RLS on with no policies: clients can't read or write it.
2. **Right after signup**, at the existing claim step (`rwtJourney.ts:312-325`): set `account_uid` after the existing UID/email cross-check. Halt (no scenario write) unless the row is bound.
3. **Report insert trigger** (BEFORE INSERT on `user_issue_reports`, SECURITY DEFINER): `SELECT ct_run, state FROM ct_runs WHERE account_uid = auth.uid() FOR SHARE`. No row: a real user, `ct_run := NULL`. Row with state `open`: `NEW.ct_run := ct_run`, always overwriting client input. Any other state: raise, the insert fails. `auth.uid()` comes from the token, so this works the same for an ownerless insert or after the account is deleted.
4. **Fence**: `UPDATE ct_runs SET state = 'fenced' WHERE ct_run = X AND state = 'open'`. Because every admitted insert holds a share lock on that row until it commits, the update returns only after every previously forwarded insert has committed or aborted, and every later insert sees `fenced` and fails. That is the settlement barrier and the write fence in one step, independent of token lifetime, job status or age.

Cleanup (in-run, and the same steps in the sweep):
1. Fence (above). Unknown result: HOLD.
2. Capture: report ids `WHERE ct_run = X`. More than the cap (4 for AHT-07) or any row whose `user_id` is neither the ledger's uid nor null: HOLD, delete nothing.
3. Account deletion through the existing `cleanupRunOwnedAccount`, by the ledger's exact uid and email. The retention proof runs here unchanged: the report survives with `user_id` null and `ct_run` intact.
4. Delete `WHERE id IN (captured) AND ct_run = X`, requiring the deleted count to equal the captured count.
5. Residue, read independently: reports by `ct_run`, by captured ids, and the account surfaces by uid all read zero. Then `state = 'cleaned'`.

Sweep (preflight of each AHT live job, or its own job): take ledger rows not `cleaned`; for each, read the bound run attempt from the GitHub API (exact repository, workflow path, run id and attempt; rc-gates.yml already has `actions: read`, and `scripts/human-test/modelComparisonRunAuthority.mjs` already reads run attempts). Only a completed attempt proceeds, and then only through the fence. A running, missing or mismatched run stays HOLD.

### Sam's conditions, checked

| Sam's condition | Rev 1 (app_metadata tag) | Rev 2 (ledger + fence) |
|---|---|---|
| Trusted, service-written `ct_run` | yes (app_metadata) | yes: ledger is service-role only, trigger overwrites client input |
| Binds exact repository, workflow, run id, attempt | **no**: run id and attempt only | yes: all four, plus test id and the run-owned email and uid |
| Prefix, test flag or typed marker is never deletion authority | partly: sweep used "has a tag" | yes: authority is the ledger row plus a completed bound run |
| Check the bound GitHub run completed | **no** | yes, before any fence by the sweep |
| Fence new writes separately | **no**: relied on token expiry | yes: the trigger refuses inserts once fenced, even with a live token |
| Settlement of previously forwarded requests | **no**: relied on a 2-hour age | yes: the fence update waits on every admitted insert's lock |
| Age or job completion alone is not proof | **no** | yes: completion only gates the sweep; the fence is the proof |
| Report-side run binding survives account deletion; retention test intact | yes | yes |
| Delete only verified run-owned ids under hard caps | **no**: deleted by tag | yes: ids, `ct_run` match, owner check, count cap |
| Independent residue read | yes | yes |
| Unknown ownership, state or settlement stays HOLD | partly | yes, at every step |
| Negative: late insert between report cleanup and account deletion | open | closed: fenced before either |
| Negative: crash after account deletion | covered | covered: ledger keeps uid and email; reports keep `ct_run` |
| Negative: copied marker on a foreign report | covered | covered: no client can set `ct_run`; owner must be the ledger uid or null |
| Negative: overlapping run, rerun attempt mismatch | **open**: tag-wide sweep | closed: one row per account per attempt; sweep never fences a running attempt |
| No new paid infrastructure | yes | yes |

### Gaps that remain

1. **A new table.** `ct_runs` is a Supabase row written first, which is what Akin asked for, but it is a table, not a column. A version without the table (fence state in `app_metadata`, share lock on `auth.users`) needs UPDATE rights on `auth.users` that Supabase may not give the migration role; unverified, so not recommended.
2. **The lock barrier must be proven** in a DB test: an insert holding its share lock blocks the fence; an insert after the fence fails; PostgREST and the service role's statement timeouts don't cut the fence short.
3. **Signup-time rows before the uid is bound** (profile, trial entitlement): they belong to the email, which the ledger already holds, so the sweep finds them; the halt in step 2 keeps any report out of that window.
4. **Real-user cost:** one indexed lookup on a tiny table per report insert.
5. **PostHog events** stay out of scope (canary-tagged, not deleted), as in the earlier plan.
6. **#1811 rework:** the recovery store and key-union capture go; the attempt cap and legs stay. Sam's four single-writer files still need no change.

### B. Account as the anchor, reports deleted first (no schema change)

The account row, created at signup with the run id in its email, is the a-priori record. Treat reports like `trial_entitlements`: delete them by `user_id` before deleting the account, in-run and in the sweep. Then whatever the crash point, the account still exists and every row is findable by its uid.

| Check | Result |
|---|---|
| Survives runner crash | yes for the account and everything owned while it exists |
| Survives account delete | no. It works only because reports are deleted first. |
| Finds every row type | not a late ownerless insert: a report sent with `user_id` null after the account is gone is untraceable |
| Real-user safety | sweep must not trust the email prefix alone (anyone can sign up with it); it can trust the existing `app_metadata.canary` claim instead |
| Churn | none in the product; test-side only |
| Effort | small: one line in the pre-delete list for the run's own cleanup, plus the sweep |
| Main cost | the live retention proof (`feedbackRetentionAfterDeletionRow`, `rwtJourney.ts:2151`) can't run, because it needs a report to survive the deletion. That product contract would have to be proven elsewhere, e.g. a DB integration test. |
| Sam's files | no change |

### C. Run marker typed into the report (the earlier proposal)

Put the run id in the description text, or have the client add it to `metadata`.

| Check | Result |
|---|---|
| Survives crash and account delete | yes, it is on the row |
| Real-user safety | **unsafe for deletes**: any signed-in user can type the same text or send the same metadata, so a sweep that deletes by it could erase real feedback |
| Churn | high: tied to the form's text field and length rules, which change with design updates |
| Effort | small |
| Verdict | not recommended; fine only as a human-readable hint, never as the delete key |

## 3. Existing ids created at app or session start (rev 3 inventory)

| Id | Created where | Already sent to | On AHT-07 rows? | Survives account delete? | Unique per run attempt? | Trusted (server-written)? |
|---|---|---|---|---|---|---|
| Supabase Auth session id (`session_id` claim) | Supabase Auth at every sign-in; in every access token | every Supabase request (in the token) | no app row stores it today | the `auth.sessions` row goes; a copy stamped on a report would stay | yes, per login (AHT-07 signs in fresh after the claim, `spec:75`) | **yes** |
| Account uid | Supabase Auth at signup | rows by FK; PostHog `identify` and Sentry `setUser` (`AnalyticsBuffer.ts:548,557`) | yes, every row | no: reports' `user_id` goes null | yes, one account per test | yes |
| Account email | harness, before signup (`rwtJourney.ts:206-209`) | Supabase Auth | `auth.users` only | no | has run id only, not repository, workflow or attempt | harness-chosen |
| `app_metadata.canary` | harness service write at the claim (`rwtJourney.ts:322`) | the token after re-sign-in; drives PostHog `traffic_type` (`AuthProvider.tsx:126`) | no | no | no (a flag) | yes |
| PostHog `boot_id`, `journey_id`, `attempt_id` | client, per page load or journey (`journeyIdentity.ts:32-90`) | PostHog only, via the envelope (`envelope.ts:41-49`) | no | n/a | no run binding | **no**: client-written |
| PostHog distinct id / `$session_id` | PostHog SDK; distinct id becomes the uid after identify | PostHog only | no | n/a | no run binding | **no** |
| Sentry user id / last event id | `Sentry.setUser` (uid); last event id only after a Sentry error | Sentry; last event id also in report `metadata` (`issueReportService.ts:231`), usually null | metadata only, often null | yes (in metadata) | no | **no** |
| Report `idempotency_key` | client, per draft (`IssueReportDialog.tsx:66,224`) | Supabase, on the report | yes, reports | yes | per draft, no run binding | **no**: any client can set it |
| Practice session id | database on save (`spec:120`) | Supabase | sessions; report `session_id` | no: nulled | per take | yes |
| GitHub run id and attempt | Actions environment | harness receipts only (`rwt-feedback-association-boundaries.live.spec.ts:156-157`), never PostHog or Supabase | no | n/a | yes | n/a |

Why not PostHog (or Sentry) as the crash record:
- **Not trusted:** events are sent with the public project key, so anyone can send an event with any id. Sam's first condition rules it out as deletion authority.
- **Lossy at a crash:** events are batched in the page, and the harness already has to wait for batches to leave before cleanup (`spec:169`). A runner that dies takes the unsent batch with it, which is exactly when we'd need it.
- **No run binding today:** nothing the app sends carries the GitHub run; adding it means writing it anyway, and writing it to Supabase is the trusted place.
- **Privacy:** reading it needs a personal PostHog key over a store of real users' events. Fine as a cross-check scoped to `canary` traffic, never as the delete key.

## 4. D. Login-session stamp (recommended, rev 3)

What is written, and when:
1. **Binding, at the existing claim write** (`rwtJourney.ts:322`, after the UID/email cross-check): `app_metadata: { canary: true, ct_run: { repository, workflow_ref, run_id, run_attempt, test_id } }`. Service-written; nothing new is created.
2. **Session start:** the harness's existing fresh sign-in (`spec:75-86`) yields a token carrying `ct_run` and Supabase's `session_id`. Extend the existing gate: no scenario write unless the token carries both.
3. **Report insert trigger** (SECURITY DEFINER): if the token has no `ct_run`, do nothing (every real user). Otherwise take a shared advisory lock keyed on the session id, then require that `auth.users` for `auth.uid()` still exists with the same `ct_run` and no `ct_fenced`; refuse the insert if not. Stamp `ct_run` (the binding plus the session id, from the token) onto the report, overwriting client input. Reading `auth.users` in definer functions and advisory-lock fences are both existing patterns here (`20261024083000_account_coaching_unknown_fence_1643.sql:106,146`; `20261019202856_account_coaching_admission_1643.sql:55`).
4. **Fence:** service sets `app_metadata.ct_fenced = true`, then calls a service-only function that takes the exclusive advisory lock for the session id. It returns only after every insert that passed the check has committed or aborted; every later insert is refused. Account deletion is also a fence: with no `auth.users` row, the trigger refuses.

Cleanup and sweep: as in A (fence, capture ids by `ct_run` under the cap with the owner check, account deletion with the retention proof, delete by ids and `ct_run`, independent residue). The sweep lists accounts with `app_metadata.ct_run` and reports with `ct_run`, reads the bound attempt from the GitHub API, and touches only completed attempts. An account with the `rwt-journey-` prefix and no `ct_run` (crash in the seconds between signup and claim) is reported, never auto-deleted.

### D against Sam's conditions

| Condition | D |
|---|---|
| Trusted, service-written binding to exact repository, workflow, run id, attempt | yes: service-written `app_metadata`, carried in the signed token |
| Write fence | yes: `ct_fenced` or a deleted account makes the trigger refuse, even with a live token |
| Settlement of forwarded requests | yes: the exclusive advisory lock waits for every admitted insert |
| Report-side binding survives deletion; retention test intact | yes |
| Delete only verified ids under caps; independent residue | yes |
| Late insert between report cleanup and account deletion | closed: fenced before either |
| Crash after account deletion | covered: reports keep `ct_run`; the trigger refuses further inserts |
| Copied marker on a foreign report | covered: stamped from the token, never from the client |
| Overlapping run, rerun attempt mismatch | covered: exact attempt in the binding; sweep only touches completed attempts |
| Unknown stays HOLD | yes |

### D vs A (run table)

| | D. Login-session stamp | A. Run table |
|---|---|---|
| New schema | 1 column, 1 trigger, 1 service-only function | 1 table, 1 column, 1 trigger |
| Existing ids reused | Supabase session id, account uid, the claim write | account uid and email |
| When the binding lands | at the claim, seconds after signup, before any scenario write | before signup |
| Signup-window crash | bare account and profile, flagged for manual removal | swept, since the row holds the email |
| Settlement mechanism | advisory lock (existing pattern) | row lock on its own table |
| Real-user cost | none: real tokens have no `ct_run`, so the trigger returns at once | one indexed lookup per report insert |
| Sam's single-writer files | no change | no change |

Gaps in D:
1. The advisory-lock barrier and the token claims must be proven in a DB test (tests/db already fake `request.jwt.claims`).
2. The `app_metadata` binding reaches reports only through a token minted after the claim; the existing re-sign-in gate covers it, but it becomes load-bearing.
3. Supabase's statement timeout for the service role must allow the settle call to wait.
4. PostHog residue stays out of scope.

## 5. Recommendation

Adopt D (rev 3). It reuses the ids that already exist (Supabase's own login session id and the account), adds one binding to the claim write the harness already makes, needs no new table and no app change, and meets every condition in Sam's note. A is the alternative if Elon prefers a table to an advisory-lock function, or if covering the few seconds between signup and claim matters. B is the no-migration stopgap but loses the live retention proof.

## 6. Questions only the team can settle

1. Akin: does D's session-based stamp answer the "unique id per crashed session" concern?
2. Elon: are the `ct_run` column, the trigger and the service-only settle function acceptable in production?
3. Sam: do the `ct_fenced` flag plus the advisory-lock settle meet "fence new writes" and "settlement" as you meant them?
4. Where the sweep runs: each AHT live job's preflight, or its own scheduled job.
