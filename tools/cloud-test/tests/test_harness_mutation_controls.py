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
