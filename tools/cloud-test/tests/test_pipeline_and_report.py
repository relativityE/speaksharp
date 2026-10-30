"""End-to-end control-plane pipeline: secret-free, offline, derived summary, validated report, and the report's refusals."""
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest

from _fixtures import NOW, REPO, ROOT, TESTED, prerequisite, request_path, run_py, sample, wjson
from _synthetic_history import shared as synthetic_history
import derive_summary as DS
import workflow_report as W

REQ = request_path()


def pipeline(extra=(), env=None, out=None):
    """The real pipeline over the SYNTHETIC sealed history (tests/_synthetic_history.py), never the retained campaigns."""
    h = synthetic_history()
    d = tempfile.mkdtemp(prefix="ct-pl-")
    oc = os.path.join(d, "oc.json"); wjson(oc, {"passed": True})
    out = out or os.path.join(d, "out")
    r = run_py("scripts/pipeline.py", "--request", h.request(REQ), "--out-dir", out, "--offline-checks", oc, "--repo", REPO, "--now", NOW,
               "--generated-at", NOW, *h.args(), *extra, env=env)
    return r, out


class Pipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        prerequisite(os.system("git -C %s cat-file -e %s 2>/dev/null" % (REPO, TESTED)) == 0, "git history of the repository")
        # A complete pipeline run over the synthetic sealed history, index and owner counters.
        cls.r, cls.out = pipeline(["--require-secret-free"])
        cls.rep = json.load(open(os.path.join(cls.out, "report", "report.json"))) if os.path.exists(os.path.join(cls.out, "report", "report.json")) else None

    def test_it_completes_and_the_report_validates(self):
        self.assertEqual(self.r.returncode, 0, self.r.stdout + self.r.stderr)
        self.assertTrue(json.load(open(os.path.join(self.out, "report", "validation.json")))["valid"])

    def test_the_summary_is_derived_leads_with_the_status_and_fits_250_words(self):
        ex = self.rep["executiveSummary"]
        self.assertTrue(ex["derived"])
        self.assertEqual(ex["parts"][0], ["Status", "BLOCKED."])
        self.assertLessEqual(ex["words"], 250)
        self.assertEqual(ex["fields"]["recommendation"], "HOLD")
        self.assertEqual(ex["fields"]["provenGapsClosed"], [])

    def test_the_report_has_seven_areas_fifteen_journeys_and_three_columns(self):
        self.assertEqual((len(self.rep["areas"]), len(self.rep["journeys"])), (7, 15))
        self.assertTrue(self.rep["latestPending"])
        self.assertTrue(all(j["latest"] is None for j in self.rep["journeys"]))

    def test_the_attestation_says_secret_free_and_no_network(self):
        a = json.load(open(os.path.join(self.out, "preflight-attestation.json")))
        self.assertEqual((a["secretFree"], a["networkAttempts"], a["productHostsContacted"], a["credentialLikeVariablesPresent"]), (True, 0, 0, []))

    def test_costs_are_unknown_in_the_report(self):
        c = self.rep["purposeAndCost"]["spend"]["costs"]
        self.assertTrue(all(v["status"] == "unknown" and v["usd"] is None for v in c.values()))
        html = open(os.path.join(self.out, "report", "REPORT.html"), encoding="utf-8").read()
        self.assertIn("unknown", html)
        self.assertNotIn("$0.00", html)

    def test_the_comparison_is_generated_not_supplied(self):
        self.assertTrue(os.path.isfile(os.path.join(self.out, "comparison-prior", "comparison.json")))
        self.assertEqual(self.rep["comparisonValidity"]["verdict"], "Not a controlled comparison.")

    def test_a_credential_in_the_environment_stops_a_secret_free_stage(self):
        r, out = pipeline(["--require-secret-free"], env={"THROWAWAY_TEST_PASSWORD": "x"})
        self.assertEqual(r.returncode, 5, r.stdout)
        self.assertIn("THROWAWAY_TEST_PASSWORD", r.stdout)
        self.assertNotIn("=x", r.stdout)

    def test_a_forbidden_service_role_key_stops_a_secret_free_stage(self):
        r, _ = pipeline(["--require-secret-free"], env={"SUPABASE_SERVICE_ROLE_KEY": "x"})
        self.assertEqual(r.returncode, 5)

    def test_enforce_go_stops_early_when_a_blocking_gate_is_open(self):
        r, out = pipeline(["--enforce-go"])
        self.assertEqual(r.returncode, 4, r.stdout + r.stderr)
        self.assertIn("Nothing was spent", r.stdout)

    def test_the_network_guard_denies_and_counts(self):
        log = os.path.join(tempfile.mkdtemp(), "net.log")
        code = ("import sys; sys.path.insert(0, %r); import _common, socket\n"
                "try:\n    socket.create_connection(('127.0.0.1', 9), 1)\nexcept OSError:\n    print('denied')\n"
                "try:\n    socket.getaddrinfo('example.invalid', 443)\nexcept OSError:\n    print('denied')\n") % os.path.join(ROOT, "scripts")
        r = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True, env={"PATH": os.environ["PATH"], "CT_NETGUARD_LOG": log})
        self.assertEqual(r.stdout.count("denied"), 2, r.stdout + r.stderr)
        self.assertEqual(open(log).read().count("attempt"), 2)

    def test_an_existing_output_directory_is_refused(self):
        d = tempfile.mkdtemp()
        r, _ = pipeline(out=d)
        self.assertNotEqual(r.returncode, 0)


class ReportRefusals(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # A complete pipeline report over the synthetic history; also reached from SummaryRules and the v14/v15 refusal tests.
        prerequisite(os.system("git -C %s cat-file -e %s 2>/dev/null" % (REPO, TESTED)) == 0, "git history of the repository")
        r, out = pipeline()
        cls.rep = json.load(open(os.path.join(out, "report", "report.json")))
        ReportRefusals.rep_cache = cls.rep
        cls.wf = sample()["wf"]

    def errs(self, mutate):
        rep = copy.deepcopy(self.rep)
        mutate(rep)
        return W.validate(rep, self.wf)

    def has(self, mutate, fragment):
        e = self.errs(mutate)
        self.assertTrue(any(fragment in x for x in e), e)

    def test_the_unmodified_report_is_valid(self):
        self.assertEqual(self.errs(lambda r: None), [])

    def test_over_250_words(self):
        self.has(lambda r: r["executiveSummary"].update(words=251), "words")

    def test_an_authored_summary_is_refused(self):
        self.has(lambda r: r["executiveSummary"].update(derived=False), "derived from evidence")

    def test_bad_status_and_recommendation(self):
        self.has(lambda r: r["executiveSummary"]["fields"].update(status="GREAT"), "status")
        self.has(lambda r: r["executiveSummary"]["fields"].update(recommendation="SHIP"), "recommendation")

    def test_a_gap_status_that_does_not_follow_from_its_evidence_is_refused(self):
        def m(r):
            r["gapLedger"][2]["status"] = "CLOSED"
        self.has(m, "does not follow from its evidence")

    def test_a_claimed_closure_in_the_summary_is_refused(self):
        self.has(lambda r: r["executiveSummary"]["fields"].update(provenGapsClosed=["GAP-03"]), "provenGapsClosed")

    def test_an_unknown_cost_with_a_number_is_refused(self):
        def m(r):
            r["purposeAndCost"]["spend"]["costs"]["provider"]["usd"] = 0
        self.has(m, "unknown but carries a number")

    def test_a_reported_cost_without_a_source_is_refused(self):
        def m(r):
            c = r["purposeAndCost"]["spend"]["costs"]["cloudAgent"]; c.update(status="reported", usd=3)
        self.has(m, "without a source")

    def test_a_secret_shaped_string_is_refused(self):
        self.has(lambda r: r.update(note="reach someone@example.com"), "secret/identifier")

    def test_the_three_denominators_must_stay_separate(self):
        self.has(lambda r: r["denominators"].pop("requirements"), "denominators")


class SummaryRules(unittest.TestCase):
    """derive_summary rules (owner review fix 2): READY cannot be said while failures, incomplete coverage, open gaps or blocking gates remain."""
    @classmethod
    def setUpClass(cls):
        cls.cmp = json.load(open(os.path.join(ROOT, "tests", "fixtures", "accepted-comparison-R5-vs-R4C.json")))
        cls.wf = sample()["wf"]
        cls.req = sample()["req"]

    def gates(self, go):
        return {"decision": "GO" if go else "NO-GO", "gates": [{"id": "G1", "status": "READY" if go else "OWNER-INPUT-OPEN"}]}

    def ld(self, statuses):
        return {"gaps": [{"id": "GAP-%02d" % (i + 1), "status": s, "history": {}, "kind": "product-fix"} for i, s in enumerate(statuses)]}

    def rv(self):
        return {"sinceLastRun": [], "sinceBaseline": [], "fixes": {}, "testedSha": TESTED}

    def sp(self):
        return {"requests": {"estimate": {"planned": 96, "runCap": 180}, "cap": {"runCapRequests": 180}, "actual": None}, "costs": {}}

    def latest(self, verdicts, same_release=True, classes=None):
        """A latest-versus-R5 comparison: verdicts maps journey id -> (prev, cur); unlisted journeys take their R5 verdicts."""
        c = copy.deepcopy(self.cmp)
        c["previous"]["servedSha"] = TESTED
        c["current"]["servedSha"] = TESTED if same_release else "1" * 40
        for j in c["journeys"]:
            prev = j["cur"]
            cur = prev
            if j["id"] in verdicts:
                prev, cur = verdicts[j["id"]]
            j.update({"prev": prev, "cur": cur, "class": (classes or {}).get(j["id"], "unchanged"), "disputed_rows": []})
        return c

    FULL = {"fullLiveRun": True, "kind": "FULL", "statement": "204 of 204 required rows executed"}
    SAFE_ALERTS = {"alerts": [], "evidenceStale": False, "evidenceAgeHours": 3.0}
    SAFE_ISO = {"status": "proven", "proven": True, "problems": []}

    def derive(self, go, statuses, latest=None, selected=("AHT-12",), targeted=("GAP-03",), coverage=FULL, alerts=SAFE_ALERTS, isolation=SAFE_ISO, spend=None):
        req = copy.deepcopy(self.req); req["targetedGaps"] = list(targeted)
        req["selection"] = [{"case": c} for c in selected]
        return DS.derive(self.cmp, latest, self.ld(statuses), self.rv(), self.gates(go), spend or self.sp(), self.wf, req, 180, coverage=coverage, alerts=alerts, isolation=isolation)

    def all_pass(self):
        return {j["id"]: ("PASS", "PASS") for j in self.cmp["journeys"]}

    def test_pre_run_no_go_is_blocked_hold(self):
        f = self.derive(False, ["OPEN"] * 6)
        self.assertEqual((f["status"], f["recommendation"]), ("BLOCKED", "HOLD"))

    def test_pre_run_go_is_limited_proceed_never_ready(self):
        f = self.derive(True, ["CLOSED"] * 6)
        self.assertEqual((f["status"], f["recommendation"]), ("LIMITED", "PROCEED"))

    def test_a_targeted_fix_that_failed_its_retest_is_blocked_fix_and_retest(self):
        f = self.derive(True, ["OPEN", "OPEN", "FAILED-RETEST"], latest=self.latest({"AHT-12": ("NOT RUN", "FAIL")}))
        self.assertEqual((f["status"], f["recommendation"]), ("BLOCKED", "FIX AND RETEST"))

    def test_a_regressed_journey_is_blocked(self):
        f = self.derive(True, ["OPEN"] * 3, latest=self.latest({"AHT-12": ("PASS", "FAIL")}, classes={"AHT-12": "regressed"}))
        self.assertEqual(f["status"], "BLOCKED")

    def test_closing_the_targeted_gap_does_not_make_the_product_ready_while_unchanged_failures_remain(self):
        """The reviewed defect: AHT-12 passes and its gap closes, but AHT-02 and AHT-03 still FAIL outside the selected test."""
        lat = self.latest({"AHT-12": ("NOT RUN", "PASS")})
        f = self.derive(True, ["CLOSED"] * 6, latest=lat)
        self.assertEqual(f["status"], "LIMITED")
        self.assertIn("AHT-02", f["readinessBasis"]["journeysFail"])
        self.assertIn("AHT-03", f["readinessBasis"]["journeysFail"])
        self.assertIn("Known failures remain", f["customerImpact"])
        self.assertIn("AHT-02", f["readiness"])

    def test_incomplete_coverage_blocks_ready(self):
        v = self.all_pass(); v["AHT-07"] = ("NOT RUN", "NOT RUN")
        f = self.derive(True, ["CLOSED"] * 6, latest=self.latest(v))
        self.assertEqual(f["status"], "LIMITED")
        self.assertIn("AHT-07", f["readinessBasis"]["journeysNotShownPass"])

    def test_blocking_gates_block_ready(self):
        f = self.derive(False, ["CLOSED"] * 6, latest=self.latest(self.all_pass()))
        self.assertEqual(f["status"], "BLOCKED")

    def test_an_open_tracked_gap_blocks_ready_even_when_it_was_not_targeted(self):
        f = self.derive(True, ["CLOSED", "CLOSED", "CLOSED", "OPEN", "CLOSED", "CLOSED"], latest=self.latest(self.all_pass()))
        self.assertEqual(f["status"], "LIMITED")
        self.assertEqual(f["readinessBasis"]["gapsNotClosed"], ["GAP-04"])

    def test_an_inconclusive_selected_journey_blocks_ready(self):
        f = self.derive(True, ["CLOSED"] * 6, latest=self.latest(self.all_pass(), classes={"AHT-12": "inconclusive"}))
        self.assertEqual(f["status"], "LIMITED")

    def test_ready_only_when_everything_holds(self):
        f = self.derive(True, ["CLOSED"] * 6, latest=self.latest(self.all_pass()))
        self.assertEqual((f["status"], f["recommendation"]), ("READY", "PROCEED"))
        self.assertEqual(f["readinessBasis"]["journeysPass"], 15)

    def test_ready_needs_a_full_live_run_even_when_everything_else_holds(self):
        f = self.derive(True, ["CLOSED"] * 6, latest=self.latest(self.all_pass()), coverage={"fullLiveRun": False, "kind": "PARTIAL", "statement": "92 of 204 required rows executed"})
        self.assertEqual(f["status"], "LIMITED")

    def test_carried_forward_verdicts_need_the_same_release(self):
        v = self.all_pass()
        f_same = self.derive(True, ["CLOSED"] * 6, latest=self.latest(v))
        self.assertIn("AHT-01", f_same["readinessBasis"]["carriedForward"])
        f_diff = self.derive(True, ["CLOSED"] * 6, latest=self.latest(v, same_release=False))
        self.assertEqual(f_diff["status"], "LIMITED")
        self.assertGreater(len(f_diff["readinessBasis"]["journeysNotShownPass"]), 10)

    def test_the_word_limit_is_enforced_by_listing_fewer_items(self):
        f = self.derive(False, ["OPEN"] * 6)
        self.assertLessEqual(DS.total_words(f), 180)

    def test_the_report_refuses_a_ready_status_that_contradicts_its_basis(self):
        if not hasattr(ReportRefusals, "rep_cache"):
            ReportRefusals.setUpClass()
        rep = copy.deepcopy(ReportRefusals.rep_cache)
        rep["executiveSummary"]["fields"]["status"] = "READY"
        errs = W.validate(rep, sample()["wf"])
        self.assertTrue(any("READY contradicts the readiness basis" in e for e in errs), errs)


if __name__ == "__main__":
    unittest.main()
