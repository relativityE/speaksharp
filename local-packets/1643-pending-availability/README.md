# Inactive pending API prerequisite and unknown responses

The pending/checkout source increment does not activate account deletion. Its
request/confirm/status RPCs require the separately applied forward migration
`20261018170000_account_closure_pending_checkout.sql` and the existing valid
backend target/worker runtime binding. A binding alone does not install schema.
The final destructive transition remains inaccessible to a pending request until
the remaining admission/settlement integrations and operational qualification exist.

Edge deployment and migration application are separate. Before the pending RPCs
are available, all three account-closure actions return structured503
`account_closure_unavailable` with `Cache-Control: no-store`. They send no email,
do not manufacture a pending/deleted outcome and do not fall back to the old
destructive confirmation adapter. This is an accepted limitation of the explicitly
inactive slice (Sam's P2 disposition on #1658), not an availability claim for the
unfinished account-exit feature. Ordinary checkout webhook compatibility remains
separate and tested across Edge-before-schema deployment.

A lost RPC/HTTP reply is unknown: confirmation may already have committed durable
pending. It must not automatically reopen admission, repeat destructive execution,
or imply that the account remains active/deletion succeeded. An authenticated,
owner-scoped status read recovers the same request without replaying confirmation.
If that read is also unavailable, retain unknown; do not translate503 into
`not_pending`. This specifies backend facts, not the withdrawn designer proposal
or a new waiting/sign-out/timeout policy.

Permanent controls: the real production dependency-builder suite covers all three
actions for explicit missing-function and lost-response errors (six cases), with
no email/destructive fallback and no-store responses. The actual-chain request/SQL
integration also commits confirmation, loses its RPC response, and recovers the
same pending intent through owner status without calling finish/destructive adapters.
