# #1884 privacy-choice terminal attribution (offline only)

Reference: #1835 migration 20261117105700 at 90415552. The invoker RPC
set_practice_privacy_choices_v1 is not the only possible writer. Owner-scoped
authenticated direct INSERT and UPDATE grants mean a revision-one row alone
cannot identify the RPC. A same-value update can also leave the revision
unchanged.

The candidate witness requires an independently confirmed, newly created
run-owned account; a separate exact-owner zero baseline before the request;
complete trusted guard observation of all relevant write paths from before
the first possible write, including direct table access and other writers;
exactly one admitted and forwarded POST to the first-choice RPC, correlated to
the exact run/binding/identity/attempt, with expected revision null, save true,
coaching false; and a later independent read of exactly one same-owner row
with revision 1, consent version 1, save true, coaching false. A conflicting,
second, direct, or unobserved writer defeats attribution. This evidence tells
only whether this first-choice write reached the expected committed state.
It is not a stopped-writer token or evidence for any other endpoint.

A zero or otherwise nonmatching read after forwarding is unresolved, not
proof of no write or refusal. Do not delete the consent row directly. The FK
cascades on an otherwise authorized Auth delete; separate same-owner zero
readback after that cascade belongs to residue proof and never retroactively
proves this writer's terminal result.

This is review prep only. The booleans and sequence in these fixtures are not
production producers. Positive production attribution needs independently
verified identity, complete actual guard coverage, no other exact-owner
sessions/writers outside the observed boundary, and privileged readback that
is already reviewed and authorized. The test does not open a route, add a
role, alter migrations, or invoke any application/hosted endpoint.

    node --test tools/cloud-test/tests/node/manual/j4a-privacy-terminal-review.test.cjs
