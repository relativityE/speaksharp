<!-- speaksharp-pr-contract:v1 -->
<!-- Keep every heading and field. Drafts may use PENDING. Ready-for-review PRs may not. -->

## PR lifecycle gate

<!--
Every PR moves through one fixed lifecycle. Name the phase you are in and the single next
transition. Drafts live in Phase 0-1 and may leave the fields below as PENDING; a
review-ready (non-draft) PR must be exactly Phase 2 with Active review return resolved and
a valid correction-round count.

Phase 0 - Governing issue defined: outcome, falsifiable acceptance criteria, risk, allowlist, authorization gates.
Phase 1 - Draft PR linked; implementation in progress; evidence may be pending.
Phase 2 - Review-ready: exact-head source + required CI green, evidence complete, pending None, status QUALIFIED.
Phase 3 - Under review; one consolidated PM/consultant return being resolved.
Phase 4 - Merge authorized and merged to main (separate Product Owner authorization).
Phase 5 - Production application/apply + readback (migration/deploy; separate authorization).
Phase 6 - Deployed; release identity re-read from window.__APP_RELEASE__ and matched to the intended SHA.
Phase 7 - Real-device/customer acceptance proven; governing issue CLOSED.

Correction round count starts at 0 and increments each time a review return sends this same
increment back. On the second correction loop (count reaches 2), stop patching: regenerate
or rescope the increment and record that in Correction disposition.
-->

- Current phase: PENDING
- Allowed next transition: PENDING
- Active review return: PENDING
- Correction round count: PENDING
- Correction disposition: N/A - not yet at the second correction loop
- Review cadence: One consolidated PM review per review-ready state; consultant only for security/privacy, qualification-void, or product-contract escalation.
- Stop rule: Missing qualification preconditions => VOID, not PASS; a second correction loop forces regenerate or rescope.
- Separate authorities: Merge, migration, deployment, activation, and production proof are each separately authorized.

## Governing issue

<!-- Required. Use Refs #123 for an increment; use Closes #123 only when this PR completes every remaining acceptance criterion. -->
Refs #

## User outcome

<!-- What changes for the user/operator, and why is this the smallest coherent increment? -->

## Scope and allowlist

- Changed-file allowlist: PENDING
- Explicitly out of scope: PENDING
- Production action on merge: PENDING

## Exact artifact and freshness

Run immediately before reporting status or requesting review:

```bash
git fetch origin --prune
git rev-parse HEAD
git rev-parse @{upstream}
git rev-parse origin/main
git status --short
git diff --name-only origin/main...HEAD
```

- PR head SHA: PENDING
- Remote PR head SHA: PENDING
- Base/main SHA: PENDING
- Worktree state: PENDING
- Tool/runtime versions: PENDING
- Artifact hashes: PENDING
- Evidence scope: PENDING

### Browser/deployed freshness

<!--
For browser, deployed, or real-device evidence, REQUIRED means:
1. Open a new page/context or reload with cache disabled.
2. Read window.__APP_RELEASE__ before recording or asserting.
3. Compare it with the intended deployed/PR SHA.
4. Confirm the harness/selectors exist on that exact release.
Missing or mismatched release identity makes the run VOID, never PASS.

If this PR needs no browser/deployed proof, write:
NOT REQUIRED — <specific reason>
and explain N/A fields below.
-->

- Browser/deployed proof: PENDING
- Target URL/environment: PENDING
- Expected deployed SHA: PENDING
- Browser release identity: PENDING
- Browser release match: PENDING
- Cache/reload action: PENDING
- Harness/selectors verified against exact release: PENDING

## Evidence completed

<!-- Exact command/workflow, run ID, tested SHA, terminal conclusion, and what it proves. -->

PENDING

## Evidence pending

<!-- Ready-for-review value must be exactly: None. -->

PENDING

## Mutation / failure proof

- Mutation proof: PENDING

<!-- Every new gate must be deliberately broken and shown to exit nonzero. If no gate changed, use N/A — <reason>. -->

## Limitations and dependencies

- Known limitations: PENDING
- Dependencies/ordering: PENDING
- Substitutions used only for diagnosis: PENDING

<!-- Mocks, source-text checks, PGlite, local substitutes, screenshots, and historical runs may diagnose but cannot replace a required authoritative proof. -->

## Status

- Status: OPEN

<!-- Allowed: OPEN, IMPLEMENTED/NOT QUALIFIED, VOID, QUALIFIED, BLOCKED. -->

## Review readiness

- [ ] Governing issue is linked.
- [ ] PR head equals remote PR head.
- [ ] Base/main and worktree state were re-read at the reported SHA.
- [ ] Changed files match the allowlist.
- [ ] Required tool versions and artifact hashes were captured.
- [ ] Browser/deployed evidence passed the release-identity gate, or is explicitly not required with a reason.
- [ ] Each new gate was mutation-tested to fail, or is explicitly not applicable with a reason.
- [ ] Full required evidence is complete; selected subsets are not presented as qualification.
- [ ] Evidence pending is `None.`
- [ ] Limitations and residual risks are explicit.
- [ ] Status is `QUALIFIED`.
- [ ] No review is requested before every item above is satisfied.

<!--
Stop rules:
- Missing qualification preconditions => VOID, not PASS.
- After two correction rounds on the same artifact, regenerate or rescope it.
- Log unrelated tooling/hygiene; fix inline only for security/privacy exposure or a false-green risk on the critical path.
- Merge, migration, deployment, activation, and production proof remain separately authorized.
-->