import copy
import hashlib
import json
import os
import unittest

from _fixtures import ROOT, approved as base_approved, fake_rv, receipt, reconciliation, sample
from _gate_fixtures import GateInputs
import check_gates as C
import validate_run_request as V

NOW = "2026-10-28T22:00:00Z"


def approved(req, ledger):
    r, l = base_approved(req, ledger)
    r["approvedLimits"]["startPressCaps"] = dict(r["proposedLimits"]["startPressCaps"])
    return r, l


class CheckGates(unittest.TestCase):
    def setUp(self):
        s = sample()
        self.inputs = GateInputs(s)
        self.addCleanup(self.inputs.close)
        self.req, self.cfg, self.ledger, self.wf = self.inputs.request, self.inputs.cfg, s["ledger"], s["wf"]
        self.rc = reconciliation()

    def ev(self, req=None, ledger=None, rec=None, stage="final", checks="default", rv=None):
        req, ledger, rv = req or self.req, ledger or self.ledger, rv or fake_rv()
        errs, _ = V.validate(req, self.cfg, ledger, self.wf, rv, self.rc)
        val = {"valid": not errs, "errors": errs}
        oc = {"passed": True} if checks == "default" else checks
        from _common import parse_utc
        return C.evaluate(req, self.cfg, ledger, self.wf, val, oc, rec, str(self.inputs.root), stage, rv, self.rc, parse_utc("2026-10-28T22:00:00Z"), receipts_root=str(self.inputs.receipts))

    def status(self, out):
        return {g["id"]: g["status"] for g in out["gates"]}

    def test_proposal_is_no_go_with_only_owner_gates_open(self):
        out = self.ev(stage="preflight")
        self.assertEqual(out["decision"], "NO-GO")
        st = self.status(out)
        for g in ("G1", "G3", "G5", "G6"):
            self.assertEqual(st[g], "OWNER-INPUT-OPEN", g)
        for g in ("G2", "G7", "G8", "G9", "G10"):
            self.assertEqual(st[g], "READY", g)
        self.assertEqual(st["G4"], "DEFERRED-TO-RUNNER")

    def test_final_stage_requires_the_receipt(self):
        self.assertEqual(self.status(self.ev(stage="final"))["G4"], "NOT-READY")

    def test_everything_supplied_is_go(self):
        r, l = approved(self.req, self.ledger)
        out = self.ev(r, l, receipt(r))
        self.assertEqual(out["blockingOpen"], [], out["gates"])
        self.assertEqual(out["decision"], "GO")

    def test_g7_accepts_only_the_receiver_verified_exact_prior_run_inventory(self):
        r, l = approved(self.req, self.ledger)
        rows = [{"label": p["label"], "passed": True} for p in r["priorRuns"]]
        prior = {"schema": "speaksharp.cloud-test.prior-run-verification.v1", "runs": rows}
        with open(os.path.join(ROOT, "tests", "fixtures", "accepted-comparison-R5-vs-R4C.json"), encoding="utf-8") as f:
            comparison = json.load(f)
        request_sha = hashlib.sha256(json.dumps(r, sort_keys=True).encode()).hexdigest()
        self.cfg["aggregateReceiver"] = {"activated": True, "manifestSha256": "a" * 64, "bundleRootSha256": "b" * 64}
        receiver = {"schema": "speaksharp.cloud-test.aggregate-receiver-receipt.v1", "manifestSha256": "a" * 64,
                    "bundleRootSha256": "b" * 64, "requestSha256": request_sha,
                    "sourceSha": r["release"]["testedSha"], "acceptedSha256": {
                        "prior-run-verification": C.canonical_sha(prior), "comparison-prior": C.canonical_sha(comparison)}}
        from _common import parse_utc
        out = C.evaluate(r, self.cfg, l, self.wf, {"valid": True, "errors": []}, {"passed": True}, receipt(r),
                         str(self.inputs.root), "final", fake_rv(), self.rc, parse_utc(NOW), offline_proof=str(self.inputs.proof),
                         prior_verification=prior, prior_comparison=comparison, receiver_receipt=receiver, request_sha256=request_sha)
        self.assertEqual(self.status(out)["G7"], "NOT-READY", "a caller-authored self-hash receipt is never receiver proof")
        out = C.evaluate(r, self.cfg, l, self.wf, {"valid": True, "errors": []}, {"passed": True}, receipt(r),
                         str(self.inputs.root), "final", fake_rv(), self.rc, parse_utc(NOW), offline_proof=str(self.inputs.proof),
                         prior_verification=prior, prior_comparison=comparison, receiver_receipt=receiver,
                         request_sha256=request_sha, receiver_verified=True)
        self.assertEqual(self.status(out)["G7"], "READY", "only the CLI's prior pinned-bundle verification may set this bit")
        for bad in (dict(prior, runs=rows[:-1]), dict(prior, runs=[dict(rows[0], passed=False), *rows[1:]]),
                    dict(prior, schema="other")):
            with self.subTest(bad=bad):
                out = C.evaluate(r, self.cfg, l, self.wf, {"valid": True, "errors": []}, {"passed": True}, receipt(r),
                                 str(self.inputs.root), "final", fake_rv(), self.rc, parse_utc(NOW), offline_proof=str(self.inputs.proof),
                                 prior_verification=bad, prior_comparison=comparison, receiver_receipt=receiver,
                                 request_sha256=request_sha, receiver_verified=True)
                self.assertEqual(self.status(out)["G7"], "NOT-READY")
        out = C.evaluate(r, self.cfg, l, self.wf, {"valid": True, "errors": []}, {"passed": True}, receipt(r),
                         str(self.inputs.root), "final", fake_rv(), self.rc, parse_utc(NOW), offline_proof=str(self.inputs.proof),
                         prior_verification=prior, prior_comparison=comparison, receiver_receipt=None, request_sha256=request_sha)
        self.assertEqual(self.status(out)["G7"], "NOT-READY")

    def test_preflight_stage_go_defers_only_g4(self):
        r, l = approved(self.req, self.ledger)
        out = self.ev(r, l, None, stage="preflight")
        self.assertEqual((out["decision"], out["deferred"]), ("GO", ["G4"]))

    # ---- item 3: G2 rejects unverified deployment and unreviewed changes, not product changes
    def test_unverified_deployment_blocks_g2(self):
        r, l = approved(self.req, self.ledger)
        rv = fake_rv(); rv["needs"] = ["frontend: no sealed run's identity reads show the tested SHA served"]
        self.assertEqual(self.status(self.ev(r, l, receipt(r), rv=rv))["G2"], "NOT-READY")

    def test_verified_deployed_fix_since_the_last_run_is_ready(self):
        r, l = approved(self.req, self.ledger)
        rv = fake_rv(since=[{"short": "8b2e7de", "pr": "1744", "customerFacing": True}])
        self.assertEqual(self.status(self.ev(r, l, receipt(r), rv=rv))["G2"], "READY")

    def test_targeted_backend_fix_needs_backend_verification(self):
        r, l = approved(self.req, self.ledger)
        rv = fake_rv({"GAP-03": {"inclusion": "cloud-verified", "pr": "1744", "commit": "x", "touchesBackend": True}})
        st = self.ev(r, l, receipt(r), rv=rv)
        self.assertEqual(self.status(st)["G2"], "NOT-READY")
        rv["backend"] = {"verified": True}
        self.assertEqual(self.status(self.ev(r, l, receipt(r), rv=rv))["G2"], "READY")

    def test_missing_release_verification_blocks(self):
        r, l = approved(self.req, self.ledger)
        out = C.evaluate(r, self.cfg, l, self.wf, {"valid": True}, {"passed": True}, receipt(r), str(self.inputs.root), "final", None, self.rc, receipts_root=str(self.inputs.receipts))
        self.assertEqual(self.status(out)["G2"], "NOT-READY")

    # ---- G4
    def test_stale_receipt_blocks(self):
        r, l = approved(self.req, self.ledger)
        self.assertEqual(self.status(self.ev(r, l, receipt(r, minutes_old=600)))["G4"], "NOT-READY")

    def test_receipt_with_product_traffic_blocks(self):
        r, l = approved(self.req, self.ledger)
        rc = receipt(r); rc["productTraffic"] = 3
        self.assertEqual(self.status(self.ev(r, l, rc))["G4"], "NOT-READY")

    def test_receipt_for_other_harness_blocks(self):
        r, l = approved(self.req, self.ledger)
        rc = receipt(r); rc["codeManifestSha256"] = "1" * 64
        self.assertEqual(self.status(self.ev(r, l, rc))["G4"], "NOT-READY")

    def test_case_not_ready_in_receipt_blocks(self):
        r, l = approved(self.req, self.ledger)
        rc = receipt(r); rc["cases"]["AHT-12"]["ready"] = False
        self.assertEqual(self.status(self.ev(r, l, rc))["G4"], "NOT-READY")

    # ---- G5 uses the RECONCILED figure
    def test_approved_ceiling_below_the_reconciled_need_blocks(self):
        r, l = approved(self.req, self.ledger)
        r["approvedLimits"]["cumulativeCeilingRequests"] = 6376
        self.assertEqual(self.status(self.ev(r, l, receipt(r)))["G5"], "NOT-READY")

    def test_measured_only_usage_would_have_wrongly_passed(self):
        # a ceiling that fits measured usage (5,421) but not the conservative figure (5,529) must be refused
        r, l = approved(self.req, self.ledger)
        r["approvedLimits"]["cumulativeCeilingRequests"] = 6300
        self.assertEqual(self.status(self.ev(r, l, receipt(r)))["G5"], "NOT-READY")

    def test_g5_replaces_the_runs_own_counted_reservation_never_another(self):
        # #1772 review 4446137335 / Jensen 1793644594.204599: at an exact fit ownerCounted already includes THIS request's open reservation.
        r, l = approved(self.req, self.ledger)
        sha = "a" * 64
        planned = r["estimate"]["starts"]
        # Review 4447628949: an exact fit in all four dimensions, each counter full including this run's own held allocation.
        a, est = r["approvedLimits"], r["estimate"]
        held = {"requests": a["runCapRequests"] + est["identityReads"], "identityReads": est["identityReads"], "starts": planned,
                "takes": est["takes"]}
        self.rc = dict(self.rc, starts=dict(self.rc["starts"], ownerCounted=self.rc["ceilings"]["starts"]),  # full, including own `planned`
                       takes=dict(self.rc["takes"], ownerCounted=self.rc["ceilings"]["takes"]),
                       requests=dict(self.rc["requests"], conservativeUsed=a["cumulativeCeilingRequests"] - self.rc["ceilings"]["protectedReserveRequests"]
                                     - a["runCapRequests"] - est["identityReads"] + held["requests"]),
                       identityReads=dict(self.rc["identityReads"], conservativeUsed=a["identityCap"]))

        def g5(reservations, request_sha256=sha):
            rc = dict(self.rc, openReservationsByRequest=reservations) if reservations is not None else self.rc
            errs, _ = V.validate(r, self.cfg, l, self.wf, fake_rv(), rc, None, request_sha256)
            from _common import parse_utc
            out = C.evaluate(r, self.cfg, l, self.wf, {"valid": not errs, "errors": errs}, {"passed": True}, receipt(r), str(self.inputs.root),
                             "final", fake_rv(), rc, parse_utc("2026-10-28T22:00:00Z"), receipts_root=str(self.inputs.receipts),
                             request_sha256=request_sha256)
            return [g for g in out["gates"] if g["id"] == "G5"][0]["status"], errs

        own = {sha: {r["runId"]: dict(held, count=1),
                     r["runId"] + ".case10-observation": {"count": 1, "requests": 50, "identityReads": 2, "starts": 0, "takes": 0}}}  # 4446862226
        self.assertEqual(g5(None)[0], "NOT-READY", "broken before: the own reservation is charged twice")
        self.assertEqual(g5(own), ("READY", []), "fixed after: replaced by the plan, admitted end to end")
        for k in held:  # each dimension on its own: a held amount one short leaves that counter over its ceiling
            short = {sha: dict(own[sha], **{r["runId"]: dict(own[sha][r["runId"]], **{k: held[k] - 1})})}
            self.assertEqual(g5(short)[0], "NOT-READY", k)
        self.assertEqual(g5({"b" * 64: own[sha]})[0], "NOT-READY", "another request's reservation is never discounted")
        self.assertEqual(g5(own, request_sha256=None)[0], "NOT-READY", "no request digest, no discount")
        self.assertEqual(g5({sha: dict(own[sha], **{r["runId"]: dict(own[sha][r["runId"]], count=2)})})[0], "NOT-READY",
                         "two open reservations of the same request and campaign are ambiguous")

    def test_expired_window_blocks(self):
        r, l = approved(self.req, self.ledger)
        r["window"] = {"startUtc": "2020-01-01T10:00:00Z", "endUtc": "2020-01-01T11:00:00Z", "approvalRef": "x"}
        self.assertEqual(self.status(self.ev(r, l, receipt(r)))["G5"], "NOT-READY")

    def test_window_longer_than_configured_blocks(self):
        r, l = approved(self.req, self.ledger)
        r["window"]["endUtc"] = "2099-01-01T20:00:00Z"
        self.assertEqual(self.status(self.ev(r, l, receipt(r)))["G5"], "NOT-READY")

        # A reviewed smoke occurrence distinguishes its end-to-end workflow envelope from the unchanged
        # live ceiling. Both values must be exact; neither omission nor an oversized live allowance passes.
        smoke = copy.deepcopy(r)
        smoke["coverageMode"] = smoke["sampleMode"] = "smoke"
        smoke["estimate"]["githubRunnerMinutesMax"] = 40
        old_limit, old_errors = C.occurrence_window_limit(smoke, {"maxWindowMinutes": 40}, False, 80)
        self.assertEqual(old_errors, [])
        self.assertGreater(80, old_limit, "without both declarations the old 40-minute occurrence ceiling still blocks")
        smoke["window"].update({"endToEndMinutes": 80, "liveMinutes": 40})
        self.assertTrue(C.occurrence_window_limit(smoke, {"maxWindowMinutes": 40}, False, 80)[1],
                        "an ordinary smoke request cannot self-authorize the R10 envelope")
        smoke.update({"runId": C.R10_SMOKE_RUN_ID, "priority": "journey-smoke", "createdUtc": smoke["window"]["startUtc"],
                      "selectionApprovalRef": smoke["window"]["approvalRef"]})
        self.assertEqual(C.occurrence_window_limit(smoke, {"maxWindowMinutes": 40}, False, 80), (80, []))
        for patch in ({"endToEndMinutes": 81}, {"endToEndMinutes": 10000}, {"liveMinutes": 1}, {"liveMinutes": 41},
                      {"liveMinutes": None}, {"endToEndMinutes": None}):
            bad = copy.deepcopy(smoke)
            bad["window"].update(patch)
            if isinstance(patch.get("liveMinutes"), int):
                bad["estimate"]["githubRunnerMinutesMax"] = patch["liveMinutes"]
            self.assertTrue(C.occurrence_window_limit(bad, {"maxWindowMinutes": 40}, False, 80)[1], patch)

    def test_expected_pass_unconfirmed_is_owner_input(self):
        r, l = approved(self.req, self.ledger)
        l["gaps"][2]["expectedPass"]["confirmedByOwner"] = False
        self.assertEqual(self.status(self.ev(r, l, receipt(r)))["G6"], "OWNER-INPUT-OPEN")

    def test_an_expected_pass_without_executable_requirements_blocks_g6(self):
        r, l = approved(self.req, self.ledger)
        l["gaps"][2]["expectedPass"].pop("requirements")
        self.assertEqual(self.status(self.ev(r, l, receipt(r)))["G6"], "NOT-READY")

    def test_expected_pass_defined_after_window_start_blocks(self):
        r, l = approved(self.req, self.ledger)
        r["window"]["startUtc"] = "2026-10-28T18:00:00Z"
        self.assertEqual(self.status(self.ev(r, l, receipt(r)))["G6"], "NOT-READY")

    def test_tampered_prior_receipts_block_g7(self):
        r, l = approved(self.req, self.ledger)
        cfg = copy.deepcopy(self.cfg)
        cfg["history"]["runs"][3]["receiptsManifestSha256"] = "0" * 64
        out = C.evaluate(r, cfg, l, self.wf, {"valid": True}, {"passed": True}, receipt(r), str(self.inputs.root), "final", fake_rv(), self.rc, receipts_root=str(self.inputs.receipts))
        self.assertEqual(self.status(out)["G7"], "NOT-READY")

    def test_offline_checks_not_passed_blocks(self):
        r, l = approved(self.req, self.ledger)
        self.assertEqual(self.status(self.ev(r, l, receipt(r), checks={"passed": False}))["G10"], "NOT-READY")
        self.assertEqual(self.status(self.ev(r, l, receipt(r), checks=None))["G10"], "NOT-READY")

    def test_invalid_request_blocks_g9(self):
        r, l = approved(self.req, self.ledger)
        r["purpose"] = "x"
        self.assertEqual(self.status(self.ev(r, l, receipt(r)))["G9"], "NOT-READY")

    def test_harness_approval_missing_is_owner_input(self):
        r, l = approved(self.req, self.ledger)
        r["harness"]["ownerApprovalRef"] = None
        self.assertEqual(self.status(self.ev(r, l, receipt(r)))["G3"], "OWNER-INPUT-OPEN")

    def test_g5_never_accepts_aggregate_only_start_permission(self):
        r,l=approved(self.req,self.ledger)
        r['approvedLimits']['startPressCaps']=None
        self.assertEqual(self.status(self.ev(r,l,receipt(r)))['G5'],'OWNER-INPUT-OPEN')
        r['approvedLimits']['startPressCaps']={'AHT-12':True}
        self.assertEqual(self.status(self.ev(r,l,receipt(r)))['G5'],'NOT-READY')


if __name__ == "__main__":
    unittest.main()


class NightlyCarriedForwardG7(unittest.TestCase):
    """G7 through its real consumers (Sam 1793575319.659179, RETURN 1793576198.013729): only QUALIFIED row evidence produced under the
    CURRENT identities clears G7; unqualified, row-empty or incomparable history falls back to the verified bootstrap receipts."""
    REQ = {"priority": "nightly-regression", "harness": {"codeManifestSha256": "3" * 64, "packetManifestSha256": "4" * 64},
           "release": {"backend": {"sha": "6" * 40}}}

    def history(self, nights, qualified=True, comp=None):
        import json as _json
        import publish_latest_record as P
        import select_baselines as SB
        current = SB.current_identities(self.REQ)
        state = P.parse_body("")
        for i, verdicts in enumerate(nights):
            day = "2026-11-%02dT08:00:00Z" % (i + 1)
            ok = set(verdicts) == {"P"}
            cases = [{"caseId": "AHT-05", "result": "PASS" if ok else "FAIL",
                      "rows": {"pass": verdicts.count("P"), "fail": verdicts.count("F"), "notRun": verdicts.count("N")}, "codes": []}]
            rec = {"runId": str(500 + i), "attempt": 1, "sourceSha": "a" * 40, "testedSha": "b" * 40, "servedSha": "b" * 40,
                   "campaignId": ("nightly-%d" % i) if qualified else None, "coverage": ("batch" if ok else "incomplete") if qualified else "unqualified",
                   "coverageMode": "partial" if qualified else None, "assertionDepth": "full" if qualified else None,
                   "requestSha256": "1" * 64 if qualified else None, "catalogSha256": "2" * 64 if qualified else None,
                   "startedUtc": day.replace("08:", "03:"), "endedUtc": day, "outcome": "passed" if ok and qualified else "failed",
                   "cases": cases, "codes": [] if qualified else ["not-qualified"]}
            if qualified:
                rec.update(rowVerdicts={"AHT-05": verdicts}, comparability=comp or current,
                           evidence={"planSha256": "7" * 64, "caseResultsSha256": "8" * 64})
            st = P.begin(state, str(500 + i), 1, "a" * 40, day.replace("08:", "03:"))
            state = P.complete(st, rec)
        return state

    def width(self):
        import json as _json
        return len(_json.load(open(os.path.join(ROOT, "config", "assertion-catalog.json")))["cases"]["AHT-05"]["requiredAssertions"])

    def test_only_qualified_comparable_row_evidence_clears_g7(self):
        import check_gates as G
        w = self.width()
        self.assertIsNone(G.nightly_history_gate(self.REQ, self.history(["P" * w])))                    # one night: bootstrap decides
        self.assertIsNone(G.nightly_history_gate(self.REQ, self.history(["P" * w] * 2, qualified=False)))  # unqualified: never clears
        self.assertIsNone(G.nightly_history_gate(self.REQ, self.history(["N" * w] * 2)))  # two all-NOT-RUN occurrences: not evidence
        other = dict(self.history(["P" * w])["history"]["identities"][0], backendSha="9" * 40)
        self.assertIsNone(G.nightly_history_gate(self.REQ, self.history(["P" * w] * 2, comp=other)))      # incomparable: bootstrap
        two = self.history(["P" * w, "F" + "N" * (w - 1)])
        self.assertEqual(G.nightly_history_gate(self.REQ, two)["status"], G.READY)
        self.assertIsNone(G.nightly_history_gate(dict(self.REQ, priority="full-coverage"), two))
        corrupt = dict(two, history=dict(two["history"], sequence=0))
        self.assertEqual(G.nightly_history_gate(self.REQ, corrupt)["status"], G.NOTREADY)

    def test_history_baselines_cover_all_rows_and_flag_comparability_with_the_current_run(self):
        import json as _json
        import select_baselines as SB
        w = self.width()
        two = self.history(["P" * w, "F" + "N" * (w - 1)])
        catalog = _json.load(open(os.path.join(ROOT, "config", "assertion-catalog.json")))
        b = SB.history_baselines(two["history"], catalog, SB.current_identities(self.REQ))
        rows = catalog["cases"]["AHT-05"]["requiredAssertions"]
        self.assertEqual(len(b["rows"]), 204)
        self.assertEqual(b["rows"]["AHT-05/%s" % rows[0]], {"baselineVerdict": "FAIL", "baseline": "501", "lastKnownGood": "500", "comparable": True})
        self.assertEqual(b["rows"]["AHT-05/%s" % rows[1]], {"baselineVerdict": "PASS", "baseline": "500", "lastKnownGood": "500", "comparable": True})
        self.assertEqual(b["journeys"]["AHT-05"], {"previousVerdictRun": "501", "previousVerdict": "FAIL", "lastKnownGood": "500"})
        self.assertFalse(SB.history_baselines(two["history"], catalog, None)["rows"]["AHT-05/%s" % rows[0]]["comparable"])
