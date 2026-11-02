"""Read-only PDF source selection uses actual pin validation, no acquisition."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

from _fixtures import ROOT, run_py, sample
import test_full_plan


class ExistingPdfSource(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ct-existing-pdf-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "node_modules/pdfjs-dist"
        (self.source / "legacy/build").mkdir(parents=True)
        (self.source / "package.json").write_text('{"version":"4.10.38","synthetic":true}')
        self.module = self.source / "legacy/build/pdf.mjs"
        self.module.write_text("// inert source; not imported\n")
        self.pin = dict(test_full_plan.PIN)
        self.pin["packageJsonSha256"] = hashlib.sha256((self.source / "package.json").read_bytes()).hexdigest()
        self.pin["pdfMjsSha256"] = hashlib.sha256(self.module.read_bytes()).hexdigest()
        cfg = sample()["cfg"]
        cfg["tools"]["pdfjs"] = self.pin
        self.config = self.root / "config.json"
        self.config.write_text(json.dumps(cfg))

    def select(self, source=None):
        env = {"CT_EXISTING_PDFJS_DIR": str(self.source if source is None else source)}
        with mock.patch.dict(os.environ, env), mock.patch.object(test_full_plan, "PIN", self.pin), \
                mock.patch.object(test_full_plan.shutil, "copytree", side_effect=AssertionError("copy forbidden")) as copy:
            try:
                return test_full_plan.selected_pdf_source()
            finally:
                copy.assert_not_called()

    def test_explicit_existing_source_is_pin_verified_without_copy(self):
        self.assertEqual(self.select(), str(self.source))

    def test_missing_source_does_not_fall_back_or_skip(self):
        with self.assertRaisesRegex(AssertionError, "does not match pins"):
            self.select(self.root / "missing")

    def test_changed_module_is_refused_without_repair(self):
        self.module.write_text("changed bytes")
        with self.assertRaisesRegex(AssertionError, "does not match pins"):
            self.select()
        self.assertEqual(self.module.read_text(), "changed bytes")

    def test_relative_source_is_not_silently_resolved(self):
        with self.assertRaisesRegex(AssertionError, "absolute"):
            self.select("relative-path")

    def test_actual_pdf_cli_refuses_relative_source_without_fallback(self):
        result = run_py("scripts/install_pdfjs.py", "--config", str(self.config), "--source-dir", "relative-path",
                        "--checkout", str(self.root), "--check-only")
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertIn("absolute", result.stderr)

    def test_actual_pdf_cli_check_only_accepts_existing_pinned_checkout(self):
        result = run_py("scripts/install_pdfjs.py", "--config", str(self.config), "--source-dir", str(self.source),
                        "--checkout", str(self.root), "--check-only")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), self.pin["pdfMjsSha256"])

    def test_explicit_source_without_check_only_cannot_enable_copy(self):
        destination = self.root / "new-checkout"
        result = run_py("scripts/install_pdfjs.py", "--config", str(self.config), "--source-dir", str(self.source),
                        "--checkout", str(destination))
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertFalse(destination.exists())

    def test_check_only_refuses_absent_checkout_without_copying_source(self):
        destination = self.root / "new-checkout"
        result = run_py("scripts/install_pdfjs.py", "--config", str(self.config), "--source-dir", str(self.source),
                        "--checkout", str(destination), "--check-only")
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertFalse(destination.exists())

    def test_full_plan_uses_the_explicit_existing_playwright_root(self):
        package = self.root / "node_modules/playwright"
        package.mkdir()
        (package / "package.json").write_text('{"version":"1.57.0"}')
        with mock.patch.dict(os.environ, {"CT_EXISTING_DEPENDENCY_ROOT": str(self.root)}):
            self.assertEqual(test_full_plan.playwright_cwd(), str(self.root.resolve()))

    def test_full_plan_refuses_explicit_bad_playwright_root_without_fallback(self):
        package = self.root / "node_modules/playwright"
        package.mkdir()
        (package / "package.json").write_text('{"version":"different"}')
        for value in (str(self.root / "missing"), str(self.root), "relative-root"):
            with self.subTest(root=value), mock.patch.dict(os.environ, {"CT_EXISTING_DEPENDENCY_ROOT": value}):
                with self.assertRaises(AssertionError):
                    test_full_plan.playwright_cwd()


if __name__ == "__main__":
    unittest.main()
