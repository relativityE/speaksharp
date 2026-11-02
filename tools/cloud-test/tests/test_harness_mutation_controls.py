"""Proof mutation controls (Sam 1793382389, 1793383008): each mutation of a temp copy must turn its correction's OWN named tests red; the pinned
harness is never written; an anchor that does not occur exactly once is refused; a mutation that only breaks module loading is not a kill."""
import hashlib
import os
from pathlib import Path
import shutil
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import harness_mutation_controls as M  # noqa: E402  (pure until main(); the network guard loads only there)

NODE = shutil.which("node")


def tree_hash(root):
    h = hashlib.sha256()
    for path in sorted(Path(root).rglob("*")):
        if path.is_file():
            h.update(str(path.relative_to(root)).encode() + b"\0" + path.read_bytes())
    return h.hexdigest()


class Anchors(unittest.TestCase):
    def test_every_primary_anchor_occurs_exactly_once_in_the_vendored_harness(self):
        for cid, (edits, kills) in M.PACKET.items():
            self.assertTrue(kills, cid)
            for rel, anchor, replacement in edits:
                text = (Path(M.HARNESS) / rel).read_text()
                self.assertEqual(text.count(anchor), 1, cid)
                self.assertNotEqual(anchor, replacement, cid)

    def test_the_primary_controls_are_the_eleven_proof_controls(self):
        self.assertEqual(sorted(c.split("-")[0] for c in M.PACKET), ["M%02d" % n for n in range(1, 12)])
        self.assertFalse([c for c in M.ADDITIONAL if not c.startswith("A-")])


def tap_text(*tests, summary=True, extra=""):
    """Synthetic node TAP: tests are (title, status, code) with status ok / fail / skip / todo."""
    lines = ["TAP version 13"]
    for i, (title, status, code) in enumerate(tests, 1):
        directive = {"skip": " # SKIP", "todo": " # TODO"}.get(status, "")
        lines.append(("not ok" if status in ("fail", "todo") else "ok") + " %d - %s%s" % (i, title, directive))
        if status == "fail":
            lines += ["  ---", "  failureType: 'testCodeFailure'", "  code: '%s'" % code, "  ..."]
    lines.append("1..%d" % len(tests))
    if summary:
        lines += ["# tests %d" % len(tests), "# pass %d" % sum(t[1] == "ok" for t in tests), "# fail %d" % sum(t[1] == "fail" for t in tests),
                  "# cancelled 0", "# skipped %d" % sum(t[1] == "skip" for t in tests), "# todo %d" % sum(t[1] == "todo" for t in tests)]
    return "\n".join(lines) + extra + "\n"


BASE = [("FO1 one", "ok", None), ("FO2 two", "ok", None)]


class TapJudgement(unittest.TestCase):
    def judged(self, *tests, rc=1, kills=("FO1 ",)):
        baseline = M.parse_tap(tap_text(*BASE), 0)
        return M.judge(baseline, M.parse_tap(tap_text(*tests), rc), kills)

    def test_a_named_assertion_failure_with_the_same_inventory_is_a_kill(self):
        self.assertEqual(self.judged(("FO1 one", "fail", "ERR_ASSERTION"), ("FO2 two", "ok", None))["fail"], 1)

    def test_a_runtime_exception_inside_the_named_test_is_not_a_kill(self):
        r = self.judged(("FO1 one", "fail", "ERR_TEST_FAILURE"), ("FO2 two", "ok", None))
        self.assertEqual(r["fail"], 0)
        self.assertIn("invalid companion execution", r["reason"])

    def test_a_named_kill_beside_an_invalid_companion_is_not_a_kill(self):
        # e.g. M04: F2 fails by assertion while F3 throws a runtime error -- the mutated run is not a clean mutation proof.
        for companion in (("FO2 two", "fail", "ERR_TEST_FAILURE"), ("FO2 two", "skip", None), ("FO2 two", "todo", None)):
            r = self.judged(("FO1 one", "fail", "ERR_ASSERTION"), companion, rc=1 if companion[1] == "fail" else 1)
            self.assertEqual(r["fail"], 0, companion)
            self.assertIn("invalid companion execution", r["reason"], companion)

    def test_a_named_todo_or_skip_is_not_a_kill(self):
        for status in ("todo", "skip"):
            self.assertEqual(self.judged(("FO1 one", status, None), ("FO2 two", "ok", None), rc=0)["fail"], 0, status)

    def test_a_signal_or_unexpected_exit_is_refused_even_with_complete_tap(self):
        complete = tap_text(("FO1 one", "fail", "ERR_ASSERTION"), ("FO2 two", "ok", None))
        for rc in (-9, 2, 7, 0):
            with self.assertRaises(M.TapError, msg=str(rc)):
                M.parse_tap(complete, rc)
        self.assertTrue(M.parse_tap(complete, 1))

    def test_summary_totals_must_reconcile(self):
        good = tap_text(("FO1 one", "ok", None), ("FO2 two", "skip", None))
        self.assertTrue(M.parse_tap(good, 0))
        for old, new in (("# pass 1", "# pass 2"), ("# skipped 1", "# skipped 0"), ("# todo 0", "# todo 1"), ("# cancelled 0", "# cancelled 1")):
            with self.assertRaises(M.TapError, msg=new):
                M.parse_tap(good.replace(old, new), 0)

    def test_a_failure_in_an_unnamed_test_is_not_a_kill(self):
        self.assertEqual(self.judged(("FO1 one", "ok", None), ("FO2 two", "fail", "ERR_ASSERTION"))["fail"], 0)

    def test_a_changed_inventory_or_load_error_is_not_a_kill(self):
        r = self.judged(("tests/node/focus-oracle-controls.test.cjs", "fail", "ERR_TEST_FAILURE"))
        self.assertEqual((r["fail"], r["reason"]), (0, "test inventory changed"))
        r = self.judged(("FO1 one", "fail", "ERR_ASSERTION"), ("FO2 two", "ok", None), ("FO3 extra", "ok", None))
        self.assertEqual(r["fail"], 0)

    def test_untrustworthy_runs_are_refused_not_judged(self):
        for text, rc, why in ((tap_text(*BASE, summary=False), 0, "missing"),
                              (tap_text(*BASE) + "# tests 9\n", 0, "malformed"),
                              (tap_text(*BASE, extra="\nBail out! crashed"), 1, "bail-out"),
                              (tap_text(*BASE), 1, "process status"),
                              (tap_text(("FO1 one", "ok", None), ("FO1 one", "ok", None)), 0, "duplicate"),
                              ("", 1, "missing")):
            with self.assertRaises(M.TapError, msg=why) as e:
                M.parse_tap(text, rc)
            self.assertIn(why, str(e.exception))

    def test_an_unclean_baseline_is_refused(self):
        dirty = M.parse_tap(tap_text(("FO1 one", "fail", "ERR_ASSERTION"), ("FO2 two", "ok", None)), 1)
        with self.assertRaises(M.TapError):
            M.judge(dirty, dirty, ("FO1 ",))


@unittest.skipUnless(NODE, "node is required for the harness mutation controls")
class AdditionalControls(unittest.TestCase):
    def test_every_additional_control_is_killed_by_its_named_test_and_the_harness_is_unchanged(self):
        before = tree_hash(Path(M.HARNESS) / "draft-adapters")
        out, refusals = M.evaluate_additional()
        self.assertEqual(refusals, [])
        self.assertEqual(set(out), set(M.ADDITIONAL))
        for cid, v in out.items():
            self.assertGreater(v["fail"], 0, cid)
            kills = M.ADDITIONAL[cid][2]
            self.assertTrue(v["failedTests"] and all(t.startswith(kills) for t in v["failedTests"]), cid)
        self.assertEqual(tree_hash(Path(M.HARNESS) / "draft-adapters"), before)

    def test_an_anchor_that_does_not_occur_exactly_once_is_refused(self):
        out, refusals = M.evaluate_additional({"A-missing": (M.FOCUS, [("this text is not in the oracle", "")], ("FO1 ",))})
        self.assertEqual(out, {})
        self.assertTrue(any("A-missing" in r and "0 times" in r for r in refusals), refusals)

    def test_a_no_op_mutation_is_missed_not_caught(self):
        out, refusals = M.evaluate_additional({"A-no-op": (M.FOCUS, [("const CONCLUSIVE=", "const CONCLUSIVE=")], ("FO1 ",))})
        self.assertEqual(refusals, [])
        self.assertEqual(out["A-no-op"]["fail"], 0)

    def test_a_mutation_that_only_breaks_loading_is_not_a_kill(self):
        out, refusals = M.evaluate_additional({"A-load-error": (M.FOCUS, [("const CONCLUSIVE=", "const CONCLUSIVE=(")], ("FO1 ",))})
        self.assertEqual(refusals, [])
        self.assertEqual(out["A-load-error"]["fail"], 0)

    def test_a_kill_outside_the_named_tests_does_not_count(self):
        # Removing the duplicate branch fails FO1, which is not the named test of this control.
        out, _ = M.evaluate_additional({"A-wrong-name": (M.FOCUS, [("else if(duplicates.length>0){result='FAIL';basis='duplicate-marker';}", "")], ("FO4 ",))})
        self.assertEqual(out["A-wrong-name"]["fail"], 0)


if __name__ == "__main__":
    unittest.main()
