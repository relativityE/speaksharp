# C5 Packages 3 + 4 + packet-read recovery source packet

**Status:** immutable draft source packet for independent PM review. It is not an installed build or acceptance claim.

- Source commit: `25829bcccc9322f51334ce05cb2372a8045a1df2`
- Source tree: `5b354292d96f9a1816221382ca4080740b1bd7be`
- Files: 22 source, test, and receipt files; `MANIFEST.json` records each file's SHA-256 and byte size.
- Verification: 273 offline Python tests passed. Five socket/loopback tests remain HOLD. Node UI smoke, shell syntax, schema JSON parsing, and `git diff --check` passed.

This candidate adds durable exact-commit packet-read requests: transient failures are recorded and retried after shared backoff, terminal results route one deduplicated local task to CLI PM, and packet-read state is visible in PM context and the dashboard. It retains bounded file/manifest/time limits, exact hashes, and categorized read failures. Other included package work covers affected-PR review state, separate Code/Security/PM qualification, dashboard blockers and selection, staged migration, and the per-repository host lock.

## Acceptance gaps

- F05 remains partial: retry/CLI PM recovery exists, but no separately authorized fallback reviewer outside local CLI PM is established.
- External Browser PM/App Dev notification transport and real task-specific actor receipt/action evidence remain blocked (F13). GitHub publication is not delivery.
- Five host/loopback tests were not run pending the candidate-bound shared host lease and any required bind permission.
- Independent PM review, installed acceptance, and the complete C4 closure contract remain pending. Do not mark all R01–R42/F01–F16 resolved from this packet.
- No installation, restart, live migration, merge, deployment, or Production operation was performed.

See `TEST_RECEIPT.md` for the test record and limitations. Earlier packets remain immutable.
