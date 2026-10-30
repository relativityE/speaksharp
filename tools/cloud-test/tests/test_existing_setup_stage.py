"""Execute the real restricted setup caller; acquisition attempts are trapped.

Everything called a browser/package here is inert, freshly generated fixture
data. Python and Node are the already installed interpreters. No browser,
dependency or PDF library is installed, fetched or launched by this suite.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest

from _fixtures import ROOT, sample

STAGE_SCRIPT = os.environ.get("CT_TEST_STAGE_SCRIPT") or str(Path(ROOT) / "scripts/execute_run.sh")

class ExistingSetupCaller(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ct-existing-stage-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.violation = self.root / "acquisition-attempted.txt"
        guard = self.bin / "python3"
        reject = "printf acquisition >> " + shlex.quote(str(self.violation)) + "; exit 97"
        guard.write_text("#!/bin/sh\ncase \"$*\" in\n"
                         " *install_browser.py*) case \" $* \" in *' --existing '*) ;; *) " + reject + ";; esac;;\n"
                         " *install_pdfjs.py*) case \" $* \" in *' --check-only '*) ;; *) " + reject + ";; esac;;\n"
                         "esac\nexec " + shlex.quote(sys.executable) + " \"$@\"\n")
        guard.chmod(0o700)
        npm = self.bin / "npm"
        npm.write_text("#!/bin/sh\n" + reject + "\n")
        npm.chmod(0o700)
        self.browser = self.root / "inert-browser"
        self.browser.write_bytes(b"not a real browser; never executed\n")
        self.browser.chmod(0o700)
        self.checkout = self.root / "synthetic-checkout"
        playwright = self.checkout / "node_modules/playwright"
        playwright.mkdir(parents=True)
        self.playwright_manifest = playwright / "package.json"
        self.playwright_manifest.write_text('{"name":"playwright","version":"1.57.0"}')
        pdf = self.checkout / "node_modules/pdfjs-dist"
        (pdf / "legacy/build").mkdir(parents=True)
        (pdf / "package.json").write_text('{"name":"pdfjs-dist","version":"4.10.38","synthetic":true}')
        self.pdf_module = pdf / "legacy/build/pdf.mjs"
        self.pdf_module.write_text("// inert fixture; never imported\n")
        self.config = copy.deepcopy(sample()["cfg"])
        self.config["tools"]["browser"]["chromeBinarySha256"] = hashlib.sha256(self.browser.read_bytes()).hexdigest()
        self.config["tools"]["pdfjs"]["packageJsonSha256"] = hashlib.sha256((pdf / "package.json").read_bytes()).hexdigest()
        self.config["tools"]["pdfjs"]["pdfMjsSha256"] = hashlib.sha256(self.pdf_module.read_bytes()).hexdigest()
        self.config_path = self.root / "unit-config.json"
        self.config_path.write_text(json.dumps(self.config))
        self.out = self.root / "out"

    def run_stage(self, omit=(), extra=None):
        env = {"PATH": str(self.bin) + os.pathsep + os.environ["PATH"], "HOME": str(self.root),
               "CT_CONFIG": str(self.config_path), "CT_OUT": str(self.out), "CT_REQUEST": "SYNTHETIC-NOT-A-RUN",
               "CT_CHROME": str(self.browser), "CT_CHECKOUT": str(self.checkout),
               "CT_SOURCE_SHA": "a1" * 20, "CT_EXECUTION_RUN_ID": "SYNTHETIC-setup-1"}
        for key in omit:
            env.pop(key)
        env.update(extra or {})
        result = subprocess.run(["bash", STAGE_SCRIPT, "install-tools"],
                                env=env, capture_output=True, text=True)
        self.assertFalse(self.violation.exists(), "restricted caller attempted acquisition")
        return result

    def test_default_restricted_caller_consumes_actual_existing_verifier_receipt(self):
        result = self.run_stage()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = json.loads((self.out / "browser-identity.json").read_text())
        self.assertEqual(receipt["sourceSha"], "a1" * 20)
        self.assertEqual(receipt["runId"], "SYNTHETIC-setup-1")
        self.assertEqual((self.out / "chrome-path.txt").read_text().strip(), str(self.browser))
        self.assertIn("nothing installed", result.stdout)

    def test_missing_browser_is_refused_without_any_acquisition(self):
        result = self.run_stage(omit=("CT_CHROME",))
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertFalse((self.out / "chrome-path.txt").exists())

    def test_mismatched_browser_is_refused_without_any_acquisition(self):
        self.browser.write_bytes(b"different bytes")
        result = self.run_stage()
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertFalse((self.out / "chrome-path.txt").exists())

    def test_missing_playwright_is_refused_and_not_installed(self):
        self.playwright_manifest.unlink()
        result = self.run_stage()
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertFalse(self.playwright_manifest.exists())
        self.assertFalse((self.out / "chrome-path.txt").exists())

    def test_wrong_playwright_version_is_refused_without_replacement(self):
        self.playwright_manifest.write_text('{"version":"wrong"}')
        result = self.run_stage()
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertEqual(self.playwright_manifest.read_text(), '{"version":"wrong"}')

    def test_missing_pdf_is_refused_without_copying(self):
        self.pdf_module.unlink()
        result = self.run_stage()
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertFalse(self.pdf_module.exists())

    def test_missing_run_binding_is_refused_without_acquisition(self):
        result = self.run_stage(omit=("CT_EXECUTION_RUN_ID",))
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertFalse((self.out / "browser-identity.json").exists())

    def test_unknown_setup_mode_is_not_treated_as_acquisition(self):
        result = self.run_stage(extra={"CT_SETUP_MODE": "unexpected"})
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertFalse((self.out / "chrome-path.txt").exists())

    def test_previous_browser_receipt_is_preserved_on_repeat_attempt(self):
        self.out.mkdir()
        receipt = self.out / "browser-identity.json"
        receipt.write_text("retained bytes")
        result = self.run_stage()
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertEqual(receipt.read_text(), "retained bytes")
        self.assertFalse((self.out / "chrome-path.txt").exists())


if __name__ == "__main__":
    unittest.main()
