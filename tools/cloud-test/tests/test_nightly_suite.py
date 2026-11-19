"""Nightly AHT suite (tools/cloud-test/nightly): its node:test files run inside the package unit tests.

The suite's verdict, budget, limit and oracle code is plain CommonJS beside the harness. This test runs its node:test
files and requires every one of them to pass, with none skipped, so a change to the nightly code is checked by the
same offline run as the rest of the package. The negative controls (nightly/negative-controls/run.cjs) rewrite files
and are run on their own, not here.
"""
import hashlib
import os
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NIGHTLY = ROOT / "nightly"
EXPECTED_TESTS = 435

# Bind the reviewed inputs the Node wrapper passes to child processes. The
# non-Linux preload is checked as bytes on Linux, not counted as a Linux run.
REVIEWED_J4A_FIXTURE_SHA256 = {
    "j4a-entry-child.cjs": "d20d7880c299434df21aefc00c32969616e2e1465a1b9df3bc31099e81aef5b0",
    "j4a-guarded-child.cjs": "01d77d88a08c77a7e7050edc0ac09684acb3d1c63250aad631f024f6d79da903",
    "j4a-supervised-child.cjs": "c4a23e8fe983ac06955eab8d8f81e05ba1f3759c554b5215459f6b936b756199",
    "j4a-writer-proof.cjs": "1f5c167b4238feeca137b835d31fa3d49cf38217288ff11e58f93641b9b1ed12",
    "no-proc-shim.cjs": "333e0f5b99ab4472a3cc95d54a73a9a20099dddc168a7b8e255b9b856166accf",
}


class NightlySuite(unittest.TestCase):
    def test_exact_j4a_fixture_bytes(self):
        for name, expected in REVIEWED_J4A_FIXTURE_SHA256.items():
            fixture = NIGHTLY / "tests" / "fixtures" / name
            with self.subTest(name=name):
                self.assertFalse(fixture.is_symlink())
                self.assertEqual(hashlib.sha256(fixture.read_bytes()).hexdigest(), expected)

    def test_every_nightly_node_test_passes_and_none_is_skipped(self):
        files = sorted(str(p) for p in (NIGHTLY / "tests").glob("*.test.cjs"))
        self.assertTrue(files, "no nightly test files found")
        env = {"PATH": os.environ.get("PATH", ""), "NODE_OPTIONS": ""}
        r = subprocess.run(["node", "--test", "--test-reporter=tap", *files], capture_output=True, text=True, cwd=str(NIGHTLY), env=env, timeout=180)
        self.assertEqual(r.returncode, 0, r.stdout[-3000:] + r.stderr[-1000:])
        counts = {k: int(v) for k, v in re.findall(r"^# (tests|pass|fail|skipped|todo|cancelled) (\d+)$", r.stdout, re.M)}
        self.assertEqual(counts, {"tests": EXPECTED_TESTS, "pass": EXPECTED_TESTS, "fail": 0, "skipped": 0, "todo": 0, "cancelled": 0})

    def test_every_nightly_module_is_covered_by_a_test_file(self):
        modules = sorted(p.relative_to(NIGHTLY).as_posix() for p in NIGHTLY.rglob("*.cjs")
                         if "tests" not in p.relative_to(NIGHTLY).parts and "negative-controls" not in p.relative_to(NIGHTLY).parts)
        tests = "\n".join(p.read_text(encoding="utf-8") for p in (NIGHTLY / "tests").glob("*.test.cjs"))
        uncovered = [m for m in modules if f"'../{m}'" not in tests]
        self.assertEqual(uncovered, [])


if __name__ == "__main__":
    unittest.main()
