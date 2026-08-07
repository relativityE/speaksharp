# Release Backlog

This file contains only unfinished work that survives review against one of two tests:

1. it is required to reach or qualify a Flawless Launch; or
2. it is a necessary product or codebase fix with a clear acceptance boundary.

Useful requirements from overlapping records are consolidated into one authoritative issue or PR and
that surviving item is updated. Work with no surviving requirement is deleted. Completed, refuted,
superseded, and historical work does not remain here; commits, merged PRs, and git history preserve its
evidence.

Moving SHAs, workflow runs, deployment state, and the current accepted marker belong only in
`RELEASE_STATUS.md`. This backlog records unfinished outcomes and their dependency order.

---

## 1. Product truth

- **Private is SpeakSharp's primary product and value proposition.** It is the default and recommended
  engine for real practice.
- **Browser is secondary.** During the current release-candidate path it remains a truthful
  compatibility path, never an equal-value substitute for Private.
- **Cloud is globally off, customer-invisible, and unavailable.** It is not a subscription benefit or
  fallback.
- A recording never silently changes engines. Engine and provenance claims must remain truthful from
  start intent through save, retry, recovery, and discard.
- The core product outcome is the **Practice Loop**:
  `complete practice -> receive one evidence-backed action -> accept Practice this next -> complete a linked repeat -> receive an honest outcome`.
- Guided Rehearsal extends that loop for a consequential event; it must remain Private-only and keep
  Guided and Freestyle evidence isolated.
- Pricing, quota, entitlement, privacy, retention, telemetry, and readiness claims must match server
  authority and deployed behavior.

---

## 2. Temporary release-candidate path — 17/19 to 19/19

Nineteen of nineteen is a **temporary release candidate**, not Flawless Launch. It establishes the
complete candidate that then enters automated qualification, polish, and manual/human testing.

### P0-A — 17/19: canonical production Practice Loop proof

- **Authority:** #1047 through PR #1166.
- **Outcome:** prove the complete Practice Loop on the canonical production host at the exact deployed
  release identity.
- **Acceptance:** independent exact-head review and CI/SCA; separately authorized deploy/proof;
  authenticated disposable user; two linked sessions; evidence-backed action; zero Cloud traffic;
  fail-closed release-identity check; guaranteed cleanup; zero marked residue; sanitized one-day
  evidence.
- **Priority:** P0; no later work may claim 17/19 without the executed production proof.

### P0-B — 18/19: truthful Private authority and Guided loop

- **Authorities, in order:** PR #1163 -> PR #1151 -> #1046 Guided G2.
- **Outcome:** establish server-owned pre-session Private provenance without phantom sessions, prove
  mock-free exact-SHA Private recording, then complete the first Guided Rehearsal loop.
- **Acceptance:**
  - owner-bound, expiring, single-active pre-session intent registered before capture;
  - failed start creates no saved session or usage;
  - successful recording binds the intent exactly once; foreign, expired, replayed, and late intents
    fail closed;
  - terminal attribution cannot remain indefinitely pending or be promoted from caller-seeded data;
  - mock-free Private recording produces and durably saves a non-empty transcript with no Cloud;
  - Guided create -> rehearse -> truthful point/time evidence -> one action -> linked repeat works with
    Freestyle isolation and the approved retention contract;
  - migration apply, deployment, maintained-account proof, qualification, and activation remain
    separate Product Owner decisions.
- **Priority:** P0; complete strictly in dependency order.

### P0-C — 19/19: canonical reconciliation

- **Authority:** #1051 through PR #1128, with the final current-main reconciliation as a separately
  reviewed increment.
- **Outcome:** every surviving requirement is represented once in the canonical roadmap and evidence
  archive; duplicates and dead work are removed.
- **Acceptance:** reconcile actual merged/current-main state; consolidate unique useful findings into
  one authority; delete records with no surviving requirement; prove the 19/19 count; independent
  exact-head acceptance; Product Owner-authorized merge.
- **Priority:** P0; terminal step after the preceding counted work is accepted.

---

## 3. Flawless Launch qualification after the temporary release candidate

The release candidate must pass the following retained work before the Product Owner can make the
final GO/HOLD decision. These are qualification requirements, not extra 19/19 markers.

### P0 — Complete exact-SHA user-journey qualification

- **Authority:** #1143 / PR #1153.
- **Outcome:** one fail-closed cradle-to-grave contract for Private, the Practice Loop, Guided, and all
  required negative paths.
- **Acceptance:** no mocks or injected sessions; exact deployed identity; UI, network, persistence,
  reload, and server evidence; unavailable or skipped behavior cannot pass; Cloud and automatic engine
  switching are rejected.

### P0 — Device, browser, accessibility, and responsive qualification

- **Authority:** #1144 / PR #1152.
- **Outcome:** the qualified journey works on the supported browser/device matrix and remains usable
  with keyboard, assistive semantics, zoom/reflow, and constrained layouts.
- **Acceptance:** dependency-backed cells execute on the release candidate; blocked cells cannot be
  reported as passed; failures map to a specific correction and rerun.

### P0 — Product truth and customer-facing claims

- **Authorities:** #1120 / PR #1155 and #1118.
- **Outcome:** Private is primary, Browser is secondary, Cloud is off, and every entitlement, quota,
  CTA, price, privacy statement, and offer matches authoritative server behavior.
- **Acceptance:** no Cloud value claim, Private-as-Pro-only claim, unsupported price, false unlimited
  claim, or clickable payment path while billing is closed; UI/server contract matrix passes.

### P0 — Observability, failure response, and launch operations

- **Authorities:** #1145 and #1147 / PR #1156.
- **Outcome:** content-free success/failure visibility plus a usable support, incident, rollback, and
  GO/HOLD playbook.
- **Acceptance:** the server-backed `linked_repeat_outcome_resolved` event cannot be manufactured by
  client retries; critical failures alert without speech content; owners can diagnose known failure
  classes; every production mutation and rollback remains explicitly authorized.

### P0 — Clean data and human-test reconciliation

- **Authorities:** #1146, #1087, and #1086.
- **Outcome:** distinguish real users from synthetic/test traffic, reconcile retained field-tester and
  Report Issue evidence, and remove misleading Basic credential/fallback paths from qualification.
- **Acceptance:** read-only inventory first; lawful retention; sanitized aggregates only; every known
  actionable human-test finding maps to one fix; maintained Free/Pro fixtures are explicit; destructive
  cleanup requires separate Product Owner authorization and a zero-residue proof.

### P1 — Review-evidence and database-security hardening

- **Authorities:** #1132 / PR #1134 and #1097 / PR #1135.
- **Outcome:** review evidence is short-lived and sanitized, and exposed SECURITY DEFINER functions
  have a verified bounded remediation path.
- **Acceptance:** raw audio, transcript, identity, traces, and broad binary roots cannot cross the
  upload boundary; evidence is exact-SHA-bound; real callers are verified before grants change; real
  PostgreSQL and negative-role proofs pass before any authorized production mutation.

### P1 — Product identity and external-trial readiness

- **Authority:** #1149.
- **Outcome:** the product name, mode terminology, and visual identity communicate calm,
  privacy-led rehearsal before a rigorous external cohort.
- **Acceptance:** owned and legally reviewable identity; intuitive Private/Guided language; no
  third-party boundary; no unsupported trademark, domain, DNS, or launch claim.

### P1 — Practice-loop comprehension and product-value validation

- **Authorities:** #1116 / PR #1121 and #1102.
- **Outcome:** users can begin a purposeful Private practice, understand the one next action, complete
  a linked repeat, and recognize the outcome; Guided value is tested with real consequential events.
- **Acceptance:** Practice Focus does not alter evidence formulas or become a score; Browser
  calibration is not counted as product activation; waitlist interest and stated willingness are not
  demand proof; real behavior and, where applicable, a real offer/deposit are the evidence.

### P1 — Execution integrity

- **Authority:** #1125 / PR #1126.
- **Outcome:** concurrent agents cannot silently collide in the same worktree or branch while launch
  corrections are in flight.
- **Acceptance:** one owner per worktree and branch; malformed or contradictory lease state fails
  closed; handoff is explicit; tooling never deletes or force-resets work.

---

## 4. Planned testing follow-up — Browser quick test

- **Authority:** #1165.
- **Relationship to launch:** retained product-direction work, but **not a Flawless Launch gate**.
- **Sequence:** workshop and validate it after the temporary release candidate enters testing, using
  real usability feedback before implementation.
- **Outcome:** clicking the main microphone starts Private directly. Browser becomes a separate,
  secondary quick-test/compatibility action that helps a user understand microphone access or recover
  toward Private; it is not a peer engine selection.
- **Acceptance before implementation:** settle placement, duration, whether results save, Progress
  eligibility, recovery copy, and analytics meaning; preserve truthful Browser provenance; never
  silently fall back; never weaken Private, Guided, retention, or attribution authority.
- **Current boundary:** workshopping only. No architecture, persistence, authority, or runtime change
  is authorized by this row.
- **Priority:** P1 after testing begins and immediate release-candidate defects are triaged.

---

## 5. Engineering efficiency — unit-coverage runtime

- **Authority:** #1130.
- **Sequence:** after the Browser testing-direction checkpoint above, unless CI delay becomes an active
  release blocker and the Product Owner reprioritizes it.
- **Evidence:** the authoritative unit-coverage job runs the full Vitest coverage suite; the current
  inventory is 3,188 tests. Database-heavy tests and repeated PGlite startup dominate execution, while
  a small set of retry tests uses real waits. Compatibility shard jobs do not replace this coverage
  authority.
- **Outcome:** shorten unit-coverage feedback without dropping behavioral requirements or creating
  multiple competing coverage binaries.
- **First bounded experiment:** benchmark the exact current suite with `VITEST_MAX_FORKS=2` versus
  `3`; compare wall time, flake rate, peak memory, test count, and coverage totals. Adopt the faster
  setting only if results are stable.
- **Next optimizations if the benchmark is insufficient:** consolidate repeated database bootstrap in
  the heaviest suites; replace proven real-time retry waits with deterministic fake timers; delete only
  assertions proven to test obsolete behavior.
- **Acceptance:** all 3,188 tests remain accounted for unless a reviewed deletion names the obsolete
  requirement; coverage thresholds and critical Practice Loop assertions do not regress; exact-head CI
  remains deterministic; the improvement is documented with before/after measurements.
- **Priority:** P1 engineering efficiency; never trade integrity for a cosmetic runtime reduction.

---

## 6. Other retained fixes and consolidation

### P2 — Controlled Private v4 integration

- **Authority:** #1139.
- **Relationship to launch:** not a Flawless Launch gate; v2 remains the release default.
- **Outcome:** preserve the qualified v4 work behind one version authority without mid-session switching,
  provenance ambiguity, or accidental activation.
- **Acceptance:** session-latched `v2 | v4` resolution; invalid configuration fails observably to v2;
  actual-producing-engine provenance survives fallback; no selector or default change; any v4 activation
  or default change is a separate Product Owner decision.
- **Priority:** P2 after the active release/testing and efficiency sequence unless a current-main defect
  makes the version boundary necessary sooner.

### P2 — Finish the #1006 salvage decision

- **Authority:** #1141.
- **Outcome:** retain only unique, still-needed product-value outcomes from the old observability draft.
- **Acceptance:** each surviving requirement is consolidated into one current authority; already-shipped,
  duplicated, speculative, unsafe, or unnecessary work is deleted; the old broad branch is never revived.
- **Priority:** P2 reconciliation work; close and remove this backlog row as soon as the bounded salvage
  matrix has no unassigned surviving requirement.

---

## 7. Backlog rules

- Every row must state evidence or a reproducible gap, outcome, acceptance criteria, priority, and one
  authoritative issue or PR.
- Consolidate overlaps into the surviving authority and update it. Do not keep parallel trackers.
- Delete a row immediately when its work lands with the required evidence.
- Delete non-surviving work after any unique useful requirement has been consolidated elsewhere.
- Do not keep a deferred, obsolete, superseded, recently closed, or historical section.
- Do not copy moving SHAs, CI runs, deployment status, developer assignments, or temporary blockers
  into this file.
- Merge, migration, deployment, production proof, activation, destructive cleanup, and tester exposure
  are separate Product Owner decisions.
- A green test is evidence, not product truth. A release claim must map to the user-facing requirement
  and the exact environment it proves.
