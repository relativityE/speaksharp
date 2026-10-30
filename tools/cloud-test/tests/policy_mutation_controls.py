#!/usr/bin/env python3
"""Negative controls for the workflow-policy tests: each mutation of cloud-test.yml must make test_workflow_policy.py fail.
Usage (from tools/cloud-test): python3 tests/policy_mutation_controls.py --out policy-mutation-controls.json   Exit 0 only if every mutation is caught."""
import argparse
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
YML = os.path.join(ROOT, "..", "..", ".github", "workflows", "cloud-test.yml")
M = {
    "schedule-trigger": lambda s: s.replace("on:\n  workflow_dispatch:", "on:\n  schedule:\n    - cron: '0 3 * * *'\n  workflow_dispatch:", 1),
    "pull-request-trigger": lambda s: s.replace("on:\n  workflow_dispatch:", "on:\n  pull_request:\n  workflow_dispatch:", 1),
    "execute-mode-added": lambda s: s.replace("          - report\n", "          - report\n          - execute\n", 1),
    "default-mode-report": lambda s: s.replace("default: preflight", "default: report", 1),
    "write-permission": lambda s: s.replace("permissions:\n  contents: read", "permissions:\n  contents: write", 1),
    "job-level-permission": lambda s: s.replace("    timeout-minutes: 30\n", "    timeout-minutes: 30\n    permissions:\n      id-token: write\n", 1),
    "environment-added": lambda s: s.replace("    timeout-minutes: 30\n", "    timeout-minutes: 30\n    environment: cloud-test-production\n", 1),
    "secret-added": lambda s: s.replace("          MODE: ${{ inputs.mode }}\n          LATEST_LABEL: ${{ inputs.latest_label }}\n        run: |\n          set -euo", "          MODE: ${{ inputs.mode }}\n          LATEST_LABEL: ${{ inputs.latest_label }}\n          K: ${{ secrets.THROWAWAY_TEST_PASSWORD }}\n        run: |\n          set -euo", 1),
    "service-role-secret-added": lambda s: s.replace("        env:\n          CT_REQUIRE_INTEGRATION: '1'\n", "        env:\n          CT_REQUIRE_INTEGRATION: '1'\n          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}\n", 1),
    "variable-added": lambda s: s.replace("          CT_REQUIRE_INTEGRATION: '1'\n", "          CT_REQUIRE_INTEGRATION: '1'\n          E: ${{ vars.FREE_TEST_EMAIL }}\n", 1),
    "input-in-run": lambda s: s.replace('python3 -I scripts/pipeline.py "${ARGS[@]}"', 'echo "${{ inputs.run_request }}"; python3 -I scripts/pipeline.py "${ARGS[@]}"', 1),
    "upload-not-always": lambda s: s.replace("        if: always()\n        uses: actions/upload-artifact@v6", "        uses: actions/upload-artifact@v6", 1),
    "upload-private-dir": lambda s: s.replace("            ${{ runner.temp }}/timings/**", "            ${{ runner.temp }}/timings/**\n            ${{ runner.temp }}/private/cfg/**", 1),
    "third-party-action": lambda s: s.replace("      - uses: actions/setup-node@v6", "      - uses: someone/else-action@v1\n      - uses: actions/setup-node@v6", 1),
    "unpinned-pip": lambda s: s.replace("pyyaml==6.0.2", "pyyaml", 1),
    "persist-credentials": lambda s: s.replace("persist-credentials: false", "persist-credentials: true", 1),
    "shallow-checkout": lambda s: s.replace("fetch-depth: 0", "fetch-depth: 1", 1),
    "timeout-removed": lambda s: s.replace("    timeout-minutes: 30\n", "", 1),
    "secret-free-flag-removed": lambda s: s.replace(" --require-secret-free)", ")", 1),
    "attestation-step-removed": lambda s: s.replace("- name: Assert the attestation", "- name: Print the attestation", 1),
    "install-failure-ignored": lambda s: s.replace('npm --prefix tools/cloud-test/runner ci --ignore-scripts --no-audit --no-fund', 'npm --prefix tools/cloud-test/runner ci --ignore-scripts --no-audit --no-fund || true', 1),
    "continue-on-error": lambda s: s.replace("      - name: Verify the vendored reviewed harness against the approved hashes\n", "      - name: Verify the vendored reviewed harness against the approved hashes\n        continue-on-error: true\n", 1),
    "integration-not-required": lambda s: s.replace("          CT_REQUIRE_INTEGRATION: '1'\n", "          CT_REQUIRE_INTEGRATION: '0'\n", 1),
    "shell-tracing": lambda s: s.replace("          set -euo pipefail\n          ARGS=", "          set -euxo pipefail\n          ARGS=", 1),
    "model-evaluation-touched": lambda s: s.replace("      - name: Record job end", "      - name: Dispatch\n        run: gh workflow run private-model-smoke.yml\n      - name: Record job end", 1),
}


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--out", required=True)
    x = a.parse_args()
    src = open(YML, encoding="utf-8").read()
    res = {}
    for n, f in M.items():
        m = f(src)
        if m == src:
            res[n] = "MUTATION-NOT-APPLIED"
            continue
        with tempfile.NamedTemporaryFile("w", suffix=".yml", delete=False) as t:
            t.write(m)
        r = subprocess.run([sys.executable, "-I", "-W", "ignore::ResourceWarning", "-m", "unittest", "discover", "-s", os.path.join(ROOT, "tests"), "-p", "test_workflow_policy.py"], capture_output=True, text=True,
                           env={**os.environ, "CLOUD_TEST_YML": t.name}, cwd=ROOT)
        os.unlink(t.name)
        res[n] = "caught" if r.returncode != 0 else "MISSED"
    with open(x.out, "w", encoding="utf-8") as f:
        json.dump({"schema": "speaksharp.cloud-test.policy-mutation-controls.v2", "results": res, "allCaught": all(v == "caught" for v in res.values())}, f, indent=1)
    for n, v in res.items():
        print(v.upper().ljust(8), n)
    sys.exit(0 if all(v == "caught" for v in res.values()) else 1)


if __name__ == "__main__":
    main()
