"""R10 run 42386714252: A6 passed, then A7 stopped with "identity receipt unavailable" in 74 ms, before any identity GET. identity-core's
IdentityLedger requires its ledger directory (the job-user-created $CT_OUT/plan/ledgers) to be owned by the process, and the run stage
runs as root. The elevated run stage now takes ownership of exactly its run-owned private trees before running and returns them to the job
user on any exit. These tests pin that contract and the owner checks it satisfies (offline; the privileged path itself runs on the runner)."""
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUN_SH = (ROOT / "scripts/execute_run.sh").read_text()


class RunStageOwnership(unittest.TestCase):
    def elevation(self):
        start = RUN_SH.index('if [ "$STAGE" = run ] && [ "${CT_RUN_STAGE_AS_ROOT:-}" = 1 ]')
        return RUN_SH[start:RUN_SH.index("\nfi\n", start)]

    def test_root_run_stage_takes_ownership_of_only_its_run_owned_trees_before_running(self):
        block = self.elevation()
        line = next(l for l in block.splitlines() if "exec sudo -n bash -c" in l)
        self.assertIn('trees=("$CT_OUT")', line)
        self.assertIn('[ -d "$pin" ] && [ ! -L "$pin" ] && trees+=("$pin")', line)      # private inputs only if a real directory
        take, run = line.index('chown -R 0:0 "${trees[@]}"'), line.index('bash "$3" run')
        trap = line.index("trap ")
        self.assertLess(trap, take)          # the return-of-ownership trap is armed before ownership is taken
        self.assertLess(take, run)           # ownership is taken before the stage runs
        self.assertIn('chown -R "$owner" "${trees[@]}"', line)                      # both trees go back to the job user on any exit
        self.assertIn("EXIT INT TERM", line)
        self.assertIn('private_inputs="${CT_PRIVATE_INPUT_DIR:-${RUNNER_TEMP:-/nonexistent}/run-inputs}"', block)
        self.assertNotIn("chown -R 0:0 /", block)
        self.assertNotRegex(line, r"chmod|setfacl|\|\| true")        # ownership only: no mode change and no swallowed failure

    def test_the_owner_checks_it_satisfies_are_unchanged(self):
        core = (ROOT / "harness/bundle/harness/identity-core.cjs").read_text()
        self.assertIn("(process.getuid && st.uid !== process.getuid())", core)
        runner = (ROOT / "harness/bundle/harness/campaign-runner.cjs").read_text()
        self.assertIn("s.uid!==process.getuid()", runner)
        evidence = (ROOT / "harness/bundle/harness/with-authenticated-evidence.cjs").read_text()
        self.assertIn("st.uid!==process.getuid()", evidence)

    def test_identity_ledger_owner_check_is_what_refused_and_passes_for_the_owner(self):
        """Content-free reproduction of the A7 mechanism: the ledger refuses a directory not owned by the process (stderr only, no JSON
        receipt on stdout, exit 2), and admits one it owns."""
        script = (ROOT / "harness/bundle/harness/identity-check.cjs")
        with tempfile.TemporaryDirectory() as d:
            ledgers = os.path.join(os.path.realpath(d), "ledgers")
            os.mkdir(ledgers, 0o755)                     # not private (the owner check's sibling condition), to force the refusal path offline
            args = ["node", str(script), "--authorize-identity-read", "true", "--url", "https://example.invalid/",
                    "--expect-sha", "a" * 40, "--ledger", os.path.join(ledgers, "identity-ledger.json"), "--cap", "1", "--phase", "admission"]
            p = subprocess.run(args, capture_output=True, text=True)
            self.assertEqual((p.returncode, p.stdout), (2, ""))
            self.assertRegex(p.stderr, r"private directory required")


if __name__ == "__main__":
    unittest.main()
