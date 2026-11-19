"""The required-test-id inventory is exactly the unittest discovery of the current source for both offline suites, so the offline
summary never refuses a real test as UNLISTED_IDS_EXECUTED nor waits for a deleted one (MANIFEST_IDS_NOT_EXECUTED). Discovery runs in
a child per suite, exactly as run_offline_checks discovers it; a module that fails to import fails this test."""
import json
import os
import subprocess
import sys
import unittest

from _fixtures import ROOT

SUITES = {"package-unit-tests": os.path.join(ROOT, "tests"), "report-builder-tests": os.path.join(ROOT, "report", "tests")}
LIST = r"""
import sys, unittest
suite = unittest.defaultTestLoader.discover(sys.argv[1], pattern="test_*.py")
def walk(s):
    for t in s:
        if isinstance(t, unittest.TestSuite):
            yield from walk(t)
        else:
            yield t.id()
print("\n".join(walk(suite)))
"""


class RequiredTestIds(unittest.TestCase):
    def test_the_inventory_is_exactly_current_discovery_of_both_suites(self):
        discovered = set()
        for name, start in SUITES.items():
            r = subprocess.run([sys.executable, "-c", LIST, start], capture_output=True, text=True, cwd=ROOT, timeout=300)
            self.assertEqual(r.returncode, 0, r.stderr[-400:])
            ids = r.stdout.split()
            self.assertFalse([i for i in ids if i.startswith("unittest.loader.")], "a test module failed to import")
            discovered |= {"%s::%s" % (name, i) for i in ids}
        with open(os.path.join(ROOT, "config", "required-test-ids.v1.json"), encoding="utf-8") as f:
            listed = set(json.load(f)["ids"])
        self.assertEqual(sorted(discovered - listed), [], "discovered but not inventoried")
        self.assertEqual(sorted(listed - discovered), [], "inventoried but no longer discovered")


if __name__ == "__main__":
    unittest.main()
