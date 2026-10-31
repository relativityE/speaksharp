"""HISTORICAL AUDIT of the retained Cloud Test campaigns: the history tests of tests/test_release_gate.py, moved unchanged from 96af08e7 with the
module helpers they use. Not part of the current suite (never collected by `discover -p test_*.py`), never current-execution credit; run
only by scripts/run_legacy_audit.py with the retained history present. The current suite runs the same rules on the synthetic history."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import copy


import json


import os


import tempfile


import unittest


from _fixtures import NOW, REPO, ROOT, git_repo, needs_history, prerequisite, request_path, sample, wjson


import verify_release as VR


from _common import load


def ledger_with(prs):
    """A ledger whose gaps link to the given PR numbers (all with complete expected-PASS criteria)."""
    base = sample()["ledger"]
    gaps = []
    for i, pr in enumerate(prs, 1):
        g = copy.deepcopy(base["gaps"][2])
        g.update({"id": "GAP-%02d" % i, "fix": {"pr": "#%s" % pr, "candidate": False, "note": "t"}})
        gaps.append(g)
    return {"gaps": gaps}


def verdict(out, subject_sha):
    return next(v for v in out["commitVerdicts"] if subject_sha.startswith(v["sha"]))


class RealRepository(unittest.TestCase):
    """The real tested release: #1744 (blocked-microphone guidance) is a verified deployed fix; the 502 fix touches the backend and stays unverified."""

    @needs_history  # verify_release.py reads the config's history runs and their sealed receipts
    def test_1744_is_in_the_tested_release_and_verified(self):
        prerequisite(os.system("git -C %s cat-file -e 4c85b006ac05e180521fd6e7d807f736987cafe8 2>/dev/null" % REPO) == 0, "git history of the repository")
        from _fixtures import run_py
        d = tempfile.mkdtemp(); out = os.path.join(d, "rv.json")
        r = run_py("scripts/verify_release.py", "--request", request_path(), "--ledger", os.path.join(ROOT, "config/gap-ledger.json"), "--repo", REPO, "--now", NOW, "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        rv = load(out)
        self.assertEqual(rv["fixes"]["GAP-03"]["inclusion"], "cloud-verified")
        self.assertEqual(rv["fixes"]["GAP-03"]["commit"][:7], "8b2e7de")
        self.assertEqual(rv["fixes"]["GAP-01"]["inclusion"], "unverified-deployment")
        self.assertEqual(rv["fixes"]["GAP-01"]["touchesBackend"], True)
        self.assertEqual(rv["sinceLastRun"], [])


if __name__ == "__main__":
    import unittest
    unittest.main()
