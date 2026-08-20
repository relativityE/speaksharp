# #1318 Non-Archived Documentation Refresh Ledger

**Source tree:** `main@307462931905ddcaac1eac303821c4291b7e0257`  
**Starting inventory:** 92 Markdown/MDX/RST/AsciiDoc files outside `product_release/archive/**`  
**Archive rule:** zero changed paths under `product_release/archive/**`  
**Status:** OPEN — provisional classification complete; file-by-file review required.

This ledger is the completion authority for issue #1318. A row may move to
`RETAINED CURRENT`, `UPDATED CURRENT`, `CONSOLIDATED AND REMOVED`,
`CURRENT REDIRECT`, or `DELETED`.
No row may remain `REVIEW REQUIRED` when review is requested. Every retained
non-archive document must describe current product, operational, or governance
truth. Git history—not a stale Markdown body—is the historical record.

## Product truths applied during review

- MVP STT is Private only; AssemblyAI/Cloud is not a launch path.
- Gemini is used only for AI suggestions.
- The newest two saved-session transcripts are retained for review/PDF; older text
  expires while metrics continue informing Progress.
- Browser/deployed evidence begins with `window.__APP_RELEASE__`; mismatch or missing
  identity makes the run `VOID`.
- Retired Basic/canary secret names are not active identities.
- Merge, migration, deployment, activation, paid tests, and production proof are separate
  authorization decisions.
- A non-archive document remains only if it is useful and accurate now. Historical-only,
  superseded, duplicate, or misleading material is consolidated into a current authority,
  replaced by a current redirect when needed, or deleted.

## Protected canonical set and disposition criteria

These 14 Product Owner-approved `product_release` authorities are protected and must be updated, never deleted or reduced to redirects:

`README.md`, `PRODUCT_REQUIREMENTS.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `STT.md`,
`PROGRESS_AND_NEXT_ACTION.md`, `ENTITLEMENTS_AND_BILLING.md`, `QUALITY.md`,
`RELEASE_PROCESS.md`, `RELEASE_STATUS.md`, `OPERATIONS_AND_SECURITY.md`,
`TESTER_GUIDE.md`, `TESTER_OPERATIONS.md`, and `EVIDENCE_INDEX.md`.

`product_release/ROADMAP.md` is named by the approved canonical map but is absent from
the 92-file starting tree. It must be materialized from the approved source map and added
to this ledger before closeout. Changing the protected set requires a separate PO ruling.

### UPDATE / RETAIN CURRENT

Allowed only for a protected canonical or a distinct current operational document with no
canonical substitute. Verify its purpose, current audience, claims, commands, paths,
identities, and links. It must not create a duplicate authority.

### CONSOLIDATE AND REMOVE

Use when a file has still-useful current content that belongs in a protected canonical or
named current operational authority, and keeping both would duplicate authority. Record a
source-to-target section map, move every retained current fact, repair inbound links, and
remove the redundant source in the same PR.

### CURRENT REDIRECT

Use only when a live consumer requires the old path. The file may contain a current pointer
only—no independent claims. Record the active consumer, validated target, and removal
condition.

### DELETE

Use when no unique current content remains and the file is obsolete, historical-only,
superseded, duplicated, temporary, or has no current audience/execution dependency.
Deletion requires prior consolidation of useful current content, an inbound-link scan and
repairs, a named replacement authority or `none needed`, and git-history recovery details.

Decision order: protect/update the 14 → retain distinct current operations → consolidate
duplicates → redirect only for live dependencies → delete the remainder.

## Ledger

| # | Path | Provisional class | Canonical owner | Disposition |
|---:|---|---|---|---|
| 1 | `.agent/workflows/canary-tests.md` | OPERATIONAL | AGENTS.md | REVIEW REQUIRED |
| 2 | `.agent/workflows/coding-standards.md` | OPERATIONAL | AGENTS.md | REVIEW REQUIRED |
| 3 | `.agent/workflows/pr-merge-workflow.md` | OPERATIONAL | AGENTS.md | REVIEW REQUIRED |
| 4 | `.agent/workflows/skills/code-review/SKILL.md` | OPERATIONAL | AGENTS.md | REVIEW REQUIRED |
| 5 | `.github/runbooks/PAID_CANARY_CUTOVER.md` | OPERATIONAL | product_release/RELEASE_PROCESS.md | REVIEW REQUIRED |
| 6 | `.github/runbooks/flawless-launch-contract-audit.md` | OPERATIONAL | product_release/RELEASE_PROCESS.md | REVIEW REQUIRED |
| 7 | `AGENTS.md` | CURRENT AUTHORITY | AGENTS.md | REVIEW REQUIRED |
| 8 | `EXECUTIVE_SUMMARY.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 9 | `README.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 10 | `USER_GUIDE.md` | CURRENT AUTHORITY | product_release/TESTER_GUIDE.md | REVIEW REQUIRED |
| 11 | `backend/supabase/edge-functions.md` | OPERATIONAL | product_release/ARCHITECTURE.md / OPERATIONS_AND_SECURITY.md | REVIEW REQUIRED |
| 12 | `backend/supabase/howto-remote-supabase-deploy.md` | OPERATIONAL | product_release/ARCHITECTURE.md / OPERATIONS_AND_SECURITY.md | REVIEW REQUIRED |
| 13 | `docs/ARCHITECTURE.md` | CONSOLIDATE/DELETE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 14 | `docs/CHANGELOG.md` | CONSOLIDATE/DELETE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 15 | `docs/OUTLINE.md` | CONSOLIDATE/DELETE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 16 | `docs/PRD.md` | CONSOLIDATE/DELETE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 17 | `docs/README.md` | CONSOLIDATE/DELETE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 18 | `docs/ROADMAP.md` | CONSOLIDATE/DELETE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 19 | `ops-health/ops-health.md` | OPERATIONAL | product_release/OPS_HEALTH_DASHBOARD.md | REVIEW REQUIRED |
| 20 | `product_release/ACTIVE_COORDINATION.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 21 | `product_release/ARCHITECTURE.md` | PROTECTED CANONICAL — UPDATE REQUIRED | product_release/README.md canonical map | REVIEW REQUIRED |
| 22 | `product_release/ARCHITECTURE.operational.md` | CONSOLIDATE/DELETE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 23 | `product_release/BACKLOG.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 24 | `product_release/CODEBASE_MAP.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 25 | `product_release/DOC_MIGRATION_LEDGER.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 26 | `product_release/ENTITLEMENTS_AND_BILLING.md` | PROTECTED CANONICAL — UPDATE REQUIRED | product_release/README.md canonical map | REVIEW REQUIRED |
| 27 | `product_release/ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` | CONSOLIDATE/DELETE REVIEW | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 28 | `product_release/ENV_INVENTORY.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 29 | `product_release/EVIDENCE_INDEX.md` | PROTECTED CANONICAL — UPDATE REQUIRED | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 30 | `product_release/INTERNAL_TEST_PROTOCOL.md` | OPERATIONAL | product_release/README.md canonical map | REVIEW REQUIRED |
| 31 | `product_release/LAUNCH_ENV_CHECKLIST.md` | OPERATIONAL | product_release/README.md canonical map | REVIEW REQUIRED |
| 32 | `product_release/MANUAL_HARDWARE_VALIDATION.md` | OPERATIONAL | product_release/README.md canonical map | REVIEW REQUIRED |
| 33 | `product_release/OPERATIONS_AND_SECURITY.md` | PROTECTED CANONICAL — UPDATE REQUIRED | product_release/README.md canonical map | REVIEW REQUIRED |
| 34 | `product_release/OPS_HEALTH_DASHBOARD.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 35 | `product_release/PAID_OPS_HARDENING_RUNBOOK.md` | OPERATIONAL | product_release/README.md canonical map | REVIEW REQUIRED |
| 36 | `product_release/PRD.operational.md` | CONSOLIDATE/DELETE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 37 | `product_release/PRECEDENCE.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 38 | `product_release/PRIVATE_STT_ACCURACY_LEVERS.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 39 | `product_release/PRODUCT_FEATURES.operational.md` | CONSOLIDATE/DELETE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 40 | `product_release/PRODUCT_REQUIREMENTS.md` | PROTECTED CANONICAL — UPDATE REQUIRED | product_release/README.md canonical map | REVIEW REQUIRED |
| 41 | `product_release/PROGRESS_AND_NEXT_ACTION.md` | PROTECTED CANONICAL — UPDATE REQUIRED | product_release/README.md canonical map | REVIEW REQUIRED |
| 42 | `product_release/PUBLIC_LAUNCH_LEDGER.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 43 | `product_release/QUALITY.md` | PROTECTED CANONICAL — UPDATE REQUIRED | product_release/README.md canonical map | REVIEW REQUIRED |
| 44 | `product_release/QUALITY_METRICS.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 45 | `product_release/RC_GATES.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 46 | `product_release/RC_TEST_INVENTORY.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 47 | `product_release/README.md` | PROTECTED CANONICAL — UPDATE REQUIRED | product_release/README.md canonical map | REVIEW REQUIRED |
| 48 | `product_release/RELEASE_CLOSEOUT_LEDGER.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 49 | `product_release/RELEASE_PROCESS.md` | PROTECTED CANONICAL — UPDATE REQUIRED | product_release/README.md canonical map | REVIEW REQUIRED |
| 50 | `product_release/RELEASE_RECOVERY.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 51 | `product_release/RELEASE_STATUS.md` | PROTECTED CANONICAL — UPDATE REQUIRED | product_release/README.md canonical map | REVIEW REQUIRED |
| 52 | `product_release/ROADMAP.operational.md` | CONSOLIDATE/DELETE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 53 | `product_release/SCA_EXCEPTIONS.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 54 | `product_release/SECRETS_ATTACK_SURFACE_AUDIT.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 55 | `product_release/SECRET_ROTATION_RUNBOOK.md` | OPERATIONAL | product_release/README.md canonical map | REVIEW REQUIRED |
| 56 | `product_release/SERVICE_LEVELS.operational.md` | CONSOLIDATE/DELETE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 57 | `product_release/SOFTWARE_QUALITY.operational.md` | CONSOLIDATE/DELETE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 58 | `product_release/SOFT_RELEASE_TESTER_INSTRUCTIONS.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 59 | `product_release/SPEAKSHARP_SESSION_PROGRESS.operational.md` | CONSOLIDATE/DELETE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 60 | `product_release/STT.md` | PROTECTED CANONICAL — UPDATE REQUIRED | product_release/README.md canonical map | REVIEW REQUIRED |
| 61 | `product_release/STT_BASELINE_CONTRACTS.operational.md` | CONSOLIDATE/DELETE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 62 | `product_release/TESTER_GUIDE.md` | PROTECTED CANONICAL — UPDATE REQUIRED | product_release/TESTER_GUIDE.md | REVIEW REQUIRED |
| 63 | `product_release/TESTER_OPERATIONS.md` | PROTECTED CANONICAL — UPDATE REQUIRED | product_release/README.md canonical map | REVIEW REQUIRED |
| 64 | `product_release/attribution-sanitation-crosswalk.md` | CONSOLIDATE/DELETE REVIEW | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 65 | `product_release/content_list.md` | CONSOLIDATE/DELETE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 66 | `product_release/evidence/BETA_50_RELEASE_EVIDENCE_2026-07-09.md` | CONSOLIDATE/DELETE REVIEW | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 67 | `product_release/evidence/ISSUE_1265_PROGRESS_DEFINITION_MATRIX.md` | CONSOLIDATE/DELETE REVIEW | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 68 | `product_release/evidence/ISSUE_1267_PRIVATE_LAUNCH_REHEARSAL.md` | CONSOLIDATE/DELETE REVIEW | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 69 | `product_release/evidence/PRIVATE_SELECTION_PRODUCT_AUDIT_2026-06-17.md` | CONSOLIDATE/DELETE REVIEW | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 70 | `product_release/evidence/README.md` | CONSOLIDATE/DELETE REVIEW | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 71 | `product_release/evidence/beta50_2026-07-09/README.md` | CONSOLIDATE/DELETE REVIEW | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 72 | `product_release/evidence/beta50_private_2026-07-10/OPTION_D_QA_SELLOFF.md` | CONSOLIDATE/DELETE REVIEW | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 73 | `product_release/evidence/beta50_private_2026-07-10/PRIVATE_PATH_VALIDATION.md` | CONSOLIDATE/DELETE REVIEW | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 74 | `product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.md` | CONSOLIDATE/DELETE REVIEW | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 75 | `product_release/evidence/test_reports/CLOUD_STT_RELEASE_EVIDENCE_2026-06-02.md` | CONSOLIDATE/DELETE REVIEW | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 76 | `product_release/evidence/test_reports/NATIVE_STT_RELEASE_EVIDENCE_2026-06-02.md` | CONSOLIDATE/DELETE REVIEW | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 77 | `product_release/evidence/test_reports/PRIVATE_STT_RELEASE_EVIDENCE_2026-06-02.md` | CONSOLIDATE/DELETE REVIEW | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 78 | `product_release/evidence/test_reports/STT_SPEED_ACCURACY_MARKET_SURVIVAL_REVIEW_2026-06-02.md` | CONSOLIDATE/DELETE REVIEW | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 79 | `product_release/stt-perf-proof-protocol.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 80 | `product_release/v4_work/V4_APP_PATH_PROOF_RUNBOOK.md` | CONSOLIDATE/DELETE REVIEW | product_release/STT.md / RELEASE_STATUS.md | REVIEW REQUIRED |
| 81 | `product_release/v4_work/V4_COMPLETE_TEST_RUNBOOK.md` | CONSOLIDATE/DELETE REVIEW | product_release/STT.md / RELEASE_STATUS.md | REVIEW REQUIRED |
| 82 | `product_release/v4_work/V4_DECODE_ROOT_CAUSE_EXPERIMENT.md` | CONSOLIDATE/DELETE REVIEW | product_release/STT.md / RELEASE_STATUS.md | REVIEW REQUIRED |
| 83 | `product_release/v4_work/V4_POSTHOG_READINESS_PROOF.md` | CONSOLIDATE/DELETE REVIEW | product_release/STT.md / RELEASE_STATUS.md | REVIEW REQUIRED |
| 84 | `product_release/v4_work/V4_RECOVERY.md` | CONSOLIDATE/DELETE REVIEW | product_release/STT.md / RELEASE_STATUS.md | REVIEW REQUIRED |
| 85 | `research/pricing_analysis.md` | CONSOLIDATE/DELETE REVIEW | product_release/ENTITLEMENTS_AND_BILLING.md | REVIEW REQUIRED |
| 86 | `scripts/FILLER_KNOWN_SCRIPT_RUNBOOK.md` | OPERATIONAL | product_release/STT.md | REVIEW REQUIRED |
| 87 | `tests/CODEBASE_FIX_APPROACH.md` | OPERATIONAL | product_release/RC_TEST_INVENTORY.md / QUALITY.md | REVIEW REQUIRED |
| 88 | `tests/README.md` | OPERATIONAL | product_release/RC_TEST_INVENTORY.md / QUALITY.md | REVIEW REQUIRED |
| 89 | `tests/TESTING.md` | OPERATIONAL | product_release/RC_TEST_INVENTORY.md / QUALITY.md | REVIEW REQUIRED |
| 90 | `tests/TEST_PLAYBOOK.md` | OPERATIONAL | product_release/RC_TEST_INVENTORY.md / QUALITY.md | REVIEW REQUIRED |
| 91 | `tests/soak/README.md` | OPERATIONAL | product_release/RC_TEST_INVENTORY.md / QUALITY.md | REVIEW REQUIRED |
| 92 | `video-production/README.md` | OPERATIONAL | product_release/README.md canonical map | REVIEW REQUIRED |

## Terminal evidence checklist

- [ ] Re-inventory after rebasing onto post-#1317 `main`.
- [ ] Every starting row has a terminal disposition.
- [ ] All 14 protected canonical files exist, remain in place, and are verified current.
- [ ] Missing canonical `product_release/ROADMAP.md` is materialized and added to this ledger.
- [ ] Every retained non-archive document is useful and accurate for the current product, architecture, release process, or operating model.
- [ ] No non-archive Markdown file exists solely to preserve a superseded requirement, obsolete workflow, or historical test result.
- [ ] Consolidated/deleted files have their useful current facts moved to a named canonical authority.
- [ ] Every removed path has inbound repository links repaired or intentionally replaced with a current redirect.
- [ ] New documentation files introduced by this PR are added to this ledger.
- [ ] `product_release/archive/**` changed-path count is zero.
- [ ] Stale-current token scan is clean across retained files.
- [ ] Internal Markdown links and referenced repository paths resolve.
- [ ] Current workflow, script, variable, and account names match code/GitHub inventory.
- [ ] Documentation/product contract guard rejects a seeded stale-current claim.
- [ ] Archive-change guard rejects a seeded archive modification.
- [ ] Exact-head required CI is terminal green.
- [ ] PR evidence pending is `None.` and status is `QUALIFIED`.
