"""The GitHub nightly regression's one immutable request per scheduled occurrence (Sam 1793553158.013909), offline only: the gate's guards
(switch, attempt, unactivated writer, absent/incomplete/expired standing approval), replay and delay, and template/approval/request
substitution. Every approval here is synthetic test data; the committed recurring-approval.json stays NOT APPROVED."""
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

from _fixtures import ROOT
import nightly_request as N

SLOT = datetime(2026, 11, 2, 3, 0, tzinfo=timezone.utc)
SHA = "4" * 40
with open(N.TEMPLATE_PATH, "rb") as _f:
    TEMPLATE = _f.read()


def approval(**over):
    ap = {"schema": "speaksharp.cloud-test.recurring-approval.v1", "status": "APPROVED", "approvedBy": "owner", "approvalRef": "slack:1793553158.013909",
          "approvedAtUtc": "2026-11-01T17:00:00Z", "validFromUtc": "2026-11-01T00:00:00Z", "expiresUtc": "2026-12-01T00:00:00Z",
          "periodStartUtc": "2026-11-01T00:00:00Z", "cadence": {"runsPerPeriod": 30, "period": "30 days"},
          "perRunCaps": {"runCapRequests": 4310, "identityReads": 126, "starts": 40, "takes": 40, "coachingRequests": 15, "windowMinutes": 340,
                         "githubRunnerMinutes": 360, "paidActionsUsd": 0},
          "periodCaps": {"requests": 129300}}
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(ap.get(k), dict):
            ap[k] = dict(ap[k], **v)
        else:
            ap[k] = v
    return json.dumps(ap, sort_keys=True).encode()


def refused(test, code, fn, *a, **k):
    with test.assertRaises(N.Refused) as e:
        fn(*a, **k)
    test.assertEqual(str(e.exception), code)


class Gate(unittest.TestCase):
    def test_an_activated_switch_attempt_one_activated_writer_and_valid_approval_admit(self):
        self.assertEqual(N.gate("true", "1", approval(), SLOT, activated=True)["status"], "APPROVED")

    def test_the_switch_is_checked_first_and_anything_but_exactly_true_is_off(self):
        for switch in ("", "TRUE", "1", "yes", " true", None):
            refused(self, "nightly-switch-off", N.gate, switch, "2", b"not even json", SLOT, activated=False)

    def test_attempt_writer_and_approval_guards(self):
        refused(self, "nightly-attempt", N.gate, "true", "2", approval(), SLOT, activated=True)
        refused(self, "state-writer-not-activated", N.gate, "true", "1", approval(), SLOT, activated=False)
        self.assertIsNone(N.state_ref_writer.REVIEWED_ROOT)
        refused(self, "state-writer-not-activated", N.gate, "true", "1", approval(), SLOT)  # the real writer is not activated today
        with open(N.APPROVAL_PATH, "rb") as f:
            committed = f.read()
        refused(self, "recurring-approval-not-approved", N.gate, "true", "1", committed, SLOT, activated=True)
        for raw, code in ((b"{", "recurring-approval-unreadable"), (approval(schema="other"), "recurring-approval-unreadable"),
                          (approval(status="NOT APPROVED"), "recurring-approval-not-approved"),
                          (approval(approvalRef=None), "recurring-approval-incomplete"),
                          (approval(perRunCaps={"windowMinutes": None}), "recurring-approval-incomplete"),
                          (approval(perRunCaps={"takes": True}), "recurring-approval-incomplete"),
                          (approval(perRunCaps={"paidActionsUsd": 5}), "recurring-approval-paid-actions"),
                          (approval(validFromUtc="2026-11-03T00:00:00Z"), "recurring-approval-not-yet-valid"),
                          (approval(expiresUtc="2026-11-02T03:00:00Z"), "recurring-approval-expired"),
                          (approval(expiresUtc="not a time"), "nightly-utc")):
            with self.subTest(code=code):
                refused(self, code, N.gate, "true", "1", raw, SLOT, activated=True)

    def test_the_cli_is_quiet_when_switched_off_and_visible_for_any_other_refusal(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d)
        script = os.path.join(ROOT, "scripts", "nightly_request.py")

        def run(switch, attempt):
            out = os.path.join(d, "out-%s-%s" % (switch or "unset", attempt))
            p = subprocess.run([sys.executable, "-I", script, "gate", "--switch", switch, "--attempt", attempt, "--outputs", out],
                               capture_output=True, text=True, timeout=60)
            with open(out, encoding="utf-8") as f:
                return p.returncode, dict(line.split("=", 1) for line in f.read().splitlines())
        self.assertEqual(run("", "1"), (0, {"admitted": "false", "code": "nightly-switch-off"}))
        self.assertEqual(run("true", "2"), (78, {"admitted": "false", "code": "nightly-attempt"}))
        self.assertEqual(run("true", "1"), (78, {"admitted": "false", "code": "state-writer-not-activated"}))


class Occurrence(unittest.TestCase):
    def test_the_slot_is_the_schedule_time_not_the_start_time_and_a_late_start_is_refused(self):
        for delay in (0, 1, 59 * 60, 60 * 60):
            self.assertEqual(N.occurrence_slot("0 3 * * *", SLOT + timedelta(seconds=delay)), SLOT, delay)
        refused(self, "nightly-occurrence-late", N.occurrence_slot, "0 3 * * *", SLOT + timedelta(minutes=60, seconds=1))
        refused(self, "nightly-occurrence-late", N.occurrence_slot, "0 3 * * *", SLOT - timedelta(minutes=1))  # yesterday's slot, 23h59m late
        for cron in ("*/5 * * * *", "0 3 * * 1", "0 24 * * *", "", None, "0 3 * * * extra"):
            refused(self, "nightly-schedule-unsupported", N.occurrence_slot, cron, SLOT)

    def test_a_delayed_start_never_widens_or_resets_the_window(self):
        on_time = json.loads(N.derive(TEMPLATE, approval(), N.occurrence_slot("0 3 * * *", SLOT), "101", SHA, set()))
        late = json.loads(N.derive(TEMPLATE, approval(), N.occurrence_slot("0 3 * * *", SLOT + timedelta(minutes=45)), "101", SHA, set()))
        self.assertEqual(on_time["window"], late["window"])
        self.assertEqual(on_time["window"], {"startUtc": "2026-11-02T03:00:00Z", "endUtc": "2026-11-02T08:40:00Z", "approvalRef": "slack:1793553158.013909"})

    def test_a_replayed_occurrence_is_refused_under_any_run_id(self):
        key = "2026-11-01T00:00:00Z/2026-11-02T03:00:00Z"
        self.assertEqual(N.occurrence_id(json.loads(approval()), SLOT), key)
        for run_id in ("101", "102", "999999"):  # a fresh GitHub run id never makes a replayed occurrence new
            refused(self, "nightly-occurrence-replayed", N.derive, TEMPLATE, approval(), SLOT, run_id, SHA, {key})
        self.assertTrue(N.derive(TEMPLATE, approval(), SLOT, "102", SHA, {"2026-11-01T00:00:00Z/2026-11-01T03:00:00Z"}))
        # The same slot in a NEW approval period is a different occurrence.
        self.assertTrue(N.derive(TEMPLATE, approval(periodStartUtc="2026-11-02T00:00:00Z", validFromUtc="2026-11-02T00:00:00Z"), SLOT, "102", SHA, {key}))
        refused(self, "nightly-occurrence-replayed", N.derive, TEMPLATE, approval(), SLOT, "102", SHA, None)

    def test_the_slot_must_lie_inside_the_approved_period(self):
        refused(self, "nightly-occurrence-outside-period", N.derive, TEMPLATE, approval(periodStartUtc="2026-11-02T03:00:01Z"), SLOT, "101", SHA, set())
        refused(self, "nightly-occurrence-outside-period", N.derive, TEMPLATE, approval(periodStartUtc="2026-10-01T00:00:00Z", validFromUtc="2026-10-01T00:00:00Z"),
                SLOT, "101", SHA, set())  # 30-day period ended 2026-10-31
        refused(self, "recurring-approval-period", N.derive, TEMPLATE, approval(cadence={"period": "monthly"}), SLOT, "101", SHA, set())


class Derivation(unittest.TestCase):
    def test_the_derived_request_is_deterministic_canonical_and_bound_to_its_three_inputs(self):
        raw = N.derive(TEMPLATE, approval(), SLOT, "101", SHA, set())
        self.assertEqual(raw, N.derive(TEMPLATE, approval(), SLOT, "101", SHA, set()))
        self.assertTrue(raw.endswith(b"}\n") and not raw.endswith(b"\n\n"))
        req = json.loads(raw)
        self.assertEqual((req["priority"], req["coverageMode"], req["synthetic"], req["runId"], req["release"]["testedSha"]),
                         ("nightly-regression", "full", False, "nightly-20261102T0300Z", SHA))
        self.assertEqual(sorted(s["case"] for s in req["selection"]), ["AHT-%02d" % n for n in range(1, 16)])
        self.assertEqual(req["nightly"], {"occurrence": "2026-11-02T03:00:00Z", "occurrenceId": "2026-11-01T00:00:00Z/2026-11-02T03:00:00Z",
                                          "runId": "101", "attempt": 1,
                                          "templateSha256": hashlib.sha256(TEMPLATE).hexdigest(),
                                          "approvalSha256": hashlib.sha256(approval()).hexdigest(), "standingApprovalRef": "slack:1793553158.013909"})
        self.assertEqual(N.verify(raw, TEMPLATE, approval(), SLOT, "101", SHA, set()), hashlib.sha256(raw).hexdigest())

    def test_the_committed_template_is_the_pinned_one_and_has_no_occurrence_or_approval_values(self):
        self.assertEqual(hashlib.sha256(TEMPLATE).hexdigest(), N.TEMPLATE_SHA256)
        tpl = json.loads(TEMPLATE)
        self.assertEqual((tpl["runId"], tpl["createdUtc"], tpl["selectionApprovalRef"], tpl["window"], tpl["release"]["testedSha"]),
                         (None, None, None, {"startUtc": None, "endUtc": None, "approvalRef": None}, None))
        self.assertTrue(all(v is None for v in tpl["approvedLimits"].values()))

    def test_template_approval_and_request_substitution_never_verify(self):
        raw = N.derive(TEMPLATE, approval(), SLOT, "101", SHA, set())
        other_tpl = TEMPLATE.replace(b'"full"', b'"full" ', 1)
        refused(self, "nightly-template-not-pinned", N.derive, other_tpl, approval(), SLOT, "101", SHA, set())
        refused(self, "nightly-template-not-pinned", N.verify, raw, other_tpl, approval(), SLOT, "101", SHA, set())
        # A different (also valid) standing approval derives different bytes, so the original request does not verify against it.
        refused(self, "nightly-request-not-the-derivation", N.verify, raw, TEMPLATE, approval(approvalRef="slack:1793553999.000001"), SLOT, "101", SHA, set())
        # A substituted request keeping the five execution-identity fields but changing window/approval/budget does not verify.
        sub = json.loads(raw)
        sub["window"]["endUtc"] = "2026-11-02T23:00:00Z"
        sub["approvedLimits"]["runCapRequests"] = 99999
        refused(self, "nightly-request-not-the-derivation", N.verify, N.canon(sub), TEMPLATE, approval(), SLOT, "101", SHA, set())
        refused(self, "nightly-request-not-the-derivation", N.verify, raw + b" ", TEMPLATE, approval(), SLOT, "101", SHA, set())
        for args, code in (((SLOT, "102", SHA), "nightly-request-not-the-derivation"), ((SLOT + timedelta(days=1), "101", SHA), "nightly-request-not-the-derivation"),
                           ((SLOT, "101", "5" * 40), "nightly-request-not-the-derivation")):
            refused(self, code, N.verify, raw, TEMPLATE, approval(), *args, set())

    def test_inputs_are_validated(self):
        for run_id in ("0", "abc", 101, ""):
            refused(self, "nightly-run-id", N.derive, TEMPLATE, approval(), SLOT, run_id, SHA, set())
        for sha in ("A" * 40, "4" * 39, None):
            refused(self, "nightly-tested-sha", N.derive, TEMPLATE, approval(), SLOT, "101", sha, set())
        refused(self, "recurring-approval-expired", N.derive, TEMPLATE, approval(expiresUtc="2026-11-02T02:00:00Z"), SLOT, "101", SHA, set())
        bad = json.loads(TEMPLATE)
        bad["nightly"] = {}
        bad_raw = json.dumps(bad).encode()
        refused(self, "nightly-template-shape", N.load_template, bad_raw, hashlib.sha256(bad_raw).hexdigest())
        bad = copy.deepcopy(json.loads(TEMPLATE))
        bad["priority"] = "full-coverage"
        bad_raw = json.dumps(bad).encode()
        refused(self, "nightly-template-shape", N.load_template, bad_raw, hashlib.sha256(bad_raw).hexdigest())


if __name__ == "__main__":
    unittest.main()
