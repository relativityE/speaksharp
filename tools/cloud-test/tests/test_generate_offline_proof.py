"""The in-job proof generator propagates every failure (Sam 1793385574): a truncated or failing suite, an incomplete plan-control run, any
mutation refusal or uncaught control, or a proof that is not PASS means no accepted proof and a failing job. A pre-existing output is refused."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import generate_offline_proof as G  # noqa: E402  (pure until main(); the network guard loads only there)
import offline_proof  # noqa: E402

PLAN = offline_proof.PLAN_CONTROLS
CONTROLS = ["M01-allowlist-removed", "A-duplicates-ignored"]


def tap(*statuses):
    """Complete node TAP for tests T1.. with the given statuses (ok / fail)."""
    lines = ["TAP version 13"]
    for i, st in enumerate(statuses, 1):
        lines.append(("not ok" if st == "fail" else "ok") + " %d - T%d test" % (i, i))
        if st == "fail":
            lines += ["  ---", "  code: 'ERR_ASSERTION'", "  ..."]
    lines += ["1..%d" % len(statuses), "# tests %d" % len(statuses), "# pass %d" % statuses.count("ok"), "# fail %d" % statuses.count("fail"),
              "# cancelled 0", "# skipped 0", "# todo 0"]
    return "\n".join(lines) + "\n"


def good():
    return dict(suites={"packet": (0, tap("ok", "ok")), "proof": (0, tap("ok"))}, plan_run=(0, json.dumps(PLAN)),
                mutations={c: {"fail": 1, "tests": 2} for c in CONTROLS}, refusals=[], expected_controls=CONTROLS,
                proof_run=0, proof={"result": "PASS"}, plan_inventory=PLAN)


def problems(**over):
    args = good()
    args.update(over)
    return G.run_problems(**args)


class Verdict(unittest.TestCase):
    def test_synthetic_case10_projection_is_bound_before_the_request_digest(self):
        import proof_prep_cases
        import case_start_caps
        req = proof_prep_cases.placeholder_request(str(SCRIPTS.parent / "harness"))
        facts = {}
        record = proof_prep_cases.bind_synthetic_case10(req, facts)
        encoded = json.dumps(record, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        row = next(item for item in req["selection"] if item["case"] == "AHT-10")
        self.assertEqual(row["requestBoundSha256"], hashlib.sha256(encoded).hexdigest())
        request_bytes = json.dumps(req).encode()
        approval = {"requestSha256": hashlib.sha256(request_bytes).hexdigest()}
        self.assertEqual(approval["requestSha256"], hashlib.sha256(request_bytes).hexdigest())
        report = case_start_caps.case10_execution_bound(req, facts, proof_prep_cases.DUMMY_ACCOUNT)
        self.assertEqual((report["projectionSha256"], report["allowance"]), (row["requestBoundSha256"], 240))

        facts["case10RequestBound"]["evidenceRef"] = "SYNTHETIC-CHANGED"
        with self.assertRaisesRegex(case_start_caps.InputValidationError, "case10-bound-digest"):
            case_start_caps.case10_execution_bound(req, facts, proof_prep_cases.DUMMY_ACCOUNT)

    def test_synthetic_proof_request_uses_the_real_start_allocation_contract(self):
        import proof_prep_cases
        from case_start_caps import request_caps
        req=proof_prep_cases.placeholder_request(str(SCRIPTS.parent/'harness'))
        mode,caps=request_caps(req,execution=True)
        self.assertEqual(mode,'full');self.assertEqual(sum(caps.values()),42)
        self.assertEqual((caps['AHT-13'],caps['AHT-14']),(3,3))
        self.assertIn('NOT-A-RUN',req['approvedLimits']['approvalRef'])
    def test_a_complete_clean_run_is_accepted(self):
        self.assertEqual(problems(), [])

    def test_a_truncated_packet_tap_with_passing_extras_is_never_accepted(self):
        truncated = tap("ok", "ok").split("1..")[0]  # no plan line, no summary, no not ok
        self.assertTrue(any("packet suite" in p for p in problems(suites={"packet": (0, truncated), "proof": (0, tap("ok"))})))

    def test_a_failing_or_crashed_suite_is_never_accepted(self):
        for packet in ((1, tap("ok", "fail")), (-9, tap("ok", "ok")), (0, ""), (1, tap("ok", "ok"))):
            self.assertTrue(problems(suites={"packet": packet, "proof": (0, tap("ok"))}), packet[0])
        self.assertTrue(problems(suites={"packet": (0, tap("ok")), "proof": (1, tap("fail"))}))

    def test_the_plan_controls_must_complete_with_the_exact_inventory(self):
        for plan_run in ((1, json.dumps(PLAN)), (0, "not json"), (0, ""), (0, json.dumps({k: v for k, v in list(PLAN.items())[1:]})),
                         (0, json.dumps(dict(PLAN, **{"negative: extra": None})))):
            self.assertTrue(any("plan controls" in p for p in problems(plan_run=plan_run)), plan_run)

    def test_any_mutation_refusal_missing_or_uncaught_control_is_never_accepted(self):
        self.assertTrue(problems(refusals=["M01-allowlist-removed: anchor occurs 0 times"]))
        self.assertTrue(any("not run" in p for p in problems(mutations={CONTROLS[0]: {"fail": 1}})))
        for bad in ({"fail": 0}, {"fail": True}, {}, None):
            self.assertTrue(any("not caught" in p for p in problems(mutations=dict(good()["mutations"], **{CONTROLS[1]: bad}))), bad)

    def test_the_proof_itself_must_exit_cleanly_and_pass(self):
        for proof_run, proof in ((1, {"result": "PASS"}), (0, {"result": "FAIL"}), (0, None)):
            self.assertTrue(any("offline proof" in p for p in problems(proof_run=proof_run, proof=proof)), (proof_run, proof))


class Cli(unittest.TestCase):
    def test_the_browser_receipt_is_required_before_any_plan_is_built(self):
        d = Path(tempfile.mkdtemp())
        env = dict(os.environ)
        env.pop("CT_BROWSER_RECEIPT", None)
        r = subprocess.run(
            [sys.executable, "-I", str(SCRIPTS / "generate_offline_proof.py"),
             "--work", str(d / "work"), "--proof-out", str(d / "proof.json"),
             "--chrome", str(d / "untrusted-browser")],
            capture_output=True, text=True, env=env,
        )
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--browser-receipt or CT_BROWSER_RECEIPT is required", r.stderr)
        self.assertFalse((d / "work").exists())
        self.assertFalse((d / "proof.json").exists())

    def test_a_pre_existing_proof_or_work_directory_is_refused_before_anything_runs(self):
        d = Path(tempfile.mkdtemp())
        existing = d / "offline-proof.json"
        existing.write_text('{"result":"PASS"}')
        for args in (["--work", str(d / "new-work"), "--proof-out", str(existing)], ["--work", str(d), "--proof-out", str(d / "new-proof.json")]):
            r = subprocess.run([sys.executable, "-I", str(SCRIPTS / "generate_offline_proof.py"), *args], capture_output=True, text=True)
            self.assertNotEqual(r.returncode, 0, args)
            self.assertIn("already exists", r.stderr, args)
        self.assertEqual(existing.read_text(), '{"result":"PASS"}')


if __name__ == "__main__":
    unittest.main()
