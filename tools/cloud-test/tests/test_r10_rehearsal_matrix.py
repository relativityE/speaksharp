"""R10 next-attempt rehearsal matrix (the reviewer N1).

Production-shaped and OFFLINE: synthetic inputs, no credential, no network. For each failure shape it drives the REAL pieces end to end:
  * the workflow: the actual cloud-test-live.yml job `needs`/`if` and live-step `if` expressions, evaluated per shape with GitHub's implicit
    success and cancellation semantics (which steps run, which settle path exists);
  * execute_run.sh's real run_stage under `env -i` with the failure injected at that stage boundary (the stage trace it writes);
  * the real collector (collect_run_record.py, execute_run.sh's collect arguments), settle_input.py and manual_reservation.settle;
  * the real timing projection (init_run_inputs.run_timing_export) and the next dispatch's evidence recovery (unexecuted_attempt_evidence).
It proves the OFFLINE contract only. Real sign-in, hosted-runner behaviour and the actual fifteen case outcomes remain live uncertainties
and are never marked passed here. Run as a script to print the matrix.

Scope, stated plainly : these are COMPONENT controls. The workflow rows show condition ELIGIBILITY (which steps
and jobs GitHub would schedule), not that collection, upload or settlement actually completed; a real job timeout or runner loss is not
exercised (a killed runner may upload nothing, leaving the reservation held for recovery or an owner disposition). run_stage is driven with
a substituted command, not execute_run.sh's full stage dispatch; the launcher path through build is covered separately by
test_init_run_inputs.ProducerScope.through_execute_run. Failed-checkout table durability is NOT demonstrated (without a checkout no
projection script exists).
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _fixtures import REPO, ROOT  # noqa: E402

sys.path.insert(0, os.path.join(ROOT, "scripts"))
import init_run_inputs as I  # noqa: E402
import manual_reservation as M  # noqa: E402
import settle_input as SI  # noqa: E402
import unexecuted_attempt_evidence as U  # noqa: E402

YML = os.path.join(REPO, ".github", "workflows", "cloud-test-live.yml")
RUN_ID = "42999999999"
HEAD = "a" * 40
RESERVED = {"type": "reserve", "campaignId": "R10-REHEARSAL", "runId": RUN_ID, "attempt": 1,
            "allocation": {"requests": 2032, "identityReads": 32, "starts": 16, "takes": 16, "coachingRequests": 20, "runnerMinutes": 40},
            "provenance": "request-sha256:" + "0" * 64, "atUtc": "2026-11-06T01:19:15Z"}


# ---------------------------------------------------------------- workflow expressions (the actual YAML strings)
def gh_eval(expr, ctx):
    """Evaluate one GitHub `if:` expression of this workflow. Supported exactly: always, cancelled, success, !, &&, ||, ==, !=, string
    and boolean literals, github.*, needs.<job>.result, steps.<id>.outcome. Anything else raises (no silent truthiness)."""
    e = expr.strip()
    if e.startswith("${{") and e.endswith("}}"):
        e = e[3:-2].strip()
    status = re.search(r"\b(always|cancelled|success|failure)\(\)", e) is not None
    e = re.sub(r"needs\.([A-Za-z0-9_-]+)\.result", lambda m: "N(%r)" % m.group(1), e)
    e = re.sub(r"steps\.([A-Za-z0-9_-]+)\.outcome", lambda m: "S(%r)" % m.group(1), e)
    e = re.sub(r"needs\.([A-Za-z0-9_-]+)\.outputs\.[A-Za-z0-9_]+", "''", e)
    e = re.sub(r"github\.([a-z_]+)", lambda m: "G(%r)" % m.group(1), e)
    e = e.replace("!=", " NE ").replace("!", " not ").replace(" NE ", " != ").replace("&&", " and ").replace("||", " or ")
    e = re.sub(r"\btrue\b", "True", re.sub(r"\bfalse\b", "False", e))
    e = e.replace("always()", "True").replace("cancelled()", "CANCELLED").replace("success()", "SUCCESS").replace("failure()", "FAILURE")
    _need = re.fullmatch(r"[\sA-Za-z0-9_()'\"=!./-]*", e)
    assert _need, expr
    ns = {"N": lambda j: ctx["needs"].get(j, "skipped"), "S": lambda s: ctx["steps"].get(s, "skipped"),
          "G": lambda k: ctx["github"][k], "CANCELLED": ctx["cancelled"], "SUCCESS": not ctx["failed"] and not ctx["cancelled"],
          "FAILURE": ctx["failed"], "True": True, "False": False, "__builtins__": {}}
    value = bool(eval(e, ns))  # noqa: S307 - the translated grammar above is closed
    if not status:                                    # GitHub's implicit success when no status function is named
        value = value and not ctx["failed"] and not ctx["cancelled"]
    return value


def workflow():
    import yaml  # noqa: PLC0415 - the cloud-test suites already require it
    with open(YML, encoding="utf-8") as f:
        return yaml.safe_load(f)


# A manual dispatch on protected main: the only ref the privileged jobs admit (Codex Security P2 on 4626f984).
GITHUB = {"event_name": "workflow_dispatch", "ref": "refs/heads/main", "ref_protected": True}


def simulate_live(steps, fail_at=None, cancel_at=None):
    """Step outcomes of the live job when the step named `fail_at` fails (or the job is cancelled at `cancel_at`)."""
    ctx = {"needs": {"record-begin": "success", "journal-reserve": "success"}, "steps": {}, "github": GITHUB, "failed": False, "cancelled": False}
    outcomes = []
    for s in steps:
        name = s.get("name") or s.get("uses")
        cond = s.get("if")
        runs = gh_eval(cond, ctx) if cond else (not ctx["failed"] and not ctx["cancelled"])
        if not runs:
            outcome = "skipped"
        elif name == fail_at:
            outcome, ctx["failed"] = "failure", True
        elif name == cancel_at:
            outcome, ctx["cancelled"] = "cancelled", True
        else:
            outcome = "success"
        if s.get("id"):
            ctx["steps"][s["id"]] = outcome
        outcomes.append((name, outcome))
    result = "cancelled" if ctx["cancelled"] else "failure" if ctx["failed"] else "success"
    return outcomes, result


def downstream_jobs(doc, live_result):
    ctx = {"needs": {"record-begin": "success", "journal-reserve": "success", "live": live_result}, "steps": {}, "github": GITHUB,
           "failed": live_result == "failure", "cancelled": live_result == "cancelled"}
    return {j: gh_eval(doc["jobs"][j]["if"], ctx) for j in ("journal-settle", "record-complete")}


# ---------------------------------------------------------------- execute_run.sh run_stage under env -i
# Synthetic stand-ins for the names a stage may receive (stage_env.py allowlist); never real values.
SYNTHETIC_STAGE_ENV = {"FREE_TEST_EMAIL": "free@example.invalid", "FREE_TEST_PASSWORD": "synthetic", "THROWAWAY_TEST_EMAIL": "throwaway@example.invalid",
                       "THROWAWAY_TEST_PASSWORD": "synthetic", "VITE_SUPABASE_URL": "https://abcdefghijklmnopqrst.supabase.co",
                       "VITE_SUPABASE_ANON_KEY": "synthetic"}


def run_stage(stage, command, out, stage_env=True):
    script = open(os.path.join(ROOT, "scripts", "execute_run.sh"), encoding="utf-8").read()
    fn = re.search(r"(?ms)^run_stage\(\) \{.*?^\}\n", script).group(0)
    request = os.path.join(out, "request.json")
    with open(request, "w", encoding="utf-8") as f:
        json.dump({"selection": [{"case": "AHT-01"}, {"case": "AHT-02"}]}, f)
    harness = ("set -euo pipefail\nROOT=%r\nCFG=%r\nREQ=%r\nROUTE=claude\nHP=%r\nOUT=%r\nss_broker_service_role=''\nss_broker_telemetry_key=''\n"
               "PYENV=(\"PATH=$PATH\" \"HOME=/tmp\")\nblocked() { echo \"BLOCKED_SETUP: $*\" >&2; exit 78; }\n%s\nrun_stage %s %s\n") % (
        ROOT, os.path.join(ROOT, "config", "test-config.v1.json"), request, os.path.join(ROOT, "harness"), out, fn, stage, command)
    env = dict({"PATH": os.environ["PATH"]}, **(SYNTHETIC_STAGE_ENV if stage_env else {}))
    return subprocess.run(["bash", "-c", harness], capture_output=True, text=True, env=env)


# ---------------------------------------------------------------- the collector, settle and recovery chain
def write(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f)


def collect(d, case_results=None):
    request = os.path.join(d, "request.json")
    write(request, {"runId": "R10-REHEARSAL", "purpose": "offline rehearsal", "priority": "journey-smoke", "targetedGaps": ["N1"],
                    "release": {"testedSha": HEAD}, "harness": {"version": "test"},
                    "selection": [{"case": "AHT-01"}, {"case": "AHT-02"}]})
    rsha = hashlib.sha256(open(request, "rb").read()).hexdigest()
    for name, doc in (("gate.json", {"decision": "GO"}), ("workflow.json", {"version": "test"}), ("runner.json", {})):
        write(os.path.join(d, name), doc)
    ledgers = os.path.join(d, "ledgers")
    write(os.path.join(ledgers, "campaign-ledger.json"), {"used": {"total": 7}})
    write(os.path.join(ledgers, "identity-ledger.json"), {"identityGets": 2})
    results = os.path.join(d, "plan", "run", "case-results.json")
    if case_results is not None:
        write(results, case_results(rsha))
    cmd = [sys.executable, "-I", os.path.join(ROOT, "scripts", "collect_run_record.py"), "--request", request, "--request-sha256", rsha,
           "--execution-run-id", RUN_ID, "--attempt", "1", "--case-results", results, "--cases-dir", os.path.join(d, "plan", "run", "cases"),
           "--ledger-dir", ledgers, "--gate-status", os.path.join(d, "gate.json"), "--workflow", os.path.join(d, "workflow.json"),
           "--runner-json", os.path.join(d, "runner.json"), "--started-utc", "2026-11-06T01:30:00Z", "--ended-utc", "2026-11-06T01:40:00Z",
           "--out", os.path.join(d, "run-record.json")]
    r = subprocess.run(cmd, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    raw = open(os.path.join(d, "run-record.json"), "rb").read()
    reserved = dict(RESERVED, provenance="request-sha256:" + rsha)
    usage, digest = M.usage_from_record(raw, reserved)
    event = M.settle(reserved, usage, digest, "2026-11-06T01:40:00Z")
    return json.loads(raw), SI.validate(SI.project(raw))["spend"], event["allocation"]


def first_case_fails(rsha):
    receipt = {"schema": "speaksharp.cloud-test.case-execution-receipt.v1", "campaignId": "R10-REHEARSAL", "runId": RUN_ID, "attempt": 1,
               "caseId": "AHT-01", "requestSha256": rsha, "planSha256": "1" * 64, "configSha256": "2" * 64, "sourceSha": HEAD,
               "servedSha": HEAD, "runtimeStartReceiptSha256": "3" * 64, "caseResultSha256": "4" * 64, "summarySha256": "5" * 64}
    return {"campaignId": "R10-REHEARSAL", "sourceSha": HEAD, "servedSha": HEAD, "result": "FAIL",
            "cases": [{"caseId": "AHT-01", "result": "FAIL", "assertions": [{"id": "a", "result": "FAIL"}], "executionReceipt": receipt},
                      {"caseId": "AHT-02", "result": "NOT RUN", "assertions": []}]}


def recovery(doc, outcomes, live_result):
    """The next dispatch's evidence recovery for this shape, from the actual workflow text's credential and consequential steps."""
    text = open(YML, encoding="utf-8").read()
    live_name = doc["jobs"]["live"]["name"]
    base = {"run_id": int(RUN_ID), "run_attempt": 1, "head_sha": HEAD, "status": "completed", "started_at": "2026-11-06T01:19:00Z",
            "completed_at": "2026-11-06T01:30:00Z"}
    jobs = [dict(base, name=doc["jobs"]["record-begin"]["name"], conclusion="success"),
            dict(base, name=doc["jobs"]["nightly-gate"]["name"], conclusion="skipped"),
            dict(base, name=doc["jobs"]["journal-reserve"]["name"], conclusion="success"),
            dict(base, name=live_name, conclusion=live_result,
                 steps=[{"number": n + 1, "name": name, "status": "completed", "conclusion": outcome} for n, (name, outcome) in enumerate(outcomes)]),
            dict(base, name=doc["jobs"]["journal-settle"]["name"], conclusion="success"),
            dict(base, name=doc["jobs"]["record-complete"]["name"], conclusion="success")]
    run = {"id": int(RUN_ID), "run_attempt": 1, "head_sha": HEAD, "status": "completed", "conclusion": "failure",
           "run_started_at": "2026-11-06T01:18:48Z", "updated_at": "2026-11-06T01:31:00Z"}
    chain = [("1" * 40, []), ("2" * 40, [dict(RESERVED)])]
    try:
        ev = U.build_evidence(run, {"jobs": jobs}, chain, text)
        return "accepted: %s %s" % (ev["accounting"], {k: ev["usage"][k] for k in ("requests", "identityReads", "starts", "takes")})
    except U.Refused as err:
        return "refused: %s (reservation stays held and counted)" % err


class RehearsalMatrix(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = workflow()
        cls.steps = cls.doc["jobs"]["live"]["steps"]
        cls.names = [s.get("name") or s.get("uses") for s in cls.steps]

    def setUp(self):
        self.d = os.path.realpath(tempfile.mkdtemp(prefix="r10-rehearsal-"))
        self.addCleanup(shutil.rmtree, self.d)

    def step(self, prefix):
        return next(n for n in self.names if n and n.startswith(prefix))

    def test_workflow_shapes_follow_the_actual_yaml_conditions(self):
        preflight, init = self.step("Prove the selected accounts"), self.step("Select the committed request")
        setup, run = self.step("Stage runner (install-tools"), self.step("Stage runner (run)")
        collect_step, timing = self.step("Collect, verify"), self.step("Project content-free per-case timing")
        for fail, expect_collect in ((preflight, "skipped"), (init, "skipped"), (setup, "skipped"), (run, "success")):
            outcomes, result = simulate_live(self.steps, fail_at=fail)
            o = dict(outcomes)
            self.assertEqual(result, "failure", fail)
            self.assertEqual(o[collect_step], expect_collect, fail)                # collect only once the run step started
            self.assertEqual(o[timing], "success", fail)                          # the table is always projected
            self.assertEqual(downstream_jobs(self.doc, result), {"journal-settle": True, "record-complete": True})
        outcomes, result = simulate_live(self.steps, cancel_at=run)              # cancellation or job timeout during the run
        o = dict(outcomes)
        self.assertEqual((result, o[collect_step], o[timing]), ("cancelled", "success", "success"))
        self.assertEqual(downstream_jobs(self.doc, result), {"journal-settle": True, "record-complete": True})
        # reserve order: the live job needs the reserve, and nothing credentialed runs without it
        self.assertEqual(self.doc["jobs"]["live"]["needs"], ["record-begin", "journal-reserve"])
        ctx = {"needs": {"record-begin": "success", "journal-reserve": "failure"}, "steps": {}, "github": GITHUB, "failed": False, "cancelled": False}
        self.assertFalse(gh_eval(self.doc["jobs"]["live"]["if"], ctx))

    def test_stage_boundaries_leave_a_trace_and_never_a_started_marker(self):
        for stage in ("install-tools", "build-plan", "stimulus-preflight", "gate-and-validate"):
            out = os.path.join(self.d, stage); os.makedirs(out)
            r = run_stage(stage, "sh -c 'exit 78'", out)
            self.assertEqual(r.returncode, 78, (stage, r.stderr))
            rows = I.stage_trace_rows(os.path.join(out, "stage-trace.tsv"))
            self.assertEqual([(x["stage"], x["exitCode"]) for x in rows], [(stage, 78)])
            self.assertFalse(os.path.exists(os.path.join(out, "started.txt")))
            table = I.run_timing_export(out, None, ["AHT-01", "AHT-02"], os.path.join(out, "started.txt"), os.path.join(out, "stage-trace.tsv"),
                                        {"runId": RUN_ID, "runAttempt": "1", "headSha": HEAD, "workflowStartUtc": None})
            self.assertEqual((table["outcome"], table["stoppedAtStage"]), ("not-started", stage))
        # the stated trace scope: a refusal BEFORE the wrapped command (here the stage-environment check) leaves no row
        out = os.path.join(self.d, "pre-command"); os.makedirs(out)
        r = run_stage("build-plan", "sh -c 'exit 0'", out, stage_env=False)
        self.assertEqual(r.returncode, 78)
        self.assertIn("BLOCKED_SETUP: stage build-plan needs VITE_SUPABASE_ANON_KEY", r.stderr)
        self.assertEqual(I.stage_trace_rows(os.path.join(out, "stage-trace.tsv")), [])

    def test_case_runner_killed_before_first_save_is_incomplete_held_at_the_caps(self):
        out = os.path.join(self.d, "out"); os.makedirs(out)
        with open(os.path.join(out, "started.txt"), "w") as f:
            f.write("2026-11-06T01:30:00Z\n")                                     # execute_run.sh writes this before admission
        r = run_stage("run", "sh -c 'kill -9 $$'", out)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(I.stage_trace_rows(os.path.join(out, "stage-trace.tsv"))[0]["stage"], "run")
        rec, spend, settled = collect(self.d)
        self.assertEqual((rec["result"], rec["incompleteReason"]), ("INCOMPLETE", "case-results-missing"))
        self.assertEqual(spend, {"requests": None, "identityReads": None, "starts": None, "takes": None})
        self.assertEqual(settled, RESERVED["allocation"])
        table = I.run_timing_export(out, None, ["AHT-01", "AHT-02"], os.path.join(out, "started.txt"), None,
                                    {"runId": RUN_ID, "runAttempt": "1", "headSha": HEAD, "workflowStartUtc": "2026-11-06T01:18:48Z"})
        self.assertEqual({c["result"] for c in table["cases"] if c["caseId"] in ("AHT-01", "AHT-02")}, {"UNKNOWN"})

    def test_a_first_case_failure_is_a_measured_record_not_incomplete(self):
        rec, spend, settled = collect(self.d, first_case_fails)
        self.assertEqual((rec["result"], [c["result"] for c in rec["cases"]]), ("FAIL", ["FAIL", "NOT RUN"]))
        self.assertEqual((spend["requests"], spend["identityReads"]), (7, 2))     # the guard ledgers' measured counts
        self.assertEqual(settled["requests"], 9)                                  # requests + identity reads, as manual settle charges them

    def test_next_dispatch_recovery_per_shape(self):
        preflight, init = self.step("Prove the selected accounts"), self.step("Select the committed request")
        setup, run = self.step("Stage runner (install-tools"), self.step("Stage runner (run)")
        expected = {preflight: "accepted: preflight-bound", init: "accepted: capped", setup: "accepted: capped", run: "accepted: capped"}
        for fail, want in expected.items():
            outcomes, result = simulate_live(self.steps, fail_at=fail)
            self.assertTrue(recovery(self.doc, outcomes, result).startswith(want), (fail, recovery(self.doc, outcomes, result)))
        # a cancelled or timed-out run is settled in-run when its settle input exists (collect and journal-settle run on cancellation,
        # test_workflow_shapes_follow_the_actual_yaml_conditions); when it does not, the reservation stayed open and recovery refused it,
        # blocking every later dispatch . Next-dispatch recovery now settles it at the FULL held caps, never as no-usage; an
        # in-run settle leaves no open reserve, so the two never both apply.
        outcomes, result = simulate_live(self.steps, cancel_at=run)
        got = recovery(self.doc, outcomes, result)
        self.assertTrue(got.startswith("accepted: terminated-capped"), got)
        self.assertIn("'starts': 16, 'takes': 16", got)


def matrix():
    """The exact-head evidence matrix (printed for the review packet)."""
    t = RehearsalMatrix(); RehearsalMatrix.setUpClass()
    rows = []
    for label, kw in (("preflight fails", {"fail_at": t.step("Prove the selected accounts")}),
                      ("input binding fails", {"fail_at": t.step("Select the committed request")}),
                      ("stage-runner setup fails", {"fail_at": t.step("Stage runner (install-tools")}),
                      ("case runner killed before first save / first case fails", {"fail_at": t.step("Stage runner (run)")}),
                      ("cancelled or job timeout during the run", {"cancel_at": t.step("Stage runner (run)")})):
        outcomes, result = simulate_live(t.steps, **kw)
        o = dict(outcomes)
        rows.append((label, result, o[t.step("Collect, verify")], o[t.step("Project content-free per-case timing")],
                     downstream_jobs(t.doc, result)["journal-settle"], recovery(t.doc, outcomes, result)))
    print("| Shape | live job | collect eligible | timing step eligible | journal-settle eligible | next-dispatch recovery if nothing settled in-run |")
    print("|---|---|---|---|---|---|")
    for r in rows:
        print("| %s | %s | %s | %s | %s | %s |" % r)


if __name__ == "__main__":
    matrix()
