"""No-install browser identity controls on inert fake bytes; never launch one."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

from _fixtures import sample
import install_browser


class ExistingBrowserOnly(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ct-existing-browser-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.binary = self.root / "inert-browser"
        self.binary.write_bytes(b"fake executable, deliberately never launched\n")
        self.binary.chmod(0o700)
        self.config = sample()["cfg"]
        self.config["tools"]["browser"]["chromeBinarySha256"] = hashlib.sha256(self.binary.read_bytes()).hexdigest()
        self.path = self.root / "config.json"
        self.path.write_text(json.dumps(self.config))

    def call(self, *args):
        argv = ["install_browser.py", "--config", str(self.path), "--existing", str(self.binary),
                "--source-sha", "a1" * 20, "--run-id", "SYNTHETIC-offline-1",
                "--receipt", str(self.root / "identity.json"), *map(str, args)]
        with mock.patch.object(sys, "argv", argv), \
                mock.patch.object(install_browser.urllib.request, "urlopen", side_effect=AssertionError("network forbidden")) as network, \
                mock.patch.object(install_browser.zipfile, "ZipFile", side_effect=AssertionError("extraction forbidden")) as archive, \
                mock.patch.object(install_browser.shutil, "copyfile", side_effect=AssertionError("copy forbidden")) as copy, \
                mock.patch.object(install_browser.shutil, "copyfileobj", side_effect=AssertionError("stream copy forbidden")) as stream_copy, \
                mock.patch.object(install_browser.os, "chmod", side_effect=AssertionError("chmod forbidden")) as chmod, \
                mock.patch.object(install_browser.tempfile, "mkdtemp", side_effect=AssertionError("install staging forbidden")) as staging, \
                contextlib.redirect_stdout(io.StringIO()) as output:
            try:
                install_browser.main()
            finally:
                network.assert_not_called()
                archive.assert_not_called()
                copy.assert_not_called()
                stream_copy.assert_not_called()
                chmod.assert_not_called()
                staging.assert_not_called()
        return output.getvalue().strip()

    def test_matching_existing_bytes_produce_identity_without_install_or_launch(self):
        receipt = self.root / "identity.json"
        self.assertEqual(self.call("--receipt", receipt), str(self.binary.resolve()))
        identity = json.loads(receipt.read_text())
        self.assertEqual(identity["observedBinarySha256"], self.config["tools"]["browser"]["chromeBinarySha256"])
        self.assertFalse(identity["browserLaunched"])
        self.assertFalse(identity["versionExecuted"])
        self.assertEqual(identity["sourceSha"], "a1" * 20)
        self.assertEqual(identity["runId"], "SYNTHETIC-offline-1")
        self.assertEqual(identity["configSha256"], hashlib.sha256(self.path.read_bytes()).hexdigest())

    def test_mismatch_refuses_without_network_fallback_or_receipt(self):
        self.binary.write_bytes(b"different binary")
        receipt = self.root / "refused.json"
        with self.assertRaises(SystemExit) as error:
            self.call("--receipt", receipt)
        self.assertEqual(error.exception.code, 78)
        self.assertFalse(receipt.exists())

    def test_missing_existing_binary_refuses_without_installation(self):
        self.binary.unlink()
        with self.assertRaises(SystemExit) as error:
            self.call()
        self.assertEqual(error.exception.code, 78)
        self.assertFalse(self.binary.exists())

    def test_explicit_empty_existing_path_cannot_fall_back_to_download(self):
        with self.assertRaises(SystemExit) as error:
            self.call("--existing", "")
        self.assertEqual(error.exception.code, 78)

    def test_nonexecutable_bytes_are_not_a_qualified_browser(self):
        self.binary.chmod(0o600)
        with self.assertRaises(SystemExit) as error:
            self.call()
        self.assertEqual(error.exception.code, 78)

    def test_identity_receipt_is_never_overwritten(self):
        receipt = self.root / "identity.json"
        receipt.write_text("retained bytes")
        with self.assertRaises(SystemExit) as error:
            self.call("--receipt", receipt)
        self.assertEqual(error.exception.code, 78)
        self.assertEqual(receipt.read_text(), "retained bytes")

    def test_cannot_combine_existing_route_with_archive_acquisition(self):
        with self.assertRaises(SystemExit) as error:
            self.call("--archive", self.root / "unread-archive.zip")
        self.assertEqual(error.exception.code, 78)

    def test_missing_or_malformed_bindings_refuse_before_acquisition(self):
        for args in (("--source-sha", ""), ("--source-sha", "short"),
                     ("--run-id", ""), ("--run-id", "../unsafe"), ("--receipt", "")):
            with self.subTest(args=args), self.assertRaises(SystemExit) as error:
                self.call(*args)
            self.assertEqual(error.exception.code, 78)
            self.assertFalse((self.root / "identity.json").exists())


if __name__ == "__main__":
    unittest.main()
