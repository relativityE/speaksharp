# C5 Packages 3 + 4 source review packet

**Status:** draft source packet for independent PM review. This is not an installed build or acceptance claim.

- Source commit: `a2101ee310468c071459f99cfe82c8e94e791d69`
- Source tree: `59e91edd6981ef0a2aa5f5cc33e7026580ccc9b7`
- Files: 22 source, test, and receipt files; SHA-256 and byte size for every file are in `MANIFEST.json`.
- Verification: 271 offline Python tests passed. Five socket/loopback tests remain HOLD. Node UI smoke, shell syntax, schema JSON parsing, and `git diff --check` passed.

The source includes bounded GitHub packet/comment/review reads and shared rate-limit backoff (F05/F11), exact-head and affected-PR review monitoring with separate Code/Security/PM acceptance states (F06), truthful dashboard state and explicit PR selection (F14), verified staged state migration (F16), and a per-repository host lock (F07).

## Acceptance gaps

- External Browser PM/App Dev notification transport and real task-specific actor receipt/action evidence remain blocked (F13). A GitHub post is not delivery.
- Five host/loopback tests were not run pending the candidate-bound shared host lease and any required bind permission.
- Independent review, the finding-by-finding C4 closure map, installed acceptance, and product journey closure remain pending. Do not mark all R01–R42/F01–F16 resolved from this packet.
- No installation, restart, live migration, merge, deployment, or Production operation was performed or authorized by this packet.

See `TEST_RECEIPT.md` for the exact test and limitation record. The earlier immutable Package 2b packet remains at its existing path and is not modified.
