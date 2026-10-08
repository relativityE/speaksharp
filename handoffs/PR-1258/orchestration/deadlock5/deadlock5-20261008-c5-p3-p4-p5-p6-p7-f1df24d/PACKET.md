# C5 Packages 3 + 4 + packet-read recovery source packet

**Status:** immutable draft source packet for independent PM review. It is not an installed build or acceptance claim.

- Source commit: `f1df24d3ed87f8eb9235e283b3449d2789ffd9db`
- Source tree: `79b722398e026fb56d6a16d2286ee4f160ed0563`
- Files: 22 source, test, and receipt files; `MANIFEST.json` records each file's SHA-256 and byte size.
- Verification: 275 offline Python tests passed. Five socket/loopback tests remain HOLD. Node UI smoke, shell syntax, schema JSON parsing, and `git diff --check` passed.

This candidate adds durable exact-commit packet-read requests: transient failures are recorded and retried after shared backoff, terminal outcomes route one deduplicated local task to CLI PM, and startup/poll recovery closes the crash gap before that task is queued. Packet-read status is visible in PM context and the dashboard. The exact-head qualifier defers during persisted GitHub backoff and records a returned rate-limit response. Other included work covers affected-PR review state, separate Code/Security/PM qualification, dashboard blockers and selection, staged migration, and the per-repository host lock.

## Acceptance gaps

- F05 remains partial: retry/CLI PM recovery exists, but no separately authorized fallback reviewer outside local CLI PM is established.
- F11 remains partial: the qualifier subprocess cannot share the board's GitHub cursor/budget; remaining paths require an explicit contract and live evidence.
- External Browser PM/App Dev notification transport and real task-specific actor receipt/action evidence remain blocked (F13). GitHub publication is not delivery.
- Five host/loopback tests were not run pending the candidate-bound shared host lease and any required bind permission.
- Independent PM review, installed acceptance, and the complete C4 closure contract remain pending. Do not mark all R01–R42/F01–F16 resolved from this packet.
- No installation, restart, live migration, merge, deployment, or Production operation was performed.

See `TEST_RECEIPT.md` for the test record and limitations. Earlier packets remain immutable.
