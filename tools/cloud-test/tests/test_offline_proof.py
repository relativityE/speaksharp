"""The offline-proof generator fails closed (Sam 1793378783, 1793379188): a PASS needs every input, every correction's executed
tests and listed mutation controls, gating plan controls, clean TAP and the checkout's own verified harness manifest."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import offline_proof as P  # noqa: E402  (pure functions; the network guard loads only in main())

MANIFEST = json.loads((SCRIPTS.parent / "config" / "test-config.v1.json").read_text())["harness"]["expectedCodeManifestSha256"]


def titles():
    return [p.lstrip("^") for _, _, pats, _ in P.CORR for p in pats]


def controls():
    return {m + "-x": {"fail": 2} for _, _, _, ms in P.CORR for m in ms}


PLAN = dict(P.PLAN_CONTROLS)


def complete(**over):
    results = {t: "PASS" for t in titles()}
    args = dict(results=results, conflicting=[], duplicated=[], mut=controls(), pc=dict(PLAN), manifest="a" * 64, stream={"notOk": 0, "bailOuts": 0})
    args.update(over)
    return P.build(args["results"], args["conflicting"], args["duplicated"], args["mut"], args["pc"], args["manifest"], stream=args["stream"])


class Build(unittest.TestCase):
    def assertFails(self, doc, label):
        self.assertEqual(doc["result"], "FAIL", label)

    def test_complete_inputs_pass(self):
        doc = complete()
        self.assertEqual(doc["result"], "PASS", doc["refusals"])
        self.assertEqual([r["id"] for r in doc["corrections"]], [c[0] for c in P.CORR])
        self.assertTrue(all(r["result"] == "PASS" for r in doc["corrections"]))

    def test_no_mutation_controls_never_pass(self):
        doc = complete(mut={})
        self.assertFails(doc, "no controls")
        self.assertTrue(any(r["missingControls"] for r in doc["corrections"]))

    def test_each_listed_control_must_be_present_and_caught(self):
        for cid, _, _, ms in P.CORR:
            for m in ms:
                mut = {k: v for k, v in controls().items() if not k.startswith(m + "-")}
                doc = complete(mut=mut)
                self.assertFails(doc, "missing " + m)
                self.assertIn(m, next(r for r in doc["corrections"] if r["id"] == cid)["missingControls"])
                for bad in ({"fail": True}, {"fail": False}, {"fail": 0}, {"fail": -1}, {"fail": 2.0}, {"fail": "2"}, {}, "caught"):
                    mut = dict(controls(), **{m + "-x": bad})
                    self.assertFails(complete(mut=mut), "uncaught or malformed " + m)

    def test_plan_controls_must_be_the_exact_reviewed_inventory_with_intended_outcomes(self):
        self.assertEqual((sum(k.startswith("positive") for k in PLAN), sum(k.startswith("negative") for k in PLAN)), (3, 11))
        first_negative = next(k for k in PLAN if k.startswith("negative"))
        cases = {
            "empty": {},
            "missing label": {k: v for k, v in PLAN.items() if k != first_negative},
            "extra label": dict(PLAN, **{"negative: invented": "REFUSED: BLOCKED_SETUP: invented"}),
            "positive refused": dict(PLAN, **{"positive: run identity": "REFUSED: BLOCKED_SETUP: x"}),
            "negative accepted": dict(PLAN, **{first_negative: "ACCEPTED"}),
            "setup error instead of the intended reason": dict(PLAN, **{first_negative: "REFUSED: ENOENT: no such file or directory"}),
            "reworded reason": dict(PLAN, **{first_negative: PLAN[first_negative] + "."}),
            "not a mapping": ["ACCEPTED"],
            "extra label with a null value": dict(PLAN, **{"negative: invented": None}),
        }
        for label, pc in cases.items():
            doc = complete(pc=pc)
            self.assertFails(doc, label)
            self.assertTrue(any("plan controls" in r for r in doc["refusals"]), label)

    def test_a_missing_or_unpassed_required_test_fails(self):
        for t in titles():
            results = {k: "PASS" for k in titles() if k != t}
            self.assertFails(complete(results=results), "missing " + t)
            for r in ("FAIL", "SKIP"):
                self.assertFails(complete(results=dict({k: "PASS" for k in titles()}, **{t: r})), r + " " + t)

    def test_any_failed_or_skipped_title_fails_even_outside_the_patterns(self):
        for r in ("FAIL", "SKIP"):
            results = dict({k: "PASS" for k in titles()}, **{"Z9 an unrelated test": r})
            self.assertFails(complete(results=results), r)

    def test_stream_failures_and_bail_outs_fail_and_an_unscanned_stream_never_passes(self):
        self.assertFails(complete(stream={"notOk": 1, "bailOuts": 0}), "not ok")
        self.assertFails(complete(stream={"notOk": 0, "bailOuts": 1}), "bail out")
        self.assertFails(complete(stream=None), "unscanned")

    def test_duplicates_conflicts_and_a_bad_manifest_fail(self):
        self.assertFails(complete(conflicting=["D1 x"]), "conflict")
        self.assertFails(complete(duplicated=["D1 x"]), "duplicate")
        for manifest in (None, "", "A" * 64, "a" * 63, "../escape"):
            self.assertFails(complete(manifest=manifest), manifest)


class Tap(unittest.TestCase):
    def parse(self, *lines):
        d = tempfile.mkdtemp()
        f = os.path.join(d, "t.tap")
        Path(f).write_text("\n".join(lines) + "\n")
        return P.tap([f])

    def test_skip_and_todo_are_never_a_pass(self):
        results, _, _ = self.parse("ok 1 - D1 alpha # SKIP no browser", "ok 2 - D2 beta # todo later", "ok 3 - D3 gamma")
        self.assertEqual(results, {"D1 alpha": "SKIP", "D2 beta": "SKIP", "D3 gamma": "PASS"})

    def test_a_later_pass_cannot_overwrite_an_earlier_failure(self):
        for order in (("not ok 1 - D1 alpha", "ok 2 - D1 alpha"), ("ok 1 - D1 alpha", "not ok 2 - D1 alpha")):
            results, conflicting, duplicated = self.parse(*order)
            self.assertEqual(results["D1 alpha"], "FAIL", order)
            self.assertEqual((conflicting, duplicated), (["D1 alpha"], ["D1 alpha"]))

    def test_untitled_nested_and_bail_out_lines_are_counted_from_the_stream(self):
        d = tempfile.mkdtemp()
        f = os.path.join(d, "t.tap")
        Path(f).write_text("ok 1 - D1 alpha\nnot ok 99\n    not ok 2 - nested subtest\nnot ok\nBail out! harness crashed\n")
        self.assertEqual(P.stream_failures([f]), {"notOk": 3, "bailOuts": 1})
        results, _, _ = P.tap([f])
        self.assertEqual(results, {"D1 alpha": "PASS"})  # the titled parser alone would have seen only a pass

    def test_a_repeated_title_is_reported(self):
        results, conflicting, duplicated = self.parse("ok 1 - D1 alpha", "ok 2 - D1 alpha")
        self.assertEqual((results["D1 alpha"], conflicting, duplicated), ("PASS", [], ["D1 alpha"]))


class Cli(unittest.TestCase):
    """The executable path, in a subprocess: required inputs and the checkout's own verified harness manifest."""
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.tap = os.path.join(self.d, "t.tap")
        Path(self.tap).write_text("".join("ok %d - %s\n" % (i + 1, t) for i, t in enumerate(titles())))
        self.mut = os.path.join(self.d, "m.json"); Path(self.mut).write_text(json.dumps(controls()))
        self.pc = os.path.join(self.d, "p.json"); Path(self.pc).write_text(json.dumps(PLAN))
        self.out = os.path.join(self.d, "proof.json")

    def run_cli(self, *args):
        return subprocess.run([sys.executable, "-I", str(SCRIPTS / "offline_proof.py"), *args], capture_output=True, text=True)

    def test_every_input_is_required(self):
        full = ["--tap", self.tap, "--mutations", self.mut, "--plan-controls", self.pc, "--code-manifest-sha256", MANIFEST, "--out", self.out]
        for flag in ("--mutations", "--plan-controls", "--code-manifest-sha256"):
            i = full.index(flag)
            r = self.run_cli(*(full[:i] + full[i + 2:]))
            self.assertEqual(r.returncode, 2, flag)

    def test_otherwise_complete_evidence_fails_on_an_untitled_failure_or_a_bail_out(self):
        common = ["--mutations", self.mut, "--plan-controls", self.pc, "--code-manifest-sha256", MANIFEST, "--out", self.out]
        for extra in ("not ok 99\n", "Bail out! the harness stopped\n"):
            bad = os.path.join(self.d, "bad.tap")
            Path(bad).write_text(Path(self.tap).read_text() + extra)
            r = self.run_cli("--tap", bad, *common)
            self.assertEqual(r.returncode, 1, extra)
            self.assertEqual(json.loads(Path(self.out).read_text())["result"], "FAIL", extra)

    def test_only_the_pinned_verified_harness_can_be_proven(self):
        common = ["--tap", self.tap, "--mutations", self.mut, "--plan-controls", self.pc, "--out", self.out]
        r = self.run_cli(*common, "--code-manifest-sha256", MANIFEST)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(json.loads(Path(self.out).read_text())["result"], "PASS")
        r = self.run_cli(*common, "--code-manifest-sha256", "b" * 64)
        self.assertEqual(r.returncode, 1)
        doc = json.loads(Path(self.out).read_text())
        self.assertEqual(doc["result"], "FAIL")
        self.assertIn("requested manifest is not the pinned, verified harness", doc["refusals"])


if __name__ == "__main__":
    unittest.main()
