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
import sys
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


QUIESCENCE = ROOT / "scripts/run_stage_quiescence.py"


class FakeProc:
    """A synthetic /proc: status (PPid, Uid), NUL-separated cmdline, and the cwd, root, exe and fd symlinks. Readlink returns the target text."""
    def __init__(self, root):
        self.root = root
        os.mkdir(root)

    def add(self, pid, ppid=1, euid=1001, argv=("sleep", "1"), cwd="/", fds=(), unreadable=False):
        d = os.path.join(self.root, str(pid)); os.mkdir(d); os.mkdir(os.path.join(d, "fd"))
        Path(d, "status").write_text("Name:\tx\nPPid:\t%d\nUid:\t%d\t%d\t%d\t%d\n" % (ppid, euid, euid, euid, euid))
        Path(d, "cmdline").write_bytes(b"\0".join(a.encode() for a in argv) + b"\0")
        os.symlink(cwd, os.path.join(d, "cwd")); os.symlink("/", os.path.join(d, "root")); os.symlink("/usr/bin/x", os.path.join(d, "exe"))
        for n, target in enumerate(fds):
            os.symlink(target, os.path.join(d, "fd", str(n)))
        if unreadable:
            os.chmod(os.path.join(d, "fd"), 0)
        return str(pid)


class Quiescence(unittest.TestCase):
    """Sam 1794161531: the recovery may return the trees only after every run-stage process has stopped; anything unreadable counts."""
    def setUp(self):
        self.d = os.path.realpath(tempfile.mkdtemp(prefix="quiescence-"))
        self.addCleanup(subprocess.run, ["chmod", "-R", "u+rwx", self.d])
        self.addCleanup(subprocess.run, ["rm", "-rf", self.d])
        self.tree = os.path.join(self.d, "ct-out")
        self.pin = os.path.join(self.d, "run-inputs")
        self.proc = FakeProc(os.path.join(self.d, "proc"))
        # the recovery chain itself: runner step shell -> sudo -> bash execute_run.sh recover-as-root -> python (self)
        self.proc.add(10, ppid=1, argv=("bash", "-e", "/w/_temp/step.sh"))   # a synthetic runner step-shell path
        self.proc.add(11, ppid=10, euid=0, argv=("sudo", "-n", "bash", "tools/cloud-test/scripts/execute_run.sh", "recover-as-root",
                                                 "1001:118", self.tree, self.pin))
        self.proc.add(12, ppid=11, euid=0, argv=("bash", "tools/cloud-test/scripts/execute_run.sh", "recover-as-root", "1001:118", self.tree,
                                                 self.pin), fds=(self.tree + "/plan/x.json",))
        self.proc.add(13, ppid=12, euid=0, argv=("python3", "-I", str(QUIESCENCE)), cwd=self.tree)
        self.proc.add(2, ppid=0, euid=0, argv=())                  # a kernel thread
        self.proc.add(500, ppid=1, euid=1001, argv=("Runner.Worker",), cwd="/home/runner")

    def check(self, wait=0):
        return subprocess.run([sys.executable, "-I", str(QUIESCENCE), "--tree", self.tree, "--tree", self.pin, "--wait-seconds", str(wait),
                               "--proc-root", self.proc.root, "--self-pid", "13"], capture_output=True, text=True, timeout=30)

    def test_only_the_recovery_chain_and_unrelated_processes_remain_quiescent(self):
        p = self.check()
        self.assertEqual((p.returncode, p.stdout.strip()), (0, "run stage quiescent"))

    def test_every_kind_of_surviving_stage_process_blocks_the_return(self):
        cases = {
            "a detached, re-sessioned browser running as the setpriv uid": dict(euid=65534, argv=("/var/tmp/ss-harness/chrome", "--type=renderer")),
            "an orphaned run-as-root shell after its parent was killed": dict(euid=0, argv=("bash", "tools/cloud-test/scripts/execute_run.sh", "run-as-root")),
            "the stage shell itself": dict(euid=0, argv=("bash", "/w/speaksharp/tools/cloud-test/scripts/execute_run.sh", "run")),
            "a harness process naming a tree path in an argument": dict(euid=0, argv=("node", "campaign-runner.cjs", "--plan=%s/plan/cfg/campaign-plan.json" % self.tree)),
            "a process whose cwd is inside a tree": dict(euid=0, argv=("node",), cwd=self.tree + "/plan"),
            "a process holding a descriptor inside the private inputs": dict(euid=0, argv=("node",), fds=(self.pin + "/live-accounts.json",)),
            "a deleted-but-open file inside a tree": dict(euid=0, argv=("node",), fds=(self.tree + "/log.txt (deleted)",)),
            "a process whose descriptors cannot be read (fail closed)": dict(euid=0, argv=("node",), unreadable=True),
        }
        for label, kw in cases.items():
            with self.subTest(label):
                pid = self.proc.add(900, ppid=1, **kw)
                try:
                    if kw.get("unreadable") and os.geteuid() == 0:
                        self.skipTest("root reads a mode-0 directory")
                    p = self.check()
                    self.assertEqual((p.returncode, p.stderr.strip()), (78, "BLOCKED_SETUP: run-stage-processes-remain"))
                    for leak in ("900", self.tree, self.pin, "campaign-plan", "chrome"):
                        self.assertNotIn(leak, p.stdout + p.stderr)
                finally:
                    subprocess.run(["chmod", "-R", "u+rwx", os.path.join(self.proc.root, pid)])
                    subprocess.run(["rm", "-rf", os.path.join(self.proc.root, pid)])

    def test_a_sibling_path_with_the_same_prefix_is_not_a_tree(self):
        self.proc.add(901, ppid=1, euid=0, argv=("node", self.tree + "-other/x"), cwd=self.tree + "-other", fds=(self.tree + "2/y",))
        self.assertEqual(self.check().returncode, 0)

    def test_the_wait_is_bounded_and_returns_as_soon_as_the_stage_stops(self):
        pid = self.proc.add(902, ppid=1, euid=65534, argv=("chrome",))
        started = time.monotonic()
        p = subprocess.Popen([sys.executable, "-I", str(QUIESCENCE), "--tree", self.tree, "--wait-seconds", "20",
                              "--proc-root", self.proc.root, "--self-pid", "13"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        time.sleep(1.5)
        subprocess.run(["rm", "-rf", os.path.join(self.proc.root, pid)])
        out, _ = p.communicate(timeout=30)
        self.assertEqual((p.returncode, out.strip()), (0, "run stage quiescent"))
        self.assertLess(time.monotonic() - started, 10)
        self.proc.add(902, ppid=1, euid=65534, argv=("chrome",))
        started = time.monotonic()
        p = self.check(wait=2)
        self.assertEqual(p.returncode, 78)
        self.assertLess(time.monotonic() - started, 10)

    def test_arguments_are_closed(self):
        for extra in (["--wait-seconds", "121"], ["--wait-seconds", "-1"]):
            p = subprocess.run([sys.executable, "-I", str(QUIESCENCE), "--tree", self.tree, "--proc-root", self.proc.root] + extra,
                               capture_output=True, text=True)
            self.assertEqual(p.returncode, 78, extra)
        for tree in ("relative", self.tree + "/", self.d + "/x/../ct-out"):
            p = subprocess.run([sys.executable, "-I", str(QUIESCENCE), "--tree", tree, "--wait-seconds", "0", "--proc-root", self.proc.root],
                               capture_output=True, text=True)
            self.assertEqual((p.returncode, p.stderr.strip()), (78, "BLOCKED_SETUP: run-stage-quiescence-arguments"), tree)
        p = subprocess.run([sys.executable, "-I", str(QUIESCENCE), "--tree", self.tree, "--wait-seconds", "0", "--proc-root", self.d + "/none"],
                           capture_output=True, text=True)
        self.assertEqual((p.returncode, p.stderr.strip()), (78, "BLOCKED_SETUP: run-stage-quiescence-proc-unavailable"))

    def test_the_browser_uid_is_the_one_chrome_wrapper_setprivs_to(self):
        self.assertIn("\nRUNAS=65534\n", (ROOT / "harness/bundle/harness/chrome-wrapper.sh").read_text())
        self.assertIn("BROWSER_UID = 65534", QUIESCENCE.read_text())

    @unittest.skipUnless(sys.platform.startswith("linux") and os.path.isdir("/proc/self/fd") and os.geteuid() == 0,
                         "Linux /proc as root (as on the runner): a non-root reader cannot read other users' descriptors, which counts as remaining")
    def test_on_linux_a_real_killed_parent_leaves_an_orphan_that_blocks_until_it_exits(self):
        """Linux/root regression with the real /proc: SIGKILL the parent shell; its orphaned child still holds the tree; the check waits.
        An unused browser uid keeps a host's own `nobody` processes out of this control."""
        os.mkdir(self.tree)
        parent = subprocess.Popen(["bash", "-c", "cd %s && (sleep 4) & wait" % self.tree], start_new_session=True)
        time.sleep(0.5)
        parent.kill(); parent.wait()                       # the trap-less path: the parent is gone, the orphan keeps its cwd in the tree
        started = time.monotonic()
        p = subprocess.run([sys.executable, "-I", str(QUIESCENCE), "--tree", self.tree, "--wait-seconds", "1", "--browser-uid", "4242424"], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)
        p = subprocess.run([sys.executable, "-I", str(QUIESCENCE), "--tree", self.tree, "--wait-seconds", "15", "--browser-uid", "4242424"], capture_output=True, text=True)
        self.assertEqual((p.returncode, p.stdout.strip()), (0, "run stage quiescent"))
        self.assertLess(time.monotonic() - started, 20)


class RecoverAsRoot(unittest.TestCase):
    """The root half of `recover-ownership`, exercised with `id`/`chown`/`python3` shims (the privileged path runs on the runner)."""
    def setUp(self):
        self.d = os.path.realpath(tempfile.mkdtemp(prefix="recover-as-root-"))
        self.addCleanup(subprocess.run, ["rm", "-rf", self.d])
        self.bin = os.path.join(self.d, "bin"); os.mkdir(self.bin)
        self.log = os.path.join(self.d, "calls.log")
        self.out = os.path.join(self.d, "out"); os.mkdir(self.out, 0o700); Path(self.out, "f").write_text("x")
        self.inputs = os.path.join(self.d, "run-inputs"); os.mkdir(self.inputs, 0o700)
        self.shim("id", '#!/bin/sh\n[ "$1" = -u ] && echo 0 && exit 0\n[ "$1" = -g ] && echo 0 && exit 0\nexec /usr/bin/id "$@"\n')
        self.shim("chown", '#!/bin/sh\necho "chown $*" >> "%s"\n[ -n "$CHOWN_FAILS" ] && exit 1\nexit 0\n' % self.log)
        self.shim("python3", '#!/bin/sh\necho "quiescence $*" >> "%s"\n[ -n "$STAGE_ALIVE" ] && exit 78\nexit 0\n' % self.log)

    def shim(self, name, body):
        p = os.path.join(self.bin, name); Path(p).write_text(body); os.chmod(p, stat.S_IRWXU)

    def recover(self, owner="1001:118", out=None, pin=None, **env):
        e = {"PATH": self.bin + ":/usr/bin:/bin", "HOME": self.d, **env}
        p = subprocess.run(["bash", str(SCRIPT), "recover-as-root", owner, self.out if out is None else out, self.inputs if pin is None else pin],
                           capture_output=True, text=True, env=e)
        return p, (Path(self.log).read_text().splitlines() if os.path.exists(self.log) else [])

    def test_a_tree_the_stage_left_root_owned_is_returned_only_after_quiescence(self):
        p, calls = self.recover()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(len(calls), 2)
        self.assertRegex(calls[0], r"^quiescence -I \S*run_stage_quiescence\.py --tree %s --tree %s --wait-seconds 90$" % (self.out, self.inputs))
        self.assertEqual(calls[1], "chown -R 1001:118 %s %s" % (self.out, self.inputs))

    def test_a_surviving_stage_process_blocks_the_return_and_nothing_changes(self):
        p, calls = self.recover(STAGE_ALIVE="1")
        self.assertEqual(p.returncode, 78)
        self.assertIn("run-owned trees not returned: a run-stage process may still write into them", p.stderr)
        self.assertEqual([c for c in calls if c.startswith("chown")], [])

    def test_trees_the_stage_already_returned_are_left_alone(self):
        p, calls = self.recover(owner="%d:%d" % (os.getuid(), os.getgid()))
        self.assertEqual((p.returncode, calls), (0, []))
        self.assertIn("already returned", p.stdout)

    def test_a_failed_return_is_reported(self):
        p, _ = self.recover(CHOWN_FAILS="1")
        self.assertEqual(p.returncode, 78)
        self.assertIn("run outputs could not be returned to the job user", p.stderr)

    def test_closed_arguments_refuse_before_any_inspection(self):
        link = os.path.join(self.d, "link"); os.symlink(self.out, link)
        for label, kw in {"root owner": {"owner": "0:0"}, "named owner": {"owner": "runner:docker"}, "symlinked out": {"out": link},
                          "trailing slash": {"out": self.out + "/"}, "relative pin": {"pin": "run-inputs"}, "symlinked pin": {"pin": link}}.items():
            with self.subTest(label):
                os.path.exists(self.log) and os.remove(self.log)
                p, calls = self.recover(**kw)
                self.assertEqual((p.returncode, calls), (78, []))

    def test_absent_private_inputs_are_skipped(self):
        p, calls = self.recover(pin=os.path.join(self.d, "absent"))
        self.assertEqual(calls[-1], "chown -R 1001:118 %s" % self.out)

    def test_only_root_may_enter_and_the_job_user_entry_needs_an_elevated_stage(self):
        os.remove(os.path.join(self.bin, "id"))
        p, calls = self.recover()
        self.assertEqual((p.returncode, calls), (78, []))
        self.assertIn("recover-as-root is internal", p.stderr)
        p = subprocess.run(["bash", str(SCRIPT), "recover-ownership"], capture_output=True, text=True,
                           env={"PATH": "/usr/bin:/bin", "HOME": self.d, "CT_OUT": self.out})
        self.assertEqual(p.returncode, 78)
        self.assertIn("recover-ownership follows only an elevated run stage", p.stderr)

    def test_the_recovery_never_signals_changes_modes_or_widens_scope(self):
        text = SCRIPT.read_text()
        block = text[text.index('if [ "$STAGE" = recover-as-root ]; then'):text.index('if [ "$STAGE" = run-as-root ]; then')]
        self.assertNotRegex(block, r"chmod|setfacl|kill|pkill|\|\| true|chown -R 0:0")
        self.assertIn('exec sudo -n bash "$0" recover-as-root "$(id -u):$(id -g)" "$CT_OUT" "$private_inputs"', text)
        self.assertNotRegex(QUIESCENCE.read_text(), r"os\.kill|signal\.|subprocess")


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
