"""Unit tests for the run-report generator. Synthetic runs only (15 journeys, 204 assertions, 151 requirement rows).

Every classification rule has a positive test and a negative control: the negative control mutates the rule (switches it
off) and asserts that the mutated rule produces a WRONG class, i.e. the positive test would fail against the mutant.
Run:  python3 -I -m unittest discover -s tests -v   (from the tool directory)
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.dirname(HERE)
sys.path.insert(0, TOOL)
sys.path.insert(0, HERE)
import rr_core as C  # noqa: E402
import synth  # noqa: E402

CID = "AHT-05"


def build(prev_kw=None, cur_kw=None, facts=None, overlay=None, rules=None):
    d = tempfile.mkdtemp(prefix="rrtest-")
    prev_dir, cur_dir = os.path.join(d, "prev"), os.path.join(d, "cur")
    synth.make_run(prev_dir, "P", **(prev_kw or {}))
    synth.make_run(cur_dir, "C", served="b" * 40, **(cur_kw or {}))
    prev = C.load_run(prev_dir, "P")
    cur = C.load_run(cur_dir, "C")
    res = C.compare_runs(prev, cur, facts, overlay, rules)
    return res, prev, cur, d


def cls(res, aid, cid=CID):
    return next(r for r in res["rows"] if r["case"] == cid and r["id"] == aid)["class"]


def jcls(res, cid=CID):
    return next(j for j in res["journeys"] if j["id"] == cid)["class"]


def ok(v=True, **kw):
    f = {"ok": v}
    f.update(kw)
    return f


class Base(unittest.TestCase):
    def setUp(self):
        self._dirs = []

    def tearDown(self):
        for d in self._dirs:
            shutil.rmtree(d, ignore_errors=True)

    def run_cmp(self, *a, **k):
        res, prev, cur, d = build(*a, **k)
        self._dirs.append(d)
        return res


# ------------------------------------------------------------------------------------------------ denominators
class TestDenominators(Base):
    def test_denominators_151_15_204(self):
        d = tempfile.mkdtemp(prefix="rrtest-")
        self._dirs.append(d)
        synth.make_run(os.path.join(d, "r"), "R")
        run = C.load_run(os.path.join(d, "r"), "R")
        self.assertEqual((run["denominators"]["requirements"], run["denominators"]["journeys"], run["denominators"]["assertions"]), (151, 15, 204))
        self.assertEqual(run["tallies"]["assertions"], {"PASS": 204})

    def _broken(self):
        d = tempfile.mkdtemp(prefix="rrtest-")
        self._dirs.append(d)
        p = os.path.join(d, "r")
        synth.make_run(p, "R")
        with open(os.path.join(p, "case-results.json")) as f:
            cr = json.load(f)
        cr["validationRequirements"] = cr["validationRequirements"][:150]
        with open(os.path.join(p, "case-results.json"), "w") as f:
            json.dump(cr, f)
        return p

    def test_wrong_requirement_denominator_is_refused(self):
        with self.assertRaises(C.ReportError):
            C.load_run(self._broken(), "R")

    def test_negctl_denominator_check_off_accepts_wrong_denominator(self):
        run = C.load_run(self._broken(), "R", rules=dict(C.DEFAULT_RULES, denominators=False))
        self.assertEqual(run["denominators"]["requirements"], 150)  # the mutant silently accepts 150 rows


# ------------------------------------------------------------------------------------------------ unchanged
class TestUnchanged(Base):
    def test_identical_runs_are_unchanged(self):
        res = self.run_cmp()
        self.assertTrue(all(j["class"] == "unchanged" for j in res["journeys"]))
        self.assertEqual(res["changes"], [])

    def test_retained_rows_same_verdicts_unchanged_with_fail(self):
        sp = {CID: {"r1": ("FAIL", ok(False))}}
        res = self.run_cmp({"sp": sp}, {"sp": sp})
        self.assertEqual(jcls(res), "unchanged")
        self.assertEqual(cls(res, "r1"), "unchanged")

    def test_not_run_in_both_is_no_signal_not_improvement(self):
        sp = {CID: {"r1": ("NOT RUN", {"notReached": True})}}
        res = self.run_cmp({"sp": sp}, {"sp": sp})
        self.assertEqual(cls(res, "r1"), "no-signal")
        self.assertEqual(jcls(res), "unchanged")


# ------------------------------------------------------------------------------------------------ improved: valid stimulus and observer
class TestImproved(Base):
    PREV = {"sp": {CID: {"r1": ("FAIL", ok(False))}}}
    CUR = {"sp": {CID: {"r1": ("PASS", ok(True))}}}

    def test_improved_when_everything_is_valid(self):
        res = self.run_cmp(self.PREV, self.CUR)
        self.assertEqual(cls(res, "r1"), "improved")
        self.assertEqual(jcls(res), "improved")

    # stimulus
    def _stim(self, rules=None):
        sp_prev = {CID: {"r1": ("FAIL", ok(False)), "r2": ("NOT RUN", {"fired": False})}}
        sp_cur = {CID: {"r1": ("PASS", ok(True)), "r2": ("NOT RUN", {"fired": False})}}
        return self.run_cmp({"sp": sp_prev}, {"sp": sp_cur}, rules=rules)

    def test_stimulus_not_established_is_inconclusive(self):
        res = self._stim()
        self.assertEqual(cls(res, "r1"), "inconclusive")
        self.assertEqual(jcls(res), "inconclusive")

    def test_negctl_stimulus_gate_off_gives_wrong_improved(self):
        res = self._stim(rules={"gate_stimulus": False})
        self.assertEqual(cls(res, "r1"), "improved")

    # observer changed (evidence schema differs)
    def _obs(self, rules=None):
        return self.run_cmp({"sp": {CID: {"r1": ("FAIL", ok(False))}}}, {"sp": {CID: {"r1": ("PASS", ok(True, handlerFailures=0))}}}, rules=rules)

    def test_observer_changed_is_inconclusive(self):
        res = self._obs()
        self.assertEqual(cls(res, "r1"), "inconclusive")
        self.assertTrue(any(g["code"] == "observer-changed" for g in next(r for r in res["rows"] if r["id"] == "r1" and r["case"] == CID)["reasons"]))

    def test_negctl_observer_gate_off_gives_wrong_improved(self):
        self.assertEqual(cls(self._obs({"gate_observer": False}), "r1"), "improved")

    def test_overlay_declared_observer_change_is_inconclusive(self):
        ov = {"observerChanges": [{"case": CID, "assertion": "r1", "note": "driver fix"}]}
        res = self.run_cmp(self.PREV, self.CUR, overlay=ov)
        self.assertEqual(cls(res, "r1"), "inconclusive")

    # harness packet differs: observer cannot be shown to be the same unless attested
    def test_packet_differs_unattested_is_inconclusive_attested_is_improved(self):
        cur = dict(self.CUR, code_sha="9" * 64)
        self.assertEqual(cls(self.run_cmp(self.PREV, cur), "r1"), "inconclusive")
        att = {"observerAttestations": [{"case": CID, "assertion": "r1", "text": "same observer"}]}
        self.assertEqual(cls(self.run_cmp(self.PREV, cur, facts=att), "r1"), "improved")

    def test_negctl_packet_unproven_gate_off_gives_wrong_improved(self):
        cur = dict(self.CUR, code_sha="9" * 64)
        self.assertEqual(cls(self.run_cmp(self.PREV, cur, rules={"gate_observer": False}), "r1"), "improved")

    # media
    def test_media_binding_differs_is_inconclusive(self):
        cur = dict(self.CUR, media={CID: "9" * 64})
        res = self.run_cmp(self.PREV, cur)
        self.assertEqual(cls(res, "r1"), "inconclusive")
        self.assertEqual(jcls(res), "inconclusive")

    def test_negctl_media_gate_off_gives_wrong_improved(self):
        cur = dict(self.CUR, media={CID: "9" * 64})
        self.assertEqual(cls(self.run_cmp(self.PREV, cur, rules={"gate_media": False}), "r1"), "improved")

    # omitted by design / allowance
    def test_prior_omitted_by_design_then_pass_is_inconclusive(self):
        prev = {"sp": {CID: {"r1": ("NOT RUN", {"omittedBy": "minimal-sample", "notAttempted": True})}}}
        res = self.run_cmp(prev, self.CUR)
        self.assertEqual(cls(res, "r1"), "inconclusive")

    def test_negctl_omitted_gate_off_gives_wrong_improved(self):
        prev = {"sp": {CID: {"r1": ("NOT RUN", {"omittedBy": "minimal-sample", "notAttempted": True})}}}
        self.assertEqual(cls(self.run_cmp(prev, self.CUR, rules={"gate_omitted_allowance": False}), "r1"), "improved")

    def test_allowance_interruption_makes_journey_inconclusive(self):
        cur = dict(self.CUR, interruption={CID: {"kind": "request-allowance", "affectedChecks": 1}})
        res = self.run_cmp(self.PREV, cur)
        self.assertEqual(jcls(res), "inconclusive")

    def test_negctl_allowance_gate_off_gives_wrong_improved(self):
        cur = dict(self.CUR, interruption={CID: {"kind": "request-allowance", "affectedChecks": 1}})
        self.assertEqual(jcls(self.run_cmp(self.PREV, cur, rules={"gate_omitted_allowance": False})), "improved")

    # receipts
    def test_missing_prior_receipt_is_inconclusive(self):
        prev = dict(self.PREV, drop_files=[(CID, "aht-05-1.json")])
        res = self.run_cmp(prev, self.CUR)
        self.assertEqual(cls(res, "r1"), "inconclusive")

    def test_negctl_receipt_gate_off_gives_wrong_improved(self):
        prev = dict(self.PREV, drop_files=[(CID, "aht-05-1.json")])
        self.assertEqual(cls(self.run_cmp(prev, self.CUR, rules={"gate_receipt": False}), "r1"), "improved")

    def test_not_run_to_pass_with_prior_not_reached_is_not_an_improvement(self):
        prev = {"sp": {CID: {"r1": ("NOT RUN", {"notReached": True})}}}
        self.assertEqual(cls(self.run_cmp(prev, self.CUR), "r1"), "inconclusive")

    def test_negctl_stimulus_gate_off_prior_not_reached_gives_wrong_improved(self):
        prev = {"sp": {CID: {"r1": ("NOT RUN", {"notReached": True})}}}
        self.assertEqual(cls(self.run_cmp(prev, self.CUR, rules={"gate_stimulus": False}), "r1"), "improved")


# ------------------------------------------------------------------------------------------------ regressed
class TestRegressed(Base):
    PREV = {}
    CUR = {"sp": {CID: {"r1": ("FAIL", ok(False))}}}

    def test_regressed_when_valid(self):
        res = self.run_cmp(self.PREV, self.CUR)
        self.assertEqual(cls(res, "r1"), "regressed")
        self.assertEqual(jcls(res), "regressed")

    def test_pass_to_fail_with_media_change_is_inconclusive(self):
        res = self.run_cmp(self.PREV, dict(self.CUR, media={CID: "9" * 64}))
        self.assertEqual(cls(res, "r1"), "inconclusive")

    def test_negctl_media_gate_off_gives_wrong_regressed(self):
        res = self.run_cmp(self.PREV, dict(self.CUR, media={CID: "9" * 64}), rules={"gate_media": False})
        self.assertEqual(cls(res, "r1"), "regressed")

    def test_new_fail_without_prior_verdict_is_not_a_regression(self):
        prev = {"sp": {CID: {"r1": ("NOT RUN", {"notReached": True})}}}
        self.assertNotEqual(cls(self.run_cmp(prev, self.CUR), "r1"), "regressed")


# ------------------------------------------------------------------------------------------------ coverage lost
class TestCoverageLost(Base):
    def _lost(self, prev_v, rules=None):
        prev = {"sp": {CID: {"r1": (prev_v, ok(prev_v == "PASS"))}}}
        cur = {"sp": {CID: {"r1": ("NOT RUN", ok(None))}}}
        return self.run_cmp(prev, cur, rules=rules)

    def test_fail_to_not_run_is_coverage_lost_never_improved(self):
        res = self._lost("FAIL")
        row = next(r for r in res["rows"] if r["case"] == CID and r["id"] == "r1")
        self.assertEqual((row["kind"], row["class"]), ("lost", "inconclusive"))
        self.assertIn("coverage-lost", [g["code"] for g in row["reasons"]])

    def test_pass_to_not_run_is_coverage_lost_never_regressed(self):
        self.assertEqual(cls(self._lost("PASS"), "r1"), "inconclusive")

    def test_negctl_coverage_rule_off_counts_lost_fail_as_improvement(self):
        self.assertEqual(cls(self._lost("FAIL", {"coverage_lost": False}), "r1"), "improved")

    def test_negctl_coverage_rule_off_counts_lost_pass_as_regression(self):
        self.assertEqual(cls(self._lost("PASS", {"coverage_lost": False}), "r1"), "regressed")


# ------------------------------------------------------------------------------------------------ disputed oracle
class TestDisputed(Base):
    SP = {"sp": {CID: {"r1": ("FAIL", ok(False))}}}
    OV = {"rowClassifications": [{"run": "both", "case": CID, "assertion": "r1", "class": "disputed-oracle", "note": "n", "source": "s"}]}

    def test_unchanged_disputed_fail_is_unchanged_not_regression(self):
        res = self.run_cmp(self.SP, self.SP, overlay=self.OV)
        row = next(r for r in res["rows"] if r["case"] == CID and r["id"] == "r1")
        self.assertEqual(row["class"], "unchanged")
        self.assertTrue(row["disputed"])
        self.assertEqual(jcls(res), "unchanged")

    def test_negctl_disputed_rule_off_counts_it_as_regression(self):
        res = self.run_cmp(self.SP, self.SP, overlay=self.OV, rules={"disputed_fail_never_regression": False})
        self.assertEqual(cls(res, "r1"), "regressed")


# ------------------------------------------------------------------------------------------------ missing prior receipts / binding, areas
class TestReceiptsAndAreas(Base):
    def test_missing_prior_binding_makes_every_journey_inconclusive(self):
        res = self.run_cmp({"drop_approval": True}, {})
        self.assertTrue(all(j["class"] == "inconclusive" for j in res["journeys"]))
        self.assertTrue(all(a["class"] == "inconclusive" for a in res["areas"]))

    def test_negctl_receipt_gate_off_hides_missing_binding(self):
        res = self.run_cmp({"drop_approval": True}, {}, rules={"gate_receipt": False})
        self.assertTrue(all(j["class"] == "unchanged" for j in res["journeys"]))

    def test_missing_prior_case_result_makes_that_journey_and_its_area_inconclusive(self):
        res = self.run_cmp({"drop_files": [("AHT-03", "case-result.json")]}, {})
        self.assertEqual(jcls(res, "AHT-03"), "inconclusive")
        self.assertEqual(jcls(res, "AHT-01"), "unchanged")
        pg02 = next(a for a in res["areas"] if a["id"] == "PG02")
        self.assertEqual(pg02["class"], "inconclusive")

    def test_area_unchanged_when_all_verdict_rows_unchanged_and_no_verdict_area_is_inconclusive(self):
        res = self.run_cmp()
        a = {x["id"]: x for x in res["areas"]}
        self.assertEqual(a["PG02"]["class"], "unchanged")
        self.assertEqual(a["PG01"]["class"], "inconclusive")  # no AHT row, no verdict
        self.assertTrue(a["PG01"]["no_signal"])

    def test_area_regressed_when_a_journey_regressed(self):
        res = self.run_cmp({}, {"sp": {"AHT-02": {"r1": ("FAIL", ok(False))}}})
        self.assertEqual(next(a for a in res["areas"] if a["id"] == "PG02")["class"], "regressed")


# ------------------------------------------------------------------------------------------------ end to end
class TestCli(Base):
    def test_cli_builds_bundle_and_refuses_existing_dir(self):
        d = tempfile.mkdtemp(prefix="rrtest-")
        self._dirs.append(d)
        synth.make_run(os.path.join(d, "p"), "P")
        synth.make_run(os.path.join(d, "c"), "C", served="b" * 40, sp={"AHT-05": {"r1": ("NOT RUN", {"omittedBy": "minimal-sample", "notAttempted": True})}})
        out = os.path.join(d, "out")
        cmd = [sys.executable, "-I", os.path.join(TOOL, "build_run_report.py"), "--current", os.path.join(d, "c"), "--previous", os.path.join(d, "p"), "--out", out,
               "--current-label", "C", "--previous-label", "P", "--generated-at", "2026-01-01T00:00:00Z"]
        r = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        for f in ("REPORT.html", "comparison.json", "journeys.csv", "assertions.csv", "changes.csv", "MANIFEST.json"):
            self.assertTrue(os.path.isfile(os.path.join(out, f)), f)
        with open(os.path.join(out, "MANIFEST.json")) as f:
            man = json.load(f)
        for e in man["files"]:
            with open(os.path.join(out, e["path"]), "rb") as f:
                self.assertEqual(hashlib.sha256(f.read()).hexdigest(), e["sha256"], e["path"])
        with open(os.path.join(out, "comparison.json")) as f:
            cj = json.load(f)
        self.assertEqual((cj["denominators"]["requirements"]["total"], cj["denominators"]["journeys"]["total"], cj["denominators"]["assertions"]["total"]), (151, 15, 204))
        self.assertEqual(len(cj["changes"]), 1)
        self.assertEqual(cj["changes"][0]["reason_code"], "omitted-by-design")
        with open(os.path.join(out, "REPORT.html")) as f:
            html = f.read()
        self.assertLess(html.index('id="headline"'), html.index('id="validity"'))
        self.assertLess(html.index('id="validity"'), html.index('id="class-counts"'))
        self.assertLess(html.index('id="class-counts"'), html.index('id="areas"'))
        self.assertLess(html.index('id="areas"'), html.index('id="journeys"'))
        self.assertNotIn("http://", html)
        self.assertNotIn("https://", html)
        r2 = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(r2.returncode, 2)
        self.assertIn("already exists", r2.stderr)


if __name__ == "__main__":
    unittest.main()


class TestChronology(unittest.TestCase):
    def test_causes_follow_execution_order_not_list_order(self):
        rows = [
            {"id": "late-nr", "verdict": "NOT RUN", "refs": ["aht-01-8.json"], "flags": C._flags({"id": "x"}, {"notReached": True}, {}), "facts": {"notReached": True}},
            {"id": "the-fail", "verdict": "FAIL", "refs": ["aht-01-3.json"], "flags": C._flags({"id": "x"}, {}, {}), "facts": {}},
        ]
        case = {"rows": rows, "guard": None, "interruption": None}
        C._assign_causes(case)
        self.assertEqual(rows[0]["cause"]["code"], "after-fail")  # listed before the FAIL, executed after it
        self.assertEqual(rows[0]["cause"]["via"], "the-fail")
