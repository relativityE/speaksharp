#!/usr/bin/env python3
"""J4.a local smoke: one lost save, one Retry, exactly one saved take, writer stopped, run-owned cleanup verified.

Offline only. Applies the reviewed J4.a candidate packet in a disposable copy (the same isolated_candidate the nightly suite
uses), then runs the J4.a save-retry smoke through the real runner and the parent save witness's own tests there. No network,
account, Stripe or production; the active packet in this checkout is unchanged.

    python3 tools/cloud-test/scripts/j4a_local_smoke.py
"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from test_nightly_suite import NightlySuite  # noqa: E402

SMOKE = ROOT / "tests" / "fixtures" / "nightly" / "j4a-save-retry.test.cjs.fixture"
WITNESS_TESTS = "j4a-save-witness.test.cjs"


def main():
    with NightlySuite().isolated_candidate() as (nightly, env):
        target = nightly / "tests" / "j4a-save-retry.test.cjs"
        if target.exists() or SMOKE.is_symlink():
            print("BLOCKED_SETUP: the smoke source is aliased or already present in the candidate copy")
            return 78
        shutil.copyfile(SMOKE, target)
        result = subprocess.run(["node", "--test", "--test-reporter=spec", str(target), str(nightly / "tests" / WITNESS_TESTS)],
                                cwd=nightly, env=env, timeout=600)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
