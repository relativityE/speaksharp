"""No-install browser identity controls on inert fake bytes; never launch one."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

from _fixtures import sample
import install_browser

REAL_NATIVE_FORMAT = install_browser.native_format


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


class InstalledBrowserBaseline(unittest.TestCase):
    """--installed (PO 2026-10-31): the preinstalled browser at or above the environment's own baseline; never a download or install.
    The fake browsers are scripts that only answer --version, so nothing real is launched. A fake made with fake() stands in for a native
    binary (native_format is answered for it); one made with launcher() keeps the real check and is therefore a launcher script."""
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ct-installed-browser-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.config = self.root / "config.json"
        self.config.write_text(json.dumps(sample()["cfg"]))
        self.binaries = set()
        real_check = install_browser.native_format
        patcher = mock.patch.object(install_browser, "native_format", side_effect=lambda p: "ELF" if os.path.realpath(p) in self.binaries else real_check(p))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.chrome = self.fake("chrome", "Google Chrome 156.0.8078.47")
        self.baselines = self.root / "baselines.json"
        self.write_baselines({"github-hosted": {"minimumMajor": 156, "candidates": [str(self.root / "absent"), str(self.chrome)]}})

    def fake(self, name, version_line, exit_code=0, body=""):
        p = self.launcher(name, version_line, exit_code, body)
        self.binaries.add(os.path.realpath(p))
        return p

    def launcher(self, name, version_line, exit_code=0, body=""):
        p = self.root / name
        p.write_text("#!/bin/sh\necho '%s'\n%sexit %d\n" % (version_line, body, exit_code))
        p.chmod(0o700)
        return p

    def write_baselines(self, environments):
        self.baselines.write_text(json.dumps({"schema": "speaksharp.cloud-test.browser-baselines.v1", "environments": environments}))

    def call(self, *args, environment="github-hosted"):
        argv = ["install_browser.py", "--config", str(self.config), "--installed", "--baselines", str(self.baselines), "--environment", environment,
                "--source-sha", "a1" * 20, "--run-id", "SYNTHETIC-offline-1", "--receipt", str(self.root / "identity.json"), *map(str, args)]
        with mock.patch.object(sys, "argv", argv), \
                mock.patch.object(install_browser.urllib.request, "urlopen", side_effect=AssertionError("network forbidden")) as network, \
                mock.patch.object(install_browser.zipfile, "ZipFile", side_effect=AssertionError("extraction forbidden")) as archive, \
                mock.patch.object(install_browser.tempfile, "mkdtemp", side_effect=AssertionError("install staging forbidden")) as staging, \
                contextlib.redirect_stdout(io.StringIO()) as output:
            try:
                install_browser.main()
            finally:
                network.assert_not_called()
                archive.assert_not_called()
                staging.assert_not_called()
        return output.getvalue().strip()

    def refused(self, *args, **kw):
        with self.assertRaises(SystemExit) as error:
            self.call(*args, **kw)
        self.assertEqual(error.exception.code, 78)
        self.assertFalse((self.root / "identity.json").exists())

    def test_a_browser_at_the_baseline_is_used_and_its_identity_recorded(self):
        self.assertEqual(self.call(), str(self.chrome.resolve()))
        r = json.loads((self.root / "identity.json").read_text())
        self.assertEqual((r["schema"], r["environment"], r["minimumMajor"], r["product"], r["version"]),
                         ("speaksharp.cloud-test.installed-browser.v1", "github-hosted", 156, "Google Chrome", "156.0.8078.47"))
        self.assertEqual((r["path"], r["binaryFormat"]), (str(self.chrome.resolve()), "ELF"))
        self.assertEqual(r["observedBinarySha256"], hashlib.sha256(self.chrome.read_bytes()).hexdigest())
        self.assertEqual(r["baselinesSha256"], hashlib.sha256(self.baselines.read_bytes()).hexdigest())
        self.assertEqual((r["versionExecuted"], r["browserLaunched"], r["sourceSha"], r["runId"]), (True, False, "a1" * 20, "SYNTHETIC-offline-1"))

    def test_a_newer_browser_is_accepted_and_an_explicit_candidate_wins(self):
        newer = self.fake("chromium", "Chromium 157.0.1.2")
        self.assertEqual(self.call("--candidate", newer), str(newer.resolve()))
        self.assertEqual(json.loads((self.root / "identity.json").read_text())["version"], "157.0.1.2")

    def test_an_older_browser_is_refused(self):
        self.refused("--candidate", self.fake("old", "Google Chrome 155.0.7000.1"))

    def test_an_older_listed_browser_does_not_block_a_later_qualifying_one(self):
        old = self.fake("old", "Google Chrome 155.0.7000.1")
        newer = self.fake("chromium", "Chromium 156.0.8078.0")
        self.write_baselines({"github-hosted": {"minimumMajor": 156, "candidates": [str(old), str(newer)]}})
        self.assertEqual(self.call(), str(newer.resolve()))
        r = json.loads((self.root / "identity.json").read_text())
        self.assertEqual((r["product"], r["version"]), ("Chromium", "156.0.8078.0"))
        self.assertEqual(len(r["rejectedCandidates"]), 1)
        self.assertIn("below the established baseline", r["rejectedCandidates"][0])

    def test_a_real_native_executable_is_recognised_and_a_launcher_script_is_not(self):
        self.assertIn(REAL_NATIVE_FORMAT(os.path.realpath(sys.executable)), ("ELF", "Mach-O", "Mach-O universal"))
        self.assertIsNone(REAL_NATIVE_FORMAT(str(self.launcher("wrapper", "Google Chrome 156.0.8078.47"))))
        text = self.root / "notes.txt"
        text.write_text("Google Chrome 156.0.8078.47\n")
        self.assertIsNone(REAL_NATIVE_FORMAT(str(text)))

    def test_an_explicit_launcher_script_is_refused_even_when_its_version_qualifies(self):
        self.refused("--candidate", self.launcher("google-chrome", "Google Chrome 156.0.8078.47"))

    def test_a_listed_launcher_is_skipped_for_the_binary_it_execs(self):
        wrapper = self.launcher("google-chrome", "Google Chrome 156.0.8078.47")
        self.write_baselines({"github-hosted": {"minimumMajor": 156, "candidates": [str(wrapper), str(self.chrome)]}})
        self.assertEqual(self.call(), str(self.chrome.resolve()))
        r = json.loads((self.root / "identity.json").read_text())
        self.assertEqual(r["observedBinarySha256"], hashlib.sha256(self.chrome.read_bytes()).hexdigest())
        self.assertIn("launcher script", r["rejectedCandidates"][0])

    def test_an_unchanged_launcher_with_a_changed_binary_is_refused_by_the_consumer(self):
        import generate_offline_proof
        wrapper = self.launcher("google-chrome", "Google Chrome 156.0.8078.47")
        self.write_baselines({"github-hosted": {"minimumMajor": 156, "candidates": [str(wrapper), str(self.chrome)]}})
        self.call()
        receipt = str(self.root / "identity.json")
        self.assertEqual(generate_offline_proof.pinned_chrome(str(self.chrome), {}, receipt), str(self.chrome))
        wrapper_bytes = wrapper.read_bytes()
        self.chrome.write_text(self.chrome.read_text() + "# swapped browser build\n")
        self.assertEqual(wrapper.read_bytes(), wrapper_bytes)
        for path in (self.chrome, wrapper):
            with self.subTest(path=path.name), self.assertRaises(SystemExit) as error:
                generate_offline_proof.pinned_chrome(str(path), {}, receipt)
            self.assertIn("BLOCKED_SETUP", str(error.exception.code))

    def test_a_binary_that_changes_during_its_version_check_is_refused(self):
        self.refused("--candidate", self.fake("mutating", "Google Chrome 156.0.8078.47", body="printf '#' >> \"$0\"\n"))

    def test_a_failing_version_command_is_refused_despite_valid_looking_output(self):
        self.refused("--candidate", self.fake("crashing", "Google Chrome 156.0.8078.47", exit_code=1))
        self.write_baselines({"github-hosted": {"minimumMajor": 156, "candidates": [str(self.fake("crashing2", "Google Chrome 157.0.1.1", exit_code=3))]}})
        self.refused()

    def test_an_environment_without_its_own_baseline_is_refused_not_given_another(self):
        self.refused(environment="cloud")
        self.write_baselines({"github-hosted": {"minimumMajor": "156", "candidates": [str(self.chrome)]}})
        self.refused()

    def test_no_preinstalled_browser_is_refused_without_download_or_install(self):
        self.write_baselines({"github-hosted": {"minimumMajor": 156, "candidates": [str(self.root / "absent")]}})
        self.refused()
        self.refused("--candidate", "")
        self.chrome.chmod(0o600)
        self.refused("--candidate", self.chrome)

    def test_an_unrecognised_version_report_is_refused(self):
        for line in ("Mozilla Firefox 140.0", "Google Chrome", "Chromium 156"):
            with self.subTest(line=line):
                self.refused("--candidate", self.fake("odd", line))

    def test_installed_discovery_cannot_be_combined_or_left_unbound(self):
        self.refused("--existing", self.chrome)
        self.refused("--archive", self.root / "unread.zip")
        for args in (("--source-sha", "short"), ("--run-id", "../unsafe"), ("--receipt", ""), ("--environment", "")):
            with self.subTest(args=args):
                self.refused(*args)

    def test_discovery_arguments_require_the_installed_mode(self):
        argv = ["install_browser.py", "--config", str(self.config), "--candidate", str(self.chrome)]
        with mock.patch.object(sys, "argv", argv), self.assertRaises(SystemExit) as error:
            install_browser.main()
        self.assertEqual(error.exception.code, 78)

    def test_the_shipped_github_hosted_baseline_is_156_with_no_other_environment(self):
        b = json.load(open(Path(install_browser.__file__).resolve().parents[1] / "config" / "browser-baselines.v1.json", encoding="utf-8"))
        self.assertEqual(list(b["environments"]), ["github-hosted"])
        self.assertEqual(b["environments"]["github-hosted"]["minimumMajor"], 156)


class RecordedBrowserIsTheOneUsed(unittest.TestCase):
    """generate_offline_proof uses exactly the browser this run's discovery recorded (same path and bytes)."""
    def setUp(self):
        import generate_offline_proof
        self.pinned_chrome = generate_offline_proof.pinned_chrome
        self.temporary = tempfile.TemporaryDirectory(prefix="ct-recorded-browser-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.chrome = self.root / "chrome"
        self.chrome.write_bytes(b"recorded browser bytes")
        self.receipt = self.root / "identity.json"
        self.receipt.write_text(json.dumps({"schema": "speaksharp.cloud-test.installed-browser.v1", "path": str(self.chrome.resolve()),
                                            "observedBinarySha256": hashlib.sha256(self.chrome.read_bytes()).hexdigest()}))
        self.cfg = sample()["cfg"]

    def test_the_recorded_browser_is_accepted(self):
        self.assertEqual(self.pinned_chrome(str(self.chrome), self.cfg, str(self.receipt)), str(self.chrome))

    def test_changed_bytes_another_path_or_a_bad_receipt_are_refused(self):
        other = self.root / "other"
        other.write_bytes(b"recorded browser bytes")
        for case, chrome, receipt in (("bytes", self.chrome, self.receipt), ("path", other, self.receipt), ("missing", self.chrome, self.root / "none.json")):
            if case == "bytes":
                self.chrome.write_bytes(b"swapped after discovery")
            with self.subTest(case=case), self.assertRaises(SystemExit) as error:
                self.pinned_chrome(str(chrome), self.cfg, str(receipt))
            self.assertIn("BLOCKED_SETUP", str(error.exception.code))

    def test_without_a_receipt_the_exact_legacy_pin_still_applies(self):
        with self.assertRaises(SystemExit) as error:
            self.pinned_chrome(str(self.chrome), self.cfg)
        self.assertIn("pinned", str(error.exception.code))


if __name__ == "__main__":
    unittest.main()
