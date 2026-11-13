"""R10 run 42318728005: A6 stopped at S12 with ENOENT; the approved private-media parent was never provisioned. Offline proof for the
create-only preparer . Production binds owner UID 0 and trusted root "/"; these tests bind the test user's UID and a
fresh temporary directory, whose own ancestors are outside the test's control."""
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import prepare_media_parent as M  # noqa: E402

UID = os.getuid()


class PrepareMediaParent(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="media-parent-")
        os.chmod(self.tmp, 0o755)
        self.addCleanup(subprocess.run, ["rm", "-rf", self.tmp])
        self.base = os.path.realpath(self.tmp)
        self.parent = os.path.join(self.base, "ss-media-cloud-test")

    def prepare(self, parent=None, expected=None, uid=UID):
        parent = self.parent if parent is None else parent
        return M.prepare(parent, parent if expected is None else expected, uid, self.base)

    def snapshot(self, p):
        st = os.lstat(p)
        return (st.st_ino, st.st_mode, st.st_uid, st.st_gid, st.st_mtime_ns)

    def test_missing_parent_is_created_root_style_0711_and_traversable(self):
        self.assertEqual(self.prepare(), "created")
        st = os.lstat(self.parent)
        self.assertTrue(stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode))
        self.assertEqual((stat.S_IMODE(st.st_mode), st.st_uid), (0o711, UID))
        self.assertEqual(self.prepare(), "existing")      # idempotent: the second call validates and leaves it unchanged

    def test_valid_pre_existing_parent_is_admitted_unchanged(self):
        os.mkdir(self.parent, 0o755)
        before = self.snapshot(self.parent)
        self.assertEqual(self.prepare(), "existing")
        self.assertEqual(self.snapshot(self.parent), before)

    def test_refusals_leave_every_existing_node_unmodified(self):
        target = os.path.join(self.base, "elsewhere")
        os.mkdir(target, 0o711)
        cases = {
            "media-parent-symlink": lambda: os.symlink(target, self.parent),                       # live symlink
            "media-parent-not-directory": lambda: Path(self.parent).write_text("x"),               # regular file
            "media-parent-writable": lambda: (os.mkdir(self.parent), os.chmod(self.parent, 0o775)),
            "media-parent-not-traversable": lambda: (os.mkdir(self.parent), os.chmod(self.parent, 0o700)),
        }
        for code, make in cases.items():
            with self.subTest(code=code):
                make()
                before = self.snapshot(self.parent)
                with self.assertRaisesRegex(M.Refused, "^" + code + "$"):
                    self.prepare()
                self.assertEqual(self.snapshot(self.parent), before)
                (os.unlink if os.path.islink(self.parent) or os.path.isfile(self.parent) else os.rmdir)(self.parent)

    def test_dangling_symlink_is_refused_and_never_followed(self):
        os.symlink(os.path.join(self.base, "does-not-exist"), self.parent)
        with self.assertRaisesRegex(M.Refused, "media-parent-symlink"):
            self.prepare()
        self.assertFalse(os.path.exists(os.path.join(self.base, "does-not-exist")))   # mkdir did not follow the link
        self.assertTrue(os.path.islink(self.parent))

    def test_wrong_owner_is_refused(self):
        os.mkdir(self.parent, 0o711)
        with self.assertRaisesRegex(M.Refused, "media-parent-owner"):
            self.prepare(uid=UID + 1)

    def test_creation_race_is_validated_as_an_existing_node(self):
        real_mkdir = os.mkdir

        def racer(path, mode=0o777):
            os.symlink(self.base, path)          # an attacker wins the race with a symlink
            raise FileExistsError(path)
        with mock.patch.object(M.os, "mkdir", racer):
            with self.assertRaisesRegex(M.Refused, "media-parent-symlink"):
                self.prepare()
        os.unlink(self.parent)

        def benign(path, mode=0o777):
            real_mkdir(path, 0o711)              # a legitimate concurrent creator, same secure shape
            raise FileExistsError(path)
        with mock.patch.object(M.os, "mkdir", benign):
            self.assertEqual(self.prepare(), "existing")

    def test_override_mismatch_and_non_canonical_paths_refuse_before_any_write(self):
        with self.assertRaisesRegex(M.Refused, "media-parent-not-the-plan"):
            self.prepare(expected=self.parent + "-other")
        for bad in (self.base + "/a/../ss-media", "relative/path", "/", self.base + "/x/"):
            with self.subTest(bad=bad), self.assertRaises(M.Refused):
                M.prepare(bad, bad, UID, self.base)
        self.assertFalse(os.path.exists(self.parent))

    def test_insecure_ancestor_refuses(self):
        mid = os.path.join(self.base, "mid")
        os.mkdir(mid, 0o777)
        os.chmod(mid, 0o777)                     # group/other writable, not sticky
        with self.assertRaisesRegex(M.Refused, "media-parent-ancestor-writable"):
            M.prepare(os.path.join(mid, "p"), os.path.join(mid, "p"), UID, self.base)
        os.chmod(mid, 0o1777)                    # sticky like /var/tmp: admitted
        self.assertEqual(M.prepare(os.path.join(mid, "p"), os.path.join(mid, "p"), UID, self.base), "created")
        os.chmod(mid, 0o700)                     # not traversable by 65534
        with self.assertRaisesRegex(M.Refused, "media-parent-ancestor-not-traversable"):
            M.prepare(os.path.join(mid, "q"), os.path.join(mid, "q"), UID, self.base)
        os.chmod(mid, 0o755)

    def test_cli_refuses_without_root_and_writes_nothing(self):
        if os.geteuid() == 0:
            self.skipTest("running as root")
        p = subprocess.run([sys.executable, "-I", str(ROOT / "scripts/prepare_media_parent.py"), "--parent", self.parent,
                            "--expected", self.parent], capture_output=True, text=True)
        self.assertEqual((p.returncode, p.stderr.strip()), (78, "BLOCKED_SETUP: media-parent-requires-root"))
        self.assertFalse(os.path.exists(self.parent))


class EntrypointOrdering(unittest.TestCase):
    def test_the_elevated_run_stage_prepares_the_plan_parent_before_admission(self):
        text = (ROOT / "scripts/execute_run.sh").read_text()
        prep = text.index('prepare_media_parent.py" --parent "$media_parent" --expected "${CT_MEDIA_PARENT:-/var/tmp/ss-media-cloud-test}"')
        admission = text.index('run_stage run node "$HP/bundle/harness/admission.cjs"')
        read = text.index('media_parent="$(python3 -I "$ROOT/scripts/cfg_get.py" "$admission_config" privateMediaParent)"')
        self.assertLess(read, prep)
        self.assertLess(prep, admission)
        root_gate = text.rindex('if [ "$(id -u)" = 0 ]; then', 0, prep)
        config_line = text.rindex('admission_config="$(python3 -I "$ROOT/scripts/cfg_get.py" "$planfile" admissionConfigFile)"', 0, root_gate)
        self.assertLess(config_line, root_gate)
        self.assertNotIn("run_stage", text[config_line:prep].replace("run_stage run node", ""))   # nothing else runs in between
        # the expected default is the one the plan builder receives, so an override binds both
        self.assertIn('BP_MEDIA_PARENT="${CT_MEDIA_PARENT:-/var/tmp/ss-media-cloud-test}"', text)
        build = (ROOT / "harness-adapter/build_plan.py").read_text()
        self.assertIn("MEDIA_PARENT = env.get('BP_MEDIA_PARENT', '/var/tmp/ss-media-cloud-test')", build)
        self.assertIn("'privateMediaParent': MEDIA_PARENT", build)

    def test_missing_parent_reproduces_the_content_free_enoent(self):
        """The A6 stop: S12's first touch of the parent (fs.readdirSync) on a missing directory is ENOENT; after preparation it is not."""
        with tempfile.TemporaryDirectory() as d:
            missing = os.path.join(os.path.realpath(d), "ss-media-cloud-test")
            p = subprocess.run(["node", "-e", "try{require('fs').readdirSync(process.argv[1]);console.log('ok')}catch(e){console.log(e.code)}",
                                missing], capture_output=True, text=True)
            self.assertEqual(p.stdout.strip(), "ENOENT")
            os.chmod(d, 0o755)
            M.prepare(missing, missing, UID, os.path.realpath(d))
            p = subprocess.run(["node", "-e", "try{require('fs').readdirSync(process.argv[1]);console.log('ok')}catch(e){console.log(e.code)}",
                                missing], capture_output=True, text=True)
            self.assertEqual(p.stdout.strip(), "ok")


if __name__ == "__main__":
    unittest.main()
