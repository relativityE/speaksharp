"""Nightly AHT suite (tools/cloud-test/nightly): its node:test files run inside the package unit tests.

The suite's verdict, budget, limit and oracle code is plain CommonJS beside the harness. This test runs its node:test
files and requires every one of them to pass, with none skipped, so a change to the nightly code is checked by the
same offline run as the rest of the package. The negative controls (nightly/negative-controls/run.cjs) rewrite files
and run in the same kind of disposable copy as the candidate tests.
"""
from contextlib import contextmanager
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NIGHTLY = ROOT / "nightly"
EXPECTED_TESTS = 551
REPO = ROOT.parents[1]
OFFLINE_PATCH = ROOT / "tests" / "fixtures" / "j4a-offline-packet.patch.fixture"
OFFLINE_PATCH_SHA256 = "632ea67bb88c10a2d380ac017db62960a0be974ed2846ca7205140036ebfb529"
HISTORICAL_CODE_SHA256 = "d2926261e3c6253168c694b306f4d0bbe8a7fc2ea2295a3c39a25f3635b3319c"
CANDIDATE_CODE_SHA256 = "92b47ee01a6a35d40607fe1d73e997090921fb070030269eb5c15bdcea6bda64"


def code_hash(cloud_test):
    return hashlib.sha256((cloud_test / "harness" / "bundle" / "CODE.sha256").read_bytes()).hexdigest()

# Bind the reviewed inputs the Node wrapper passes to child processes. The
# non-Linux preload is checked as bytes on Linux, not counted as a Linux run.
REVIEWED_J4A_FIXTURE_SHA256 = {
    "j4a-entry-child.cjs": "d20d7880c299434df21aefc00c32969616e2e1465a1b9df3bc31099e81aef5b0",
    "j4a-guarded-child.cjs": "01d77d88a08c77a7e7050edc0ac09684acb3d1c63250aad631f024f6d79da903",
    "j4a-retry-child.cjs": "dc5e82a84a2ff35828af4b15b42b4c7d5a1850bcd282a191df5727ec48b72170",
    "j4a-supervised-child.cjs": "c4a23e8fe983ac06955eab8d8f81e05ba1f3759c554b5215459f6b936b756199",
    "j4a-writer-proof.cjs": "4828c7adfcb1dc017ef8b18366715aaca130261f24607c6db85ddec8995419b4",
    "no-proc-shim.cjs": "333e0f5b99ab4472a3cc95d54a73a9a20099dddc168a7b8e255b9b856166accf",
}


# Candidate-only test sources must never run against the historical packet.
REVIEWED_OFFLINE_TEST_SHA256 = {
    "j4a-guarded-owner.test.cjs.fixture": "d4d4c73eeff7b9a2e1e43195ecdf71f27ff933c1235cd3be56d709709847f131",
    "j4a-nightly-entry.test.cjs.fixture": "6c8e893a84c923c72fd7057178e3996abd3e971f0106c2225e2429ea67ec3c44",
    "j4a-save-retry.test.cjs.fixture": "60c0c5b2f1e762a3a354db68f2e80c3b9ddc9af5452abd362cf75f2e63991029",
    "j4a-supervised-adapter.test.cjs.fixture": "6009e95031e30fc9d6f434e05074e4dd94d7cebb4cb55dff3fff5d8751151d0e",
    "j4a-supervised-entrypoint.test.cjs.fixture": "7e7a22a5a9914e963e945075084b01061fee3a87f19b4c6886161eca58eae696",
    "j4a-supervisor-termination.test.cjs.fixture": "4e96f432f4a5a1c217851b693df89456a5c8f8faba31be0a71d197b1cdc597c7",
}

class NightlySuite(unittest.TestCase):
    def test_exact_j4a_fixture_bytes(self):
        for name, expected in REVIEWED_J4A_FIXTURE_SHA256.items():
            fixture = NIGHTLY / "tests" / "fixtures" / name
            with self.subTest(name=name):
                self.assertFalse(fixture.is_symlink())
                self.assertEqual(hashlib.sha256(fixture.read_bytes()).hexdigest(), expected)

    def test_active_request_and_retained_receiver_agree_without_the_candidate(self):
        config = json.loads((ROOT / "config" / "test-config.v1.json").read_bytes())
        raw = (ROOT / "config" / "aggregate" / "manifest.json").read_bytes()
        retained = json.loads(raw)
        self.assertEqual(hashlib.sha256(raw).hexdigest(), config["aggregateReceiver"]["manifestSha256"])
        self.assertEqual(retained["workflowVersion"], config["workflowVersion"])
        self.assertEqual(retained["codeManifestSha256"], HISTORICAL_CODE_SHA256)
        self.assertEqual(config["harness"]["expectedCodeManifestSha256"], code_hash(ROOT))
        self.assertEqual(code_hash(ROOT), HISTORICAL_CODE_SHA256)

    @contextmanager
    def isolated_candidate(self):
        self.assertEqual(code_hash(ROOT), HISTORICAL_CODE_SHA256)
        self.assertFalse(OFFLINE_PATCH.is_symlink())
        patch = OFFLINE_PATCH.read_bytes()
        self.assertEqual(hashlib.sha256(patch).hexdigest(), OFFLINE_PATCH_SHA256)
        # Keep the retained packet and request validator on their original
        # contract. Exercise the candidate only in a private disposable copy.
        env = {"PATH": os.environ.get("PATH", ""), "NODE_OPTIONS": "", "GIT_CONFIG_NOSYSTEM": "1",
               "GIT_CONFIG_GLOBAL": os.devnull}
        with tempfile.TemporaryDirectory(prefix="nightly-offline-packet-") as scratch:
            top = Path(scratch).resolve()
            candidate = top / "tools" / "cloud-test"
            shutil.copytree(ROOT, candidate, ignore=shutil.ignore_patterns("__pycache__", "node_modules"))
            shutil.copytree(REPO / "tests" / "live", top / "tests" / "live",
                            ignore=shutil.ignore_patterns("__pycache__", "node_modules"))
            for name in ("scripts/production-release-policy.mjs", "scripts/lib/releaseEvidenceEligibility.mjs"):
                target = top / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(REPO / name, target)
            # Reuse only the checkout's installed compiler for the TypeScript drift test.
            dependency = (REPO / "node_modules" / "typescript").resolve(strict=True)
            (top / "node_modules").mkdir()
            (top / "node_modules" / "typescript").symlink_to(dependency, target_is_directory=True)
            applied = subprocess.run(["git", "apply", "--whitespace=nowarn", "-"], input=patch,
                                     capture_output=True, cwd=top, env=env, timeout=30)
            self.assertEqual(applied.returncode, 0, applied.stderr.decode(errors="replace"))
            self.assertEqual(code_hash(candidate), CANDIDATE_CODE_SHA256)
            checked = subprocess.run(
                [sys.executable, "-I", str(candidate / "scripts" / "verify_harness.py"),
                 "--config", str(candidate / "config" / "test-config.v1.json"), "--root", str(top)],
                capture_output=True, text=True, env=env, timeout=30)
            self.assertEqual(checked.returncode, 0, checked.stdout + checked.stderr)
            nightly = candidate / "nightly"
            for name, expected in REVIEWED_OFFLINE_TEST_SHA256.items():
                fixture = candidate / "tests" / "fixtures" / "nightly" / name
                self.assertFalse(fixture.is_symlink())
                self.assertEqual(hashlib.sha256(fixture.read_bytes()).hexdigest(), expected)
                executable = nightly / "tests" / Path(name).stem
                self.assertFalse(executable.exists())
                shutil.copyfile(fixture, executable)
            yield nightly, env
        self.assertEqual(code_hash(ROOT), HISTORICAL_CODE_SHA256)

    def test_every_nightly_node_test_passes_and_none_is_skipped(self):
        with self.isolated_candidate() as (nightly, env):
            files = sorted(str(p) for p in (nightly / "tests").glob("*.test.cjs"))
            self.assertTrue(files, "no nightly test files found")
            r = subprocess.run(["node", "--test", "--test-reporter=tap", *files], capture_output=True,
                               text=True, cwd=nightly, env=env, timeout=180)
        failures = re.findall(r"(?m)^ *not ok .*\n(?:^(?! *# Subtest:| *ok | *not ok ).*\n)*", r.stdout)
        self.assertEqual(r.returncode, 0, "\n".join(failures)[-5000:] + r.stdout[-500:] + r.stderr[-1000:])
        counts = {k: int(v) for k, v in re.findall(r"^# (tests|pass|fail|skipped|todo|cancelled) (\d+)$", r.stdout, re.M)}
        self.assertEqual(counts, {"tests": EXPECTED_TESTS, "pass": EXPECTED_TESTS, "fail": 0, "skipped": 0, "todo": 0, "cancelled": 0})

    def test_candidate_journal_breaks_fail_and_recover_in_the_isolated_packet(self):
        with self.isolated_candidate() as (nightly, env):
            for control in ("P31-j4a-admission-without-journal", "P31-j4a-hooks-without-journal"):
                with self.subTest(control=control):
                    result = subprocess.run(
                        ["node", str(nightly / "negative-controls" / "run.cjs"), "--only", control],
                        capture_output=True, text=True, cwd=nightly, env=env, timeout=60)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertEqual(result.stdout.strip(), f"{control}: break FAIL, restored PASS -> PROVEN")

    def test_every_nightly_module_is_covered_by_a_test_file(self):
        modules = sorted(p.relative_to(NIGHTLY).as_posix() for p in NIGHTLY.rglob("*.cjs")
                         if "tests" not in p.relative_to(NIGHTLY).parts and "negative-controls" not in p.relative_to(NIGHTLY).parts)
        sources = list((NIGHTLY / "tests").glob("*.test.cjs"))
        sources += [ROOT / "tests" / "fixtures" / "nightly" / name for name in REVIEWED_OFFLINE_TEST_SHA256]
        tests = "\n".join(p.read_text(encoding="utf-8") for p in sources)
        uncovered = [m for m in modules if f"'../{m}'" not in tests]
        self.assertEqual(uncovered, [])


if __name__ == "__main__":
    if sys.argv[1:2] == ["--negative-controls"]:
        # Preserve the caller-relative output path rather than writing into the temporary tree.
        import argparse
        parser = argparse.ArgumentParser()
        parser.add_argument("--only")
        parser.add_argument("--out", type=Path)
        args = parser.parse_args(sys.argv[2:])
        with NightlySuite().isolated_candidate() as (nightly, env):
            command = ["node", str(nightly / "negative-controls" / "run.cjs")]
            if args.only is not None:
                command.extend(("--only", args.only))
            if args.out is not None:
                command.extend(("--out", str(args.out.resolve())))
            result = subprocess.run(command, cwd=nightly, env=env, timeout=3600)
        sys.exit(result.returncode)
    unittest.main()
