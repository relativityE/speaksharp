"""R10 run 42386714252: A6 passed, then A7 stopped with "identity receipt unavailable" in 74 ms. identity-core's IdentityLedger requires its
ledger directory (the job-user-created $CT_OUT/plan/ledgers) to be owned by the reading process, and the run stage runs as root. The
elevated run stage now enters `run-as-root`, which takes ownership of exactly its run-owned private trees, runs the stage, and returns them.
Sam 1794066566/1794066358: a failed take must stop the stage; a failed return must be reported and fail it. Behaviour is exercised
offline with `id`/`chown` shims (the privileged path itself runs on the runner); the stage it launches stops at its first config check."""
import os
import signal
import stat
import time
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/execute_run.sh"
RUN_STARTED = "CT_CONFIG (the reviewed run configuration) is required"     # the real run stage's first refusal: proof it was launched


class RunAsRoot(unittest.TestCase):
    def setUp(self):
        self.d = os.path.realpath(tempfile.mkdtemp(prefix="run-as-root-"))
        self.addCleanup(subprocess.run, ["rm", "-rf", self.d])
        self.bin = os.path.join(self.d, "bin"); os.mkdir(self.bin)
        self.log = os.path.join(self.d, "chown.log")
        self.out = os.path.join(self.d, "out"); os.mkdir(self.out, 0o700)
        self.inputs = os.path.join(self.d, "run-inputs"); os.mkdir(self.inputs, 0o700)
        self.shim("id", '#!/bin/sh\n[ "$1" = -u ] && echo 0 && exit 0\n[ "$1" = -g ] && echo 0 && exit 0\nexec /usr/bin/id "$@"\n')
        self.shim("chown", '#!/bin/sh\necho "$*" >> "%s"\n[ -n "$SLOW_ON" ] && [ "$2" = "$SLOW_ON" ] && sleep 5\n'
                           '[ -n "$FAIL_ON" ] && [ "$2" = "$FAIL_ON" ] && exit 1\nexit 0\n' % self.log)

    def shim(self, name, body):
        p = os.path.join(self.bin, name)
        Path(p).write_text(body)
        os.chmod(p, stat.S_IRWXU)

    def run_as_root(self, fail_on="", pin=None, extra_args=None, out=None):
        env_file = os.path.join(self.d, "env")
        Path(env_file).write_text("export CT_OUT=%s\n" % (self.out if out is None else out))
        args = extra_args if extra_args is not None else [env_file, "1001:118", self.inputs if pin is None else pin]
        env = {"PATH": self.bin + ":/usr/bin:/bin", "FAIL_ON": fail_on, "HOME": self.d}
        p = subprocess.run(["bash", str(SCRIPT), "run-as-root"] + args, capture_output=True, text=True, env=env)
        calls = Path(self.log).read_text().splitlines() if os.path.exists(self.log) else []
        return p, calls, env_file

    def test_success_takes_both_trees_runs_the_stage_then_returns_them(self):
        p, calls, env_file = self.run_as_root()
        self.assertIn(RUN_STARTED, p.stderr)
        self.assertEqual(calls, ["-R 0:0 %s %s" % (self.out, self.inputs), "-R 1001:118 %s %s" % (self.out, self.inputs)])
        self.assertEqual(p.returncode, 78)                 # the launched stage's own status is propagated unchanged
        self.assertFalse(os.path.exists(env_file))         # the 0600 environment file is consumed

    def test_failed_take_stops_before_the_stage_and_still_tries_to_return(self):
        p, calls, _ = self.run_as_root(fail_on="0:0")
        self.assertEqual(p.returncode, 78)
        self.assertIn("run-owned trees could not be taken for the root run stage; the stage did not run", p.stderr)
        self.assertNotIn(RUN_STARTED, p.stderr)
        self.assertEqual(calls, ["-R 0:0 %s %s" % (self.out, self.inputs), "-R 1001:118 %s %s" % (self.out, self.inputs)])

    def test_failed_return_is_reported_and_fails_the_stage(self):
        p, calls, _ = self.run_as_root(fail_on="1001:118")
        self.assertIn(RUN_STARTED, p.stderr)
        self.assertIn("run outputs could not be returned to the job user", p.stderr)
        self.assertNotEqual(p.returncode, 0)

    def test_absent_private_inputs_are_skipped(self):
        p, calls, _ = self.run_as_root(pin=os.path.join(self.d, "absent"))
        self.assertEqual(calls[0], "-R 0:0 %s" % self.out)

    def test_non_canonical_roots_refuse_before_any_ownership_change(self):
        real = os.path.join(self.d, "real"); os.mkdir(real, 0o700)
        link = os.path.join(self.d, "link"); os.symlink(real, link)
        parent_link = os.path.join(self.d, "plink"); os.symlink(self.d, parent_link)
        bad = {"symlink root": link, "trailing-slash link": link + "/", "symlinked ancestor": os.path.join(parent_link, "out"),
               "relative": "out", "dot-dot": self.d + "/real/../out", "trailing slash": self.out + "/"}
        for name, path in bad.items():
            for which in ("out", "pin"):
                with self.subTest(name=name, which=which):
                    os.path.exists(self.log) and os.remove(self.log)
                    p, calls, _ = self.run_as_root(out=path) if which == "out" else self.run_as_root(pin=path)
                    self.assertEqual((p.returncode, calls), (78, []))
                    self.assertRegex(p.stderr, r"must be a canonical directory with no symlink component")

    def test_term_during_the_privileged_step_returns_ownership_and_exits_143(self):
        env_file = os.path.join(self.d, "env"); Path(env_file).write_text("export CT_OUT=%s\n" % self.out)
        env = {"PATH": self.bin + ":/usr/bin:/bin", "SLOW_ON": "0:0", "HOME": self.d}
        p = subprocess.Popen(["bash", str(SCRIPT), "run-as-root", env_file, "1001:118", self.inputs], env=env,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        deadline = time.time() + 5
        while time.time() < deadline and not (os.path.exists(self.log) and Path(self.log).read_text()):
            time.sleep(0.05)
        p.send_signal(signal.SIGTERM)
        out, err = p.communicate(timeout=20)
        self.assertEqual(p.returncode, 143)
        calls = Path(self.log).read_text().splitlines()
        self.assertEqual(calls[-1], "-R 1001:118 %s %s" % (self.out, self.inputs))
        self.assertNotIn(RUN_STARTED, err)

    def test_internal_entry_refuses_without_root_or_with_wrong_arguments(self):
        os.remove(os.path.join(self.bin, "id"))           # the real uid: not root
        p, calls, _ = self.run_as_root()
        self.assertEqual((p.returncode, calls), (78, []))
        self.assertIn("run-as-root is internal to the elevated run stage", p.stderr)
        self.shim("id", '#!/bin/sh\necho 0\n')
        p, calls, _ = self.run_as_root(extra_args=["only-one"])
        self.assertEqual((p.returncode, calls), (78, []))


class Wiring(unittest.TestCase):
    def test_the_elevation_enters_run_as_root_with_the_job_owner_and_private_inputs(self):
        text = SCRIPT.read_text()
        self.assertIn('exec sudo -n bash "$0" run-as-root "$envfile" "$(id -u):$(id -g)" "$private_inputs"', text)
        self.assertIn('private_inputs="${CT_PRIVATE_INPUT_DIR:-${RUNNER_TEMP:-/nonexistent}/run-inputs}"', text)
        self.assertLess(text.index('if [ "$STAGE" = run-as-root ]; then'), text.index('case "$STAGE" in'))
        block = text[text.index('if [ "$STAGE" = run-as-root ]; then'):text.index('case "$STAGE" in')]
        self.assertNotRegex(block, r"chmod|setfacl|\|\| true|chown -R 0:0 /")

    def test_the_owner_checks_it_satisfies_are_unchanged(self):
        self.assertIn("(process.getuid && st.uid !== process.getuid())", (ROOT / "harness/bundle/harness/identity-core.cjs").read_text())
        self.assertIn("s.uid!==process.getuid()", (ROOT / "harness/bundle/harness/campaign-runner.cjs").read_text())
        self.assertIn("st.uid!==process.getuid()", (ROOT / "harness/bundle/harness/with-authenticated-evidence.cjs").read_text())

    def test_identity_ledger_refusal_is_what_a7_saw(self):
        """The ledger refuses a directory that fails the private-directory check (stderr only, no stdout receipt, exit 2)."""
        with tempfile.TemporaryDirectory() as d:
            ledgers = os.path.join(os.path.realpath(d), "ledgers"); os.mkdir(ledgers, 0o755)
            p = subprocess.run(["node", str(ROOT / "harness/bundle/harness/identity-check.cjs"), "--authorize-identity-read", "true",
                                "--url", "https://example.invalid/", "--expect-sha", "a" * 40, "--ledger", os.path.join(ledgers, "l.json"),
                                "--cap", "1", "--phase", "admission"], capture_output=True, text=True)
            self.assertEqual((p.returncode, p.stdout), (2, ""))
            self.assertRegex(p.stderr, r"private directory required")


if __name__ == "__main__":
    unittest.main()
