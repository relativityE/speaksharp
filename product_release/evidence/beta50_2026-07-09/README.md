# Beta-50 QA artifacts — 2026-07-09 (v0.9.0-rc0)

> **HISTORICAL EVIDENCE — point-in-time measurement, NOT current release truth.**
> This report records what was measured on its own date. It is **not** rewritten to look current, and it
> must not be: a measurement edited to match today's posture stops being evidence of anything.
> Current release posture: [`RELEASE_STATUS.md`](../../RELEASE_STATUS.md). Current work sequencing:
> [`ROADMAP.md`](../../ROADMAP.md).
> STT model selection is **not complete** — no Private model has been chosen; any model ranking below
> predates the #1304 certified harness and its frozen corpus.

Drop QA evidence here. Parent packet: [`../BETA_50_RELEASE_EVIDENCE_2026-07-09.md`](../BETA_50_RELEASE_EVIDENCE_2026-07-09.md).

**Redact before adding:** no passwords, tokens, auth headers, cookies, or private audio. Strip `Authorization`/`Cookie` headers from any HAR.

## Expected files

| File | From | Owner |
|---|---|---|
| `runA-desktop-*.png` | Run A screenshots (12: Home … reopened session; Score shot must show **Audience Impact**) | QA |
| `runA-console.txt` / `runA-network.txt` | Run A DevTools exports (preserve-log) | QA |
| `runB-mobile-*.png` | Run B mobile screenshots | QA |
| `runB-console.txt` / `runB-network.txt` | Run B DevTools exports | QA |
| `runC-report-normal.png` / `runC-report-optin.png` / `runC-failure.png` | Run C Report Issue states | QA |
| `runC-db-query.txt` | Run C `user_issue_reports` SQL output (ids/timestamps ok; no raw private content) | Dev |
| `runD-filler-*.png` | Run D filler count per surface | QA |
| `runE-export.pdf` | Run E exported PDF (watermark visible) | QA |
| `sell-off-final.md` | completed §14 table + GO/CONDITIONAL/NO-GO | Dev + Owner |

## Status

Empty until QA runs on the deployed app (https://speaksharp-public.vercel.app). Dev-owned pre-QA evidence is in the parent packet; these artifacts complete the gating QA rows.
