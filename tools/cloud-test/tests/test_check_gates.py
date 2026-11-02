import copy
import hashlib
import json
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
        comparison = {"schema": "speaksharp.run-comparison.v1", "previous": {"label": self.cfg["history"]["comparisonBaselines"][0]},
                      "current": {"label": self.cfg["history"]["comparisonBaselines"][1]}}
        request_sha = hashlib.sha256(json.dumps(r, sort_keys=True).encode()).hexdigest()
        self.cfg["aggregateReceiver"] = {"manifestSha256": "a" * 64, "bundleRootSha256": "b" * 64}
        receiver = {"schema": "speaksharp.cloud-test.aggregate-receiver-receipt.v1", "manifestSha256": "a" * 64,
                    "bundleRootSha256": "b" * 64, "requestSha256": request_sha,
                    "sourceSha": r["release"]["testedSha"], "acceptedSha256": {
                        "prior-run-verification": C.canonical_sha(prior), "comparison-prior": C.canonical_sha(comparison)}}
        from _common import parse_utc
        out = C.evaluate(r, self.cfg, l, self.wf, {"valid": True, "errors": []}, {"passed": True}, receipt(r),
                         str(self.inputs.root), "final", fake_rv(), self.rc, parse_utc(NOW), offline_proof=str(self.inputs.proof),
                         prior_verification=prior, prior_comparison=comparison, receiver_receipt=receiver, request_sha256=request_sha)
        self.assertEqual(self.status(out)["G7"], "READY")
        for bad in (dict(prior, runs=rows[:-1]), dict(prior, runs=[dict(rows[0], passed=False), *rows[1:]]),
                    dict(prior, schema="other")):
            with self.subTest(bad=bad):
                out = C.evaluate(r, self.cfg, l, self.wf, {"valid": True, "errors": []}, {"passed": True}, receipt(r),
                                 str(self.inputs.root), "final", fake_rv(), self.rc, parse_utc(NOW), offline_proof=str(self.inputs.proof),
                                 prior_verification=bad, prior_comparison=comparison, receiver_receipt=receiver, request_sha256=request_sha)
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

    def test_expired_window_blocks(self):
        r, l = approved(self.req, self.ledger)
        r["window"] = {"startUtc": "2020-01-01T10:00:00Z", "endUtc": "2020-01-01T11:00:00Z", "approvalRef": "x"}
        self.assertEqual(self.status(self.ev(r, l, receipt(r)))["G5"], "NOT-READY")

    def test_window_longer_than_configured_blocks(self):
        r, l = approved(self.req, self.ledger)
        r["window"]["endUtc"] = "2099-01-01T20:00:00Z"
        self.assertEqual(self.status(self.ev(r, l, receipt(r)))["G5"], "NOT-READY")

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
