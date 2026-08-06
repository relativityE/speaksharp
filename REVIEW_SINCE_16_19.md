# Second-review request — DevClaude v1 changes since 16/19

**Reviewer: Jules.** This branch (`review-1166-1151-1163-1171`) carries no code — it is a changelog of the changes I (DevClaude v1) authored while driving the DAG from 16/19 → 17/19 and preparing the next hops. Please independently verify each item against the referenced commit/branch. I am the author, so a second set of eyes on my own fixes is the point.

All four items share one root cause I want scrutinized hardest: **the `on_auth_user_created_trial_profile` trigger inserts a `trial_entitlements` row on every signup, and `trial_entitlements.user_id` is `ON DELETE SET NULL`** — so `auth.admin.deleteUser()` orphans that row rather than cascading it. Any "zero-residue" disposable-account proof that ignores it silently accumulates orphaned rows (email + trial timestamps) in production. Please confirm my reasoning and that no *other* SET-NULL / RESTRICT owned table is similarly missed (e.g. `user_issue_reports`).

---

## 1. #1166 — production-proof zero-residue fix `[MERGED → main a3fc4280]`
- **File:** `scripts/1047-production-proof-account.mjs`
- **Finding (P1):** cleanup deleted 5 tables and counted residue by `user_id`, reported `zero_residue=true` while orphaning the SET-NULL `trial_entitlements` row every run.
- **Fix:** enumerated `trial_entitlements` with `residueColumn:'email'` / `residueValue:email`; delete by `user_id` **before** `deleteUser`; readback keyed by the **email PK** (post-delete `user_id` is NULL → false-clean). Generalized `count(table,column,value)`; documented CASCADE tables as gone-by-construction.
- **Verify:** the `tables` array + `residueCol/residueVal` helpers in `cleanup()`.

## 2. #1151 — same fix in the Private recording proof `[branch dev/1089-proof-harness @ 8d1484ee, CI running]`
- **File:** `tests/live/private-recording-proof.live.spec.ts`
- **Finding (P1):** identical gap — cleanup relied purely on the auth cascade + a readback that omitted `trial_entitlements`.
- **Fix:** explicit `trial_entitlements` delete by `user_id` before `deleteUser`; residue check keyed on the lowercased email PK. Fail-closed like the surrounding steps.
- **Also in scope for your review:** `tests/live/helpers/proofAuthority.ts` — the two Codex P1s (P1.1 use `modelId` not `privateModelKey`; P1.2 anchor identity on the **instantiated** engine `runtimeProvider`, exact-match, never the `serviceMode` label) are already implemented at this head. Please confirm they hold and that `isPrivateRuntimeIdentity` / `matchesPrivatePersistedArm` are exact-match and fail-closed.

## 3. #1171 — production-proof workflow un-parseable `[MERGED → main d99f4325]`
- **File:** `.github/workflows/1047-production-proof.yml`
- **Finding (P1):** `PROOF_RECOVERY_FILE: ${{ runner.temp }}/…` at **job-level `env:`** — `runner` context is step-only, so GitHub rejected the file (`Unrecognized named-value: 'runner'`); the workflow never parsed/dispatched (prior "runs" were empty parse failures).
- **Fix:** `runner.temp` → `github.workspace` (valid at job-level env; also keeps the recovery file out of the uploaded `test-results/` artifact dir).
- **Please check:** whether any *other* workflow repeats the job-level `runner.*` pattern.

## 4. #1163 — attribution authority: rebase + review `[branch dev/1161-attribution-authority @ 3ac8a07f, CI running]`
- **No code change by me** — rebased `e54fe94a` onto current `main` (24 commits, clean, all own files byte-identical to `e54fe94a`).
- **My review conclusion:** security surface is disciplined (all authority writers `SECURITY DEFINER` + `search_path` pinned + `REVOKE ALL FROM PUBLIC` → `service_role`; client `UPDATE` on `sessions` revoked & re-granted column-level; RLS select-own on the 3 attribution tables). `bind_attribution_intent_v1` is race-safe (`FOR UPDATE` + single atomic guarded UPDATE folding ownership/expiry/single-bind/idempotency into the WHERE).
- **⚠️ Rollout flag I want you to confirm:** the migration `20260803010000_session_attribution_authority.sql` now sorts **before** already-merged `20260804000000` (retention converge) and `20260805000000` (retention preflight, #1164). On a target DB where 04/05 are already applied, applying 03010000 is an **out-of-order migration**. Recommendation before the server-first rollout: bump the timestamp to after the latest applied migration. This is a deploy-time concern, not a merge-blocker — please sanity-check that assessment.

---

### Process notes for the reviewer
- Every fix was pushed with `--force-with-lease` pinned to the prior head; I worked in detached worktrees and never entered another agent's worktree.
- The paid-Gemini #1047 proof-dispatch is **deferred** (PO holding); #1171 only unblocks it.
- Related awareness issue: [#1170](https://github.com/relativityE/speaksharp/issues/1170) (CI unit-sharding / #1168).

_— DevClaude v1_
