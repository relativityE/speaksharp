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
import shutil
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
        revalidator = self.root / "received-browser-revalidator.py"
        revalidator.write_text(
            "import hashlib,json,os,sys\n"
            "def arg(name):\n"
            " i=sys.argv.index(name); return sys.argv[i+1]\n"
            "try:\n"
            " source=json.load(open(arg('--received-installed-receipt')))\n"
            " browser=os.path.realpath(os.environ['CT_CHROME'])\n"
            " assert source['schema']=='speaksharp.cloud-test.installed-browser.v1'\n"
            " assert source['path']==browser and source['sourceSha']==arg('--source-sha') and source['runId']==arg('--run-id')\n"
            " assert source['observedBinarySha256']==hashlib.sha256(open(browser,'rb').read()).hexdigest()\n"
            " output=dict(source,revalidated=True)\n"
            " with open(arg('--receipt'),'x') as f: json.dump(output,f,sort_keys=True); f.write('\\n')\n"
            " print(browser)\n"
            "except Exception as error:\n"
            " print('BLOCKED_SETUP: synthetic received-browser contract refused: '+str(error),file=sys.stderr); raise SystemExit(78)\n")
        guard = self.bin / "python3"
        reject = "printf acquisition >> " + shlex.quote(str(self.violation)) + "; exit 97"
        guard.write_text("#!/bin/sh\ncase \"$*\" in\n"
                         " *install_browser.py*) case \" $* \" in *' --received-installed-receipt '*) exec " +
                         shlex.quote(sys.executable) + " " + shlex.quote(str(revalidator)) + " \"$@\";; *) " + reject + ";; esac;;\n"
                         " *install_pdfjs.py*) case \" $* \" in *' --check-only '*) ;; *) " + reject + ";; esac;;\n"
                         "esac\nexec " + shlex.quote(sys.executable) + " \"$@\"\n")
        guard.chmod(0o700)
        npm = self.bin / "npm"
        npm.write_text("#!/bin/sh\n" + reject + "\n")
        npm.chmod(0o700)
        self.browser = self.root / "inert-browser"
        self.browser.write_bytes(b"not a real browser; never executed\n")
        self.browser.chmod(0o700)
        self.received_browser_receipt = self.root / "installed-browser-discovery.json"
        self.received_browser_receipt.write_text(json.dumps({
            "schema": "speaksharp.cloud-test.installed-browser.v1",
            "environment": "github-hosted",
            "path": str(self.browser),
            "observedBinarySha256": hashlib.sha256(self.browser.read_bytes()).hexdigest(),
            "sourceSha": "a1" * 20,
            "runId": "SYNTHETIC-setup-1",
        }))
        self.checkout = self.root / "synthetic-checkout"
        playwright = self.checkout / "node_modules/playwright"
        playwright.mkdir(parents=True)
        self.playwright_manifest = playwright / "package.json"
        self.playwright_manifest.write_text('{"name":"playwright","version":"1.57.0"}')
        self.playwright_entry = playwright / "index.js"
        self.playwright_entry.write_text("// inert resolver fixture; never imported\n")
        self.stimulus_called = self.root / "stimulus-called.txt"
        stub = self.root / "stimulus-stub.py"
        stub.write_text("import json,os,sys\nfrom pathlib import Path\n"
                        "Path(" + repr(str(self.stimulus_called)) + ").write_text(os.getcwd())\n"
                        "out=sys.argv[sys.argv.index('--out')+1]\n"
                        "Path(out).write_text(json.dumps({'synthetic':True,'productTraffic':0,'cases':{'AHT-12':{'ready':True}}}))\n")
        real_node = shutil.which("node")
        if not real_node:
            raise AssertionError("already-installed Node is required for these offline controls")
        node = self.bin / "node"
        node.write_text("#!/bin/sh\ncase \"$1\" in\n *stimulus-preflight.cjs) exec " + shlex.quote(sys.executable) + " " + shlex.quote(str(stub)) + " \"$@\";;\n"
                        "esac\nexec " + shlex.quote(real_node) + " \"$@\"\n")
        node.chmod(0o700)
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
        self.request_path = self.root / "synthetic-request.json"
        # A real, readable request shape for the production route selector. It
        # selects only inert setup fixtures and grants no product-run authority.
        self.request_path.write_text(json.dumps({
            "executionRuntime": "Claude SpeakSharp R4",
            "selection": [{"case": "AHT-12"}],
        }))
        self.out = self.root / "out"

    def run_stage(self, omit=(), extra=None, stage="install-tools"):
        env = {"PATH": str(self.bin) + os.pathsep + os.environ["PATH"], "HOME": str(self.root),
               "CT_CONFIG": str(self.config_path), "CT_OUT": str(self.out), "CT_REQUEST": str(self.request_path),
               "CT_CHROME": str(self.browser), "CT_CHECKOUT": str(self.checkout),
               "CT_BROWSER_RECEIPT": str(self.received_browser_receipt),
               "CT_SOURCE_SHA": "a1" * 20, "CT_EXECUTION_RUN_ID": "SYNTHETIC-setup-1"}
        for key in omit:
            env.pop(key)
        env.update(extra or {})
        result = subprocess.run(["bash", STAGE_SCRIPT, stage],
                                env=env, capture_output=True, text=True)
        self.assertFalse(self.violation.exists(), "restricted caller attempted acquisition")
        return result

    def test_default_restricted_caller_consumes_actual_existing_verifier_receipt(self):
        result = self.run_stage()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = json.loads((self.out / "browser-identity.json").read_text())
        self.assertEqual(receipt["sourceSha"], "a1" * 20)
        self.assertEqual(receipt["runId"], "SYNTHETIC-setup-1")
        self.assertTrue(receipt["revalidated"])
        self.assertEqual((self.out / "chrome-path.txt").read_text().strip(), str(self.browser))
        self.assertIn("nothing installed", result.stdout)

    def test_missing_browser_is_refused_without_any_acquisition(self):
        result = self.run_stage(omit=("CT_CHROME",))
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertIn("CT_CHROME is required for existing-only setup", result.stderr)
        self.assertFalse((self.out / "chrome-path.txt").exists())

    def test_missing_request_is_refused_before_setup_without_acquisition(self):
        self.request_path.unlink()
        result = self.run_stage()
        self.assertEqual(result.returncode, 78)
        self.assertIn("explicit supported runtime and case selection required", result.stderr)
        self.assertFalse((self.out / "browser-identity.json").exists())

    def test_unsupported_runtime_is_refused_before_setup_without_acquisition(self):
        self.request_path.write_text(json.dumps({"executionRuntime": "unsupported", "selection": [{"case": "AHT-12"}]}))
        result = self.run_stage()
        self.assertEqual(result.returncode, 78)
        self.assertIn("explicit supported runtime and case selection required", result.stderr)
        self.assertFalse((self.out / "browser-identity.json").exists())

    def test_mismatched_browser_is_refused_without_any_acquisition(self):
        self.browser.write_bytes(b"different bytes")
        result = self.run_stage()
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertIn("installed-browser receipt revalidation failed", result.stderr)
        self.assertFalse((self.out / "chrome-path.txt").exists())

    def test_missing_received_browser_receipt_is_refused_without_any_acquisition(self):
        result = self.run_stage(omit=("CT_BROWSER_RECEIPT",))
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertIn("installed-browser discovery receipt is required", result.stderr)
        self.assertFalse((self.out / "browser-identity.json").exists())

    def test_substituted_received_browser_receipt_is_refused_without_any_acquisition(self):
        receipt = json.loads(self.received_browser_receipt.read_text())
        receipt["schema"] = "speaksharp.cloud-test.unrelated-browser.v1"
        self.received_browser_receipt.write_text(json.dumps(receipt))
        result = self.run_stage()
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertIn("installed-browser receipt revalidation failed", result.stderr)
        self.assertFalse((self.out / "browser-identity.json").exists())

    def test_received_browser_receipt_refuses_source_or_run_substitution(self):
        original = json.loads(self.received_browser_receipt.read_text())
        for field, value in (("sourceSha", "b2" * 20), ("runId", "SYNTHETIC-other-run")):
            with self.subTest(field=field):
                changed = dict(original, **{field: value})
                self.received_browser_receipt.write_text(json.dumps(changed))
                result = self.run_stage()
                self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
                self.assertIn("installed-browser receipt revalidation failed", result.stderr)
                self.assertFalse((self.out / "browser-identity.json").exists())
        self.received_browser_receipt.write_text(json.dumps(original))

    def test_missing_playwright_is_refused_and_not_installed(self):
        self.playwright_manifest.unlink()
        result = self.run_stage()
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertIn("existing pinned Playwright is unavailable", result.stderr)
        self.assertFalse(self.playwright_manifest.exists())
        self.assertFalse((self.out / "chrome-path.txt").exists())

    def test_wrong_playwright_version_is_refused_without_replacement(self):
        self.playwright_manifest.write_text('{"version":"wrong"}')
        result = self.run_stage()
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertIn("existing Playwright version differs from the pin", result.stderr)
        self.assertEqual(self.playwright_manifest.read_text(), '{"version":"wrong"}')

    def test_missing_pdf_is_refused_without_copying(self):
        self.pdf_module.unlink()
        result = self.run_stage()
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertIn("existing pinned PDF parser is unavailable", result.stderr)
        self.assertFalse(self.pdf_module.exists())

    def test_missing_run_binding_is_refused_without_acquisition(self):
        result = self.run_stage(omit=("CT_EXECUTION_RUN_ID",))
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertIn("installed-browser receipt revalidation failed", result.stderr)
        self.assertFalse((self.out / "browser-identity.json").exists())

    def test_unknown_setup_mode_is_not_treated_as_acquisition(self):
        result = self.run_stage(extra={"CT_SETUP_MODE": "unexpected"})
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertIn("CT_SETUP_MODE must be existing-only", result.stderr)
        self.assertFalse((self.out / "chrome-path.txt").exists())

    def test_legacy_acquire_selection_is_refused_before_download_or_install(self):
        result = self.run_stage(extra={"CT_SETUP_MODE": "acquire"})
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertIn("acquire is unsupported", result.stderr)
        self.assertFalse((self.out / "browser-identity.json").exists())
        self.assertFalse((self.out / "chrome-path.txt").exists())

    def test_stimulus_stage_cannot_reenter_through_legacy_acquire_mode(self):
        setup = self.run_stage()
        self.assertEqual(setup.returncode, 0, setup.stdout + setup.stderr)
        result = self.run_stage(stage="stimulus-preflight", extra={"CT_SETUP_MODE": "acquire"})
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertIn("acquire is unsupported", result.stderr)
        self.assertFalse(self.stimulus_called.exists())

    def test_previous_browser_receipt_is_preserved_on_repeat_attempt(self):
        self.out.mkdir()
        receipt = self.out / "browser-identity.json"
        receipt.write_text("retained bytes")
        result = self.run_stage()
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertIn("installed-browser receipt revalidation failed", result.stderr)
        self.assertEqual(receipt.read_text(), "retained bytes")
        self.assertFalse((self.out / "chrome-path.txt").exists())

    def test_stimulus_consumer_uses_the_exact_verified_dependency_root(self):
        setup = self.run_stage()
        self.assertEqual(setup.returncode, 0, setup.stdout + setup.stderr)
        receipt = json.loads((self.out / "playwright-identity.json").read_text())
        self.assertEqual(receipt["root"], str(self.checkout))
        result = self.run_stage(stage="stimulus-preflight")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.stimulus_called.read_text(), receipt["root"])

    def test_stimulus_refuses_changed_verified_module_before_consumer_runs(self):
        setup = self.run_stage()
        self.assertEqual(setup.returncode, 0, setup.stdout + setup.stderr)
        self.playwright_entry.write_text("// changed fixture entry\n")
        result = self.run_stage(stage="stimulus-preflight")
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertIn("Playwright identity changed after setup", result.stderr)
        self.assertFalse(self.stimulus_called.exists())

    def test_stimulus_refuses_a_different_valid_dependency_root(self):
        setup = self.run_stage()
        self.assertEqual(setup.returncode, 0, setup.stdout + setup.stderr)
        other = self.root / "other-root"
        package = other / "node_modules/playwright"
        package.mkdir(parents=True)
        (package / "package.json").write_bytes(self.playwright_manifest.read_bytes())
        (package / "index.js").write_bytes(self.playwright_entry.read_bytes())
        result = self.run_stage(stage="stimulus-preflight", extra={"CT_EXISTING_DEPENDENCY_ROOT": str(other)})
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertIn("Playwright identity changed after setup", result.stderr)
        self.assertFalse(self.stimulus_called.exists())

    def test_stimulus_refuses_missing_verification_receipt(self):
        setup = self.run_stage()
        self.assertEqual(setup.returncode, 0, setup.stdout + setup.stderr)
        (self.out / "playwright-identity.json").unlink()
        result = self.run_stage(stage="stimulus-preflight")
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertIn("verified Playwright identity is missing", result.stderr)
        self.assertFalse(self.stimulus_called.exists())


if __name__ == "__main__":
    unittest.main()
