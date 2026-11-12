# Outcome 4 D2: keeping the chosen tip with its repeat (proposal, revision 3)

Status: proposal for Sam's review, in draft PR #1827. Nothing here is applied to any database, merged or released,
and none of it is authorised by this document.

## What changes for the user

On a repeat's Progress page, under the stored comparison:

- `Tip you chose for this repeat: “<tip>”`
- `This tip is kept with this repeat until you save another session.`

When no tip is kept: `No coaching tip is kept for this repeat.` On a database without the migration: no tip line.
The tip is quoted, never measured or scored (D1). The existing line "This comparison measures delivery, not whether
the coaching tip was followed." stays.

## Retention rule (proposed)

A copy of the original session's coaching tip (`what_to_try_next`, server-validated with the app's own review
contract) is taken when Practice again is pressed, but only if that original is the user's newest saved session and
its transcript has not expired. Pressing Practice again on an older session, even one whose review is still available
because retention is off, copies nothing. That copy:

1. Lives with the original while the original is still the newest saved session, and is deleted if the original
   expires before a repeat is bound.
2. Is bound, once and by the server, to the first session completed after Practice again was pressed that is newer
   than the original. The binding happens when that session's status becomes `completed`, which in
   `complete_session_v2` is step 1, before the transcript write and newest-one retention expire the original.
   It can never be moved to another session.
3. Is deleted when any newer session is saved (with or without coaching or a kept transcript), when its repeat's
   transcript expires, when its repeat is deleted, when the attempt is abandoned, when the attempt is resolved to a
   session other than the bound repeat, when a newer session that cannot be the repeat is saved, and when the
   account is deleted. Deleting the original deletes its recommendation and attempt.

Net effect: per attempt, at most one session's worth of chosen-tip text exists, and only while that session is the
user's newest saved session, which is the lifetime newest-one retention already gives that session's transcript.
The rule does not depend on retention being activated: with retention off, the copy lives shorter than its source.

Pressing Practice again, saving and expiry are decided one at a time per user (a per-user advisory transaction lock),
so a new copy cannot be taken from an original that a concurrent save or expiry has just made older or expired.

## Disclosure (proposed wording)

- Inline, beside the tip (implemented on the local branch): "This tip is kept with this repeat until you save
  another session."
- Privacy or data page, if one lists what is kept per session: "When you press Practice again, SpeakSharp keeps a
  copy of that session's coaching tip with your next saved session, so the repeat can show which tip you chose. The
  copy is deleted when you save another session, delete or abandon the repeat, or delete your account. SpeakSharp
  never measures or scores the tip."

## Review blockers and where each is met

| Blocker (Sam, #1824 review of `30e07d17`) | Answer in revision 2 | Proof |
|---|---|---|
| The repeat save expires the original before the advance binds the repeat | The server binds the repeat when it completes, before retention runs in the same save; the advance can only confirm it | Real-save test "binding before the original expires" (event log shows bound, then expired); fails when the binding is deferred past expiry |
| The purge trigger needs `ai_suggestions IS NOT NULL`, so repeats without coaching are missed | Cleanup keys on saves, expiry, deletion and lifecycle, never on coaching or transcript content | Real-save tests "no coaching on the repeat" and "no transcript text on the newer save"; each fails against its control; PGlite "own expiry" test |
| Repeat deletion is `ON DELETE SET NULL`, not cascade | Both links are SET NULL and the BEFORE UPDATE guard deletes the copy when either goes null | PGlite "deleting the repeat" test |
| Keeping the tip past its source's expiry changes retention | Explicit rule and disclosure above | This document |
| Server-validated, immutable binding | Set only by the completion trigger, validated (owner, completed, newer than the original, started after Practice again), never moved; tip insert-only | PGlite "binding" test |
| Abandoned attempts, delayed retries, concurrent saves | Each clears or waits as above; the completion trigger locks the user's tip rows first | PGlite tests; `tests/db/manual/repeat-practised-tip-concurrency.sh` on PostgreSQL 16 |
| Revision 2 return: an unbound copy survived its original expiring | Expiry now deletes a copy not yet bound whose original is the expired session; a copy already bound stays | PGlite and real-save "unbound copy goes when its original expires" tests; each fails against its control |
| Revision 2 return: an older original's tip was copied | The copy is taken only from the newest saved, unexpired original; accept, save and expiry share a per-user advisory lock | PGlite and real-save "only the newest saved session" tests; concurrency scenarios 6 to 9 fail without the lock |
| Revision 2 return: tied start times made one test flaky | Fixture starts are strictly ordered; equal start times are tested on purpose, both ways | PGlite "equal start times" tests |
| Owner-only reads, server-sourced text | Existing RLS select only; no client write path or new RPC | PGlite "owner" and "not callable" tests |

## Limits of the proof

- `tests/db/repeat-practised-tip-real-save.integration.test.ts` applies every shipped migration and saves through the
  real lease, create and `complete_session_v2`, with newest-one retention activated (and once without, as Production is
  today). The engine attestation, which an Edge function writes, and the coaching write are done as the service side
  would. The edge-case suite still drives the triggers with a fixture save.
- Production also serialises a user's saves with a NOWAIT lock on `user_profiles`; the concurrency script omits it
  so the migration is shown correct even when writes overlap.
- The e2e spec covers the tip line with mocked rows and has not run locally.
