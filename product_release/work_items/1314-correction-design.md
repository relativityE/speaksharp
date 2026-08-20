# #1314 correction design — for bounded Consultant review

> **SUPERSEDED IN ONE RESPECT (PO ruling, 2026-08-19).** §6's "exactly two overloads" transition posture is
> withdrawn. The atomic RPC is now a **distinctly named `complete_session_v2`**, and the migration is **purely
> additive** — it drops and replaces nothing. Rationale, with executed evidence, in the migration header: a
> defaulted same-name overload makes subset named-argument calls ambiguous (42725 / PostgREST 300), which is the
> opposite of backward compatibility. That ambiguity was verified to **already exist in production today**
> between the legacy and Stage-A overloads, with neither #1314 function present; the single production caller is
> safe only because it sends all ten named arguments.

**Design only. No implementation in this document.** Targets the PO rulings plus every accepted RETURN finding.
Nothing applied, merged, deployed, or human-tested.

---

## 1. Subtransaction design (Ruling 1)

The invariant to protect: **never more than two transcript-bearing rows**, while never costing the user the
session they just recorded.

Ordering is the whole design. The metrics write and the transcript write become **two separate statements**, with
the transcript and the coordinator inside one subtransaction:

```
  1. UPDATE sessions SET status, duration, total_words, clarity_score, wpm,
                         filler_counts, pause_metrics, next_action_signal
     -- NO transcript. This is the write that must survive.

  2. BEGIN                                   -- plpgsql EXCEPTION block == subtransaction
       UPDATE sessions SET transcript = p_final_transcript   -- trigger derives transcript_state
       v_retention := converge_transcript_retention(auth.uid())
       v_transcript_retained := true
     EXCEPTION WHEN OTHERS THEN
       v_transcript_retained := false
       v_retention_sqlstate  := SQLSTATE      -- sanitized: code only, never row content
     END
```

Why the transcript UPDATE must be **inside** the same subtransaction as the coordinator, not before it: if the
coordinator fails after the transcript has landed, the row is transcript-bearing and unrotated — exactly the
third-transcript breach. Rolling both back together is what makes the invariant hold on the failure path.

`transcript_state` needs no special handling: the derivation trigger runs on the transcript UPDATE, and the
subtransaction rollback reverts it with the text, so the row honestly reads `not_captured` (Ruling 1.3). It is
never claimed `available` without text — the `sessions_expired_transcript_null_check` CHECK and the trigger both
still hold.

### Structured outcome (Ruling 1.4)

```json
{ "success": true, "session_saved": true, "transcript_retained": false,
  "retention_status": "error", "retention_sqlstate": "55000",
  "final_status": "completed", "transcript_state": "not_captured",
  "next_action_signal": { ... } }
```

`transcript_retained` is returned on the success path too (`true`), so the client reads one field rather than
inferring from an absence.

## 2. Idempotent replay must not skip convergence (Ruling 1.8)

**Current defect:** the idempotent `RETURN` sits at line 106, the coordinator call at line 157 — so a replay
provably cannot re-run convergence.

**Fix:** convergence moves to a single exit path traversed by **both** the fresh-completion and idempotent-replay
branches. A replay therefore re-runs convergence and reports its status.

**Deliberate consequence, and the honest reading of Ruling 1.7/1.8.** If retention failed, the stored transcript
is NULL. A replay carrying the transcript then **mismatches the idempotency predicate and conflicts (40003)**
rather than quietly writing it. We do **not** relax the predicate to let it through: that would re-open the
third-transcript breach through the back door, and this PR exists to remove exactly that class of silent hole.

Per Ruling 1.7 no transcript-recovery path is claimed, because none is implemented: the local recovery draft is
content-free, and only the in-memory retry object holds the transcript, which a reload loses. The transcript is
therefore **treated as unavailable** — stated in the UI, not left waiting for an unobservable retry.

**For the Consultant:** the residual sharp edge is that a client which resends the transcript on retry gets a
`40003` conflict rather than a friendly result. The client fix is to not resend after `transcript_retained:false`.
Flagging it as a deliberate trade rather than leaving it to be discovered.

## 3. Dual size bound (Ruling 5)

Rejected if **either** bound is exceeded; never truncated.

| bound | check | purpose |
|---|---|---|
| 50,000 Unicode characters | `length(p_final_transcript)` | product ceiling with headroom over the ~15k a 600s recording yields |
| 200,000 UTF-8 bytes | `octet_length(p_final_transcript)` | stops a multi-byte-heavy input defeating the storage purpose |

`max_persisted_transcript_chars()` becomes `max_persisted_transcript_chars()` + `max_persisted_transcript_bytes()`
so both are introspectable by the readback. The DB stays authoritative; a client preflight is UX only and never
the enforcement point. Distinct SQLSTATE/message per bound so the readback and logs can tell which one tripped.

## 4. Remove the redundant metrics PATCH (RETURN 3)

The `updateSession` PATCH in `stopRecording` is now fully redundant — the RPC writes those columns atomically.

**Care needed, and this is the part most likely to bite:** `metricsPersisted` from that PATCH currently gates
Progress evaluation. Removing the PATCH without re-pointing the gate would silently disable Progress. The gate
moves to the RPC's own result (`success && session_saved`), so Progress is evaluated exactly when the metrics
genuinely landed. This also removes the misleading "some analysis metrics could not be updated" banner at its
source rather than suppressing it.

## 5. Real coordinator + real concurrency (RETURN 4)

- **Real coordinator:** load the actual R1 (`20260803000000`) and R2 (`20260804000000`) migrations, as
  `transcript-retention-converge-on-save.integration.test.ts` already does. Prove a real **three-session
  rotation**: sessions 2 and 3 retained, session 1 expired, session 1's metrics and progress contribution intact.
  No stub.
- **Real concurrency:** a `postgres:` **service container**, following the five existing matrix workflows
  (`progress-mode-separation-matrix` et al). PGlite is single-connection and cannot show contention; this proves
  concurrent completions for one user serialize on the shared `user_profiles` lock, and that two racing
  completions cannot produce a third transcript-bearing row.

## 6. PostgREST overload / schema cache

- Verify **exactly two** `complete_session` entries (legacy + the new atomic one). Three means the Stage-A
  overload survived and 10-named-argument calls are ambiguous (300 Multiple Choices) — the readback's first check.
- Verify PostgREST resolves the new signature after a schema-cache reload, since a stale cache produces the same
  PGRST202 symptom as a missing migration and would be misdiagnosed as the latter.

## 7. e2e RPC mock

e2e runs against a real un-migrated database, which is what turned all four shards red. The client adopts
`p_final_transcript` only after application; until then e2e mocks the completion RPC contract so the new client
path is exercised without depending on migration state. This keeps the CI/migration deadlock from recurring.

## 8. Client changes

- Consume the structured outcome; surface `transcript_retained: false` with truthful copy — the session and its
  metrics were saved, its transcript could not be retained. **Never** generic success, and never "transcript
  saved".
- Do not resend the transcript on a retry after `transcript_retained: false` (see §2).
- Re-point the completion privacy guard in the **same** increment that adopts the parameter.

## Order of evidence

1. Real-coordinator three-session rotation (PGlite, real R1/R2).
2. Multi-connection concurrency (Postgres service container).
3. PostgREST overload + schema-cache verification.
4. Full unit collection (no subset) + e2e.
5. Exact-head GitHub Actions.

Migration application remains a separate, later gate.
