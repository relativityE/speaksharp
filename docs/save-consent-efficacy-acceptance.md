**Deliverable:** Sam owns a bounded test-suite efficacy increment under #1539. Extend the existing `pnpm test:efficacy` and required CI evidence for Retry Save and account-wide saving/coaching consent. No replacement framework or product behavior change.

**Expected outcome:** CI cannot report release-critical save and consent evidence green when it never ran the right test, accepted a bad save, or let a disabled privacy choice send or persist content.

1. Map the user's outcomes to current save replay, owner isolation and consent tests. Verify which suite actually executes each assertion, what the existing gate admits, and what #1689, #1721, #1855 and #1856 already cover.
2. Use independent evidence: exact owner and save key, persisted row count and contents, and outbound provider call and coaching persistence counts. Require post-opt-in and default-off controls in Open Mic and Focus Points where the shared gate applies.
3. Plant specific breaks for a first request accidentally forwarded, duplicate/foreign completion, transcript persistence without consent and coaching send without consent or after revocation. Add coverage only where the existing tests cannot kill the break.
4. Require the clean baseline and exact intended failure for each selected break. A missing test, setup/import failure, skip, stale input or unbound receipt is not a successful control.
5. Wire those named results into the existing required evidence lane. Prove missing or stale evidence refuses and prove correct, current evidence passes. Don't count CI test proof as production journey acceptance.
6. Record the exact tests and controls for #1539, batch actionable review findings, and qualify one clean head. No broad cleanup, provider calls, production writes or journey-run dependency.

**Prior work:** #1689 (merged: consumed evidence and flaky accounting), #1721 (merged: source qualification is separate from live acceptance), #1727 (merged: owned runner copies), #1855 (merged: save replay and owner isolation), #1856 (merged: lease and admission controls), and #1843 (closed without merge: false-green/trial-access investigation, reference only). Reuse rather than repeat. Keep #1539 open for the remaining audit.

**Deviation rule:** Comment here with the changed step, reason, evidence and revised action. Escalate a verified out-of-scope issue to Sam and the PO for one separate PR for that issue only. No repeated review cycles on unchanged code.

Draft starting point: acceptance contract only. Implementation follows #1884.
