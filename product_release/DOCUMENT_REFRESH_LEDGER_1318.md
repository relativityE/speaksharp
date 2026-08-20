# #1318 Non-Archived Documentation Refresh Ledger

**Source tree:** `main@307462931905ddcaac1eac303821c4291b7e0257`  
**Starting inventory:** 92 Markdown/MDX/RST/AsciiDoc files outside `product_release/archive/**`  
**Archive rule:** zero changed paths under `product_release/archive/**`  
**Status:** OPEN — provisional classification complete; file-by-file review required.

This ledger is the completion authority for issue #1318. A row may move to
`VERIFIED CURRENT`, `UPDATED`, `HISTORICAL HEADER ADDED`,
`REDIRECTED/TOMBSTONED`, or `DELETE CANDIDATE — AWAITING AUTHORIZATION`.
No row may remain `REVIEW REQUIRED` when review is requested.

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
- Historical evidence remains historical; its body is not rewritten as current truth.

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
| 13 | `docs/ARCHITECTURE.md` | REDIRECT/TOMBSTONE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 14 | `docs/CHANGELOG.md` | REDIRECT/TOMBSTONE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 15 | `docs/OUTLINE.md` | REDIRECT/TOMBSTONE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 16 | `docs/PRD.md` | REDIRECT/TOMBSTONE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 17 | `docs/README.md` | REDIRECT/TOMBSTONE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 18 | `docs/ROADMAP.md` | REDIRECT/TOMBSTONE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 19 | `ops-health/ops-health.md` | OPERATIONAL | product_release/OPS_HEALTH_DASHBOARD.md | REVIEW REQUIRED |
| 20 | `product_release/ACTIVE_COORDINATION.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 21 | `product_release/ARCHITECTURE.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 22 | `product_release/ARCHITECTURE.operational.md` | REDIRECT/TOMBSTONE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 23 | `product_release/BACKLOG.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 24 | `product_release/CODEBASE_MAP.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 25 | `product_release/DOC_MIGRATION_LEDGER.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 26 | `product_release/ENTITLEMENTS_AND_BILLING.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 27 | `product_release/ENTITLEMENT_PRO_LIMIT_EVIDENCE.md` | HISTORICAL EVIDENCE | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 28 | `product_release/ENV_INVENTORY.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 29 | `product_release/EVIDENCE_INDEX.md` | CURRENT AUTHORITY | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 30 | `product_release/INTERNAL_TEST_PROTOCOL.md` | OPERATIONAL | product_release/README.md canonical map | REVIEW REQUIRED |
| 31 | `product_release/LAUNCH_ENV_CHECKLIST.md` | OPERATIONAL | product_release/README.md canonical map | REVIEW REQUIRED |
| 32 | `product_release/MANUAL_HARDWARE_VALIDATION.md` | OPERATIONAL | product_release/README.md canonical map | REVIEW REQUIRED |
| 33 | `product_release/OPERATIONS_AND_SECURITY.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 34 | `product_release/OPS_HEALTH_DASHBOARD.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 35 | `product_release/PAID_OPS_HARDENING_RUNBOOK.md` | OPERATIONAL | product_release/README.md canonical map | REVIEW REQUIRED |
| 36 | `product_release/PRD.operational.md` | REDIRECT/TOMBSTONE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 37 | `product_release/PRECEDENCE.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 38 | `product_release/PRIVATE_STT_ACCURACY_LEVERS.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 39 | `product_release/PRODUCT_FEATURES.operational.md` | REDIRECT/TOMBSTONE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 40 | `product_release/PRODUCT_REQUIREMENTS.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 41 | `product_release/PROGRESS_AND_NEXT_ACTION.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 42 | `product_release/PUBLIC_LAUNCH_LEDGER.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 43 | `product_release/QUALITY.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 44 | `product_release/QUALITY_METRICS.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 45 | `product_release/RC_GATES.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 46 | `product_release/RC_TEST_INVENTORY.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 47 | `product_release/README.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 48 | `product_release/RELEASE_CLOSEOUT_LEDGER.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 49 | `product_release/RELEASE_PROCESS.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 50 | `product_release/RELEASE_RECOVERY.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 51 | `product_release/RELEASE_STATUS.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 52 | `product_release/ROADMAP.operational.md` | REDIRECT/TOMBSTONE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 53 | `product_release/SCA_EXCEPTIONS.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 54 | `product_release/SECRETS_ATTACK_SURFACE_AUDIT.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 55 | `product_release/SECRET_ROTATION_RUNBOOK.md` | OPERATIONAL | product_release/README.md canonical map | REVIEW REQUIRED |
| 56 | `product_release/SERVICE_LEVELS.operational.md` | REDIRECT/TOMBSTONE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 57 | `product_release/SOFTWARE_QUALITY.operational.md` | REDIRECT/TOMBSTONE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 58 | `product_release/SOFT_RELEASE_TESTER_INSTRUCTIONS.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 59 | `product_release/SPEAKSHARP_SESSION_PROGRESS.operational.md` | REDIRECT/TOMBSTONE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 60 | `product_release/STT.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 61 | `product_release/STT_BASELINE_CONTRACTS.operational.md` | REDIRECT/TOMBSTONE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 62 | `product_release/TESTER_GUIDE.md` | CURRENT AUTHORITY | product_release/TESTER_GUIDE.md | REVIEW REQUIRED |
| 63 | `product_release/TESTER_OPERATIONS.md` | OPERATIONAL | product_release/README.md canonical map | REVIEW REQUIRED |
| 64 | `product_release/attribution-sanitation-crosswalk.md` | HISTORICAL EVIDENCE | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 65 | `product_release/content_list.md` | REDIRECT/TOMBSTONE REVIEW | product_release/README.md canonical map | REVIEW REQUIRED |
| 66 | `product_release/evidence/BETA_50_RELEASE_EVIDENCE_2026-07-09.md` | HISTORICAL EVIDENCE | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 67 | `product_release/evidence/ISSUE_1265_PROGRESS_DEFINITION_MATRIX.md` | HISTORICAL EVIDENCE | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 68 | `product_release/evidence/ISSUE_1267_PRIVATE_LAUNCH_REHEARSAL.md` | HISTORICAL EVIDENCE | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 69 | `product_release/evidence/PRIVATE_SELECTION_PRODUCT_AUDIT_2026-06-17.md` | HISTORICAL EVIDENCE | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 70 | `product_release/evidence/README.md` | HISTORICAL EVIDENCE | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 71 | `product_release/evidence/beta50_2026-07-09/README.md` | HISTORICAL EVIDENCE | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 72 | `product_release/evidence/beta50_private_2026-07-10/OPTION_D_QA_SELLOFF.md` | HISTORICAL EVIDENCE | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 73 | `product_release/evidence/beta50_private_2026-07-10/PRIVATE_PATH_VALIDATION.md` | HISTORICAL EVIDENCE | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 74 | `product_release/evidence/stt_product_metrics_release_matrix_2026-06-02.md` | HISTORICAL EVIDENCE | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 75 | `product_release/evidence/test_reports/CLOUD_STT_RELEASE_EVIDENCE_2026-06-02.md` | HISTORICAL EVIDENCE | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 76 | `product_release/evidence/test_reports/NATIVE_STT_RELEASE_EVIDENCE_2026-06-02.md` | HISTORICAL EVIDENCE | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 77 | `product_release/evidence/test_reports/PRIVATE_STT_RELEASE_EVIDENCE_2026-06-02.md` | HISTORICAL EVIDENCE | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 78 | `product_release/evidence/test_reports/STT_SPEED_ACCURACY_MARKET_SURVIVAL_REVIEW_2026-06-02.md` | HISTORICAL EVIDENCE | product_release/EVIDENCE_INDEX.md | REVIEW REQUIRED |
| 79 | `product_release/stt-perf-proof-protocol.md` | CURRENT AUTHORITY | product_release/README.md canonical map | REVIEW REQUIRED |
| 80 | `product_release/v4_work/V4_APP_PATH_PROOF_RUNBOOK.md` | HISTORICAL EVIDENCE | product_release/STT.md / RELEASE_STATUS.md | REVIEW REQUIRED |
| 81 | `product_release/v4_work/V4_COMPLETE_TEST_RUNBOOK.md` | HISTORICAL EVIDENCE | product_release/STT.md / RELEASE_STATUS.md | REVIEW REQUIRED |
| 82 | `product_release/v4_work/V4_DECODE_ROOT_CAUSE_EXPERIMENT.md` | HISTORICAL EVIDENCE | product_release/STT.md / RELEASE_STATUS.md | REVIEW REQUIRED |
| 83 | `product_release/v4_work/V4_POSTHOG_READINESS_PROOF.md` | HISTORICAL EVIDENCE | product_release/STT.md / RELEASE_STATUS.md | REVIEW REQUIRED |
| 84 | `product_release/v4_work/V4_RECOVERY.md` | HISTORICAL EVIDENCE | product_release/STT.md / RELEASE_STATUS.md | REVIEW REQUIRED |
| 85 | `research/pricing_analysis.md` | HISTORICAL EVIDENCE | product_release/ENTITLEMENTS_AND_BILLING.md | REVIEW REQUIRED |
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
- [ ] New documentation files introduced by this PR are added to this ledger.
- [ ] `product_release/archive/**` changed-path count is zero.
- [ ] Stale-current token scan is clean or every historical occurrence is classified.
- [ ] Internal Markdown links and referenced repository paths resolve.
- [ ] Current workflow, script, variable, and account names match code/GitHub inventory.
- [ ] Documentation/product contract guard rejects a seeded stale-current claim.
- [ ] Archive-change guard rejects a seeded archive modification.
- [ ] Exact-head required CI is terminal green.
- [ ] PR evidence pending is `None.` and status is `QUALIFIED`.
