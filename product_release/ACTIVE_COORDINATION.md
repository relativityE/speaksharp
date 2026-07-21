# Active Coordination (tracked SSOT)

**Owner:** Prod Owner (relativityE)

The current active-coordination board — the working subset of `BACKLOG.md`. It is **not** a second backlog and **not** a historical ping log: the exhaustive backlog stays in `BACKLOG.md`; current ship/deployment posture stays in `RELEASE_STATUS.md`. No secrets, PII, transcripts, or audio — reference PRs and file paths only.

## Current baseline
- **Product code baseline:** `main` `65e58a62` (the #1010 CORS config fix on top of the private-first UX milestone `e9040464`, #1007/#1008). The frozen `v0.9.0-rc4` tag (`df909805`) is historical and is **not** the current baseline.

## Current work
- **Open draft:** **#1006** — reliable data-retrieval / observability / durable delivery (outbox + provenance + owner-alert + protected retrieval). **DRAFT, not activated.**
- **Current task:** #1006 corrections + independent review (see `BACKLOG.md` P0.4). Pre-approval blockers: concurrent-run-safe time-bounded provenance; queue-depth/age/dead-letter monitoring; executable rollback + worker-disable; privacy-safe pseudonymous (HMAC) PostHog identity; exact client-event retirement sequence.
- **Next task:** P0.4 completion → controlled #1006 activation review (Prod Owner-gated: migrations, workers, crons, reconciliation each require separate authorization).

_This file lists only current work. Merged PRs live in git history; deployment posture lives in `RELEASE_STATUS.md`._
