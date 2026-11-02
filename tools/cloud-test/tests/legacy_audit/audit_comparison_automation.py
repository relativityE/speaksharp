"""HISTORICAL AUDIT of the retained Cloud Test campaigns (moved unchanged from tests/test_comparison_automation.py at 96af08e7): the real sealed
R4/R4B/R4C/R5 sets, the accepted R5-vs-R4C comparison and the gap ledger derived from those receipts. Not part of the current suite (never
collected by `discover -p test_*.py`), never current-execution credit; run only by scripts/run_legacy_audit.py with the retained history present."""
import copy
import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _fixtures import ROOT, fake_rv, run_py, sample, wjson, needs_history  # noqa: E402
import derive_ledger as DL  # noqa: E402
import verify_receipts as VRC  # noqa: E402
from test_comparison_automation import manifest, writable  # noqa: E402

RECEIPTS = os.path.join(ROOT, "config", "history", "receipts")
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "accepted-comparison-R5-vs-R4C.json")




class SealedReceipts(unittest.TestCase):
    def setUp(self):
        self.cfg = sample()["cfg"]
        self.pin = {r["label"]: r["receiptsManifestSha256"] for r in self.cfg["history"]["runs"]}

    def copy_set(self, label):
        d = tempfile.mkdtemp(prefix="ct-seal-")
        shutil.copytree(os.path.join(RECEIPTS, label), os.path.join(d, label))
        writable(d)
        return os.path.join(d, label)

    @needs_history
    def test_the_four_sealed_sets_verify_against_their_pinned_hashes(self):
        for lab, pin in self.pin.items():
            errs, n = VRC.verify_set(os.path.join(RECEIPTS, lab), pin)
            self.assertEqual(errs, [], lab)
            self.assertGreater(n, 0)

    @needs_history
    def test_a_changed_receipt_fails(self):
        b = self.copy_set("R5")
        with open(os.path.join(b, "AHT-12", "case-result.json"), "a") as f:
            f.write(" ")
        errs, _ = VRC.verify_set(b, self.pin["R5"])
        self.assertTrue(any("changed: AHT-12/case-result.json" in e for e in errs), errs)

    @needs_history
    def test_an_added_receipt_fails(self):
        b = self.copy_set("R5")
        open(os.path.join(b, "AHT-12", "extra.json"), "w").write("{}")
        self.assertTrue(any("unlisted file" in e for e in VRC.verify_set(b, self.pin["R5"])[0]))

    @needs_history
    def test_a_removed_receipt_fails(self):
        b = self.copy_set("R5")
        os.remove(os.path.join(b, "AHT-12", "case-result.json"))
        self.assertTrue(any("missing: AHT-12/case-result.json" in e for e in VRC.verify_set(b, self.pin["R5"])[0]))

    @needs_history
    def test_a_regenerated_manifest_does_not_match_the_pinned_hash(self):
        b = self.copy_set("R5")
        with open(os.path.join(b, "case-results.json"), "a") as f:
            f.write(" ")
        manifest(b)  # an attacker re-seals the changed set; the pin in the config still differs
        self.assertTrue(any("pinned hash" in e for e in VRC.verify_set(b, self.pin["R5"])[0]))

    @needs_history
    def test_an_unpinned_set_fails(self):
        self.assertTrue(any("no pinned" in e for e in VRC.verify_set(os.path.join(RECEIPTS, "R5"), None)[0]))

    @needs_history
    def test_compare_refuses_a_tampered_set(self):
        d = tempfile.mkdtemp()
        for lab in ("R4C", "R5"):
            shutil.copytree(os.path.join(RECEIPTS, lab), os.path.join(d, lab))
        writable(d)
        with open(os.path.join(d, "R5", "AHT-01", "case-result.json"), "a") as f:
            f.write(" ")
        r = run_py("scripts/compare_latest.py", "--current", "R5", "--previous", "R4C", "--out", os.path.join(d, "out"), "--receipts-root", d)
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertFalse(os.path.exists(os.path.join(d, "out")))

    @needs_history
    def test_sealed_sets_exclude_certificates_and_sandbox_files_and_contain_no_secret_patterns(self):
        for lab in ("R4C", "R5"):
            for r, ds, fs in os.walk(os.path.join(RECEIPTS, lab)):
                self.assertNotIn("tls", ds)
                self.assertNotIn("sandbox.json", fs)
        import re
        pat = re.compile(rb"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|sb_secret_|-----BEGIN [A-Z ]*PRIVATE KEY|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}")
        for r, _, fs in os.walk(RECEIPTS):
            for f in fs:
                self.assertIsNone(pat.search(open(os.path.join(r, f), "rb").read()), os.path.join(r, f))


@needs_history
class AutomaticComparison(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = tempfile.mkdtemp(prefix="ct-cmp-")
        r = run_py("scripts/compare_latest.py", "--current", "R5", "--previous", "R4C", "--out", os.path.join(cls.d, "cmp"), "--generated-at", "2026-10-28T18:11:53Z")
        assert r.returncode == 0, r.stdout + r.stderr
        cls.out = json.load(open(os.path.join(cls.d, "cmp", "comparison.json")))
        cls.accepted = json.load(open(FIXTURE))

    def test_generated_comparison_reproduces_the_independently_verified_result(self):
        for k in ("headline", "classes", "denominators", "validity", "changes", "signals"):
            self.assertEqual(self.out[k], self.accepted[k], k)
        self.assertEqual([(j["id"], j["prev"], j["cur"], j["class"]) for j in self.out["journeys"]], [(j["id"], j["prev"], j["cur"], j["class"]) for j in self.accepted["journeys"]])
        self.assertEqual([(a["id"], a["class"]) for a in self.out["areas"]], [(a["id"], a["class"]) for a in self.accepted["areas"]])

    def test_no_journey_is_claimed_improved_or_regressed_for_r5_against_r4c(self):
        self.assertEqual(self.out["classes"]["journeys"], {"improved": 0, "regressed": 0, "unchanged": 5, "inconclusive": 10})

    def test_inconsistent_latest_receipts_are_flagged_and_never_close_a_gap(self):
        """A forged or inconsistent latest PASS (campaign report and case receipt disagree) is reported as a receipt problem and cannot close a gap."""
        d = tempfile.mkdtemp(prefix="ct-forge-")
        for lab in ("R4", "R4B", "R4C", "R5"):
            shutil.copytree(os.path.join(RECEIPTS, lab), os.path.join(d, lab))
        shutil.copytree(os.path.join(RECEIPTS, "R5"), os.path.join(d, "R6T"))
        writable(d)
        p = os.path.join(d, "R6T", "case-results.json")
        cr = json.load(open(p)); cr["campaignId"] = "R6T-synthetic"
        for c in cr["cases"]:
            if c["caseId"] == "AHT-12":
                c["result"] = "PASS"
                for a in c["assertions"]:
                    if a["id"] in ("press-bound-denial", "denial-truthful-no-mic"):
                        a["result"] = "PASS"
        wjson(p, cr)
        pin = manifest(os.path.join(d, "R6T"))
        cfg = copy.deepcopy(sample()["cfg"])
        cfg["history"]["runs"].append({"label": "R6T", "campaignId": "R6T", "servedSha": "4c85b006ac05e180521fd6e7d807f736987cafe8", "ledgersOnly": False, "receiptsManifestSha256": pin})
        cp = os.path.join(d, "cfg.json"); wjson(cp, cfg)
        r = run_py("scripts/compare_latest.py", "--current", "R6T", "--previous", "R5", "--out", os.path.join(d, "cmp"), "--config", cp, "--receipts-root", d, "--generated-at", "2026-10-29T00:00:00Z")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        cmp_ = json.load(open(os.path.join(d, "cmp", "comparison.json")))
        self.assertTrue(any("differs" in x or "binding check failed" in x for x in cmp_["receipts"]["problems"]), cmp_["receipts"]["problems"])
        j = next(x for x in cmp_["journeys"] if x["id"] == "AHT-12")
        self.assertEqual(j["validity"], "not comparable")
        rv = fake_rv()
        wjson(os.path.join(d, "rv.json"), rv)
        r = run_py("scripts/derive_ledger.py", "--ledger", os.path.join(ROOT, "config/gap-ledger.json"), "--config", cp, "--release-verification", os.path.join(d, "rv.json"), "--latest-label", "R6T",
                   "--latest-comparison", os.path.join(d, "cmp", "comparison.json"), "--receipts-root", d, "--out", os.path.join(d, "ld.json"))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        g = next(x for x in json.load(open(os.path.join(d, "ld.json")))["gaps"] if x["id"] == "GAP-03")
        self.assertEqual(g["latest"]["result"], "PASS")
        self.assertFalse(g["latest"]["comparable"])
        self.assertEqual(g["status"], "INCONCLUSIVE")
        self.assertNotEqual(g["status"], "CLOSED")



class DerivedLedger(unittest.TestCase):
    def setUp(self):
        self.led = sample()["ledger"]
        if self._testMethodName in ("test_the_ledger_definitions_carry_no_typed_results", "test_status_rules"):
            return
        d = tempfile.mkdtemp(); self.out = os.path.join(d, "ld.json")
        wjson(os.path.join(d, "rv.json"), fake_rv())
        r = run_py("scripts/derive_ledger.py", "--ledger", os.path.join(ROOT, "config/gap-ledger.json"), "--release-verification", os.path.join(d, "rv.json"), "--out", self.out)
        assert r.returncode == 0, r.stderr
        self.gaps = {g["id"]: g for g in json.load(open(self.out))["gaps"]}

    @needs_history
    def test_prior_verdicts_come_from_the_sealed_receipts(self):
        g = self.gaps["GAP-03"]
        self.assertEqual({k: v["rollup"] for k, v in g["history"].items()}, {"R4C": "FAIL", "R5": "NOT RUN"})
        self.assertEqual(g["priorFail"]["run"], "R4C")
        self.assertIn("denial-truthful-no-mic", g["priorFail"]["what"])

    @needs_history
    def test_evidence_references_carry_the_sha256_of_the_sealed_file(self):
        g = self.gaps["GAP-03"]
        ev = [e for e in g["priorFail"]["evidence"] if e["file"].endswith(".json")]
        self.assertTrue(ev)
        for e in ev:
            path = os.path.join(RECEIPTS, *e["file"].split("/"))
            self.assertEqual(hashlib.sha256(open(path, "rb").read()).hexdigest(), e["sha256"], e["file"])

    @needs_history
    def test_guard_signals_are_counted_from_the_guard_logs(self):
        coaching = [o for r, h in self.gaps["GAP-01"]["history"].items() for o in h["observations"] if "signal" in o]
        self.assertEqual([o["count"] for o in coaching], [4, 1])
        rest = [o for h in self.gaps["GAP-04"]["history"].values() for o in h["observations"] if "signal" in o]
        self.assertEqual([o["count"] for o in rest], [3, 1])

    @needs_history
    def test_a_missing_assertion_is_not_run_never_pass(self):
        led = copy.deepcopy(self.led)
        led["gaps"][2]["observations"] = [{"case": "AHT-12", "assertion": "no-such-assertion"}]
        d = tempfile.mkdtemp(); lp = os.path.join(d, "l.json"); wjson(lp, led); wjson(os.path.join(d, "rv.json"), fake_rv())
        r = run_py("scripts/derive_ledger.py", "--ledger", lp, "--release-verification", os.path.join(d, "rv.json"), "--out", os.path.join(d, "o.json"))
        g = next(x for x in json.load(open(os.path.join(d, "o.json")))["gaps"] if x["id"] == "GAP-03")
        self.assertEqual({k: v["rollup"] for k, v in g["history"].items()}, {"R4C": "NOT RUN", "R5": "NOT RUN"})

    @needs_history
    def test_pending_until_a_latest_run_exists(self):
        for g in self.gaps.values():
            self.assertEqual(g["latest"]["result"], "PENDING")
            self.assertNotEqual(g["status"], "CLOSED")

    @needs_history
    def test_the_candidate_fix_for_the_403_is_never_a_verified_fix(self):
        self.assertTrue(self.gaps["GAP-04"]["fix"]["candidate"])
        self.assertEqual(self.gaps["GAP-04"]["status"], "OPEN")

    @needs_history
    def test_a_deployed_fix_that_was_tested_and_still_failed_is_failed_retest_not_open(self):
        g = copy.deepcopy(self.gaps["GAP-03"]); g["latest"] = {"result": "FAIL", "evidence": [{"file": "x", "sha256": "y"}]}
        self.assertEqual(DL.ledger_status(g)[0], "FAILED-RETEST")


if __name__ == "__main__":
    unittest.main()
