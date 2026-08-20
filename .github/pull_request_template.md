<!--
speaksharp PR — two-clock evidence contract.

You (the author) write prose only: outcome, scope/decisions, limitations, and the
human attestations. The PR Evidence Contract bot owns the GitHub facts and evidence
state: it writes and maintains the `pr-evidence-bot` block below from the actual head
SHA (code clock), the governing issue's Acceptance-criteria hash (intent clock), the
real changed-file set, and the risk tier. Do not edit the bot block by hand — it is
overwritten on every run. Changing the governing issue's Acceptance criteria, or the
code, invalidates evidence and returns the PR to Draft.
-->

## Governing issue

<!-- Required. Use Refs #123 for an increment; Closes #123 only when this PR completes every acceptance criterion. The issue must exist first and carry a non-empty "## Acceptance criteria" section. -->
Refs #

## User outcome

<!-- What changes for the user/operator, and why is this the smallest coherent increment? -->

## Scope and decisions

<!-- The intended change, explicit exclusions, the merge/deploy effect, and any judgment calls with their alternative. -->

## Limitations

<!-- Known limitations, residual risks, and any diagnostic-only substitutions (which never qualify an authoritative boundary). -->

## Review readiness

<!-- Human attestations. The bot cannot judge these; you must. -->
- [ ] Acceptance criteria are observable and sufficient for this increment.
- [ ] Scope is the smallest coherent increment and the exclusions are honest.

<!--
Authorizations are separate and each is its own decision:
1. Merge authorization (includes any declared automatic deploy effect).
2. Production-state authorization (migrations, activation, paid/live-provider action,
   secret/config mutation, or a direct production write).
PM review is quality review, not a production authorization. Real-device testing is
evidence, not an approval.

The bot maintains the managed facts block below. Leave it in place; do not edit it.
-->

<!-- pr-evidence-bot:v1:start -->
_The PR Evidence Contract bot will populate this block on the first run._
<!-- pr-evidence-bot:v1:end -->
