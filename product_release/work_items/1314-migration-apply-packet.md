<!-- pm-currentization:2026-09-04 -->
> [!CAUTION]
> **Reviewed 4 Sep 2026 — superseded work packet.** This file is preserved for provenance and must not be executed as current product/release authority. Preview/internal-build model selection, PostHog-flag targeting, two-transcript retention, and prior closure claims are superseded by the canonical root documents and issues #1259/#1258/#1390/#1404/#1407/#1386/#1263/#1304. Use canonical Production only; do not infer that historical PASS evidence qualifies the current product.
<!-- /pm-currentization:2026-09-04 -->

# #1314 — Immutable migration apply / readback / rollback packet

**The MIGRATION ARTIFACT is pinned by content hash below.** The file has been REVISED since `6c3bf405` — the
helper ACLs and the header were corrected under review — so any "unchanged since 6c3bf405" statement is wrong and
has been removed. What is guaranteed is narrower and verifiable: the git blob and sha256 in the identity table
are recomputed from the committed file at each packet update, and a preflight check (`git hash-object`) refuses
to apply anything whose hash differs. The authority is the content hash, not a commit or a "frozen since" claim.
Production application is **NOT** authorized by this document. It exists so the decision can be made against an
exact artifact rather than a description.

---

## 1. Immutable identity of what would be applied

| | |
|---|---|
| file | `backend/supabase/migrations/20260819120000_complete_session_v2_atomic_retention_1314.sql` |
| reviewed commit | resolved at push time — see the PR comment that accompanies this packet; the AUTHORITY below is the content hash, which no commit can silently change |
| git blob | `0b88bd0db32b0005fc58f3289b661e9b9703ee8c` |
| sha256 | `b70efd30a0ee0f5806ef9484f5c9eb3ca889d4122eaf4773d22f47486d9c7584` |
| size | 20,007 bytes / 301 lines |

Re-verify before applying:

```bash
git rev-parse HEAD                                  # must be the REVIEWED head (see §1)
shasum -a 256 backend/supabase/migrations/20260819120000_complete_session_v2_atomic_retention_1314.sql
```

If either differs, **stop** — this packet describes a different artifact.

## 2. What it does, and what it provably does not

**Creates exactly three functions. Nothing else.**

```
59: CREATE OR REPLACE FUNCTION public.max_persisted_transcript_chars()
62: CREATE OR REPLACE FUNCTION public.max_persisted_transcript_bytes()
66: CREATE OR REPLACE FUNCTION public.complete_session_v2(...)
249-251: REVOKE FROM PUBLIC / GRANT to authenticated, service_role  — on the NEW function only
```

There is **no `DROP`**, **no `ALTER TABLE`**, and no change to any existing function, column, constraint or
trigger. Both existing `complete_session` overloads keep their exact current resolution, so **no in-flight client
can break**. Verified by grep over the frozen file and by the readback below.

## 2b. Exact preflight and apply command

**Preflight — all four must hold before applying:**

```bash
git hash-object backend/supabase/migrations/20260819120000_complete_session_v2_atomic_retention_1314.sql
                                     # must equal the git blob in the identity table above
shasum -a 256 backend/supabase/migrations/20260819120000_complete_session_v2_atomic_retention_1314.sql
                                      # b70efd30a0ee0f5806ef9484f5c9eb3ca889d4122eaf4773d22f47486d9c7584
supabase migration list               # record BEFORE state
psql -At -f product_release/work_items/1314-atomic-rpc-readback.sql
                                      # must show A2_V2=[NONE], C_TRANSCRIPT_LIMIT=[chars=ABSENT bytes=ABSENT]
```

**Apply** — via the existing authorized workflow, which dry-runs first:

```
supabase db push --dry-run   # inspect
supabase db push --yes       # apply
```

**Immediately after apply, reload the PostgREST schema cache:**

```sql
NOTIFY pgrst, 'reload schema';
```

This is not optional. PostgREST resolves RPCs from a cached schema, so **until it reloads, `complete_session_v2`
returns 404 (PGRST202) even though the function exists**. Proven on the disposable stack: step 2 of the PostgREST
proof applies the migration and the call still 404s; step 3 reloads and it resolves.

**`NOTIFY` is fire-and-forget — confirm the reload OPERATIONALLY, do not assume it.** `NOTIFY` returns success
whether or not PostgREST is listening. The reload is only confirmed when a real request resolves the new function:

```bash
# Poll until PostgREST RESOLVES v2, bounded. The probe MUST send the FULL named-argument set: complete_session_v2
# has no defaultable p_session_id, so an empty `{}` body cannot match the signature and PostgREST returns
# PGRST202 (function not found) REGARDLESS of whether the function exists — which cannot distinguish "not
# reloaded" from "reloaded". A full-args call with a NONEXISTENT session id instead returns a business response
# (a 2xx with {"success":false,"error":"session_not_found"|"profile_not_found"}) once resolved; only an
# UNRESOLVED function returns PGRST202. So absence of PGRST202 == reload confirmed.
BOGUS='{"p_session_id":"00000000-0000-0000-0000-000000000000","p_status":"completed","p_final_duration":1,'\
'"p_reason":null,"p_next_action":null,"p_total_words":null,"p_clarity_score":null,"p_wpm":null,'\
'"p_filler_counts":null,"p_pause_metrics":null,"p_final_transcript":null}'
for i in $(seq 1 15); do
  code=$(curl -s -o /tmp/probe.json -w '%{http_code}' -H "Authorization: Bearer $JWT" \
    -H 'Content-Type: application/json' -X POST "$REST_URL/rpc/complete_session_v2" -d "$BOGUS")
  grep -q PGRST202 /tmp/probe.json || { echo "reload confirmed (http $code)"; break; }
  sleep 2
done
grep -q PGRST202 /tmp/probe.json && { echo "FAIL: PostgREST never resolved v2 after reload"; exit 1; }
```

A `NOTIFY` with no confirming probe is not evidence the cache reloaded; it is only evidence the statement ran.

## 2c. Partial-apply behaviour — TESTED, not asserted

An earlier revision of this packet asserted that `supabase db push` wraps each migration in a transaction. That
guarantee is **not documented**, and asserting undocumented CLI behaviour as a safety property is precisely the
kind of claim this PR exists to stop making. **The claim is withdrawn.** In its place, three tested facts from
`scripts/run-migration-partial-apply-proof.sh`, run against real PostgreSQL by injecting a guaranteed failure at
the most dangerous cut point — after the functions are created but before their ACLs run:

| case | result |
|---|---|
| mid-file failure, **no** transaction control | **PARTIAL APPLY IS REAL** — 3/3 objects left installed, and `complete_session_v2` exists with **PUBLIC EXECUTE = true**, because the REVOKE/GRANT statements never ran |
| the same failure, wrapped in `BEGIN … COMMIT` | **0/3** left — nothing survives |
| clean apply | 3/3 installed, and **no** created function is executable by PUBLIC |

**What this means for authorization.** The dangerous window is real and security-relevant, so safety must not
rest on how the CLI happens to behave. It rests instead on the **post-apply readback being mandatory and
fail-closed**: in the partial case the readback reports `complete_session_v2` PRESENT with an **incomplete
`E_GRANTS`**, so a human sees a partial apply rather than a success. That check depends on no CLI behaviour at
all.

**PROVEN — no explicit `BEGIN`/`COMMIT` is needed.** The open question ("does `db push` wrap each migration in
a transaction?") is now answered empirically by the pinned-CLI proof on postgres 15 and 17: a migration poisoned
with a failure AFTER the functions are created but BEFORE their ACLs leaves **0/3 functions and 0
migration-history rows**. So `supabase db push` applies each migration atomically — a mid-file failure rolls the
whole migration back — and an explicit `BEGIN`/`COMMIT` would be redundant. This is the CLI's demonstrated
behaviour at 2.101.0, not a documented guarantee, so it is re-proven on every run of that job rather than assumed.

Run: https://github.com/relativityE/speaksharp/actions/runs/32323408235

## 2d. Fail-closed readback and ACL checks

**The readback is a DIAGNOSTIC, not a gate.** It prints state and exits 0 — an earlier revision of this packet
wrongly called it "fail-closed". The ENFORCING check is `scripts/postflight-gate-1314.sh before|after`, which
asserts each expectation and **exits nonzero** on any deviation (verified: it fails on a poisoned partial state).
The readback still introspects `pg_proc`, `pg_trigger` and `information_schema` and **never invokes** the
functions it reports on. That matters in both directions: it
cannot be fooled by a function that exists but errors, and it still runs *after* rollback when the functions are
gone (an earlier version called them and therefore could not verify a rollback at all — the one moment it was
most needed).

**ACL, expected exactly:**

```
E_GRANTS=[complete_session_v2->authenticated; complete_session_v2->postgres; complete_session_v2->service_role; max_persisted_transcript_bytes->authenticated; max_persisted_transcript_bytes->postgres; max_persisted_transcript_bytes->service_role; max_persisted_transcript_chars->authenticated; max_persisted_transcript_chars->postgres; max_persisted_transcript_chars->service_role]
```

`PUBLIC` is explicitly revoked, so an unauthenticated caller cannot execute the RPC. Verified end to end on the
disposable stack, not merely by reading the grant: PostgREST step 4 calls `complete_session_v2` with an **anon**
JWT and asserts it is denied. `postgres:EXECUTE` is the owner's implicit grant.

Anything other than that exact set — in particular any `PUBLIC` entry — means the REVOKE did not take, and the
function is callable by unauthenticated requests.

## 3. Exact expected readback

Run `product_release/work_items/1314-atomic-rpc-readback.sql` (read-only; introspects catalogs, never invokes the
functions, so it also works after rollback).

**BEFORE** — and this must match production today:

```
A2_V2=[NONE]
C_TRANSCRIPT_LIMIT=[chars=ABSENT bytes=ABSENT]
E_GRANTS=[NONE]
B_CALLERS_OF_COORDINATOR=[complete_session(uuid,text,text,integer,text);
                          create_session_and_update_usage(jsonb,text,uuid,text,text,text);
                          spe_converge_retention()]
```

**AFTER APPLY** — exactly four fields change:

```
A2_V2=[complete_session_v2(uuid,text,integer,text,jsonb,integer,double precision,double precision,jsonb,jsonb,text)]
C_TRANSCRIPT_LIMIT=[chars=50000 bytes=200000]
E_GRANTS=[complete_session_v2->authenticated; complete_session_v2->postgres; complete_session_v2->service_role; max_persisted_transcript_bytes->authenticated; max_persisted_transcript_bytes->postgres; max_persisted_transcript_bytes->service_role; max_persisted_transcript_chars->authenticated; max_persisted_transcript_chars->postgres; max_persisted_transcript_chars->service_role]
B_CALLERS_OF_COORDINATOR=[… + complete_session_v2(…)]      <- the severed edge, reconnected
```

`A_OVERLOADS` and `D_TRIGGERS` must be **unchanged**. If `A_OVERLOADS` changes, the migration was not additive
and something dropped an overload.

## 4. Rollback

`product_release/work_items/1314-atomic-rpc-rollback.sql` drops all three created functions — not just the RPC.
An earlier revision dropped only the RPC while claiming exact restoration; that was false, and a rollback that
leaves objects behind is how drift starts.

**Proven state-restoring:** executed apply → readback → rollback → readback against real PostgreSQL, the
post-rollback readback is **byte-identical to the pre-apply readback**.

**Order matters.** If the client has adopted v2, revert the client FIRST or its calls 404 (PGRST202). With
PostgREST in front, also `NOTIFY pgrst, 'reload schema'` — otherwise it serves a cached signature that no longer
exists and the rollback looks incomplete.

## 4b. What each step concretely verifies — and what a FAILED rollback leaves behind

Stated up front because migration authorizations hinge on the rollback story more than the apply story.

| step | what it concretely verifies |
|---|---|
| **apply** | the three functions exist with the expected signatures and grants; nothing else in the schema moved (`A_OVERLOADS` and `D_TRIGGERS` unchanged) |
| **readback** | catalog state ONLY — it introspects `pg_proc`/`pg_trigger`/`information_schema` and never invokes the functions, so it is valid before apply, after apply, and after rollback. It reads no row data and no transcript |
| **rollback** | all three created functions are gone, and the readback returns to a state **byte-identical** to the pre-apply readback |

### A failed rollback leaves the APPLIED state, never a partial one

The rollback runs inside `BEGIN … COMMIT`, so its three `DROP`s are **atomic**. Verified by forcing a failure: a
dependency was created on `max_persisted_transcript_chars()`, then the rollback was run.

```
ERROR: cannot drop function max_persisted_transcript_chars() because other objects depend on it
DETAIL: constraint dep_probe_x_check on table dep_probe depends on function max_persisted_transcript_chars()

readback after the FAILED rollback:
  A2_V2=[complete_session_v2(…)]                 <- still present
  C_TRANSCRIPT_LIMIT=[chars=50000 bytes=200000]  <- still present
```

**Nothing was removed.** The database is left in the exact post-apply state — the same state it was in a moment
earlier, which the system is already proven to work in — rather than a half-rolled-back state where the RPC is
gone but its helpers linger, or vice versa. Recovery is "fix the blocker, run it again".

### What rollback does NOT do, by design

It deletes **no data**. No row is read or written; no transcript is removed. All three objects are stateless
functions. A rollback therefore cannot lose a user's session, transcript, or metrics.

### When to roll back

Roll back if the post-apply readback does not match §3 exactly — specifically if `A_OVERLOADS` changed (the
migration was not additive), if `E_GRANTS` contains `PUBLIC` (the REVOKE did not take), or if
`B_CALLERS_OF_COORDINATOR` does not gain `complete_session_v2` (the retention edge was not reconnected).

Do **not** roll back merely because PostgREST returns 404 — check `NOTIFY pgrst, 'reload schema'` first; an
unreloaded cache is indistinguishable from a missing function at the HTTP layer, and this exact confusion already
caused one misdiagnosis on this PR.

### The one ordering hazard

If the client has already adopted `complete_session_v2`, rolling back the database first makes every completion
fail with **PGRST202**. Revert the client FIRST. With PostgREST in front, also `NOTIFY pgrst, 'reload schema'` —
otherwise it keeps advertising a signature the database no longer has, and the failure looks like a different
bug. This is the mirror image of the apply order.

## 5. Evidence index — terminal, at this exact SHA

| evidence | result |
|---|---|
| `CI - Test Audit` | ✅ success |
| `PostgREST contract proof (disposable stack)` | ✅ 2 `PASS`, 0 `FAIL` — pg16 + pg17 |
| `Atomic completion concurrency (disposable Postgres)` | ✅ 3 `PASS`, 0 `FAIL` — pg15/16/17 |
| `STT Runtime Evidence` / `SCA` / `unaffiliated domain` / `U3` | ✅ success |
| full unit collection | 398 files, 3932 tests, 0 failures |
| [pinned-CLI db push proof (2.101.0), pg15/17](https://github.com/relativityE/speaksharp/actions/runs/32323408235) | ✅ poisoned: 0 functions / 0 history / reach proven; clean: 1 history; gate passes |
| postflight gate mutation harness (in that run) | ✅ 8/8 defects CAUGHT, clean PASSES |

Checked by **reading the job logs**, not the badges — on this PR a badge already reported success over a script
that printed `FAIL`.

PostgREST proved, on a disposable stack: unresolvable before apply; resolution by **named arguments** after
`NOTIFY pgrst, 'reload schema'`; `transcript_outcome` present; **anon denied** by ACL; the pre-existing legacy
ambiguity as a real **300**; and **404** after rollback.

## 5b. What `complete_session_v2` does semantically — including partial success

Not a success/failure binary. Applying the migration does not activate any of this (§6), but the reviewer should
know what the function will do once adopted:

- **The session write is outside the exception block** — metrics, filler snapshot, the one next action, duration
  and status. This is the write that must survive.
- **The transcript write and the retention coordinator are inside ONE subtransaction.** If the coordinator fails,
  both roll back together: the transcript is not retained, but the session and its metrics are kept. Putting the
  transcript write first would leave a transcript-bearing, unrotated row — the third-transcript breach.
- **The outcome is typed, not boolean:** `retained` / `not_provided` / `not_captured` / `retention_failed` /
  `expired`, derived from the **re-read** row rather than predicted, plus the actual `transcript_state`.
- **Partial success is intentional and reported**, per the PO ruling: `session_saved: true` with
  `transcript_retained: false`. The invariant it protects is that from a valid at-most-two starting state, a
  failed convergence **cannot increase** the transcript-bearing row count.
- **Convergence is scoped** to completed saves and their replays; a failed or cancelled transition does not
  rotate anyone's transcripts.
- **Replays re-run convergence.** The idempotent path no longer returns early, so a guarded retention failure is
  retryable rather than unreachable.

## 6. What application does NOT do

Applying this changes **no product behaviour**. The client does not call `complete_session_v2` — adoption is a
later, separate increment. Applying it makes the function available so that adoption can then be proven against a
real database instead of a mock.

## 7. Gates still closed

- [ ] production application — **your authorization**
- [ ] client adoption of `p_final_transcript`
- [ ] merge / deployment
- [ ] the nine remaining #1314 findings
- [ ] three-session Private-STT real-device qualification — **the acceptance gate**

Known accepted limitation: the pre-existing subset-call ambiguity between the two legacy-era overloads remains
live (it predates this PR). Closing it is the "one completion authority" step, after deployed proof of the new
path. Tracked separately, along with #1315 for the eight masked workflow steps.
