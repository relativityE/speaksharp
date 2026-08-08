# ROADMAP

> **Status: DRAFT (#1051 PR-A, pull-forward).** The canonical product-value roadmap — the single
> disposition of all unfinished and deferred work. The **disposition below is fixed as laid out in #1051**;
> this document only annotates each row with **status**. PR-A stays Draft and is reconciled against final
> issue state before Product Owner approval. It moves no files and changes no runtime behavior.
>
> **Precedence:** this file owns *disposition + status*. It does NOT carry deployment identity, moving SHAs,
> or run IDs — current release posture lives only in
> [`product_release/RELEASE_STATUS.md`](product_release/RELEASE_STATUS.md).
>
> **Status legend:** ✅ done · 🟡 in progress · ⬜ not started · ⛔ retired/declined.

_Status last reconciled: 2026-08-08 (DevClaude, PR-A draft)._

---

## Now — finish and make the current loop trustworthy

1. 🟡 **#1125** worktree leases. — _Leases tooling in PR #1126 (unmerged); single-owner rule in effect._
2. 🟡 **#1037** STT evidence closure. — _Lane A merged (#1119); PR-B1 Browser journey (#1124) + PR-B2 Private worker open._
3. 🟡 **#1089** Private recording integrity. — _Capture-limit backstop + completed-duration snapshot shipped; see #1089 for residual._
4. 🟡 **#1047** transcript surfaces + Review/Progress UX + release matrix. — _U1 provenance applied to prod (#1131); ongoing._
5. ✅ **#1046** Guided Rehearsal. — _CLOSED 2026-08-08; loop live end-to-end (slices 1–5c). Full-loop e2e = hardening follow-up._
6. 🟡 **#1051** final archive. — _PR-A = this document (draft); PR-B extraction/archive runs last._

## Next — Pareto Product Value

1. 🟡 **#1120 PR-S1**: Private first / Browser secondary / Cloud globally default-off before any expanded tester surface. — _Flag mechanism in PR #1223 (flag OFF by default; merge + activation pending)._
2. ⬜ **#1116**: Practice Focus, prompt/sample on-ramp, and Guided bridge inside the corrected hierarchy.
3. ⬜ **#1120 PR-S2**: canonical `browser` runtime/code naming plus legacy `native` compatibility and provider cleanup; may run in parallel after S1.
4. ⬜ **#1118**: entitlement, pricing, offer-copy, and conversion-event truthfulness.
5. ⬜ **#1102**: paid concierge and real offer tests after their named gates.

## Parallel work and mandatory trust lanes

- ⬜ **#1102 phase 1** recent-event interviews may start now without product code.
- 🟡 **#1117** latest-two transcript source work starts immediately after #1047 U1; destructive scrub remains separately authorized. — _R1 SQL contract in PR #1160._
- 🟡 **#1130 PR-T1** audits the exact-main test/coverage contract now; **PR-T2** later reconciles shared gaps and ratchets toward 80%. — _Unit-sharding win merged (#1130/#1168)._
- ⬜ **#1087** tester evidence before next release.
- ⬜ **#1097** security classification/hardening.
- ⬜ **#1123** legacy deployment ownership/containment.

## Later

- ⬜ **#1086** Basic-account/credential cleanup only; Native→Browser is owned by #1120.
- ⬜ **Private v4** only after approved evidence.
- ⬜ **Enterprise systems** only after a buyer funds them.

## Explicitly retired

- ⛔ **#1081** Guided "Notify me" backend and email funnel: no provider integration or activation; #1046 G2 removes the dormant customer call path. — _Frontend call path removed (#1221 slice 5c); backend Edge-fn deletion is a separate deploy-authorized cleanup._

## Declined until evidence

- ⛔ broad scenario library;
- ⛔ personas/roleplay/live interruption;
- ⛔ generic analytics expansion;
- ⛔ PDF/dashboard expansion beyond truthful release needs;
- ⛔ enterprise SSO/admin/certification without a signed/funded buyer.
