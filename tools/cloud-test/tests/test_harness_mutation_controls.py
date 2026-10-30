"""Proof-v2 mutation controls (Sam 1793382389): each mutation of a temp copy must turn its focused tests red; the pinned harness is never
written; an anchor that does not occur exactly once is refused, never reported as caught."""
import hashlib
from pathlib import Path
import shutil
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import harness_mutation_controls as M  # noqa: E402  (pure until main(); the network guard loads only there)

NODE = shutil.which("node")


@unittest.skipUnless(NODE, "node is required for the harness mutation controls")
class MutationControls(unittest.TestCase):
    def test_every_control_is_caught_and_the_vendored_harness_is_unchanged(self):
        target = Path(M.ROOT) / M.FOCUS[0]
        before = hashlib.sha256(target.read_bytes()).hexdigest()
        out, refusals = M.evaluate()
        self.assertEqual(refusals, [])
        self.assertEqual(set(out), set(M.CONTROLS))
        for cid, v in out.items():
            self.assertGreater(v["fail"], 0, cid)
            self.assertGreater(v["tests"], 0, cid)
        self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(), before)

    def test_an_anchor_that_does_not_occur_exactly_once_is_refused(self):
        out, refusals = M.evaluate({"M99-missing-anchor": (M.FOCUS, "this text is not in the oracle", "")})
        self.assertEqual(out, {})
        self.assertTrue(any("M99-missing-anchor" in r and "0 times" in r for r in refusals), refusals)

    def test_a_no_op_mutation_is_reported_missed_not_caught(self):
        out, refusals = M.evaluate({"M98-no-op": (M.FOCUS, "const CONCLUSIVE=", "const CONCLUSIVE=")})
        self.assertEqual(refusals, [])
        self.assertEqual(out["M98-no-op"]["fail"], 0)


if __name__ == "__main__":
    unittest.main()
