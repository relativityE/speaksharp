# Session-save path: local client-to-database evidence

**Observed 16 November 2026:** The 29 focused tests in
[`session-save-path-contract.integration.test.ts`](../../../tests/db/session-save-path-contract.integration.test.ts)
passed on the #1846 candidate integrated with main `362fbd68`. The test
runs the real client save functions and shipped migration chain against
an isolated PGlite database through a local PostgREST-shaped transport.

The suite observed successful metric and transcript round-trip, rollback
on partial write failure, recovery after a lost response, and exact
wrong-owner and nonexistent-session refusals. An identical replay was
accepted and a replay changing only the word count returned SQLSTATE
`40003` without changing the row. Deliberate controls exercised lost
metrics and a swallowed transcript-write failure.

This evidence is local and synthetic. It does not verify a hosted
PostgREST deployment, production persistence, or release acceptance.
