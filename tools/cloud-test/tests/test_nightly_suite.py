"""Nightly AHT suite (tools/cloud-test/nightly): its node:test files run inside the package unit tests.

The suite's verdict, budget, limit and oracle code is plain CommonJS beside the harness. This test runs its node:test
files and requires every one of them to pass, with none skipped, so a change to the nightly code is checked by the
same offline run as the rest of the package. The negative controls (nightly/negative-controls/run.cjs) rewrite files
and are run on their own, not here.
"""
import os
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NIGHTLY = ROOT / "nightly"
EXPECTED_TESTS = 138


class NightlySuite(unittest.TestCase):
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
