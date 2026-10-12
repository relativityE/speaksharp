# Reported queue and failure sequences

| Sequence | Required behavior/readback |
|---|---|
| #873/#874 RESPONDED, recipient action unverified | Publication remains separate from authenticated receipt/result and PM disposition. No inferred completion. |
| #875/#876/#878/#879 atomic board patch rejection | Exact per-queue reason retained. Empty optional checkpoint normalized; stale lease/owner conflict still requires fresh typed PM readback. No bypass or blind retry. |
| #877 PM timeout and cleanup denied | Historical terminal error/no retry preserved. New worker checks its owned process group including descendants; denied/unverified cleanup blocks replacement. Old PM cleanup requires host inspection. |
| #880 queued Dev task, no receipt/result | Durable inbox plus registered worker; verify original frozen recipient/checkout/lease. Missing transport stays blocked. |
| #881 queued GitHub-to-PM and open asks | Serialized owning PM lane and typed ask dispositions remain; event copies are observation only, never a second writer. |
| Unnamed PM decision skipped by keyword/seen filter | Explicit four-role notices, no keyword skip. Edited/unaddressed decisions preserved. Separate fallback filter remains Dev-owned. |
| Waiting PR, running CI, reviews started/completed, edited Security | Check fingerprints, run/attempt and discussion edits observed; event changes alone do not qualify a PR. |
| Worker restart, duplicate event, lost turn-start response | Resume actual saved thread. Unique action ID and pre-send ledger prevent replay; uncertainty blocks further work. |
| Receipt present, result absent | Pickup is distinct from completion. Worker waits; authenticated result required. |
| #180301/#180302 host-slot/route asks | Inspect current host processes and actual owner/release evidence. Establish one serialized order; clone-local test locks are not a host-wide interlock. |

This describes source behavior and installed reconciliation, not a claim that the old host queue was repaired remotely. Keep original action/source/lease identities.
