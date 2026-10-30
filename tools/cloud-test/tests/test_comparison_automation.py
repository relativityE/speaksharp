"""Regression tests for comparison automation (owner item 1): immutable sealed prior-run receipts; latest-versus-prior generated automatically from
them; ledger values and the executive summary derived from evidence, never typed."""
import copy
import hashlib
import json
import os
import shutil
import tempfile
import unittest

from _fixtures import ROOT, fake_rv, run_py, sample, wjson
import derive_ledger as DL
import verify_receipts as VRC

RECEIPTS = os.path.join(ROOT, "config", "history", "receipts")
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "accepted-comparison-R5-vs-R4C.json")


def manifest(base):
    lines = []
    for r, _, fs in os.walk(base):
        for f in fs:
            if f not in ("RECEIPTS.sha256", "SEAL.json"):
                full = os.path.join(r, f)
                lines.append("%s  %s" % (hashlib.sha256(open(full, "rb").read()).hexdigest(), os.path.relpath(full, base)))
    lines.sort(key=lambda s: s.split("  ", 1)[1])
    with open(os.path.join(base, "RECEIPTS.sha256"), "w") as f:
        f.write("\n".join(lines) + "\n")
    return hashlib.sha256(open(os.path.join(base, "RECEIPTS.sha256"), "rb").read()).hexdigest()


def writable(d):
    for r, _, fs in os.walk(d):
        for f in fs:
            os.chmod(os.path.join(r, f), 0o644)


class SealedReceipts(unittest.TestCase):
    def setUp(self):
        self.cfg = sample()["cfg"]
        self.pin = {r["label"]: r["receiptsManifestSha256"] for r in self.cfg["history"]["runs"]}

    def copy_set(self, label):
        d = tempfile.mkdtemp(prefix="ct-seal-")
        shutil.copytree(os.path.join(RECEIPTS, label), os.path.join(d, label))
        writable(d)
        return os.path.join(d, label)

    def test_the_four_sealed_sets_verify_against_their_pinned_hashes(self):
        for lab, pin in self.pin.items():
            errs, n = VRC.verify_set(os.path.join(RECEIPTS, lab), pin)
            self.assertEqual(errs, [], lab)
            self.assertGreater(n, 0)

    def test_a_changed_receipt_fails(self):
        b = self.copy_set("R5")
        with open(os.path.join(b, "AHT-12", "case-result.json"), "a") as f:
            f.write(" ")
        errs, _ = VRC.verify_set(b, self.pin["R5"])
        self.assertTrue(any("changed: AHT-12/case-result.json" in e for e in errs), errs)

    def test_an_added_receipt_fails(self):
        b = self.copy_set("R5")
        open(os.path.join(b, "AHT-12", "extra.json"), "w").write("{}")
        self.assertTrue(any("unlisted file" in e for e in VRC.verify_set(b, self.pin["R5"])[0]))

    def test_a_removed_receipt_fails(self):
        b = self.copy_set("R5")
        os.remove(os.path.join(b, "AHT-12", "case-result.json"))
        self.assertTrue(any("missing: AHT-12/case-result.json" in e for e in VRC.verify_set(b, self.pin["R5"])[0]))

    def test_a_regenerated_manifest_does_not_match_the_pinned_hash(self):
        b = self.copy_set("R5")
        with open(os.path.join(b, "case-results.json"), "a") as f:
            f.write(" ")
        manifest(b)  # an attacker re-seals the changed set; the pin in the config still differs
        self.assertTrue(any("pinned hash" in e for e in VRC.verify_set(b, self.pin["R5"])[0]))

    def test_an_unpinned_set_fails(self):
        self.assertTrue(any("no pinned" in e for e in VRC.verify_set(os.path.join(RECEIPTS, "R5"), None)[0]))

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

    def test_seal_refuses_secrets_and_existing_directories(self):
        d = tempfile.mkdtemp()
        led = os.path.join(d, "campaign-ledger.json"); wjson(led, {"used": {"total": 1}, "note": "someone@example.com"})
        idl = os.path.join(d, "identity-ledger.json"); wjson(idl, {"identityGets": 0, "receipts": []})
        r = run_py("scripts/seal_receipts.py", "--label", "X", "--out", os.path.join(d, "X"), "--ledgers-only", "--campaign-ledger", led, "--identity-ledger", idl, "--provenance", "t")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("secret scan", r.stderr)
        wjson(led, {"used": {"total": 1}})
        r = run_py("scripts/seal_receipts.py", "--label", "X", "--out", os.path.join(d, "X"), "--ledgers-only", "--campaign-ledger", led, "--identity-ledger", idl, "--provenance", "t")
        self.assertEqual(r.returncode, 0, r.stderr)
        r = run_py("scripts/seal_receipts.py", "--label", "X", "--out", os.path.join(d, "X"), "--ledgers-only", "--campaign-ledger", led, "--identity-ledger", idl, "--provenance", "t")
        self.assertNotEqual(r.returncode, 0)

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
        d = tempfile.mkdtemp(); self.out = os.path.join(d, "ld.json")
        wjson(os.path.join(d, "rv.json"), fake_rv())
        r = run_py("scripts/derive_ledger.py", "--ledger", os.path.join(ROOT, "config/gap-ledger.json"), "--release-verification", os.path.join(d, "rv.json"), "--out", self.out)
        assert r.returncode == 0, r.stderr
        self.gaps = {g["id"]: g for g in json.load(open(self.out))["gaps"]}

    def test_the_ledger_definitions_carry_no_typed_results(self):
        for g in self.led["gaps"]:
            for k in ("priorRuns", "priorFail", "latest", "status", "deployedInclusion", "r5Evidence", "comparable"):
                self.assertNotIn(k, g, "%s.%s must be derived, not typed" % (g["id"], k))

    def test_prior_verdicts_come_from_the_sealed_receipts(self):
        g = self.gaps["GAP-03"]
        self.assertEqual({k: v["rollup"] for k, v in g["history"].items()}, {"R4C": "FAIL", "R5": "NOT RUN"})
        self.assertEqual(g["priorFail"]["run"], "R4C")
        self.assertIn("denial-truthful-no-mic", g["priorFail"]["what"])

    def test_evidence_references_carry_the_sha256_of_the_sealed_file(self):
        g = self.gaps["GAP-03"]
        ev = [e for e in g["priorFail"]["evidence"] if e["file"].endswith(".json")]
        self.assertTrue(ev)
        for e in ev:
            path = os.path.join(RECEIPTS, *e["file"].split("/"))
            self.assertEqual(hashlib.sha256(open(path, "rb").read()).hexdigest(), e["sha256"], e["file"])

    def test_guard_signals_are_counted_from_the_guard_logs(self):
        coaching = [o for r, h in self.gaps["GAP-01"]["history"].items() for o in h["observations"] if "signal" in o]
        self.assertEqual([o["count"] for o in coaching], [4, 1])
        rest = [o for h in self.gaps["GAP-04"]["history"].values() for o in h["observations"] if "signal" in o]
        self.assertEqual([o["count"] for o in rest], [3, 1])

    def test_a_missing_assertion_is_not_run_never_pass(self):
        led = copy.deepcopy(self.led)
        led["gaps"][2]["observations"] = [{"case": "AHT-12", "assertion": "no-such-assertion"}]
        d = tempfile.mkdtemp(); lp = os.path.join(d, "l.json"); wjson(lp, led); wjson(os.path.join(d, "rv.json"), fake_rv())
        r = run_py("scripts/derive_ledger.py", "--ledger", lp, "--release-verification", os.path.join(d, "rv.json"), "--out", os.path.join(d, "o.json"))
        g = next(x for x in json.load(open(os.path.join(d, "o.json")))["gaps"] if x["id"] == "GAP-03")
        self.assertEqual({k: v["rollup"] for k, v in g["history"].items()}, {"R4C": "NOT RUN", "R5": "NOT RUN"})

    def test_pending_until_a_latest_run_exists(self):
        for g in self.gaps.values():
            self.assertEqual(g["latest"]["result"], "PENDING")
            self.assertNotEqual(g["status"], "CLOSED")

    def test_status_rules(self):
        base = {"kind": "product-fix", "fix": {"inclusion": "cloud-verified"}, "latest": {"result": "PASS", "evidence": [1], "comparable": True}}
        self.assertEqual(DL.ledger_status(base)[0], "CLOSED")
        g = copy.deepcopy(base); g["fix"]["inclusion"] = "unverified-deployment"
        self.assertEqual(DL.ledger_status(g)[0], "OPEN")
        g = copy.deepcopy(base); g["latest"]["comparable"] = False
        self.assertEqual(DL.ledger_status(g)[0], "INCONCLUSIVE")
        g = copy.deepcopy(base); g["latest"]["result"] = "NOT RUN"
        self.assertEqual(DL.ledger_status(g)[0], "INCONCLUSIVE")
        g = copy.deepcopy(base); g["latest"]["result"] = "FAIL"
        self.assertEqual(DL.ledger_status(g)[0], "FAILED-RETEST")
        g = copy.deepcopy(base); g["latest"] = {"result": "PENDING"}
        self.assertEqual(DL.ledger_status(g)[0], "DEPLOYED-AWAITING-TEST")
        g = copy.deepcopy(base); g["latest"] = {"result": "PENDING"}; g["fix"]["candidate"] = True
        self.assertEqual(DL.ledger_status(g)[0], "OPEN")
        g = {"kind": "harness-correction", "fix": {}, "latest": {"result": "PENDING"}}
        self.assertEqual(DL.ledger_status(g)[0], "HARNESS-ONLY")
        g = {"kind": "evidence-restoration", "fix": {}, "latest": {"result": "PENDING"}}
        self.assertEqual(DL.ledger_status(g)[0], "OPEN")

    def test_the_candidate_fix_for_the_403_is_never_a_verified_fix(self):
        self.assertTrue(self.gaps["GAP-04"]["fix"]["candidate"])
        self.assertEqual(self.gaps["GAP-04"]["status"], "OPEN")

    def test_a_deployed_fix_that_was_tested_and_still_failed_is_failed_retest_not_open(self):
        g = copy.deepcopy(self.gaps["GAP-03"]); g["latest"] = {"result": "FAIL", "evidence": [{"file": "x", "sha256": "y"}]}
        self.assertEqual(DL.ledger_status(g)[0], "FAILED-RETEST")


def stub_comparison(d, cases, prev_label, comparison_valid, omit_journeys, label):
    """A faithful stand-in for compare_latest.py output between the synthetic latest run and a sealed run: one row per latest assertion with the sealed run's own verdict
    as `prev`, and one journey per case with the requested validity. (The real comparison is exercised separately.)"""
    sealed = {c["caseId"]: {a["id"]: a["result"] for a in c["assertions"]} for c in json.load(open(os.path.join(d, prev_label, "case-results.json")))["cases"]}
    rows = []
    for cid, asserts in cases.items():
        for aid, v in asserts.items():
            prev = sealed.get(cid, {}).get(aid, "NOT RUN")
            bad = (comparison_valid or {}).get(cid, "valid") != "valid"
            cls = "inconclusive" if (bad or prev == "NOT RUN") else ("unchanged" if prev == v else ("improved" if v == "PASS" else "regressed"))
            rows.append({"key": "%s/%s" % (cid, aid), "case": cid, "id": aid, "prev": prev, "cur": v, "class": cls, "reason_text": "changed observer" if bad else None})
    comp = {"previous": {"label": prev_label}, "current": {"label": label}, "rows": rows,
            "journeys": [{"id": c, "validity": (comparison_valid or {}).get(c, "valid"), "reasons": [{"text": "changed observer"}]} for c in cases if c not in (omit_journeys or ())]}
    return comp


def synthetic_latest(cases, comparison_valid=None, with_evidence=True, label="R6T", omit_journeys=None):
    """A tiny sealed latest run: cases maps case id -> {assertion: verdict}. Returns (receipts root, comparison path): the legacy single comparison (against R5) is
    cmp.json; comparisons/<label>/comparison.json holds the comparison with each sealed run, and cfg.json lists the latest run in the history."""
    from _nightly import CATALOG, history
    all_rows = [(cid, aid) for cid, spec in CATALOG["cases"].items() for aid in spec["requiredAssertions"]]
    # Explicit synthetic comparison scenario: a failed baseline followed by
    # an unexecuted baseline. This proves the most-recent-observed selection
    # rule without copying or claiming any actual R4C/R5 campaign evidence.
    d, cfg = history(("R4C", {"fails": all_rows, "sha": "b2" * 20}),
                     ("R5", {"notrun": all_rows, "sha": "4c85b006ac05e180521fd6e7d807f736987cafe8"}))
    unittest.addModuleCleanup(shutil.rmtree, d)
    base = os.path.join(d, label)
    os.makedirs(base)
    cr = {"campaignId": label, "servedSha": "4c85b006ac05e180521fd6e7d807f736987cafe8", "cases": []}
    for cid, asserts in cases.items():
        os.makedirs(os.path.join(base, cid))
        rows = []
        for i, (aid, v) in enumerate(asserts.items(), 1):
            ref = "aht-%s-%d.json" % (cid[4:], i)
            if with_evidence is True or (isinstance(with_evidence, (set, list)) and cid not in with_evidence):
                wjson(os.path.join(base, cid, ref), {"fact": aid})
                rows.append({"id": aid, "result": v, "evidenceRefs": [ref]})
            else:
                rows.append({"id": aid, "result": v, "evidenceRefs": []})
        cr["cases"].append({"caseId": cid, "result": "PASS", "assertions": rows})
    wjson(os.path.join(base, "case-results.json"), cr)
    for lab in ("R4C", "R5"):
        os.makedirs(os.path.join(d, "comparisons", lab))
        wjson(os.path.join(d, "comparisons", lab, "comparison.json"), stub_comparison(d, cases, lab, comparison_valid, omit_journeys, label))
    cfg["history"]["runs"].append({"label": label, "campaignId": label, "servedSha": "4c85b006ac05e180521fd6e7d807f736987cafe8", "ledgersOnly": False})
    wjson(os.path.join(d, "cfg.json"), cfg)
    cp = os.path.join(d, "cmp.json"); wjson(cp, stub_comparison(d, cases, "R5", comparison_valid, omit_journeys, label))
    return d, cp


def derive_gap(gap_id, root, cmp_path=None, baselines=True):
    """baselines=True: the pipeline's path (select_baselines, then a per-row comparison with the most recent run that has a verdict). baselines=False: the legacy single comparison."""
    rv = os.path.join(root, "rv.json"); wjson(rv, fake_rv())
    out = os.path.join(root, "ld.json")
    args = ["--ledger", os.path.join(ROOT, "config/gap-ledger.json"), "--config", os.path.join(root, "cfg.json"), "--release-verification", rv, "--latest-label", "R6T", "--receipts-root", root, "--out", out]
    if cmp_path and baselines:
        r0 = run_py("scripts/select_baselines.py", "--ledger", os.path.join(ROOT, "config/gap-ledger.json"), "--config", os.path.join(root, "cfg.json"), "--receipts-root", root, "--latest-label", "R6T", "--out", os.path.join(root, "baselines.json"))
        assert r0.returncode == 0, r0.stdout + r0.stderr
        args += ["--baselines", os.path.join(root, "baselines.json"), "--comparisons-dir", os.path.join(root, "comparisons")]
    elif cmp_path:
        args += ["--latest-comparison", cmp_path]
    r = run_py("scripts/derive_ledger.py", *args)
    assert r.returncode == 0, r.stdout + r.stderr
    return next(g for g in json.load(open(out))["gaps"] if g["id"] == gap_id)


GAP06 = {"AHT-04": {"cold-pending-observed": "PASS"}, "AHT-13": {"download-fault-exercised": "PASS"}, "AHT-14": {"download-fault-exercised": "PASS"}}


class MultiCaseGapsNeedEveryCase(unittest.TestCase):
    """Owner review fix 3: GAP-06 requires AHT-04, AHT-13 and AHT-14; it must not close on one case, and comparability must be explicitly proven."""
    def test_the_ledger_requires_every_case_of_gap_06_and_gap_02_in_executable_form(self):
        led = {g["id"]: g for g in sample()["ledger"]["gaps"]}
        self.assertEqual([r["case"] for r in led["GAP-06"]["expectedPass"]["requirements"]], ["AHT-04", "AHT-13", "AHT-14"])
        self.assertEqual([r["case"] for r in led["GAP-02"]["expectedPass"]["requirements"]], ["AHT-02", "AHT-03"])
        for g in led.values():
            self.assertNotIn("case", g["expectedPass"], g["id"])
            self.assertNotIn("assertions", g["expectedPass"], g["id"])

    def test_every_observed_case_is_a_required_case(self):
        import validate_run_request as V
        self.assertEqual(V.validate_ledger(sample()["ledger"]), [])
        bad = copy.deepcopy(sample()["ledger"])
        bad["gaps"][5]["expectedPass"]["requirements"] = [bad["gaps"][5]["expectedPass"]["requirements"][0]]
        errs = V.validate_ledger(bad)
        self.assertTrue(any("GAP-06 observed AHT-13" in e for e in errs), errs)
        self.assertTrue(any("GAP-06 observed AHT-14" in e for e in errs), errs)

    def test_a_request_must_select_every_case_of_a_targeted_gap(self):
        import validate_run_request as V
        from _fixtures import reconciliation
        s = sample()
        req = copy.deepcopy(s["req"])
        req["targetedGaps"] = ["GAP-03", "GAP-06"]
        req["priority"] = "prove-deployed-fix"
        req["selection"][0]["gaps"] = ["GAP-03", "GAP-06"]
        req["selection"].append({"order": 2, "case": "AHT-04", "gaps": ["GAP-06"], "role": "target", "needsCaptureDevice": True, "plannedRequests": 157, "gate": None, "reason": "x"})
        errs = V.validate(req, s["cfg"], s["ledger"], s["wf"], fake_rv(), reconciliation())[0]
        self.assertTrue(any("GAP-06 requires every one of its cases" in e and "AHT-13" in e and "AHT-14" in e for e in errs), errs)
        self.assertFalse(any("GAP-03 requires" in e for e in errs))

    def test_one_passing_case_does_not_close_gap_06(self):
        d, cp = synthetic_latest({"AHT-04": {"cold-pending-observed": "PASS"}})
        g = derive_gap("GAP-06", d, cp)
        self.assertEqual(g["latest"]["result"], "NOT RUN")
        self.assertEqual(g["latest"]["notRunCases"], ["AHT-13", "AHT-14"])
        self.assertEqual(g["status"], "INCONCLUSIVE")
        self.assertEqual(g["latest"]["perCase"]["AHT-04"]["result"], "PASS")

    def test_two_of_three_cases_passing_does_not_close_gap_06(self):
        d, cp = synthetic_latest({"AHT-04": {"cold-pending-observed": "PASS"}, "AHT-13": {"download-fault-exercised": "PASS"}})
        self.assertEqual(derive_gap("GAP-06", d, cp)["status"], "INCONCLUSIVE")

    def test_a_fail_in_any_required_case_is_failed_retest(self):
        c = dict(GAP06); c["AHT-14"] = {"download-fault-exercised": "FAIL"}
        d, cp = synthetic_latest(c)
        g = derive_gap("GAP-06", d, cp)
        self.assertEqual((g["status"], g["latest"]["failedCases"]), ("FAILED-RETEST", ["AHT-14"]))

    def test_all_three_cases_with_evidence_and_proven_comparability_close_it(self):
        d, cp = synthetic_latest(GAP06)
        g = derive_gap("GAP-06", d, cp)
        self.assertEqual((g["latest"]["result"], g["latest"]["comparable"], g["status"]), ("PASS", True, "CLOSED"))

    def test_comparability_must_be_proven_for_every_required_case(self):
        d, cp = synthetic_latest(GAP06, comparison_valid={"AHT-13": "not comparable"})
        g = derive_gap("GAP-06", d, cp)
        self.assertEqual(g["latest"]["result"], "PASS")
        self.assertFalse(g["latest"]["comparable"])
        self.assertIn("AHT-13", g["latest"]["comparableReason"])
        self.assertEqual(g["status"], "INCONCLUSIVE")

    def test_a_case_missing_from_the_comparison_is_not_proven_comparable(self):
        d, cp = synthetic_latest(GAP06, omit_journeys={"AHT-13"})
        g = derive_gap("GAP-06", d, cp)
        self.assertFalse(g["latest"]["comparable"])
        self.assertIn("AHT-13 is not in the comparison with R4C", g["latest"]["comparableReason"])
        self.assertEqual(g["status"], "INCONCLUSIVE")

    def test_no_comparison_at_all_never_closes_a_gap(self):
        d, _ = synthetic_latest(GAP06)
        g = derive_gap("GAP-06", d, None)
        self.assertEqual(g["latest"]["result"], "PASS")
        self.assertIs(g["latest"]["comparable"], False)
        self.assertEqual(g["status"], "INCONCLUSIVE")

    def test_missing_evidence_in_any_required_case_stays_inconclusive(self):
        d, cp = synthetic_latest(GAP06, with_evidence={"AHT-13"})
        g = derive_gap("GAP-06", d, cp)
        self.assertEqual(g["latest"]["missingEvidenceCases"], ["AHT-13"])
        self.assertEqual(g["status"], "INCONCLUSIVE")
        self.assertIn("missing evidence stays inconclusive", g["statusReason"])

    def test_gap_02_needs_both_focus_journeys(self):
        one = {"AHT-03": {"focus-next-point-marked": "PASS", "focus-live-durable": "PASS"}}
        d, cp = synthetic_latest(one)
        self.assertEqual(derive_gap("GAP-02", d, cp)["status"], "INCONCLUSIVE")
        both = dict(one); both["AHT-02"] = {"focus-next-point-marked": "PASS"}
        d, cp = synthetic_latest(both)
        self.assertEqual(derive_gap("GAP-02", d, cp)["latest"]["result"], "PASS")

    def test_status_rule_unit_cases(self):
        base = {"kind": "evidence-restoration", "fix": {}, "latest": {"result": "PASS", "evidence": [1], "comparable": True}}
        self.assertEqual(DL.ledger_status(base)[0], "CLOSED")
        for mutate, expect in ((lambda g: g["latest"].pop("comparable"), "INCONCLUSIVE"), (lambda g: g["latest"].update(comparable=None), "INCONCLUSIVE"),
                               (lambda g: g["latest"].update(missingEvidenceCases=["AHT-13"]), "INCONCLUSIVE"), (lambda g: g["latest"].update(evidence=None), "INCONCLUSIVE")):
            g = copy.deepcopy(base); mutate(g)
            self.assertEqual(DL.ledger_status(g)[0], expect)


if __name__ == "__main__":
    unittest.main()
