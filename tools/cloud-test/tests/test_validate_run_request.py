import copy
import unittest

from _fixtures import fake_rv, reconciliation, sample
from test_case_start_caps import synthetic_allocation
import validate_run_request as V


class ValidateRunRequest(unittest.TestCase):
    def setUp(self):
        s = sample()
        self.req, self.cfg, self.ledger, self.wf = s["req"], s["cfg"], s["ledger"], s["wf"]
        self.rc = reconciliation()
        self.rv = fake_rv()

    def errs(self, req=None, ledger=None, rv=None, rc=None):
        return V.validate(req or self.req, self.cfg, ledger or self.ledger, self.wf, rv or self.rv, rc or self.rc)[0]

    def expect(self, req, fragment, **kw):
        e = self.errs(req, **kw)
        self.assertTrue(any(fragment in x for x in e), "%r not in %r" % (fragment, e))

    def test_proposal_is_valid(self):
        self.assertEqual(self.errs(), [])

    def test_short_purpose_refused(self):
        r = copy.deepcopy(self.req); r["purpose"] = "rerun"; self.expect(r, "purpose")

    def test_report_only_priority_refused(self):
        r = copy.deepcopy(self.req); r["priority"] = "produce-another-report"; self.expect(r, "priority")

    # ---- item 3: a verified deployed fix is what prove-deployed-fix needs; unverified deployment is what it rejects
    def test_prove_fix_needs_verified_deployment(self):
        rv = fake_rv({"GAP-03": {"inclusion": "unverified-deployment", "pr": "1744", "commit": "x"}})
        self.expect(self.req, "cloud-verified deployed inclusion", rv=rv)

    def test_prove_fix_refuses_a_candidate_fix(self):
        l = copy.deepcopy(self.ledger)
        l["gaps"][2]["fix"]["candidate"] = True
        self.expect(self.req, "cloud-verified deployed inclusion", ledger=l)

    def test_restore_evidence_needs_an_evidence_gap(self):
        r = copy.deepcopy(self.req); r["priority"] = "restore-missing-evidence"
        self.expect(r, "evidence-restoration or harness-correction")

    def test_unknown_gap_refused(self):
        r = copy.deepcopy(self.req); r["targetedGaps"].append("GAP-99"); self.expect(r, "GAP-99")

    def test_no_targeted_gap_refused(self):
        r = copy.deepcopy(self.req); r["targetedGaps"] = []; self.expect(r, "targetedGaps is empty")

    def test_broad_rerun_refused(self):
        r = copy.deepcopy(self.req)
        r["selection"] = [{"order": i, "case": "AHT-%02d" % i, "gaps": ["GAP-03"], "role": "target", "plannedRequests": 50, "gate": None, "reason": "all"} for i in range(1, 16)]
        self.expect(r, "invalid per-case Start allocation")

    def test_case_not_tied_to_a_gap_refused(self):
        r = copy.deepcopy(self.req); r["selection"][0]["gaps"] = []; self.expect(r, "not tied to a targeted gap")

    def test_gate_must_point_at_an_earlier_case(self):
        r = copy.deepcopy(self.req); r["selection"][0]["gate"] = "AHT-04:cold-pending-observed"; self.expect(r, "earlier selected case")

    def test_targeted_gap_case_must_be_selected(self):
        r = copy.deepcopy(self.req); r["targetedGaps"].append("GAP-01"); self.expect(r, "not selected")

    # ---- item 2: costs
    def test_dollar_cost_keys_are_refused_anywhere(self):
        for key in ("costUsd", "costCapUsd", "actualCostUsd"):
            r = copy.deepcopy(self.req); r["estimate"][key] = 0
            self.expect(r, "a dollar figure is not accepted")

    def test_paid_actions_must_stay_at_zero(self):
        r = copy.deepcopy(self.req); r["estimate"]["paidActionsAuthorizedUsd"] = 5; self.expect(r, "paidActionsAuthorizedUsd")

    def test_provider_billable_requests_need_a_cap_and_basis(self):
        r = copy.deepcopy(self.req); r["estimate"]["providerBillableRequests"] = {}; self.expect(r, "providerBillableRequests")

    def test_guard_coaching_cap_must_match_the_estimate(self):
        r = copy.deepcopy(self.req); r["proposedLimits"]["guardCaps"]["coaching"] = 40; self.expect(r, "guardCaps.coaching")

    def test_estimate_must_sum(self):
        r = copy.deepcopy(self.req); r["estimate"]["requests"]["planned"] = 600; self.expect(r, "does not equal the sum")

    def test_run_cap_above_configured_maximum_refused(self):
        r = copy.deepcopy(self.req)
        r["estimate"]["requests"]["pooledSlack"] = 900; r["estimate"]["requests"]["runCap"] = 1046; r["proposedLimits"]["runCapRequests"] = 1046
        self.expect(r, "exceeds the configured maximum")

    def test_identity_reads_must_be_2k_plus_2(self):
        r = copy.deepcopy(self.req); r["estimate"]["identityReads"] = 9; self.expect(r, "2k+2")

    def test_github_minutes_bound(self):
        r = copy.deepcopy(self.req); r["estimate"]["githubRunnerMinutesMax"] = 500; self.expect(r, "githubRunnerMinutesMax")

    # ---- item 2: the ceiling is reconciled, not asserted
    def test_ceiling_below_the_reconciled_need_refused(self):
        r = copy.deepcopy(self.req); r["proposedLimits"]["cumulativeCeilingRequests"] = 6376; self.expect(r, "below the reconciled requirement")

    def test_the_old_6990_style_increase_needs_a_justification(self):
        r = copy.deepcopy(self.req)
        r["estimate"]["requests"].update({"planned": 662, "pooledSlack": 68, "runCap": 780}); r["estimate"]["identityReads"] = 12
        r["selection"] = [{"order": i + 1, "case": c, "gaps": ["GAP-03"], "role": "target", "plannedRequests": n, "gate": None, "reason": "x"} for i, (c, n) in enumerate([("AHT-12", 96), ("AHT-04", 157), ("AHT-13", 114), ("AHT-14", 179), ("AHT-03", 116)])]
        r["estimate"]["identityReads"] = 12
        r["proposedLimits"].update({"cumulativeCeilingRequests": 6990, "identityCap": 110, "runCapRequests": 780})
        synthetic_allocation(r)
        self.expect(r, "without ceilingIncreaseJustification")
        r["proposedLimits"]["ceilingIncreaseJustification"] = "owner decision needed"
        r["proposedLimits"]["identityIncreaseJustification"] = "owner decision needed"
        e = self.errs(r)
        self.assertFalse(any("ceilingIncreaseJustification" in x or "identityIncreaseJustification" in x for x in e), e)

    def test_ceiling_equal_to_a_reconciled_requirement_with_unreconciled_usage_counts_the_larger_figure(self):
        # measured usage alone (5,421) would have allowed a 6,269 ceiling; the conservative 5,529 needs 6,377
        r = copy.deepcopy(self.req); r["proposedLimits"]["cumulativeCeilingRequests"] = 6269; self.expect(r, "below the reconciled requirement")

    def test_identity_cap_below_need_refused(self):
        r = copy.deepcopy(self.req); r["proposedLimits"]["identityCap"] = 97; self.expect(r, "identity cap")

    def test_approved_limits_cannot_exceed_proposal(self):
        r = copy.deepcopy(self.req); r["approvedLimits"]["cumulativeCeilingRequests"] = 9999; self.expect(r, "exceeds what the request proposed")

    # ---- item 3: commits are never declared by hand
    def test_declared_commit_classification_is_refused(self):
        r = copy.deepcopy(self.req); r["release"]["commitsSinceLastRun"] = [{"sha": "x", "customerFacing": False}]; self.expect(r, "commitsSinceLastRun is not accepted")

    def test_full_shas_required(self):
        r = copy.deepcopy(self.req); r["release"]["testedSha"] = "4c85b00"; self.expect(r, "40-character")

    def test_expected_pass_after_window_start_refused(self):
        r = copy.deepcopy(self.req); r["window"]["startUtc"] = "2026-10-28T18:00:00Z"; self.expect(r, "window start")

    def test_expected_pass_missing_refused(self):
        l = copy.deepcopy(self.ledger); l["gaps"][2]["expectedPass"]["criteria"] = ""
        self.expect(self.req, "expectedPass.criteria", ledger=l)

    def test_workflow_and_config_versions_must_match(self):
        r = copy.deepcopy(self.req); r["workflowVersion"] = "0.9.0"; self.expect(r, "workflowVersion")
        r = copy.deepcopy(self.req); r["configVersion"] = "0.1.0"; self.expect(r, "configVersion")

    def test_harness_hash_must_match_config(self):
        r = copy.deepcopy(self.req); r["harness"]["codeManifestSha256"] = "0" * 64; self.expect(r, "harness")

    def test_prior_runs_must_be_the_compared_baselines(self):
        r = copy.deepcopy(self.req); r["priorRuns"] = r["priorRuns"][:1]; self.expect(r, "priorRuns")

    def test_deviations_must_be_a_list(self):
        r = copy.deepcopy(self.req); r["deviations"] = None; self.expect(r, "deviations")


if __name__ == "__main__":
    unittest.main()
