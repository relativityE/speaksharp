#!/usr/bin/env python3
"""Legacy acquire route (execute_run.sh CT_SETUP_MODE=acquire): the REAL pinned Chrome for Testing archive installs to the pinned binary.
Not part of the current qualification (PO 2026-10-31): the GitHub workflow and the default existing-only route use the already-installed,
hash-verified browser (install_browser.py --existing), so this module is deliberately not named test_*.py and discovery never loads it.
Its offline verification logic stays covered by test_runnable_package.BrowserPin. Run it only with a separately authorized archive:
Usage (from tools/cloud-test): CT_BROWSER_ARCHIVE=/path/chrome-linux64.zip python3 tests/legacy_acquire_route_checks.py   A missing archive fails."""
import hashlib
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CFG = os.path.join(ROOT, "config", "test-config.v1.json")


class LegacyAcquireRoute(unittest.TestCase):
    def test_the_real_pinned_archive_installs(self):
        arch = os.environ.get("CT_BROWSER_ARCHIVE")
        self.assertTrue(arch and os.path.isfile(arch), "CT_BROWSER_ARCHIVE must name the separately authorized pinned archive")
        d = tempfile.mkdtemp()
        r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "install_browser.py"), "--config", CFG, "--browsers-path", d, "--archive", arch], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(hashlib.sha256(open(r.stdout.strip(), "rb").read()).hexdigest(), "2e61bc3fd990bd4d7b419ef6b6303c67aaed683e5b83b3b25e416f015f343209")


if __name__ == "__main__":
    unittest.main()
