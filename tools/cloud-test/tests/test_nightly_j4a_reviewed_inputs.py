"""Prove the offline verifier rejects altered and substituted J4.a inputs."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "verify_nightly_j4a_inputs.py"
SPEC = importlib.util.spec_from_file_location("verify_nightly_j4a_inputs", MODULE_PATH)
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)


def digest(data):
    return hashlib.sha256(data).hexdigest()


class ReviewedInputs(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name).resolve()
        self.manifest = self.root / "reviewed.json"
        self.files = {}
        for name in VERIFY.REQUIRED:
            data = name.encode()
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            self.files[name] = digest(data)
        self.pinned = self.write(self.files)

    def write(self, files):
        raw = json.dumps({"schema": VERIFY.SCHEMA, "files": files}, sort_keys=True).encode()
        self.manifest.write_bytes(raw)
        return digest(raw)

    def test_exact_snapshot(self):
        VERIFY.check(self.root, self.manifest, self.pinned)

    def test_new_digest_does_not_authorize_mutated_file(self):
        rel = VERIFY.NIGHTLY_ROOT + "j4a-parent-teardown.cjs"
        (self.root / rel).write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "changed input"):
            VERIFY.check(self.root, self.manifest, self.pinned)
        self.files[rel] = digest(b"changed")
        self.write(self.files)
        with self.assertRaisesRegex(ValueError, "differs from approved"):
            VERIFY.check(self.root, self.manifest, self.pinned)

    def test_runtime_residue_helper_is_bound_as_bytes_not_just_count(self):
        (self.root / VERIFY.RESIDUE_HELPER).write_bytes(b"same inventory count, different store")
        with self.assertRaisesRegex(ValueError, "changed input: tests/live/helpers/runOwnedCleanup.ts"):
            VERIFY.check(self.root, self.manifest, self.pinned)

    def test_inventory_cannot_drop_or_add_a_file(self):
        self.files.pop(VERIFY.NIGHTLY_ROOT + "runner-bridge.cjs")
        with self.assertRaisesRegex(ValueError, "exactly"):
            VERIFY.check(self.root, self.manifest, self.write(self.files))
        self.files["../runner-bridge.cjs"] = "a" * 64
        with self.assertRaisesRegex(ValueError, "exactly"):
            VERIFY.check(self.root, self.manifest, self.write(self.files))

    def test_same_bytes_through_symlink_do_not_qualify(self):
        file = self.root / (VERIFY.NIGHTLY_ROOT + "j4a-nightly-entry.cjs")
        replacement = self.root / "substituted.cjs"
        file.rename(replacement)
        file.symlink_to(replacement)
        with self.assertRaisesRegex(ValueError, "noncanonical input"):
            VERIFY.check(self.root, self.manifest, self.pinned)

    def test_missing_reviewed_file_refuses(self):
        (self.root / (VERIFY.NIGHTLY_ROOT + "j4a-supervised-binding.cjs")).unlink()
        with self.assertRaises(FileNotFoundError):
            VERIFY.check(self.root, self.manifest, self.pinned)


if __name__ == "__main__":
    unittest.main()
