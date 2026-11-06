"""The GitHub nightly regression's one immutable request per scheduled occurrence (Sam 1793553158.013909, RETURN 1793553793.785919), offline
only. Every approval, template and budget here is SYNTHETIC test data supplied through test-only overrides; the production anchors stay unset and
the committed recurring-approval.json stays NOT APPROVED, so production derivation refuses."""
import copy
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from _fixtures import REPO, ROOT
import nightly_request as N
import case_start_caps as C
import check_gates as G
import state_ref_writer as W
from _common import parse_utc
from _fixtures import fake_rv, receipt, reconciliation, sample
from _gate_fixtures import GateInputs

SLOT = datetime(2026, 11, 2, 3, 0, tzinfo=timezone.utc)
SHA = "4" * 40
with open(os.path.join(ROOT, "config", "test-config.v1.json"), encoding="utf-8") as _f:
    CFG = json.load(_f)
with open(os.path.join(ROOT, "tests", "fixtures", "nightly-template.synthetic.json"), "rb") as _f:
    TEMPLATE = _f.read()
TEMPLATE_PIN = hashlib.sha256(TEMPLATE).hexdigest()
with open(os.path.join(REPO, ".github", "workflows", "cloud-test-live.yml"), encoding="utf-8") as _f:
    WF = _f.read()
OCCURRENCE = "nightly-20261101T0000Z-20261102T0300Z"


def approval(**over):
    """Synthetic standing approval within the package's full-mode limits (6000 requests, 32 identity reads, 330 minutes, 360 runner minutes)."""
    ap = {"schema": "speaksharp.cloud-test.recurring-approval.v1", "status": "APPROVED", "approvedBy": "owner", "approvalRef": "slack:1793553158.013909",
          "approvedAtUtc": "2026-10-31T12:00:00Z", "validFromUtc": "2026-10-31T12:00:00Z", "expiresUtc": "2026-12-15T00:00:00Z",
          "periodStartUtc": "2026-11-01T00:00:00Z", "cadence": {"runsPerPeriod": 30, "period": "30 days"},
          "perRunCaps": {"runCapRequests": 4400, "identityReads": 32, "starts": 42, "takes": 40, "coachingRequests": 15, "windowMinutes": 330,
                         "githubRunnerMinutes": 360, "paidActionsUsd": 0},
          "periodCaps": {"requests": 132000, "identityReads": 960, "starts": 1260, "takes": 1200, "coachingRequests": 450, "githubRunnerMinutes": 10800}}
    for k, v in over.items():
        ap[k] = dict(ap[k], **v) if isinstance(v, dict) and isinstance(ap.get(k), dict) else v
    return json.dumps(ap, sort_keys=True).encode()


def budget(**over):
    starts = dict(C.FULL_MINIMA)
    b = {"requests": {"runCap": 4310, "plannedSumOfEstimates": 3610, "cleanupReserve": 150, "pooledSlack": 550}, "identity": {"readsThisRun": 32}, "actions": {"startsMinimum": sum(starts.values()), "takesMinimum": 30},
         "coaching": {"cap": 15, "basis": "SYNTHETIC reviewed coaching allowance"}, "window": {"proposedWindowMinutes": 329},
         "perCase": [{"case": cid, "startsMin": starts[cid]} for cid in C.CASE_IDS]}
    for k, v in over.items():
        b[k] = dict(b[k], **v)
    return json.dumps(b, sort_keys=True).encode()


def derive(ap=None, bud=None, slot=SLOT, run_id="101", sha=SHA, prior=frozenset(), tpl=TEMPLATE, tpl_pin=TEMPLATE_PIN, bud_pin=None, wf=WF):
    ap, bud = ap or approval(), bud or budget()
    return N.derive(tpl, ap, bud, slot, run_id, sha, prior, CFG, wf, template_pin=tpl_pin, budget_pin=bud_pin or hashlib.sha256(bud).hexdigest())


def refused(test, code, fn, *a, **k):
    with test.assertRaises(N.Refused) as e:
        fn(*a, **k)
    test.assertEqual(str(e.exception), code)


class Approval(unittest.TestCase):
    def test_complete_authority_admits(self):
        self.assertEqual(N.check_approval(approval(), SLOT, CFG)["status"], "APPROVED")

    def test_typed_complete_chronological_in_limit_and_valid(self):
        with open(N.APPROVAL_PATH, "rb") as f:
            refused(self, "recurring-approval-not-approved", N.check_approval, f.read(), SLOT, CFG)
        for raw, code in ((b"{", "recurring-approval-unreadable"), (approval(schema="x"), "recurring-approval-unreadable"),
                          (approval(status="NOT APPROVED"), "recurring-approval-not-approved"),
                          (approval(approvalRef=None), "recurring-approval-incomplete"),
                          (approval(perRunCaps={"takes": True}), "recurring-approval-incomplete"),
                          (approval(perRunCaps={"windowMinutes": 330.0}), "recurring-approval-incomplete"),
                          (approval(periodCaps={"requests": None}), "recurring-approval-incomplete"),
                          (approval(periodCaps={"coachingRequests": "450"}), "recurring-approval-incomplete"),
                          (approval(cadence={"runsPerPeriod": 0}), "recurring-approval-incomplete"),
                          (approval(perRunCaps={"paidActionsUsd": 1}), "recurring-approval-paid-actions"),
                          (approval(approvedAtUtc="2026-11-01T00:00:01Z"), "recurring-approval-chronology"),
                          (approval(validFromUtc="2026-11-01T00:00:01Z"), "recurring-approval-chronology"),
                          (approval(expiresUtc="2026-11-30T23:59:59Z"), "recurring-approval-chronology"),
                          (approval(cadence={"period": "monthly"}), "recurring-approval-period"),
                          (approval(perRunCaps={"runCapRequests": 6001}), "recurring-approval-exceeds-package-limits"),
                          (approval(perRunCaps={"identityReads": 126}), "recurring-approval-exceeds-package-limits"),
                          (approval(perRunCaps={"windowMinutes": 361}), "recurring-approval-exceeds-package-limits"),
                          (approval(periodCaps={"coachingRequests": 14}), "recurring-approval-run-exceeds-period")):
            with self.subTest(code=code):
                refused(self, code, N.check_approval, raw, SLOT, CFG)
        N.check_approval(approval(validFromUtc="2026-11-01T00:00:00Z", approvedAtUtc="2026-11-01T00:00:00Z"), SLOT, CFG)
        refused(self, "recurring-approval-not-yet-valid", N.check_approval, approval(), datetime(2026, 10, 31, 11, tzinfo=timezone.utc), CFG)
        refused(self, "recurring-approval-expired", N.check_approval, approval(), datetime(2026, 12, 15, tzinfo=timezone.utc), CFG)


class Gate(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.d)
        self.path = os.path.join(self.d, "approval.json")
        with open(self.path, "wb") as f:
            f.write(approval())

    def gate(self, switch="true", attempt="1", path=None, trigger=SLOT, activated=True):
        return N.gate(switch, attempt, path or self.path, "0 3 * * *", trigger, SLOT, CFG, activated=activated)

    def test_admits_and_binds_the_trigger_slot(self):
        self.assertEqual(self.gate(trigger=SLOT + timedelta(minutes=29))[1], SLOT)

    def test_the_switch_is_decided_before_any_file_is_read(self):
        for switch in ("", "TRUE", "1", " true", None):
            refused(self, "nightly-switch-off", self.gate, switch, "2", os.path.join(self.d, "missing.json"), activated=False)

    def test_attempt_writer_approval_and_trigger_guards(self):
        refused(self, "nightly-attempt", self.gate, attempt="2")
        refused(self, "state-writer-not-activated", self.gate, activated=False)
        self.assertEqual(N.state_ref_writer.REVIEWED_ROOT, "92d6ebf902351750c368d7d513116c6b1f19f80c")
        self.assertEqual(self.gate(activated=None)[1], SLOT)
        refused(self, "recurring-approval-unreadable", self.gate, path=os.path.join(self.d, "missing.json"))
        refused(self, "nightly-trigger-ambiguous", self.gate, trigger=SLOT + timedelta(minutes=31))
        refused(self, "nightly-trigger-ambiguous", self.gate, trigger=SLOT - timedelta(minutes=1))  # yesterday's slot, 23h59m before

    def test_the_slot_comes_from_the_original_trigger_so_a_late_job_is_never_relabelled(self):
        self.assertEqual(N.occurrence_slot("0 3 * * *", SLOT + timedelta(minutes=5)), SLOT)
        for cron in ("*/5 * * * *", "0 3 * * 1", "0 24 * * *", "", None):
            refused(self, "nightly-schedule-unsupported", N.occurrence_slot, cron, SLOT)

    def test_the_actual_cli_is_quiet_when_off_even_without_an_approval_and_visible_otherwise(self):
        script = os.path.join(ROOT, "scripts", "nightly_request.py")

        def run(*args):
            out = os.path.join(self.d, "out-%d" % len(os.listdir(self.d)))
            p = subprocess.run([sys.executable, "-I", script, "gate", *args, "--outputs", out], capture_output=True, text=True, timeout=60)
            with open(out, encoding="utf-8") as f:
                return p.returncode, dict(line.split("=", 1) for line in f.read().splitlines()), p.stderr
        self.assertEqual(run("--switch", "", "--attempt", "1")[:2], (0, {"admitted": "false", "code": "nightly-switch-off", "request_sha256": "", "request_b64": ""}))
        self.assertEqual(run("--switch", "false")[:2], (0, {"admitted": "false", "code": "nightly-switch-off", "request_sha256": "", "request_b64": ""}))
        code, out, err = run("--switch", "true", "--attempt", "2", "--cron", "0 3 * * *", "--trigger-utc", "2026-11-02T03:01:00Z")
        self.assertEqual((code, out["code"], err.strip()), (78, "nightly-attempt", "BLOCKED_SETUP: nightly-attempt"))
        self.assertEqual(run("--switch", "true", "--attempt", "1", "--cron", "0 3 * * *", "--trigger-utc", "2026-11-02T03:01:00Z")[:2],
                         (78, {"admitted": "false", "code": "recurring-approval-not-approved", "request_sha256": "", "request_b64": ""}))

    def test_an_admitted_gate_outputs_exactly_the_admitted_bytes_beside_their_digest(self):
        import base64
        from unittest import mock
        raw = derive()
        out = os.path.join(self.d, "admitted-outputs")
        with mock.patch.object(N, "admit", return_value=(OCCURRENCE, hashlib.sha256(raw).hexdigest(), raw)):
            self.assertEqual(N.main(["nightly_request.py", "gate", "--switch", "true", "--attempt", "1", "--cron", "0 3 * * *",
                                     "--trigger-utc", "2026-11-02T03:01:00Z", "--run-id", "101", "--tested-sha", SHA, "--outputs", out]), 0)
        with open(out, encoding="utf-8") as f:
            got = dict(line.split("=", 1) for line in f.read().splitlines())
        self.assertEqual((got["admitted"], got["code"], got["request_sha256"]), ("true", "admitted", hashlib.sha256(raw).hexdigest()))
        self.assertEqual(base64.b64decode(got["request_b64"], validate=True), raw)


class Derivation(unittest.TestCase):
    def test_the_production_anchors_are_unset_so_production_derivation_refuses(self):
        self.assertEqual((N.TEMPLATE_SHA256, N.BUDGET_SHA256), (None, None))
        self.assertEqual((N.TEMPLATE_PATH, N.BUDGET_PATH), (None, None))
        refused(self, "nightly-template-not-received", N.derive, TEMPLATE, approval(), budget(), SLOT, "101", SHA, frozenset(), CFG, WF)
        refused(self, "nightly-budget-not-accepted", N.derive, TEMPLATE, approval(), budget(), SLOT, "101", SHA, frozenset(), CFG, WF,
                template_pin=TEMPLATE_PIN)

    def test_deterministic_canonical_and_bound_to_every_input(self):
        raw = derive()
        self.assertEqual(raw, derive())
        self.assertTrue(raw.endswith(b"}\n") and not raw.endswith(b"\n\n"))
        req = json.loads(raw)
        self.assertEqual((req["runId"], req["window"]["startUtc"], req["window"]["endUtc"], req["synthetic"]),
                         (OCCURRENCE, "2026-11-02T03:00:00Z", "2026-11-02T08:30:00Z", False))
        self.assertEqual(req["estimate"]["requests"]["runCap"], 4310)
        self.assertEqual(req["proposedLimits"]["runCapRequests"], 4310)
        self.assertEqual(req["approvedLimits"]["runCapRequests"], 4310,
                         "the standing 4400 ceiling does not reserve 90 unused requests")
        self.assertEqual(req["estimate"]["providerBillableRequests"],
                         {"coachingCap": 15, "basis": "SYNTHETIC reviewed coaching allowance"})
        self.assertEqual((req["estimate"]["identityReads"], req["estimate"]["starts"], req["estimate"]["takes"],
                          req["estimate"]["paidActionsAuthorizedUsd"], req["estimate"]["githubRunnerMinutesMax"]), (32, 42, 30, 0, 359))
        self.assertEqual(req["approvedLimits"]["startPressCaps"], dict(C.FULL_MINIMA))
        self.assertEqual(req["proposedLimits"]["startPressCaps"], dict(C.FULL_MINIMA))
        self.assertEqual(req["proposedLimits"]["guardCaps"]["coaching"], 15)
        self.assertEqual({row["case"]: row["startPressCap"] for row in req["selection"]}, dict(C.FULL_MINIMA))
        self.assertEqual(C.request_caps(req, execution=True), ("full", dict(C.FULL_MINIMA)))
        self.assertEqual((req["nightly"]["occurrenceId"], req["nightly"]["budgetSha256"]), (OCCURRENCE, hashlib.sha256(budget()).hexdigest()))
        self.assertEqual(N.verify(raw, TEMPLATE, approval(), budget(), SLOT, "101", SHA, frozenset(), CFG, WF, template_pin=TEMPLATE_PIN,
                                  budget_pin=hashlib.sha256(budget()).hexdigest()), hashlib.sha256(raw).hexdigest())

    def test_every_derived_allocation_fits_the_approval_and_the_whole_window_its_validity_and_period(self):
        for over in ({"requests": {"runCap": 4401}}, {"identity": {"readsThisRun": 33}}, {"coaching": {"cap": 40}},
                     {"actions": {"takesMinimum": 41}}, {"window": {"proposedWindowMinutes": 331}}):
            with self.subTest(over=over):
                refused(self, "nightly-need-exceeds-approval", derive, bud=budget(**over))
        refused(self, "nightly-budget-shape", derive, bud=json.dumps({"requests": {}}).encode())
        refused(self, "nightly-budget-shape", derive, bud=budget(coaching={"cap": 1.5}))
        refused(self, "nightly-budget-shape", derive, bud=budget(coaching={"basis": ""}))
        missing_row = json.loads(budget())
        missing_row["perCase"].pop()
        refused(self, "nightly-budget-shape", derive, bud=json.dumps(missing_row).encode())
        inconsistent = json.loads(budget())
        inconsistent["perCase"][0]["startsMin"] += 1
        refused(self, "nightly-budget-shape", derive, bud=json.dumps(inconsistent).encode())
        duplicate = json.loads(budget())
        duplicate["perCase"][1]["case"] = duplicate["perCase"][0]["case"]
        refused(self, "nightly-budget-shape", derive, bud=json.dumps(duplicate).encode())
        below_case_minimum = json.loads(budget())
        below_case_minimum["perCase"][0]["startsMin"] -= 1
        below_case_minimum["perCase"][1]["startsMin"] += 1
        refused(self, "nightly-execution-contract", derive, bud=json.dumps(below_case_minimum).encode())
        refused(self, "nightly-need-exceeds-approval", derive, ap=approval(perRunCaps={"starts": 41}))
        late_slot = datetime(2026, 11, 30, 21, 0, tzinfo=timezone.utc)
        refused(self, "nightly-window-outside-period", derive, slot=late_slot)
        refused(self, "nightly-occurrence-outside-period", derive, slot=datetime(2026, 12, 1, 3, 0, tzinfo=timezone.utc))

    def test_the_runner_minute_need_is_the_actual_workflow_allowance(self):
        timeouts = N.workflow_job_timeouts(WF)
        self.assertEqual(timeouts, {"nightly-gate": 3, "record-begin": 5, "journal-reserve": 3, "live": 340,
                                    "journal-settle": 3, "record-complete": 5})
        self.assertEqual(N.nightly_runner_minutes(WF), 359, "a nightly run includes both serial journal transition jobs")
        refused(self, "nightly-need-exceeds-approval", derive, ap=approval(perRunCaps={"githubRunnerMinutes": 358}))
        self.assertTrue(derive(ap=approval(perRunCaps={"githubRunnerMinutes": 359})))
        refused(self, "nightly-workflow-timeouts", derive, wf=WF.replace(
            "    timeout-minutes: ${{ fromJSON(github.event_name == 'workflow_dispatch' && '65' || '340') }}",
            "    timeout-minutes: ${{ fromJSON(github.event_name == 'workflow_dispatch' && '66' || '340') }}"))

    def test_the_derived_request_passes_the_ordinary_validator_as_one_contract(self):
        import validate_run_request as V
        req = json.loads(derive())
        s = sample()
        cfg = copy.deepcopy(s["cfg"])
        cfg["harness"]["expectedCodeManifestSha256"] = req["harness"]["codeManifestSha256"]
        rc = reconciliation()
        period = json.loads(approval())["periodCaps"]
        rc["ceilings"] = dict(rc["ceilings"], requests=period["requests"], identityReads=period["identityReads"],
                              starts=period["starts"], takes=period["takes"])
        accepted_budget = json.loads(budget())
        selected = {row["case"]: row for row in req["selection"]}
        for row in accepted_budget["perCase"]:
            row["estimate"] = selected[row["case"]]["plannedRequests"]
        accepted_budget["window"].update(expectedMinutes=req["estimate"]["window"]["expectedMinutes"],
                                           worstCaseMinutes=req["estimate"]["window"]["worstCaseMinutes"])
        with open(os.path.join(ROOT, "config", "assertion-catalog.json"), encoding="utf-8") as catalog:
            accepted_budget["_catalog"] = json.load(catalog)
        errors, _ = V.validate(req, cfg, s["ledger"], s["wf"], fake_rv(), rc, accepted_budget)
        self.assertEqual(errors, [])

        too_long = copy.deepcopy(req)
        too_long["estimate"]["githubRunnerMinutesMax"] = N.nightly_runner_minutes(WF) + 1
        errors, _ = V.validate(too_long, cfg, s["ledger"], s["wf"], fake_rv(), rc, accepted_budget)
        self.assertTrue(any("githubRunnerMinutesMax" in error for error in errors), errors)

        mismatched = copy.deepcopy(req)
        mismatched["approvedLimits"]["runCapRequests"] += 1
        errors, _ = V.validate(mismatched, cfg, s["ledger"], s["wf"], fake_rv(), rc, accepted_budget)
        self.assertTrue(any("exceeds what the request proposed" in error for error in errors), errors)

    def test_the_whole_run_must_still_fit_from_now_using_the_callers_own_checks(self):
        raw = derive()
        self.assertEqual(N.check_fit(raw, SLOT + timedelta(minutes=1), CFG, WF), 304)  # 15 setup + 304 live + 10 collect = 329 of 330 minutes
        refused(self, "nightly-run-would-outlast-window", N.check_fit, raw, SLOT + timedelta(minutes=1, seconds=1), CFG, WF)
        # Sam 1793554593.723039: a 360-minute nightly window covers the maximum 30-minute trigger delay; it stays anchored to the slot.
        self.assertEqual(N.NIGHTLY_MAX_WINDOW_MINUTES, 360)
        self.assertEqual(CFG["modes"]["full"]["limits"]["maxWindowMinutes"], 330, "the package config (and manual runs) are unchanged")
        wide = derive(ap=approval(perRunCaps={"windowMinutes": 360}))
        self.assertEqual(json.loads(wide)["window"]["endUtc"], "2026-11-02T09:00:00Z")
        self.assertEqual(N.check_fit(wide, SLOT + timedelta(minutes=31), CFG, WF), 304)
        refused(self, "nightly-run-would-outlast-window", N.check_fit, wide, SLOT + timedelta(minutes=31, seconds=1), CFG, WF)
        self.assertEqual(G.NIGHTLY_MAX_WINDOW_MINUTES, N.NIGHTLY_MAX_WINDOW_MINUTES)
        req = json.loads(wide)
        inputs = GateInputs(sample())
        self.addCleanup(inputs.close)
        result = G.evaluate(req, CFG, sample()["ledger"], sample()["wf"], {"valid": True, "errors": []},
                            {"passed": True}, receipt(req), str(inputs.root), "final", fake_rv(), reconciliation(),
                            parse_utc("2026-11-02T03:31:00Z"), receipts_root=str(inputs.receipts))
        g5 = next(g for g in result["gates"] if g["id"] == "G5")
        self.assertEqual(g5["status"], G.READY, g5)
        self.assertEqual(raw, derive(), "the request bytes never depend on when admission ran")

    def test_template_approval_budget_and_request_substitution_never_verify(self):
        raw = derive()
        args = (TEMPLATE, approval(), budget(), SLOT, "101", SHA, frozenset(), CFG, WF)
        pins = {"template_pin": TEMPLATE_PIN, "budget_pin": hashlib.sha256(budget()).hexdigest()}
        refused(self, "nightly-template-not-anchored", N.verify, raw, TEMPLATE + b" ", *args[1:], **pins)
        refused(self, "nightly-budget-not-anchored", N.verify, raw, TEMPLATE, approval(), budget(coaching={"cap": 14}), *args[3:], **pins)
        refused(self, "nightly-request-not-the-derivation", N.verify, raw, TEMPLATE, approval(approvalRef="slack:1793553999.000001"), *args[2:], **pins)
        sub = json.loads(raw)
        sub["window"]["endUtc"] = "2026-11-02T23:00:00Z"
        sub["approvedLimits"]["runCapRequests"] = 99999
        refused(self, "nightly-request-not-the-derivation", N.verify, N.canon(sub), *args, **pins)
        for i, value in ((4, "102"), (5, "5" * 40)):
            changed = list(args)
            changed[i] = value
            refused(self, "nightly-request-not-the-derivation", N.verify, raw, *changed, **pins)

    def test_the_template_is_structural_never_fixture_authority(self):
        tpl = json.loads(TEMPLATE)
        for mutate in (lambda t: t.update(fixtureScope="x"), lambda t: t.update(synthetic=True), lambda t: t.update(nightly={}),
                       lambda t: t.update(priority="full-coverage"), lambda t: t.update(selection=t["selection"][:14])):
            bad = copy.deepcopy(tpl)
            mutate(bad)
            raw = json.dumps(bad).encode()
            refused(self, "nightly-template-shape", derive, tpl=raw, tpl_pin=hashlib.sha256(raw).hexdigest())

    def test_inputs_are_validated(self):
        for run_id in ("0", "abc", 101, ""):
            refused(self, "nightly-run-id", derive, run_id=run_id)
        for sha in ("A" * 40, "4" * 39, None):
            refused(self, "nightly-tested-sha", derive, sha=sha)
        refused(self, "nightly-occurrence-replayed", derive, prior=[OCCURRENCE])  # a caller-supplied list is not ledger state


class NightlyChecks(unittest.TestCase):
    """The two nightly-only checks layered on #1772's derivation (Sam 1793617478.811419)."""
    def test_the_estimate_split_is_the_accepted_budgets_and_the_template_rows_own(self):
        q = json.loads(derive())["estimate"]["requests"]
        self.assertEqual((q["planned"], q["cleanupReserve"], q["pooledSlack"], q["runCap"]), (3610, 150, 550, 4310))
        for label, bud in (("slack differs", budget(requests={"pooledSlack": 551})),
                           ("planned differs from the template rows", budget(requests={"plannedSumOfEstimates": 3600, "pooledSlack": 560})),
                           ("cleanup differs", budget(requests={"cleanupReserve": 140, "pooledSlack": 560})),
                           ("split missing", json.dumps(dict(json.loads(budget()), requests={"runCap": 4310}), sort_keys=True).encode())):
            with self.subTest(label):
                refused(self, "nightly-estimate-not-the-budget", derive, bud=bud)

    def test_the_case10_row_pins_the_observation_contract(self):
        import case10_observation
        self.assertEqual(case10_observation.contract_of(json.loads(derive()))["readBudget"], {"requests": 12, "identityReads": 1})
        tpl = json.loads(TEMPLATE)
        next(r for r in tpl["selection"] if r["case"] == "AHT-10").pop("observationContract")
        raw = json.dumps(tpl).encode()
        refused(self, "nightly-case10-observation-contract", derive, tpl=raw, tpl_pin=hashlib.sha256(raw).hexdigest())


class Case10PerOccurrence(unittest.TestCase):
    """#1772 thread 4442216949: a recurring run cannot reuse one pinned Case 10 projection bound to a single occurrence. Every derived
    occurrence's AHT-10 row pins the observation contract, so the bound takes only that occurrence's own fresh observation (admitted for
    its sealed request digest, run, attempt and time; see test_case10_observation) and refuses a pinned projection as a second source."""
    def test_consecutive_occurrences_each_take_case10_only_from_their_own_observation(self):
        account = "00000000-0000-4000-8000-000000000010"
        for run_id, slot in (("101", SLOT), ("102", SLOT + timedelta(days=1))):
            raw = derive(run_id=run_id, slot=slot)
            req = json.loads(raw)
            row = next(r for r in req["selection"] if r["case"] == "AHT-10")
            self.assertIn("observationContract", row, run_id)
            for facts, code in (({"case10RequestBound": {"runId": req["runId"]}}, "case10-observation-two-sources"),
                                ({}, "case10-observation-missing")):
                with self.assertRaises(C.InputValidationError) as e:
                    C.case10_execution_bound(req, facts, account, hashlib.sha256(raw).hexdigest(), run_id, _iso(slot))
                self.assertEqual(str(e.exception), code, run_id)


def _iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


class ReplayThroughTheRealWriter(unittest.TestCase):
    """Occurrence state from the VERIFIED state-ref chain (temporary bare repo; the real writer); a second run id for the same occurrence refuses."""

    def setUp(self):
        self.d = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.d)
        self.remote = os.path.join(self.d, "remote.git")
        subprocess.run(["git", "init", "-q", "--bare", self.remote], check=True)
        self.repo = os.path.join(self.d, "writer")
        subprocess.run(["git", "init", "-q", self.repo], check=True)
        env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@invalid", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@invalid"}

        def git(*a, data=None):
            return subprocess.run(["git", "-C", self.repo, *a], input=data, capture_output=True, check=True, env=env).stdout.decode().strip()
        blob = git("hash-object", "-w", "--stdin", data=W.ledger_bytes([]))
        tree = git("mktree", data=("100644 blob %s\tledger.json\n" % blob).encode())
        self.root = git("commit-tree", tree, data=b"genesis\n")
        git("push", "-q", self.remote, "%s:%s" % (self.root, W.STATE_REF))

    def test_a_second_run_id_for_a_reserved_occurrence_is_refused(self):
        self.assertEqual(N.occurrences_from_chain(self.repo, self.remote, self.root, self.remote), frozenset())
        raw = derive(run_id="101")
        reserve = {"type": "reserve", "campaignId": json.loads(raw)["runId"], "runId": "101", "attempt": 1,
                   "allocation": {"requests": 4400, "identityReads": 32, "starts": 40, "takes": 40, "coachingRequests": 15, "runnerMinutes": 350},
                   "provenance": "request-sha256:" + hashlib.sha256(raw).hexdigest(), "atUtc": "2026-11-02T03:01:00Z"}
        W.propose(self.repo, self.remote, self.root, reserve, self.root, self.remote)
        seen = N.occurrences_from_chain(self.repo, self.remote, self.root, self.remote)
        self.assertEqual(seen, frozenset({OCCURRENCE}))
        for run_id in ("102", "999999"):
            refused(self, "nightly-occurrence-replayed", derive, run_id=run_id, prior=seen)
        self.assertTrue(derive(slot=SLOT + timedelta(days=1), run_id="103", prior=seen), "the next night is a new occurrence")


if __name__ == "__main__":
    unittest.main()


class StandingPeriodLimits(unittest.TestCase):
    """#1772 Code finding 4447377710 (broken before: a derived occurrence kept the template's one-off cumulative limits, e.g. takesCap 55 and
    10,535 requests, so a second occurrence with 30 prior takes was rejected by the ordinary validator despite a 1,200-take standing grant)."""

    def test_a_later_occurrence_validates_against_the_standing_period_caps(self):
        import validate_run_request as V
        ap_raw = approval()
        req = json.loads(derive(ap=ap_raw))
        period = json.loads(ap_raw)["periodCaps"]
        self.assertEqual({k: req["proposedLimits"][k] for k in ("cumulativeCeilingRequests", "identityCap", "startsCap", "takesCap")},
                         {"cumulativeCeilingRequests": period["requests"], "identityCap": period["identityReads"],
                          "startsCap": period["starts"], "takesCap": period["takes"]})
        # A second occurrence: the standing period's own ceilings, with a prior occurrence's 30 takes and 42 Starts already counted.
        s = sample()
        rc = reconciliation()
        rc["ceilings"] = dict(rc["ceilings"], requests=period["requests"], identityReads=period["identityReads"],
                              starts=period["starts"], takes=period["takes"])
        rc["starts"] = dict(rc["starts"], ownerCounted=42)
        rc["takes"] = dict(rc["takes"], ownerCounted=30)
        errors, _ = V.validate(req, s["cfg"], s["ledger"], s["wf"], fake_rv(), rc)
        limit_errors = [e for e in errors if "would exceed the cumulative cap" in e or "cumulative ceiling" in e or "identity cap" in e
                        or "exceeds the current" in e]
        self.assertEqual(limit_errors, [])
        # A second REAL occurrence (the next nightly slot, another run) derives the same standing-period limits and validates too.
        second = json.loads(derive(ap=ap_raw, slot=SLOT + timedelta(days=1), run_id="102", prior=frozenset({req["runId"]})))
        self.assertNotEqual(second["runId"], req["runId"])
        self.assertEqual(second["proposedLimits"]["takesCap"], period["takes"])
        errors, _ = V.validate(second, s["cfg"], s["ledger"], s["wf"], fake_rv(), rc)
        self.assertEqual([e for e in errors if "would exceed the cumulative cap" in e or "cumulative ceiling" in e or "identity cap" in e
                          or "exceeds the current" in e], [])
        # The standing caps still bind: a period already at its take ceiling refuses the next occurrence.
        rc["takes"] = dict(rc["takes"], ownerCounted=period["takes"])
        errors, _ = V.validate(req, s["cfg"], s["ledger"], s["wf"], fake_rv(), rc)
        self.assertTrue(any("takes would exceed the cumulative cap" in e for e in errors), errors)
