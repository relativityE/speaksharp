"""GitHub live caller inputs (RETURNs of b0100ad8 and 3e0279d6): a committed request in the ONE
reviewed location, its live/approval/window/source bindings, request-only lineage or a fully bound older-release diagnostic, complete-case
sampling, per-run and time ceilings (cumulative caps stay G5's), one account role bound to credential names, account ID and history, the
builder's real facts schema, the producer scope composed from the request and accepted by the real bootstrap, fail-closed continuity, and
qualification through the REAL verify_run_binding on a frozen snapshot followed by a separate all-selected-rows-PASS check bound to the record."""
import copy
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from datetime import datetime, timedelta, timezone

from _fixtures import ROOT, J, approved, fake_rv, receipt, reconciliation, sample
from _gate_fixtures import GateInputs
import check_gates as C
import init_run_inputs as I
import validate_run_request as V

SHA = "a" * 40
NOW = datetime(2026, 11, 1, 14, 0, tzinfo=timezone.utc)
ACCOUNT_ID = "00000000-0000-4000-8000-000000000001"  # synthetic; never a real account
CFG = J(os.path.join(ROOT, "config", "test-config.v1.json"))
FULL = J(os.path.join(ROOT, "tests", "fixtures", "full-request.json"))
KEYS = I._request_keys()
RUNS = I.REQUEST_DIR


def utc(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def live_request(cases=None, **over):
    """The reviewed full fixture made live-shaped for unit checks; it is never written into the repository as a run request."""
    r = copy.deepcopy(FULL)
    r.pop("fixtureScope", None)
    if cases is not None:
        r["selection"] = [s for s in r["selection"] if s["case"] in cases]
        for index, row in enumerate(r["selection"], 1):
            row["order"] = index
        r["coverageMode"] = "partial"
        r["estimate"]["requests"]["runCap"] = 700
        r["estimate"]["identityReads"] = 8
        r["estimate"].pop("window", None)
    r.update(synthetic=False, executionRuntime=I.RUNTIME, selectionApprovalRef=FIXTURE_APPROVAL)
    r["release"]["testedSha"] = SHA
    r["harness"]["ownerApprovalRef"] = FIXTURE_APPROVAL
    r["window"] = {"startUtc": "2026-11-01T13:00:00Z", "endUtc": "2026-11-01T20:00:00Z", "approvalRef": FIXTURE_APPROVAL}
    full = r["coverageMode"] == "full"
    start_caps = {row["case"]: row["startPressCap"] for row in r["selection"]}
    r["proposedLimits"]["startPressCaps"] = copy.deepcopy(start_caps)
    r["estimate"]["starts"] = sum(start_caps.values())
    r["approvedLimits"] = {"cumulativeCeilingRequests": 12000, "identityCap": 126, "runCapRequests": 4310 if full else 800,
                           "startPressCaps": start_caps, "approvalRef": FIXTURE_APPROVAL, "approvedBy": I.APPROVER_ROLE}
    r.update(over)
    return r


# A synthetic opaque approval code (public-repository rule: no chat-message reference or personal name in dispatch inputs).
FIXTURE_APPROVAL = "approval-" + "0123456789abcdef" * 2


def facts(**over):
    f = {"ownerApprovalReference": FIXTURE_APPROVAL, "approvedBy": I.APPROVER_ROLE, "reviewer": "release-reviewer",
         "receipts": {k: "receipt:%s@aaaaaaaaaaaa" % k for k in I.RECEIPT_KEYS},
         "accounts": {"existing-disposable": {"idSha256": hashlib.sha256(ACCOUNT_ID.encode()).hexdigest(), "historyRef": "history:throwaway@r5"}},
         "backend": {"manifestRef": "synthetic:backend-manifest@1", "generation": 7, "completion": "OFF", "migration129": "absent"}}
    f.update(over)
    return f


def action_approval(req, request_sha256, reconciliation_bytes, **over):
    """A synthetic stand-in for the approver-supplied builder action approval (never constructed by prepare)."""
    a = {"schema": I.ACTION_APPROVAL_SCHEMA, "requestSha256": request_sha256,
         "reconciliationSha256": hashlib.sha256(reconciliation_bytes).hexdigest(),
         "approvalRef": req["approvedLimits"]["approvalRef"], "approvedBy": req["approvedLimits"]["approvedBy"],
         "selectionApprovalRef": req["selectionApprovalRef"]}
    a.update(over)
    return a


# The live step always supplies the project origin (vars.SUPABASE_URL as VITE_SUPABASE_URL); the builder used to default to this host.
LIVE_ORIGIN_ENV = dict(os.environ, VITE_SUPABASE_URL="https://yxlapjuovrsvjswkwnrk.supabase.co")

class FirstObservationExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cases = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def write_case(self, case_id, status="OBSERVED", linked=True, tamper_digest=False):
        d = os.path.join(self.cases, case_id)
        os.makedirs(d)
        ref = case_id.lower() + "-first-observation.json"
        observed = status == "OBSERVED"
        doc = {"contentSafe": True, "kind": "first-account-observation", "inventoryStatus": status,
               "role": "existing-disposable" if case_id == "AHT-01" else "maintained-read-only",
               "accountSubjectSha256": "a" * 64, "sourceBindingSha256": "b" * 64, "sourceSha": "c" * 40,
               "servedSha": "c" * 40, "observedAtUtc": "2026-11-03T16:00:00Z",
               "rowCount": 0 if observed else None, "completedCount": 0 if observed else None,
               "readableCompletedCount": 0 if observed else None, "readableHistoryAvailable": False if observed else None,
               "inventoryComplete": observed, "readLimit": 100,
               "sanitizer": {"blockedStrings": 0, "droppedKeys": 0, "truncated": 0}}
        raw = (json.dumps(doc, indent=2) + "\n").encode()
        with open(os.path.join(d, ref), "wb") as f:
            f.write(raw)
        result = {"assertions": [{"id": "unit", "result": "NOT RUN", "evidenceRefs": [ref] if linked else []}],
                  "evidenceDigests": {ref: ("f" * 64 if tamper_digest else hashlib.sha256(raw).hexdigest())}}
        with open(os.path.join(d, "case-result.json"), "w", encoding="utf-8") as f:
            json.dump(result, f)

    def test_observed_and_unknown_records_are_exported_from_linked_exact_bytes(self):
        self.write_case("AHT-01")
        self.write_case("AHT-15", "UNKNOWN")
        out = I.first_observation_export(self.cases, ["AHT-%02d" % n for n in range(1, 16)])
        self.assertEqual(out["schema"], "speaksharp-first-observations-v1")
        self.assertEqual([x["caseId"] for x in out["observations"]], ["AHT-01", "AHT-15"])
        self.assertEqual(out["observations"][1]["observation"]["inventoryStatus"], "UNKNOWN")
        self.assertNotIn("00000000-0000-4000-8000-000000000001", json.dumps(out))

    def test_completed_observation_survives_when_a_later_selected_case_was_never_reached(self):
        self.write_case("AHT-01")
        out = I.first_observation_export(self.cases, ["AHT-%02d" % n for n in range(1, 16)])
        self.assertEqual([x["caseId"] for x in out["observations"]], ["AHT-01"])
        self.assertEqual(out["notObserved"], [{"caseId": "AHT-15", "status": "NOT OBSERVED", "reason": "CASE NOT REACHED"}])

    def test_reached_case_without_an_inventory_is_explicitly_not_observed(self):
        os.makedirs(os.path.join(self.cases, "AHT-15"))
        out = I.first_observation_export(self.cases, ["AHT-15"])
        self.assertEqual(out["observations"], [])
        self.assertEqual(out["notObserved"], [{"caseId": "AHT-15", "status": "NOT OBSERVED", "reason": "OBSERVATION NOT PRODUCED"}])

    def test_dangling_observation_symlink_refuses_instead_of_disappearing(self):
        directory = os.path.join(self.cases, "AHT-15")
        os.makedirs(directory)
        os.symlink(os.path.join(directory, "missing-observation.json"), os.path.join(directory, "aht-15-first-observation.json"))
        with self.assertRaisesRegex(I.Refused, "regular-files"):
            I.first_observation_export(self.cases, ["AHT-15"])

    def test_unlinked_or_digest_substituted_observation_refuses(self):
        for linked, tamper, reason in ((False, False, "not-linked"), (True, True, "not-linked")):
            with self.subTest(linked=linked, tamper=tamper):
                self.tmp.cleanup(); self.tmp = tempfile.TemporaryDirectory(); self.cases = self.tmp.name
                self.write_case("AHT-01", linked=linked, tamper_digest=tamper)
                with self.assertRaisesRegex(I.Refused, reason):
                    I.first_observation_export(self.cases, ["AHT-01"])

    def test_malicious_or_blocked_first_observation_refuses(self):
        self.write_case("AHT-01")
        p = os.path.join(self.cases, "AHT-01", "aht-01-first-observation.json")
        with open(p, encoding="utf-8") as f:
            doc = json.load(f)
        doc["privateText"] = "secret"
        raw = (json.dumps(doc) + "\n").encode()
        with open(p, "wb") as f:
            f.write(raw)
        result_path = os.path.join(self.cases, "AHT-01", "case-result.json")
        with open(result_path, encoding="utf-8") as f:
            result = json.load(f)
        result["evidenceDigests"]["aht-01-first-observation.json"] = hashlib.sha256(raw).hexdigest()
        with open(result_path, "w", encoding="utf-8") as f:
            json.dump(result, f)
        with self.assertRaisesRegex(I.Refused, "shape"):
            I.first_observation_export(self.cases, ["AHT-01"])


class CaseTimingExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cases = self.tmp.name
        self.results = os.path.join(self.cases, "case-results.json")

    def tearDown(self):
        self.tmp.cleanup()

    def fixture(self, tamper=False, duration_seconds=12, executed_missing=False):
        rows = []
        for n in range(1, 16):
            case_id = "AHT-%02d" % n
            row = {"caseId": case_id, "result": "NOT RUN"}
            if case_id == "AHT-01" and not executed_missing:
                directory = os.path.join(self.cases, case_id)
                os.makedirs(directory)
                summary = {"startedAt": "2026-11-03T16:00:00.000Z",
                           "endedAt": (datetime(2026, 11, 3, 16, 0, tzinfo=timezone.utc) + timedelta(seconds=duration_seconds)).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                           "privateError": "must-not-be-exported"}
                raw = (json.dumps(summary) + "\n").encode()
                with open(os.path.join(directory, "summary.json"), "wb") as f:
                    f.write(raw)
                row.update(result="PASS", executionReceipt={"summarySha256": "f" * 64 if tamper else hashlib.sha256(raw).hexdigest(),
                                                            "caseId": case_id, "runId": "42142985744"})
            elif case_id == "AHT-01":
                row["result"] = "PASS"
            rows.append(row)
        with open(self.results, "w", encoding="utf-8") as f:
            json.dump({"cases": rows}, f)

    def test_observed_and_not_observed_timings_are_content_free(self):
        self.fixture()
        out = I.case_timing_export(self.cases, self.results, ["AHT-01", "AHT-02"])
        self.assertEqual(out["cases"][0], {"caseId": "AHT-01", "result": "PASS", "timingStatus": "OBSERVED",
                                                  "startedAtUtc": "2026-11-03T16:00:00.000Z", "endedAtUtc": "2026-11-03T16:00:12.000Z", "durationMs": 12000})
        self.assertEqual(out["cases"][1]["timingStatus"], "NOT OBSERVED")
        self.assertNotIn("privateError", json.dumps(out))

    BIND = {"runId": "42142985744", "runAttempt": "1", "headSha": "7" * 40, "workflowStartUtc": "2026-11-06T01:18:48Z"}

    def test_a_run_that_never_started_is_affirmatively_not_run_for_every_selected_case_and_says_where_setup_stopped(self):
        # Run 42142985744 (the reviewer): setup stopped before the run stage and no per-case table or timing survived.
        trace = os.path.join(self.cases, "stage-trace.tsv")
        with open(trace, "w", encoding="utf-8") as f:
            f.write("install-tools\t2026-11-06T01:24:52Z\t2026-11-06T01:24:53Z\t0\nbuild-plan\t2026-11-06T01:24:53Z\t2026-11-06T01:24:53Z\t78\n")
        out = I.run_timing_export(os.path.join(self.cases, "absent-cases"), os.path.join(self.cases, "absent-results.json"),
                                  ["AHT-01", "AHT-15"], os.path.join(self.cases, "started.txt"), trace, self.BIND)
        self.assertEqual((out["schema"], out["outcome"], out["runStarted"], out["stoppedAtStage"]),
                         ("speaksharp-case-timings-v2", "not-started", False, "build-plan"))
        self.assertEqual(out["binding"], {"runId": "42142985744", "runAttempt": 1, "headSha": "7" * 40})
        self.assertEqual(len(out["cases"]), 15)
        by = {c["caseId"]: c for c in out["cases"]}
        self.assertEqual((by["AHT-01"]["result"], by["AHT-01"]["evidence"]), ("NOT RUN", "run-stage-never-started"))
        self.assertEqual((by["AHT-02"]["result"], by["AHT-02"]["timingStatus"]), ("NOT SELECTED", "NOT APPLICABLE"))
        self.assertEqual([(r["stage"], r["durationMs"], r["exitCode"]) for r in out["stages"]], [("install-tools", 1000, 0), ("build-plan", 0, 78)])
        self.assertIn("WRAPPED command", out["traceScope"])
        self.assertEqual(out["timings"], {"workflowStartUtc": "2026-11-06T01:18:48Z", "runStageStartedAtUtc": None, "workflowStartToRunStageMs": None})
        # with no trace at all it is still a complete table; case results without a started run are a contradiction and refuse
        self.assertEqual(I.run_timing_export(self.cases, None, ["AHT-01"], None, None, self.BIND)["stages"], [])
        self.fixture()
        with self.assertRaisesRegex(I.Refused, "case-timing-results-without-run"):
            I.run_timing_export(self.cases, self.results, ["AHT-01"], os.path.join(self.cases, "started.txt"), trace, self.BIND)

    def test_started_without_case_results_is_unknown_never_not_run(self):
        # started.txt precedes admission, so a missing result does not prove a case never ran.
        started = os.path.join(self.cases, "started.txt")
        with open(started, "w", encoding="utf-8") as f:
            f.write("2026-11-06T01:30:00Z\n")
        out = I.run_timing_export(self.cases, os.path.join(self.cases, "absent-results.json"), ["AHT-01", "AHT-07"], started, None, self.BIND)
        self.assertEqual((out["outcome"], out["runStarted"]), ("started-without-results", True))
        by = {c["caseId"]: c for c in out["cases"]}
        self.assertEqual((by["AHT-07"]["result"], by["AHT-07"]["evidence"]), ("UNKNOWN", "started-without-case-results"))
        self.assertNotIn("NOT RUN", {c["result"] for c in out["cases"]})
        self.assertEqual(out["timings"]["workflowStartToRunStageMs"], 672000)

    def test_a_started_run_keeps_its_case_timings_and_adds_the_measured_stages(self):
        self.fixture()
        started = os.path.join(self.cases, "started.txt")
        with open(started, "w", encoding="utf-8") as f:
            f.write("2026-11-03T15:59:00Z\n")
        trace = os.path.join(self.cases, "stage-trace.tsv")
        with open(trace, "w", encoding="utf-8") as f:
            f.write("run\t2026-11-03T15:59:00Z\t2026-11-03T16:01:00Z\t0\n")
        bind = dict(self.BIND, workflowStartUtc="2026-11-03T15:50:00Z")      # the same day, before the run stage started
        out = I.run_timing_export(self.cases, self.results, ["AHT-01", "AHT-02"], started, trace, bind)
        self.assertEqual(out["timings"]["workflowStartToRunStageMs"], 540000)
        projected = {c["caseId"]: c for c in I.case_timing_export(self.cases, self.results, ["AHT-01", "AHT-02"])["cases"]}
        for c in out["cases"]:
            if c["caseId"] in projected:
                self.assertEqual({k: c[k] for k in projected[c["caseId"]]}, projected[c["caseId"]])
                self.assertEqual(c["evidence"], "bound-case-receipt" if c["caseId"] == "AHT-01" else "harness-not-run")
        self.assertEqual((out["outcome"], out["runStarted"], out["stoppedAtStage"], out["stages"][0]["durationMs"]), ("results", True, None, 120000))
        for bad in ("unknown-stage\t2026-11-03T15:59:00Z\t2026-11-03T16:01:00Z\t0\n", "run\t2026-11-03T16:01:00Z\t2026-11-03T15:59:00Z\t0\n",
                    "run\t2026-11-03T15:59:00Z\t2026-11-03T16:01:00Z\t0\t/private/path\n", "run\tnot-a-time\t2026-11-03T16:01:00Z\t0\n"):
            with open(trace, "w", encoding="utf-8") as f:
                f.write(bad)
            with self.assertRaisesRegex(I.Refused, "stage-trace"):
                I.run_timing_export(self.cases, self.results, ["AHT-01"], started, trace, bind)
        # out-of-order times refuse instead of yielding a negative or misleading duration
        with open(trace, "w", encoding="utf-8") as f:
            f.write("run\t2026-11-03T15:59:00Z\t2026-11-03T16:01:00Z\t0\n")
        with self.assertRaisesRegex(I.Refused, "case-timing-out-of-order"):           # run stage before the workflow started
            I.run_timing_export(self.cases, self.results, ["AHT-01"], started, None, dict(bind, workflowStartUtc="2026-11-03T16:00:00Z"))
        with self.assertRaisesRegex(I.Refused, "case-timing-out-of-order"):           # a traced stage before the workflow started
            I.run_timing_export(self.cases, self.results, ["AHT-01"], started, trace, dict(bind, workflowStartUtc="2026-11-03T15:59:30Z"))
        with open(trace, "w", encoding="utf-8") as f:
            f.write("run\t2026-11-03T16:00:00Z\t2026-11-03T16:01:00Z\t0\nbuild-plan\t2026-11-03T15:58:00Z\t2026-11-03T15:58:30Z\t0\n")
        with self.assertRaisesRegex(I.Refused, "case-timing-out-of-order"):           # trace rows out of time order
            I.run_timing_export(self.cases, self.results, ["AHT-01"], started, trace, dict(bind, workflowStartUtc="2026-11-03T15:50:00Z"))
        for wrong in (dict(self.BIND, runId="0"), dict(self.BIND, headSha="x"), dict(self.BIND, workflowStartUtc="yesterday")):
            with self.assertRaisesRegex(I.Refused, "case-timing-binding"):
                I.run_timing_export(self.cases, self.results, ["AHT-01"], started, None, wrong)
        with self.assertRaisesRegex(I.Refused, "case-timing-selection"):
            I.run_timing_export(self.cases, self.results, ["AHT-01", "AHT-01"], started, None, bind)

    def started(self):
        path = os.path.join(self.cases, "started.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write("2026-11-03T15:59:00Z\n")
        return path

    def table(self, selected=("AHT-01", "AHT-02")):
        out = I.run_timing_export(self.cases, self.results, list(selected), self.started(), None,
                                  dict(self.BIND, workflowStartUtc="2026-11-03T15:50:00Z"))
        return out, {c["caseId"]: c for c in out["cases"]}

    def test_corrupt_or_ambiguous_top_level_results_credit_nothing_and_still_yield_the_table(self):
        # a corrupt results file must not erase the table nor credit any result
        for content, reason in (("{not json", "case-results-unreadable"), ('{"cases": [null]}', "case-results-shape"),
                                ('{"cases": [{"result": "NOT RUN"}]}', "case-results-shape"), ('[]', "case-results-shape")):
            with self.subTest(content):
                with open(self.results, "w", encoding="utf-8") as f:
                    f.write(content)
                out, by = self.table()
                self.assertEqual(out["outcome"], "results-invalid")
                self.assertEqual({by[c]["result"] for c in ("AHT-01", "AHT-02")}, {"UNKNOWN"})
                self.assertEqual({by[c]["evidence"] for c in ("AHT-01", "AHT-02")}, {reason})
                self.assertTrue(all(by[c]["durationMs"] is None for c in ("AHT-01", "AHT-02")))

    def test_one_bad_case_is_isolated_to_its_own_unknown_row(self):
        # the reviewer B3-B9 / a wrong digest, reversed times, an over-limit duration, an unbound receipt, a malformed
        # summary or a duplicate row makes ONLY that row UNKNOWN with null measurements; the valid peer keeps its verified timing
        def mutate(change):
            self.fixture()
            doc = json.load(open(self.results))
            change(doc)
            with open(self.results, "w", encoding="utf-8") as f:
                json.dump(doc, f)

        def summary(body):
            raw = (json.dumps(body) + "\n").encode()
            with open(os.path.join(self.cases, "AHT-01", "summary.json"), "wb") as f:
                f.write(raw)
            return hashlib.sha256(raw).hexdigest()

        cases = {
            "summary-digest": lambda d: d["cases"][0]["executionReceipt"].update(summarySha256="0" * 64),
            "receipt-not-bound": lambda d: d["cases"][0]["executionReceipt"].update(runId="1"),
            "duplicate-case": lambda d: d["cases"].append(dict(d["cases"][0])),
            "case-result-invalid": lambda d: d["cases"][0].update(result="PASSED"),
        }
        for reason, change in cases.items():
            with self.subTest(reason):
                self.tmp.cleanup(); self.tmp = tempfile.TemporaryDirectory(); self.cases = self.tmp.name
                self.results = os.path.join(self.cases, "case-results.json")
                mutate(change)
                out, by = self.table()
                self.assertEqual((out["outcome"], by["AHT-01"]["result"], by["AHT-01"]["evidence"], by["AHT-01"]["durationMs"]),
                                 ("results", "UNKNOWN", reason, None))
                self.assertEqual((by["AHT-02"]["result"], by["AHT-02"]["evidence"]), ("NOT RUN", "harness-not-run"))
        for body in ({"startedAt": "2026-11-03T16:00:12.000Z", "endedAt": "2026-11-03T16:00:00.000Z"},       # reversed
                     {"startedAt": "2026-11-03T16:00:00.000Z", "endedAt": "2026-11-03T16:45:00.000Z"},       # over the 40-minute limit
                     []):                                                                                    # not an object
            with self.subTest(body):
                self.tmp.cleanup(); self.tmp = tempfile.TemporaryDirectory(); self.cases = self.tmp.name
                self.results = os.path.join(self.cases, "case-results.json")
                self.fixture()
                digest = summary(body)
                doc = json.load(open(self.results)); doc["cases"][0]["executionReceipt"]["summarySha256"] = digest
                with open(self.results, "w", encoding="utf-8") as f:
                    json.dump(doc, f)
                out, by = self.table()
                self.assertEqual((by["AHT-01"]["result"], by["AHT-01"]["evidence"], by["AHT-01"]["durationMs"]), ("UNKNOWN", "case-timing-invalid", None))
        # and the valid case keeps its verdict and verified timing
        self.tmp.cleanup(); self.tmp = tempfile.TemporaryDirectory(); self.cases = self.tmp.name
        self.results = os.path.join(self.cases, "case-results.json")
        self.fixture()
        out, by = self.table()
        self.assertEqual((by["AHT-01"]["result"], by["AHT-01"]["timingStatus"], by["AHT-01"]["durationMs"]), ("PASS", "OBSERVED", 12000))

    def test_tampered_summary_or_executed_case_without_receipt_refuses(self):
        for tamper, missing, reason in ((True, False, "summary-digest"), (False, True, "missing-receipt")):
            with self.subTest(reason=reason):
                self.tmp.cleanup(); self.tmp = tempfile.TemporaryDirectory(); self.cases = self.tmp.name; self.results = os.path.join(self.cases, "case-results.json")
                self.fixture(tamper=tamper, executed_missing=missing)
                with self.assertRaisesRegex(I.Refused, reason):
                    I.case_timing_export(self.cases, self.results, ["AHT-01"])

    def test_earlier_timing_survives_later_guard_exit_without_summary(self):
        self.fixture()
        with open(self.results, encoding="utf-8") as f:
            results = json.load(f)
        results["cases"][1].update(result="FAIL", executionReceipt={"summarySha256": None})
        with open(self.results, "w", encoding="utf-8") as f:
            json.dump(results, f)
        out = I.case_timing_export(self.cases, self.results, ["AHT-01", "AHT-02"])
        self.assertEqual(out["cases"][0]["timingStatus"], "OBSERVED")
        self.assertEqual(out["cases"][1], {"caseId": "AHT-02", "result": "FAIL", "timingStatus": "NOT OBSERVED",
                                           "startedAtUtc": None, "endedAtUtc": None, "durationMs": None})

    def test_null_summary_digest_still_refuses_a_present_substituted_summary(self):
        self.fixture()
        with open(self.results, encoding="utf-8") as f:
            results = json.load(f)
        results["cases"][1].update(result="FAIL", executionReceipt={"summarySha256": None})
        directory = os.path.join(self.cases, "AHT-02")
        os.makedirs(directory)
        with open(os.path.join(directory, "summary.json"), "w", encoding="utf-8") as f:
            json.dump({"startedAt": "2026-11-03T16:00:00.000Z", "endedAt": "2026-11-03T16:00:01.000Z"}, f)
        with open(self.results, "w", encoding="utf-8") as f:
            json.dump(results, f)
        with self.assertRaisesRegex(I.Refused, "case-timing-summary"):
            I.case_timing_export(self.cases, self.results, ["AHT-01", "AHT-02"])

    def test_timing_outside_the_run_ceiling_refuses(self):
        self.fixture(duration_seconds=2401)
        with self.assertRaisesRegex(I.Refused, "duration"):
            I.case_timing_export(self.cases, self.results, ["AHT-01"])


def put(path, doc):
    with open(path, "w", encoding="utf-8") as f:
        f.write(doc if isinstance(doc, str) else json.dumps(doc))


def refused(test, code, fn, *a, **k):
    with test.assertRaises(I.Refused) as e:
        fn(*a, **k)
    test.assertEqual(str(e.exception), code)


class GitRepo:
    def __init__(self):
        self.dir = os.path.realpath(tempfile.mkdtemp())
        self.git("init", "-q")
        self.git("config", "user.email", "unit@example.invalid")
        self.git("config", "user.name", "unit")

    def git(self, *a):
        return subprocess.run(["git", "-C", self.dir, *a], check=True, capture_output=True, text=True).stdout.strip()

    def commit(self, files):
        for rel, doc in files.items():
            os.makedirs(os.path.dirname(os.path.join(self.dir, rel)), exist_ok=True)
            put(os.path.join(self.dir, rel), doc)
            self.git("add", "--", rel)
        self.git("commit", "-q", "-m", "unit")
        return self.git("rev-parse", "HEAD")


class SelectRequest(unittest.TestCase):
    def setUp(self):
        self.repo = GitRepo()
        self.addCleanup(shutil.rmtree, self.repo.dir)
        self.head = self.repo.commit({RUNS + "r6.json": {"a": 1}, "frontend/r6.json": {"a": 1}, RUNS + "nested/r6.json": {"a": 1}})

    def test_only_the_reviewed_request_location_is_selectable(self):
        path, blob, raw = I.select_request(self.repo.dir, RUNS + "r6.json", self.head)
        self.assertEqual((path, blob), (os.path.join(self.repo.dir, RUNS + "r6.json"), self.repo.git("rev-parse", self.head + ":" + RUNS + "r6.json")))
        self.assertEqual(raw, self.repo.git("cat-file", "blob", blob).encode(), "the admitted bytes are exactly the committed blob")
        for rel in ("frontend/r6.json", RUNS + "nested/r6.json", "tools/cloud-test/tests/fixtures/full-request.json"):
            refused(self, "request-not-in-the-reviewed-request-location", I.select_request, self.repo.dir, rel, self.head)
        for rel in ("/etc/r6.json", "../r6.json", RUNS + "../runs/r6.json", "", None):
            refused(self, "request-path", I.select_request, self.repo.dir, rel, self.head)

    def test_untracked_modified_or_other_source_requests_are_refused(self):
        put(os.path.join(self.repo.dir, RUNS + "new.json"), "{}")
        refused(self, "request-not-committed-at-source", I.select_request, self.repo.dir, RUNS + "new.json", self.head)
        put(os.path.join(self.repo.dir, RUNS + "r6.json"), '{"a": 2}')
        refused(self, "request-differs-from-commit", I.select_request, self.repo.dir, RUNS + "r6.json", self.head)
        refused(self, "checkout-not-at-source", I.select_request, self.repo.dir, RUNS + "r6.json", "b" * 40)


class CheckRequest(unittest.TestCase):
    def test_live_full_and_partial_requests_are_accepted(self):
        self.assertEqual(I.check_request(live_request(), NOW, KEYS), I.ALL_CASES)
        self.assertEqual(I.check_request(live_request(["AHT-04", "AHT-05"]), NOW, KEYS), ["AHT-04", "AHT-05"])

    def test_synthetic_runtime_shape_and_sampling_are_refused(self):
        for code, req in [("synthetic-request-refused", live_request(synthetic=True)),
                          ("synthetic-request-refused", {k: v for k, v in live_request().items() if k != "synthetic"}),
                          ("request-not-for-github-runtime", live_request(executionRuntime="Claude SpeakSharp R4")),
                          ("partial-selection-needs-selected-full-sampling", live_request(["AHT-05"], sampleMode="minimal")),
                          ("full-mode-needs-all-fifteen", live_request(["AHT-05"], coverageMode="full")),
                          ("request-schema", live_request(schema="speaksharp.cloud-test.run-request.v1")),
                          ("request-schema", live_request(fixtureScope="unit")),
                          ("request-schema", {k: v for k, v in live_request().items() if k != "purpose"})]:
            refused(self, code, I.check_request, req, NOW, KEYS)
        r = live_request(); r["release"]["testedSha"] = "HEAD"
        refused(self, "request-release-sha", I.check_request, r, NOW, KEYS)

    def test_missing_approvals_or_a_closed_window_are_refused(self):
        for mutate in (lambda r: r.update(selectionApprovalRef=None), lambda r: r["harness"].update(ownerApprovalRef=None),
                       lambda r: r["window"].update(approvalRef="")):
            r = live_request(); mutate(r)
            refused(self, "approval-reference-missing", I.check_request, r, NOW, KEYS)
        r = live_request(); r["approvedLimits"]["runCapRequests"] = None
        refused(self, "approved-limits-missing", I.check_request, r, NOW, KEYS)
        r = live_request(); r["window"]["endUtc"] = None
        refused(self, "approved-window-missing", I.check_request, r, NOW, KEYS)
        refused(self, "outside-approved-window", I.check_request, live_request(), datetime(2026, 11, 1, 20, 0, tzinfo=timezone.utc), KEYS)


class Ceilings(unittest.TestCase):
    def test_full_fifteen_fit_only_a_job_timeout_covering_case_limits_and_reserves(self):
        # 272 case minutes + admission 20 + inter-case 10 + cleanup 2 = 304 live; plus 15 setup and 10 collect = 329.
        self.assertEqual(I.check_ceilings(CFG, live_request(), I.ALL_CASES, 329), 304)
        refused(self, "time-exceeds-job-timeout", I.check_ceilings, CFG, live_request(), I.ALL_CASES, 328)
        refused(self, "job-timeout", I.check_ceilings, CFG, live_request(), I.ALL_CASES, 361)

    def test_partial_selections_use_partial_caps(self):
        six = ["AHT-04", "AHT-05", "AHT-06", "AHT-09", "AHT-10", "AHT-11"]
        # 95 case minutes + 32 harness reserves = 127 live (inside the partial 150); plus 25 caller reserves = 152.
        self.assertEqual(I.check_ceilings(CFG, live_request(six), six, 152), 127)
        refused(self, "time-exceeds-job-timeout", I.check_ceilings, CFG, live_request(six), six, 151)
        seven = six + ["AHT-13"]
        refused(self, "selection-exceeds-mode-cap", I.check_ceilings, CFG, live_request(seven), seven, 329)
        heavy = ["AHT-01", "AHT-02", "AHT-03", "AHT-12", "AHT-04", "AHT-07"]
        refused(self, "time-exceeds-mode-window", I.check_ceilings, CFG, live_request(heavy), heavy, 329)

    def test_per_run_request_identity_and_paid_ceilings_are_never_raised_by_input(self):
        r = live_request(); r["approvedLimits"]["runCapRequests"] = 6001
        refused(self, "approved-limit-above-mode-cap", I.check_ceilings, CFG, r, I.ALL_CASES, 329)
        r = live_request(); r["approvedLimits"]["runCapRequests"] = 3610
        refused(self, "estimate-exceeds-approved-run-cap", I.check_ceilings, CFG, r, I.ALL_CASES, 329)
        r = live_request(); r["estimate"]["identityReads"] = 33
        refused(self, "estimate-exceeds-per-run-identity-cap", I.check_ceilings, CFG, r, I.ALL_CASES, 329)
        six = ["AHT-04", "AHT-05", "AHT-06", "AHT-09", "AHT-10", "AHT-11"]
        r = live_request(six); r["estimate"]["identityReads"] = 21
        refused(self, "estimate-exceeds-per-run-identity-cap", I.check_ceilings, CFG, r, six, 329)
        r = live_request(); r["estimate"]["paidActionsAuthorizedUsd"] = 1
        refused(self, "paid-actions-refused", I.check_ceilings, CFG, r, I.ALL_CASES, 329)
        r = live_request(); r["estimate"]["window"]["worstCaseMinutes"] = 305
        refused(self, "estimate-worst-case-exceeds-case-limits", I.check_ceilings, CFG, r, I.ALL_CASES, 329)

    def test_the_whole_job_must_end_before_the_approved_window_closes(self):
        r = live_request(["AHT-05"])  # 47 live minutes + 25 caller reserves = 72
        r["window"]["endUtc"] = "2026-11-01T15:12:00Z"
        I.check_window_fit(r, NOW, 47)
        r["window"]["endUtc"] = "2026-11-01T15:11:59Z"
        refused(self, "run-would-outlast-approved-window", I.check_window_fit, r, NOW, 47)


class CumulativeCapsAreG5s(unittest.TestCase):
    """G5 (check_gates.py 131-170) is the authority for the CUMULATIVE caps (the reviewer RETURN 3e0279d6). The caller holds no second formula; this
    drives the REAL gate evaluator at its exact boundary with nonzero reconciled prior usage."""

    def setUp(self):
        s = sample()
        self.inputs = GateInputs(s)
        self.addCleanup(self.inputs.close)
        self.req, self.cfg, self.ledger, self.wf = self.inputs.request, self.inputs.cfg, s["ledger"], s["wf"]
        self.rc = reconciliation()

    def g5(self, req, ledger):
        from _common import parse_utc
        errs, _ = V.validate(req, self.cfg, ledger, self.wf, fake_rv(), self.rc)
        out = C.evaluate(req, self.cfg, ledger, self.wf, {"valid": not errs, "errors": errs}, {"passed": True}, receipt(req), str(self.inputs.root),
                         "final", fake_rv(), self.rc, parse_utc("2026-10-28T22:00:00Z"), receipts_root=str(self.inputs.receipts))
        return {g["id"]: g["status"] for g in out["gates"]}["G5"]

    def test_the_caller_has_no_cumulative_formula_of_its_own(self):
        self.assertFalse(hasattr(I, "check_cumulative"))

    def test_g5_exact_request_and_identity_boundaries_with_nonzero_prior_usage(self):
        r, l = approved(self.req, self.ledger)
        a, est, rc = r["approvedLimits"], r["estimate"], self.rc
        self.assertGreater(rc["requests"]["conservativeUsed"], 0)
        self.assertGreater(rc["identityReads"]["conservativeUsed"], 0)
        need = rc["requests"]["conservativeUsed"] + a["runCapRequests"] + rc["ceilings"]["protectedReserveRequests"] + est["identityReads"]
        a["cumulativeCeilingRequests"], a["identityCap"] = need, rc["identityReads"]["conservativeUsed"] + est["identityReads"]
        self.assertEqual(self.g5(r, l), "READY")
        a["cumulativeCeilingRequests"] = need - 1
        self.assertEqual(self.g5(r, l), "NOT-READY", "one request short of used + run cap + protected reserve + identity reads")
        a["cumulativeCeilingRequests"], a["identityCap"] = need, a["identityCap"] - 1
        self.assertEqual(self.g5(r, l), "NOT-READY", "one identity read short of used + reads")


class Lineage(unittest.TestCase):
    """Workflow source vs tested release (the reviewer RETURNs b0100ad8 #4 and 3e0279d6 #1)."""

    def setUp(self):
        self.repo = GitRepo()
        self.addCleanup(shutil.rmtree, self.repo.dir)
        self.release = self.repo.commit({"frontend/app.json": {"v": 1}, "package.json": {"v": 1}})

    def req(self):
        r = live_request(["AHT-05"])
        r["release"]["testedSha"] = self.release
        return r

    def lineage(self, head, diagnostic=None, blob="blob", cases=("AHT-05",)):
        return I.check_release_lineage(self.repo.dir, self.req(), RUNS + "r6.json", head, blob, list(cases), diagnostic, KEYS)

    def test_schema_valid_requests_in_the_reviewed_location_are_request_only_lineage(self):
        head = self.repo.commit({RUNS + "r6.json": self.req(), RUNS + "r5.json": live_request(["AHT-04"])})
        self.assertEqual(self.lineage(head), "request-only-descendant")

    def test_product_dependency_and_non_request_json_changes_refuse(self):
        for change in ({"frontend/app.json": {"v": 2}}, {"package.json": {"v": 2}}, {"frontend/runs/r6.json": self.req()},
                       {RUNS + "notes.json": {"not": "a request"}}, {RUNS + "script.py": "x"}):
            head = self.repo.commit(dict({RUNS + "r6.json": self.req()}, **change))
            refused(self, "source-changes-product-beyond-request", self.lineage, head)

    def test_an_older_release_diagnostic_is_bound_to_workflow_tested_request_and_selection(self):
        head = self.repo.commit({"frontend/app.json": {"v": 2}, RUNS + "r6.json": self.req()})
        good = {"approvalRef": "slack:1000000010.000010", "workflowSha": head, "testedSha": self.release, "requestBlob": "blob", "cases": ["AHT-05"]}
        self.assertEqual(self.lineage(head, good), "explicit-older-release-diagnostic")
        for k, v in (("workflowSha", "c" * 40), ("testedSha", "c" * 40), ("requestBlob", "other"), ("cases", ["AHT-06"]), ("approvalRef", "")):
            refused(self, "source-changes-product-beyond-request", self.lineage, head, dict(good, **{k: v}))
        refused(self, "source-changes-product-beyond-request", self.lineage, head, dict(good, extra=1))

    def test_a_diagnostic_without_a_product_change_and_a_release_outside_history_refuse(self):
        head = self.repo.commit({RUNS + "r6.json": self.req()})
        refused(self, "diagnostic-declared-without-product-change", self.lineage, head, {"approvalRef": "x"})
        r = self.req(); r["release"]["testedSha"] = "b" * 40
        refused(self, "request-release-not-in-source-history", I.check_release_lineage, self.repo.dir, r, RUNS + "r6.json", head, "blob", ["AHT-05"], None, KEYS)


class Account(unittest.TestCase):
    """the CLI developer's I1'/I2' contract (Case15): every selected role bound to its own credential names, its own account id
    from the private bundle and its own history; an all-15 run is 14 existing-disposable + 1 maintained-read-only."""
    FREE_ID = "22222222-2222-4222-8222-222222222222"

    def free_cfg(self):
        cfg = copy.deepcopy(CFG)
        cfg["credentials"]["runEnvironment"]["stages"]["run"] += ["FREE_TEST_EMAIL", "FREE_TEST_PASSWORD"]
        return cfg

    def bundle(self):
        return I.parse_live_accounts_bundle(bundle_with(ACCOUNT_ID))

    def accounts(self, **over):
        a = {"existing-disposable": {"idSha256": hashlib.sha256(ACCOUNT_ID.encode()).hexdigest(), "historyRef": "history:throwaway@r5"},
             "maintained-read-only": {"idSha256": hashlib.sha256(self.FREE_ID.encode()).hexdigest(), "historyRef": "history:free@r5"}}
        a.update(over)
        return a

    def test_one_role_bound_to_its_credential_names_id_and_history(self):
        b = I.account_bindings(CFG, ["AHT-05"], {"existing-disposable": self.accounts()["existing-disposable"]}, self.bundle())
        # Credential NAMES only; the account id comes from the private bundle, never from a named Variable.
        self.assertEqual(b, [{"role": "existing-disposable", "credentials": {"email": "THROWAWAY_TEST_EMAIL", "password": "THROWAWAY_TEST_PASSWORD"},
                              "historyRef": "history:throwaway@r5"}])
        self.assertNotIn(ACCOUNT_ID, json.dumps(b))

    def test_an_all_fifteen_selection_binds_fourteen_plus_one_each_to_its_own_names(self):
        b = I.account_bindings(CFG, I.ALL_CASES, self.accounts(), self.bundle())
        self.assertEqual([(x["role"], x["credentials"]["email"], x["credentials"]["password"]) for x in b],
                         [("existing-disposable", "THROWAWAY_TEST_EMAIL", "THROWAWAY_TEST_PASSWORD"),
                          ("maintained-read-only", "FREE_TEST_EMAIL", "FREE_TEST_PASSWORD")])
        self.assertEqual(sum(I.ROLE[c] == "existing-disposable" for c in I.ALL_CASES), 14)
        # Removing the maintained role's names from the reviewed run-stage allowlist refuses AHT-15; they are never renamed into THROWAWAY.
        missing_free = copy.deepcopy(CFG)
        missing_free["credentials"]["runEnvironment"]["stages"]["run"] = [
            name for name in missing_free["credentials"]["runEnvironment"]["stages"]["run"] if not name.startswith("FREE_TEST_")
        ]
        refused(self, "role-credentials-not-in-run-stage-allowlist", I.account_bindings, missing_free, I.ALL_CASES, self.accounts(), self.bundle())
        refused(self, "role-credentials-not-in-run-stage-allowlist", I.account_bindings, missing_free, ["AHT-15"],
                {"maintained-read-only": self.accounts()["maintained-read-only"]}, self.bundle())

    def test_missing_extra_or_wrong_role_bindings_are_refused(self):
        refused(self, "account-binding-roles", I.account_bindings, self.free_cfg(), I.ALL_CASES,
                {"existing-disposable": self.accounts()["existing-disposable"]}, self.bundle())
        refused(self, "account-binding-roles", I.account_bindings, self.free_cfg(), ["AHT-05"], self.accounts(), self.bundle())
        refused(self, "account-binding-roles", I.account_bindings, CFG, ["AHT-05"], None, self.bundle())
        swapped = self.accounts(**{"maintained-read-only": self.accounts()["existing-disposable"]})
        refused(self, "account-id-not-the-approved-account", I.account_bindings, self.free_cfg(), I.ALL_CASES, swapped, self.bundle())
        refused(self, "account-history-reference", I.account_bindings, CFG, ["AHT-05"],
                {"existing-disposable": dict(self.accounts()["existing-disposable"], historyRef="")}, self.bundle())
        refused(self, "account-binding-shape", I.account_bindings, CFG, ["AHT-05"],
                {"existing-disposable": dict(self.accounts()["existing-disposable"], role="existing-disposable")}, self.bundle())

    def test_r10_first_discovery_derives_identity_only_inside_the_protected_bundle_boundary(self):
        first = {role: {"idSha256": "FIRST-DISCOVERY",
                        "historyRef": "first-observation:%s@R10-3b040043-smoke15" % role}
                 for role in ("existing-disposable", "maintained-read-only")}
        bound = I.account_bindings(CFG, I.ALL_CASES, first, self.bundle(), "R10-3b040043-smoke15")
        self.assertEqual([row["role"] for row in bound], ["existing-disposable", "maintained-read-only"])
        self.assertNotIn(ACCOUNT_ID, json.dumps(bound))
        refused(self, "account-first-discovery-not-authorized", I.account_bindings, CFG, I.ALL_CASES,
                first, self.bundle())
        wrong = copy.deepcopy(first)
        wrong["existing-disposable"]["historyRef"] = "history:invented@r9"
        refused(self, "account-first-discovery-reference", I.account_bindings, CFG, I.ALL_CASES,
                wrong, self.bundle(), "R10-3b040043-smoke15")


class Facts(unittest.TestCase):
    def test_the_builder_schema_is_produced_without_the_account_binding_or_diagnostic(self):
        out = I.translate_facts(facts(olderReleaseDiagnostic={"approvalRef": "x"}), live_request(), "github-direct")
        self.assertEqual(set(out), {"ownerApprovalReference", "approvedBy", "reviewer", "receipts", "backend"})
        self.assertEqual(set(out["receipts"]), {"pre", "rls", "analytics", "disp", "fence", "review"})

    def test_facts_without_the_backend_identity_refuse_in_prepare_not_in_the_stage_runner(self):
        # Run 42226498611: these exact dispatch facts (no `backend`) passed prepare, then the plan builder refused them after the reserve
        # and the preflight (build_plan.py `obj(FACTS.get('backend'), 'facts-backend')`). They now refuse here, with a named code.
        dispatched = {"accounts": {"existing-disposable": {"historyRef": "first-observation:existing-disposable@R10-3b040043-smoke15",
                                                           "idSha256": "FIRST-DISCOVERY"},
                                   "maintained-read-only": {"historyRef": "first-observation:maintained-read-only@R10-3b040043-smoke15",
                                                            "idSha256": "FIRST-DISCOVERY"}},
                      "approvedBy": "product-owner", "ownerApprovalReference": FIXTURE_APPROVAL, "producerReviewReference": "slack:1000000011.000011",
                      "receipts": {"analytics": "pending:preflight", "disp": "slack:1000000012.000012", "fence": "slack:1000000013.000013",
                                   "pre": "pending:preflight", "review": "slack:1000000011.000011", "rls": "pending:preflight"}, "reviewer": "Sam"}
        refused(self, "facts-backend-missing", I.translate_facts, dispatched, live_request(), "github-producer")
        with_backend = dict(dispatched, backend={"manifestRef": "synthetic:backend-manifest@1", "generation": 7, "completion": "OFF",
                                                 "migration129": "absent"})
        self.assertEqual(I.translate_facts(with_backend, live_request(), "github-producer")["backend"]["generation"], 7)

    def test_the_old_receipt_shape_and_unbound_approvals_are_refused(self):
        old = facts(receipts={k: "receipt:%s@aaaaaaaaaaaa" % k for k in ("analytics", "disp", "fence", "review")})
        refused(self, "facts-receipts", I.translate_facts, old, live_request(), "github-direct")
        refused(self, "facts-approval-not-the-request-approval", I.translate_facts, facts(ownerApprovalReference="slack:other.1"), live_request(), "github-direct")
        refused(self, "producer-review-reference-missing", I.translate_facts, facts(), live_request(), "github-producer")
        refused(self, "facts-shape", I.translate_facts, facts(approvedSourceSha=SHA), live_request(), "github-direct")


class ProducerScope(unittest.TestCase):
    """The producer scope is composed from the COMMITTED request and accepted by the REAL authenticated_job_bootstrap.validateBindings
    against the builder environment the REAL run_env.py derives from the same request (the reviewer RETURN 3e0279d6 #4)."""

    LIMITS = {"maxDeliveries": 4, "maxSupabaseRequests": 32, "maxTelemetryReads": 2}

    def setUp(self):
        self.d = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.d)
        now = datetime.now(timezone.utc).replace(microsecond=0)
        self.req = live_request(["AHT-07"], evidenceScope=dict(self.LIMITS))
        self.req["window"].update(startUtc=utc(now - timedelta(hours=1)), endUtc=utc(now + timedelta(hours=3)))
        self.deadline = I.execution_deadline(self.req, now, 40)   # the run's one execution deadline, as prepare computes it
        self.facts = I.translate_facts(facts(producerReviewReference="review:producer@1"), self.req, "github-producer")

    def bind(self, scope, account=ACCOUNT_ID, facts_over=None, plan_deadline=None):
        private = os.path.join(self.d, "private-%d" % len(os.listdir(self.d)))
        os.mkdir(private, 0o700)
        scope_file, facts_file, bindings_file, req_file, reconciliation_file, env_file = (
            os.path.join(private, n) for n in ("scope.json", "facts.json", "account-bindings.json", "req.json", "reconciliation.json", "env.txt")
        )
        project_ref = I.parse_live_accounts_bundle(bundle_with(ACCOUNT_ID))["projectRef"]
        bindings = {
            "schema": "speaksharp.cloud-test.live-account-bindings.v1", "projectRef": project_ref,
            "projectOrigin": "https://%s.supabase.co" % project_ref, "sourceBundleSha256": "d" * 64,
            "campaignId": self.req["runId"], "roles": {
                "existing-disposable": {"accountId": account, "credentialVars": {"email": "THROWAWAY_TEST_EMAIL", "password": "THROWAWAY_TEST_PASSWORD"}},
                "maintained-read-only": {"accountId": "22222222-2222-4222-8222-222222222222",
                                         "credentialVars": {"email": "FREE_TEST_EMAIL", "password": "FREE_TEST_PASSWORD"}},
            },
        }
        for path, doc in ((scope_file, scope), (facts_file, dict(self.facts, **(facts_over or {}))),
                          (bindings_file, bindings), (req_file, self.req)):
            put(path, doc)
            os.chmod(path, 0o600)
        put(reconciliation_file, reconciliation())
        os.chmod(reconciliation_file, 0o600)
        # The REAL run_env.py gets the same project origin the binding resolver gets (VITE_SUPABASE_URL); BP_HOST_DB is never injected here,
        # because the live path never injected it either (run 42142985744 refused against https://undefined).
        r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "run_env.py"), "--request", req_file,
                            "--request-sha256", I._sha(req_file), "--reconciliation", reconciliation_file,
                            "--execution-deadline", plan_deadline or self.deadline, "--out", env_file],
                           capture_output=True, text=True, env=dict(os.environ, VITE_SUPABASE_URL="https://%s.supabase.co" % project_ref))
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(env_file, encoding="utf-8") as f:
            bp = dict(line.rstrip("\n").split("=", 1) for line in f if "=" in line)
        env = dict(bp, PATH=os.environ["PATH"], GITHUB_ACTIONS="true", GITHUB_REPOSITORY="relativityE/speaksharp", GITHUB_RUN_ID="123",
                   GITHUB_RUN_ATTEMPT="1", GITHUB_JOB="live", GITHUB_SHA="b" * 40, BP_FACTS=facts_file,
                   BP_ACCOUNT_BINDINGS_FILE=bindings_file)
        script = ("const b=require(process.argv[1]),{privateJson}=require(process.argv[2]),fs=require('node:fs');"
                  "const s=privateJson(process.argv[3],process.argv[4]);b.validateBindings(s,JSON.parse(fs.readFileSync(process.env.BP_FACTS)),process.env);"
                  "console.log('BOUND')")
        p = subprocess.run(["node", "-e", script, os.path.join(ROOT, "scripts", "authenticated_job_bootstrap.cjs"),
                            os.path.join(ROOT, "harness", "bundle", "harness", "with-authenticated-evidence.cjs"), scope_file, I._sha(scope_file)],
                           capture_output=True, text=True, env=env)
        return p.stdout.strip(), p.stderr

    def scope(self):
        return I.compose_scope(self.req, self.facts, ACCOUNT_ID, ["AHT-07"], "github-producer", self.deadline)

    def test_the_composed_scope_is_accepted_by_the_real_bootstrap(self):
        s = self.scope()
        self.assertEqual((s["caseIds"], s["campaignId"], s["sourceSha"]), (["AHT-07"], self.req["runId"], SHA))
        out, err = self.bind(s)
        self.assertEqual(out, "BOUND", err)

    def test_the_real_plan_environment_carries_the_project_host_and_a_missing_one_is_a_named_refusal(self):
        # Run 42142985744: the plan environment had no BP_HOST_DB, so the bootstrap compared bindings with https://undefined behind a
        # generic refusal. The real run_env.py now derives it from the resolver's origin, and refuses a producer run without one.
        s = self.scope()
        req_file = os.path.join(self.d, "req-host.json"); put(req_file, self.req); os.chmod(req_file, 0o600)
        rec = os.path.join(self.d, "rec-host.json"); put(rec, reconciliation()); os.chmod(rec, 0o600)
        env_file = os.path.join(self.d, "env-host.txt")
        base = {k: v for k, v in os.environ.items() if k != "VITE_SUPABASE_URL"}
        cmd = [sys.executable, "-I", os.path.join(ROOT, "scripts", "run_env.py"), "--request", req_file, "--request-sha256", I._sha(req_file),
               "--reconciliation", rec, "--execution-deadline", self.deadline, "--out", env_file]
        missing = subprocess.run(cmd, capture_output=True, text=True, env=base)
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn("project origin (VITE_SUPABASE_URL) is required", missing.stderr)
        for bad in ("http://abcdefghijklmnopqrst.supabase.co", "https://abcdefghijklmnopqrst.supabase.co:8443", "https://evil.example/"):
            self.assertNotEqual(subprocess.run(cmd, capture_output=True, text=True, env=dict(base, VITE_SUPABASE_URL=bad)).returncode, 0, bad)
        ok = subprocess.run(cmd, capture_output=True, text=True, env=dict(base, VITE_SUPABASE_URL="https://abcdefghijklmnopqrst.supabase.co"))
        self.assertEqual(ok.returncode, 0, ok.stderr)
        with open(env_file, encoding="utf-8") as f:
            self.assertIn("BP_HOST_DB=abcdefghijklmnopqrst.supabase.co\n", f.read())
        self.assertEqual(self.bind(s)[0], "BOUND")

    def through_execute_run(self, origin):
        """the PRODUCTION path, not a direct call. The real execute_run.sh functions build, ensure_account_bindings,
        plan_env_file and run_stage (env -i, then `. plan-env.txt`) run the real binding resolver, the real run_env.py and the real
        bootstrap CLI, which invokes the real plan builder. Returns (returncode, stderr, plan-env text)."""
        script = open(os.path.join(ROOT, "scripts", "execute_run.sh"), encoding="utf-8").read()
        fns = "".join(re.search(r"(?ms)^%s\(\) \{.*?^\}\n" % n, script).group(0) for n in ("run_stage", "ensure_account_bindings", "plan_env_file", "build"))
        d = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, d)
        out, inputs = os.path.join(d, "out"), os.path.join(d, "inputs")
        os.mkdir(out, 0o700); os.mkdir(inputs, 0o700)
        files = {}
        for name, doc in (("request.json", self.req), ("facts.json", self.facts), ("scope.json", self.scope())):
            files[name] = os.path.join(inputs, name); put(files[name], doc); os.chmod(files[name], 0o600)
        bundle = os.path.join(inputs, "live-accounts.json")
        with open(bundle, "wb") as f:                       # the workflow writes the bundle's canonical bytes (init_run_inputs prepare)
            f.write(I.canonical_bundle_bytes(I.parse_live_accounts_bundle(bundle_with(ACCOUNT_ID))))
        os.chmod(bundle, 0o600)
        put(os.path.join(out, "reconciliation.json"), reconciliation()); os.chmod(os.path.join(out, "reconciliation.json"), 0o600)
        env = {"PATH": os.environ["PATH"], "HOME": d, "GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "relativityE/speaksharp", "GITHUB_RUN_ID": "123",
               "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": "live", "GITHUB_SHA": "b" * 40, "VITE_SUPABASE_URL": origin,
               "VITE_SUPABASE_ANON_KEY": "anon-synthetic", "CT_OUT": out, "CT_PRIVATE_INPUT_DIR": inputs, "CT_CHECKOUT": os.path.dirname(os.path.dirname(ROOT)),
               "CT_FACTS_FILE": files["facts.json"], "CT_REQUEST": files["request.json"], "CT_REQUEST_SHA256": I._sha(files["request.json"]),
               "CT_EVIDENCE_SCOPE_FILE": files["scope.json"], "CT_EVIDENCE_SCOPE_SHA256": I._sha(files["scope.json"]),
               "CT_LIVE_ACCOUNTS_FILE": bundle, "CT_LIVE_ACCOUNTS_SHA256": I._sha(bundle), "CT_EXECUTION_DEADLINE": self.deadline}
        harness = ("set -euo pipefail\nROOT=%r\nREPO=%r\nCFG=%r\nREQ=%r\nROUTE=github-producer\nHP=%r\nOUT=%r\nSTAGE=build-plan\n"
                   "ss_broker_service_role=''\nss_broker_telemetry_key=''\nPYENV=(\"PATH=$PATH\" \"HOME=$HOME\")\n"
                   "blocked() { echo \"BLOCKED_SETUP: $*\" >&2; exit 78; }\n%s\nbuild \"$OUT/plan\"\n") % (
            ROOT, os.path.dirname(os.path.dirname(ROOT)), os.path.join(ROOT, "config", "test-config.v1.json"), files["request.json"],
            os.path.join(ROOT, "harness"), out, fns)
        r = subprocess.run(["bash", "-c", harness], capture_output=True, text=True, env=env, timeout=120)
        plan_env = os.path.join(out, "plan-env.txt")
        return r.returncode, r.stderr, open(plan_env, encoding="utf-8").read() if os.path.exists(plan_env) else None

    def test_the_production_path_carries_the_host_through_env_i_into_the_bootstrap_cli_and_reaches_the_builder(self):
        rc, err, plan_env = self.through_execute_run("https://abcdefghijklmnopqrst.supabase.co")
        self.assertIn("BP_HOST_DB=abcdefghijklmnopqrst.supabase.co\n", plan_env)
        # Past every binding check, the bootstrap reached the real plan builder (which refuses these synthetic inputs): never the host refusal.
        self.assertNotIn("PROJECT_HOST_REQUIRED", err)
        self.assertNotIn("bundle-project-mismatch", err)
        self.assertIn("NOT_RUN: AUTHENTICATED_JOB_PREPARATION_REFUSED PLAN_BUILD_REFUSED", err)

    def test_the_production_path_refuses_an_empty_malformed_or_other_project_host_before_the_bootstrap(self):
        for origin in ("", "not-a-url", "https://zzzzzzzzzzzzzzzzzzzz.supabase.co"):
            rc, err, _ = self.through_execute_run(origin)
            self.assertNotEqual(rc, 0, origin)
            self.assertNotIn("AUTHENTICATED_JOB_PREPARATION_REFUSED", err, origin)   # stopped before the bootstrap ever ran

    def test_the_real_bootstrap_refuses_another_account_or_review_reference(self):
        self.assertNotEqual(self.bind(self.scope(), account=ACCOUNT_ID.replace("1", "2"))[0], "BOUND")
        out, err = self.bind(self.scope(), facts_over={"producerReviewReference": "review:other@1"})
        self.assertNotEqual(out, "BOUND")
        self.assertIn("SELECTED_SCOPE_DIFFERS", err)

    def test_scope_limits_window_and_route_are_checked_before_composition(self):
        for lim in ({}, dict(self.LIMITS, maxDeliveries=0), dict(self.LIMITS, maxSupabaseRequests=257), dict(self.LIMITS, extra=1)):
            refused(self, "evidence-scope-limits", I.compose_scope, dict(self.req, evidenceScope=lim), self.facts, ACCOUNT_ID, ["AHT-07"], "github-producer",
                    self.deadline)
        r = copy.deepcopy(self.req); r["window"]["endUtc"] = utc(datetime.now(timezone.utc) + timedelta(hours=6))
        refused(self, "producer-scope-window-over-six-hours", I.compose_scope, r, self.facts, ACCOUNT_ID, ["AHT-07"], "github-producer", self.deadline)
        refused(self, "evidence-scope-only-for-producer-route", I.compose_scope, self.req, self.facts, ACCOUNT_ID, ["AHT-05"], "github-direct",
                self.deadline)
        self.assertIsNone(I.compose_scope(live_request(["AHT-05"]), self.facts, ACCOUNT_ID, ["AHT-05"], "github-direct", None))
        # The scope's deadline is the run's one execution deadline: missing, malformed or outside the occurrence refuses.
        w = self.req["window"]
        for bad in (None, "", "soon", w["startUtc"], utc(datetime.strptime(w["endUtc"], "%Y-%m-%dT%H:%M:%SZ") + timedelta(seconds=1))):
            refused(self, "execution-deadline-missing", I.compose_scope, self.req, self.facts, ACCOUNT_ID, ["AHT-07"], "github-producer", bad)
        self.assertEqual(self.scope()["deadlineAt"], self.deadline)
        self.assertNotEqual(self.deadline, w["endUtc"])

    def test_a_plan_deadline_other_than_the_scope_deadline_is_refused_by_the_real_bootstrap(self):
        """admission, producer and campaign bind ONE value. A plan built with any other deadline (the occurrence end, as
        before) cannot pair with the scope: the real bootstrap refuses it."""
        out, err = self.bind(self.scope(), plan_deadline=self.req["window"]["endUtc"])
        self.assertNotEqual(out, "BOUND")


class PrepareFailsClosedOnContinuity(unittest.TestCase):
    def test_every_other_binding_valid_still_refuses_without_a_verified_checkpoint_and_writes_nothing(self):
        repo = GitRepo()
        self.addCleanup(shutil.rmtree, repo.dir)
        req = live_request(["AHT-05"])
        now = datetime.now(timezone.utc)
        req["window"].update(startUtc=utc(now - timedelta(hours=1)), endUtc=utc(now + timedelta(hours=1, minutes=30)))
        release = repo.commit({"tools/cloud-test/config/test-config.v1.json": CFG})
        req["release"]["testedSha"] = release
        stray = copy.deepcopy(req); stray["release"]["testedSha"] = "b" * 40
        head = repo.commit({RUNS + "r6.json": req, RUNS + "stray.json": stray})
        out, env, outputs = (os.path.join(repo.dir, n) for n in ("out", "env", "outputs"))
        bundle = bundle_with(ACCOUNT_ID)

        def prepare(rel):
            argv = ["prepare", "--repo", repo.dir, "--config", "tools/cloud-test/config/test-config.v1.json", "--request", rel,
                    "--facts", json.dumps(facts()), "--run-id", "123", "--attempt", "1", "--source-sha", head,
                    "--job-timeout-minutes", "150", "--out", out, "--env-file", env, "--outputs", outputs]
            p = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "init_run_inputs.py"), *argv], capture_output=True, text=True,
                               env={"PATH": os.environ["PATH"], "CLOUD_TEST_LIVE_ACCOUNTS": bundle, "SUPABASE_URL": SUPABASE_URL_OK})
            self.assertNotIn(ACCOUNT_ID, p.stdout + p.stderr)
            self.assertNotIn("synthetic", p.stdout + p.stderr)
            self.assertFalse(any(os.path.exists(x) for x in (out, env, outputs)))
            return p.returncode, p.stderr.strip()

        self.assertEqual(prepare(RUNS + "r6.json"), (78, "BLOCKED_SETUP: continuity-inputs-missing"))
        self.assertEqual(prepare(RUNS + "stray.json"), (78, "BLOCKED_SETUP: request-release-not-in-source-history"))

    def test_admission_publishes_the_committed_request_digest_and_every_consumer_reads_a_private_copy_of_those_bytes(self):
        # The continuity contract is stubbed HERE ONLY, to observe what admission would hand the later steps.
        repo = GitRepo()
        self.addCleanup(shutil.rmtree, repo.dir)
        req = live_request(["AHT-05"])
        now = datetime.now(timezone.utc)
        req["window"].update(startUtc=utc(now - timedelta(hours=1)), endUtc=utc(now + timedelta(hours=1, minutes=30)))
        req["release"]["testedSha"] = repo.commit({"tools/cloud-test/config/test-config.v1.json": CFG})
        head = repo.commit({RUNS + "r6.json": req})
        out, env, outputs = (os.path.join(repo.dir, n) for n in ("out", "env", "outputs"))
        argv = ["init_run_inputs.py", "prepare", "--repo", repo.dir, "--config", "tools/cloud-test/config/test-config.v1.json", "--request",
                RUNS + "r6.json", "--facts", json.dumps(facts()), "--run-id", "123", "--attempt", "1", "--source-sha", head,
                "--job-timeout-minutes", "150", "--out", out, "--env-file", env, "--outputs", outputs]
        rc_bytes = b'{"ceilings":{"starts":120},"starts":{"ownerCounted":0}}\n'
        committed_sha = hashlib.sha256(repo.git("cat-file", "blob", head + ":" + RUNS + "r6.json").encode()).hexdigest()
        argv[argv.index("--facts") + 1] = json.dumps(facts(actionApproval=action_approval(req, committed_sha, rc_bytes)))
        with mock.patch.object(I, "checkpoint_and_scope", lambda repo_dir, request, **_: (rc_bytes, None)), \
                mock.patch.dict(os.environ, {"CLOUD_TEST_LIVE_ACCOUNTS": bundle_with(ACCOUNT_ID), "SUPABASE_URL": SUPABASE_URL_OK}):
            self.assertEqual(I.main(argv), 0)
        committed = repo.git("cat-file", "blob", head + ":" + RUNS + "r6.json").encode()
        with open(outputs, encoding="utf-8") as f:
            published = dict(line.split("=", 1) for line in f.read().splitlines())
        self.assertEqual(published["request_sha256"], hashlib.sha256(committed).hexdigest())
        # The continuity checkpoint's exact bytes, private, and their digest only as a step output (Increment I).
        reconciliation_file = os.path.join(out, "reconciliation.json")
        with open(reconciliation_file, "rb") as f:
            self.assertEqual(f.read(), rc_bytes)
        self.assertEqual(stat.S_IMODE(os.stat(reconciliation_file).st_mode), 0o600)
        self.assertEqual(published["reconciliation_sha256"], hashlib.sha256(rc_bytes).hexdigest())
        with open(env, encoding="utf-8") as f:
            ct_request = dict(line.split("=", 1) for line in f.read().splitlines())["CT_REQUEST"]
        self.assertEqual(ct_request, os.path.join(out, "request.json"), "consumers read the private admitted copy, not the workspace file")
        with open(ct_request, "rb") as f:
            self.assertEqual(f.read(), committed)
        self.assertEqual(stat.S_IMODE(os.stat(ct_request).st_mode), 0o600)
        # The validated bundle, canonical and private, for the per-case role consumers; only its digest is an output, never a value.
        with open(env, encoding="utf-8") as f:
            bundle_file = dict(line.split("=", 1) for line in f.read().splitlines())["CT_LIVE_ACCOUNTS_FILE"]
        self.assertEqual(bundle_file, os.path.join(out, "live-accounts.json"))
        self.assertEqual(stat.S_IMODE(os.stat(bundle_file).st_mode), 0o600)
        with open(bundle_file, "rb") as f:
            canonical = f.read()
        parsed = I.parse_live_accounts_bundle(bundle_with(ACCOUNT_ID))
        self.assertEqual(canonical, json.dumps({"version": 1, "projectRef": parsed["projectRef"], "accounts": parsed["accounts"]},
                                                sort_keys=True, separators=(",", ":")).encode() + b"\n", "canonical JSON plus exactly one LF")
        self.assertEqual(stat.S_IMODE(os.stat(out).st_mode), 0o700)
        self.assertEqual(published["live_accounts_sha256"], hashlib.sha256(canonical).hexdigest())
        with open(outputs, encoding="utf-8") as f:
            outputs_text = f.read()
        self.assertNotIn("synthetic", outputs_text)
        self.assertNotIn(ACCOUNT_ID, outputs_text)
        with open(env, encoding="utf-8") as f:
            env_names = {line.split("=", 1)[0] for line in f.read().splitlines()}
        self.assertFalse(env_names & {"CT_REQUEST_SHA256", "CT_LIVE_ACCOUNTS_SHA256"}, "admission digests never travel through $GITHUB_ENV")
        self.assertEqual(I.canonical_bundle_bytes(I.parse_live_accounts_bundle(canonical.decode())), canonical, "canonical bytes are a fixed point")
        # The window check accepts exactly those bytes, and refuses them once the workspace-style copy is rewritten.
        check = lambda: subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "init_run_inputs.py"), "window-check", "--request",
                                        ct_request, "--live-minutes", published["live_minutes"], "--request-sha256", published["request_sha256"],
                                        "--execution-deadline", published["execution_deadline"]],
                                       capture_output=True, text=True, env={"PATH": os.environ["PATH"]})
        self.assertEqual(check().returncode, 0, check().stderr)
        os.chmod(ct_request, 0o600)
        put(ct_request, dict(req, window=dict(req["window"], endUtc="2099-01-01T00:00:00Z")))
        self.assertEqual((check().returncode, check().stderr.strip()), (78, "BLOCKED_SETUP: request-changed-since-admission"))


class Qualify(unittest.TestCase):
    """Composition with the REAL verify_run_binding.py on a frozen snapshot of the builder's selected-full plan: all 15 plan.cases rows (driver
    and config bytes), the dispatch subset in plan.selection, and case results whose other rows are notSelected (campaign-core.cjs 116)."""

    SELECTED = ["AHT-05", "AHT-09"]
    CAMPAIGN = "C1"

    def setUp(self):
        self.d = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.d)
        adapters = os.path.join(self.d, "packet", "draft-adapters")
        os.makedirs(adapters)
        os.makedirs(os.path.join(self.d, "cfg"))
        rows, manifest = [], []
        for cid in I.ALL_CASES:
            driver, config = os.path.join(adapters, cid + ".cjs"), os.path.join(self.d, "cfg", cid + ".json")
            put(driver, "// %s driver\n" % cid)
            put(config, {"caseId": cid, "requiredAssertions": ["%s-a" % cid.lower(), "%s-b" % cid.lower()]})
            manifest.append("%s  draft-adapters/%s.cjs\n" % (self.sha(driver), cid))
            rows.append({"id": cid, "driverFile": driver, "driverSha256": self.sha(driver), "configFile": config, "configSha256": self.sha(config)})
        self.code = os.path.join(self.d, "packet", "CODE.sha256")
        put(self.code, "".join(manifest))
        self.plan = os.path.join(self.d, "campaign-plan.json")
        put(self.plan, {"campaignId": self.CAMPAIGN, "sourceSha": SHA, "servedSha": SHA, "coverageMode": "partial", "assertionDepth": "full", "cases": rows,
                        "selection": {"ids": list(self.SELECTED), "order": list(self.SELECTED), "ownerApprovalReference": "slack:1", "reason": "unit"}})
        self.approval = os.path.join(self.d, "security-approval.json")
        put(self.approval, {"reviewedCodeManifestSha256": self.sha(self.code)})
        self.cases = os.path.join(self.d, "cases")
        self.results = os.path.join(self.d, "case-results.json")
        for cid in self.SELECTED:
            self.write_case(cid, [("a", "PASS"), ("b", "PASS")])
        self.write_results()
        self.runs = 0

    @staticmethod
    def sha(p):
        with open(p, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()

    def write_case(self, cid, rows, result="PASS", refresh=True):
        os.makedirs(os.path.join(self.cases, cid), exist_ok=True)
        ev = os.path.join(self.cases, cid, cid.lower() + "-1.json")
        put(ev, {"contentSafe": True})
        put(os.path.join(self.cases, cid, "summary.json"), {"caseId": cid})
        put(os.path.join(self.cases, cid, "case-result.json"),
            {"caseId": cid, "sourceSha": SHA, "servedSha": SHA, "result": result,  # per-case receipt identities, as the stricter verifier requires
             "assertions": [{"id": "%s-%s" % (cid.lower(), i), "result": r} for i, r in rows],
             "evidenceDigests": {cid.lower() + "-1.json": self.sha(ev)}})
        if refresh and cid in self.SELECTED and os.path.exists(self.results):
            self.write_results()  # the campaign row follows its case, as the real runner writes both

    def write_results(self, rows=None, patch=None, **over):
        """The campaign case-results as the real runner writes them: each dispatched row carries the case's own result and assertions
        (campaign-core.cjs); unselected rows are notSelected. `patch` replaces or edits single rows for negative controls."""
        def row(c):
            if c in self.SELECTED:
                case = J(os.path.join(self.cases, c, "case-result.json"))
                return {"caseId": c, "result": case["result"], "assertions": case["assertions"],
                        "executionReceipt": {"summarySha256": self.sha(os.path.join(self.cases, c, "summary.json"))}}
            return {"caseId": c, "result": "NOT RUN", "notSelected": True, "requestsUsed": 0, "reason": "Not selected by the approved case selection"}
        built = rows or [row(c) for c in I.ALL_CASES]
        for c, change in (patch or {}).items():
            built = [change(dict(r)) if r["caseId"] == c else r for r in built]
        put(self.results, dict({"campaignId": self.CAMPAIGN, "sourceSha": SHA, "servedSha": SHA, "cases": built}, **over))

    def qualify(self, run_verifier=I._run_verifier, selected=None, mode="partial"):
        self.runs += 1
        request_file = os.path.join(self.d, "request-%d.json" % self.runs)
        put(request_file, self.request(selected, mode))
        ids = self.ids(request_file)
        return I.qualify(self.plan, self.results, self.cases, selected or self.SELECTED, self.approval, self.code,
                         os.path.join(self.d, "snapshot-%d" % self.runs), mode, ids, run_verifier)

    def request(self, selected=None, mode="partial"):
        """The committed request this campaign ran: runId = campaignId, the selection, the tested release and the harness CODE pin."""
        req = live_request(None if mode == "full" else list(selected or self.SELECTED), runId=self.CAMPAIGN)
        if mode == "smoke":
            req.update(coverageMode="smoke", sampleMode="smoke", priority="journey-smoke")
        req["release"]["testedSha"] = SHA
        req["harness"]["codeManifestSha256"] = self.sha(self.code)
        return req

    def ids(self, request_file, catalog=None):
        """identities shape over a synthetic catalog whose per-case sets are exactly this fixture's required assertions."""
        return {"requestSha256": self.sha(request_file), "request": J(request_file), "catalogSha256": "c" * 64,
                "catalog": catalog or {c: ["%s-a" % c.lower(), "%s-b" % c.lower()] for c in I.ALL_CASES}}

    def make_full(self):
        """The real full builder's shape: no partial markers, an explicit all-15 selection, every case dispatched with its receipts."""
        plan = J(self.plan)
        plan.pop("coverageMode"); plan.pop("assertionDepth")
        plan["selection"] = {"ids": list(I.ALL_CASES), "order": list(I.ALL_CASES), "ownerApprovalReference": "slack:1", "reason": "unit"}
        put(self.plan, plan)
        self.SELECTED = list(I.ALL_CASES)
        for cid in I.ALL_CASES:
            self.write_case(cid, [("a", "PASS"), ("b", "PASS")], refresh=False)
        self.write_results()

    def make_smoke(self):
        """The real smoke builder's shape: explicit smoke markers and all 15 cases selected."""
        plan = J(self.plan)
        plan["coverageMode"] = "smoke"
        plan["assertionDepth"] = "smoke"
        plan["selection"] = {"ids": list(I.ALL_CASES), "order": list(I.ALL_CASES),
                             "ownerApprovalReference": "slack:1", "reason": "unit smoke"}
        put(self.plan, plan)
        self.SELECTED = list(I.ALL_CASES)
        for cid in I.ALL_CASES:
            self.write_case(cid, [("a", "PASS"), ("b", "PASS")], refresh=False)
        self.write_results()

    def collect(self, request):
        """The REAL collector over the same case results (collect_run_record.py; campaign-runner rows carry their assertions)."""
        request["harness"]["codeManifestSha256"] = self.sha(self.code)  # the reviewed harness pin the run executed
        request_file = os.path.join(self.d, "request.json")
        put(request_file, request)
        request_sha = self.sha(request_file)
        results = J(self.results)
        plan_rows = {row["id"]: row for row in J(self.plan)["cases"]}
        for row in results["cases"]:
            if row["caseId"] in self.SELECTED:
                case = J(os.path.join(self.cases, row["caseId"], "case-result.json"))
                case_result = os.path.join(self.cases, row["caseId"], "case-result.json")
                summary = os.path.join(self.cases, row["caseId"], "summary.json")
                row.update(result=case["result"], assertions=case["assertions"], executionReceipt={
                    "schema": "speaksharp.cloud-test.case-execution-receipt.v1", "campaignId": request["runId"],
                    "runId": "123", "attempt": 1, "caseId": row["caseId"], "requestSha256": request_sha,
                    "planSha256": self.sha(self.plan), "configSha256": plan_rows[row["caseId"]]["configSha256"],
                    "sourceSha": results["sourceSha"], "servedSha": results["servedSha"],
                    "runtimeStartReceiptSha256": "a" * 64, "caseResultSha256": self.sha(case_result),
                    "summarySha256": self.sha(summary),
                })
        put(self.results, results)
        ledgers = os.path.join(self.d, "ledgers"); os.makedirs(ledgers, exist_ok=True)
        put(os.path.join(ledgers, "campaign-ledger.json"), {"used": {"total": 1}})
        put(os.path.join(ledgers, "identity-ledger.json"), {"identityGets": 1})
        for name, doc in (("gate-status.json", {"decision": "GO"}), ("runner.json", {})):
            put(os.path.join(self.d, name), doc)
        out = os.path.join(self.d, "run-record.json")
        p = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "collect_run_record.py"), "--request", os.path.join(self.d, "request.json"),
                            "--request-sha256", request_sha, "--execution-run-id", "123", "--attempt", "1",
                            "--case-results", self.results, "--cases-dir", self.cases, "--ledger-dir", ledgers,
                            "--gate-status", os.path.join(self.d, "gate-status.json"), "--workflow", os.path.join(ROOT, "workflow.json"),
                            "--runner-json", os.path.join(self.d, "runner.json"), "--started-utc", "2026-11-01T14:00:00Z",
                            "--ended-utc", "2026-11-01T14:30:00Z", "--out", out], capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        return J(out)

    def test_real_qualifier_collector_and_projection_compose_for_full_and_batch(self):
        for mode in ("partial", "full"):
            self.setUp()
            if mode == "full":
                self.make_full()
            request = live_request(None if mode == "full" else list(self.SELECTED), runId="C1")
            record = self.collect(request)
            q = self.qualify(mode=mode)
            rec = I.project(record, "123", 1, "c" * 40, SHA, q, q["requestSha256"], prov_of(q))
            self.assertEqual((rec["outcome"], rec["coverage"], rec["campaignId"], len(rec["cases"])),
                             ("passed", "full" if mode == "full" else "batch", "C1", 15), mode)
            self.assertEqual(sum(c["result"] == "NOT SELECTED" for c in rec["cases"]), 0 if mode == "full" else 13)
            self.assertEqual((rec["requestSha256"], rec["catalogSha256"]), (q["requestSha256"], q["catalogSha256"]))
            # a full claim against a selected-full plan, and the reverse, are refused by the qualifier itself
            if mode == "full":
                refused(self, "plan-not-a-selected-full-plan", self.qualify, mode="partial")
            else:
                # A "full" claim on a selected-full campaign is refused at the request binding, before any plan inspection.
                refused(self, "request-selection-mismatch", self.qualify, mode="full")
            # the collector's campaign is the request runId; a qualification for another campaign never passes
            other = I.project(dict(record, runId="C2"), "123", 1, "c" * 40, SHA, q, q["requestSha256"], prov_of(q))
            self.assertEqual((other["outcome"], other["coverage"]), ("failed", "unqualified"), mode)

    def test_smoke_qualifies_projects_publishes_and_stays_out_of_acceptance_history(self):
        self.make_smoke()
        request = self.request(mode="smoke")
        record = self.collect(request)
        q = self.qualify(mode="smoke")
        with open(self.results, "rb") as f:
            case_results_raw = f.read()
        request_path = os.path.join(self.d, "request-%d.json" % self.runs)
        with open(request_path, "rb") as f:
            request_raw = f.read()
        catalog = {"cases": {cid: {"requiredAssertions": ["%s-a" % cid.lower(), "%s-b" % cid.lower()]}
                             for cid in I.ALL_CASES}}
        rec = I.project(record, "123", 1, "c" * 40, SHA, q, q["requestSha256"], prov_of(q),
                        case_results_raw, catalog, request_raw, b"synthetic-smoke-media")
        self.assertEqual((q["coverage"], q["outcome"], rec["coverage"], rec["outcome"]),
                         ("smoke", "passed", "smoke", "passed"))
        clean = I.LR.sanitize_record(rec)
        running = I.LR.begin(I.LR.parse_body(""), "123", 1, "c" * 40, record["startedUtc"])
        pending = I.LR.pending_completion(running, clean, "2026-11-01T14:40:00Z", "8" * 64, "9" * 64)
        self.assertEqual(I.LR.parse_body(I.LR.render(pending))["pendingCompletion"]["record"]["coverage"], "smoke")
        done = I.LR.complete(running, clean)
        self.assertEqual((done["history"]["occurrences"][0]["coverage"], done["history"]["occurrences"][0]["rowEvidence"]),
                         ("smoke", False))
        self.assertEqual(done["history"]["rows"], {})
        self.assertEqual(I.LR.qualified_comparable(done["history"], clean["comparability"]), [])
        self.assertEqual(I.LR.parse_body(I.LR.render(done)), done)

    def make_selected_smoke(self, selected):
        """The real smoke builder's shape for the R10 one-case attempt (run_env BP_SELECT): smoke markers, the fifteen-row denominator, only the
        selected cases dispatched; the other rows notSelected."""
        plan = J(self.plan)
        plan.update(campaignId=self.CAMPAIGN, coverageMode="smoke", assertionDepth="smoke",
                    selection={"ids": list(selected), "order": list(selected), "ownerApprovalReference": "slack:1", "reason": "unit one case"})
        put(self.plan, plan)
        self.SELECTED = list(selected)
        for cid in os.listdir(self.cases):      # the setUp fixture's own dispatched cases are not part of this campaign
            if cid not in selected:
                shutil.rmtree(os.path.join(self.cases, cid))
        for cid in selected:
            self.write_case(cid, [("a", "PASS"), ("b", "PASS")], refresh=False)
        self.write_results()

    def test_the_r10_selected_aht01_smoke_qualifies_projects_and_publishes_with_fifteen_display_rows(self):
        """a SUCCESSFUL selected-AHT-01 smoke must not become another unpublishable record. The real verifier, qualifier,
        collector, projection and latest-record publisher compose: only AHT-01's own smoke assertions qualify; the display keeps fifteen rows
        with fourteen NOT SELECTED; the record completes as smoke, outside acceptance history."""
        self.CAMPAIGN = I.R10_ONE_OFF_RUN_ID
        self.setUp()
        self.make_selected_smoke(["AHT-01"])
        request = self.request(["AHT-01"], mode="smoke")
        record = self.collect(request)
        q = self.qualify(selected=["AHT-01"], mode="smoke")
        self.assertEqual((q["coverage"], q["outcome"], q["campaignId"], q["cases"]), ("smoke", "passed", I.R10_ONE_OFF_RUN_ID, ["AHT-01"]))
        with open(self.results, "rb") as f:
            case_results_raw = f.read()
        with open(os.path.join(self.d, "request-%d.json" % self.runs), "rb") as f:
            request_raw = f.read()
        catalog = {"cases": {cid: {"requiredAssertions": ["%s-a" % cid.lower(), "%s-b" % cid.lower()]} for cid in I.ALL_CASES}}
        rec = I.project(record, "123", 1, "c" * 40, SHA, q, q["requestSha256"], prov_of(q),
                        case_results_raw, catalog, request_raw, b"synthetic-smoke-media")
        self.assertEqual((rec["coverage"], rec["outcome"], rec["campaignId"], len(rec["cases"])), ("smoke", "passed", I.R10_ONE_OFF_RUN_ID, 15))
        self.assertEqual([c["caseId"] for c in rec["cases"] if c["result"] != "NOT SELECTED"], ["AHT-01"])
        self.assertEqual(sum(c["result"] == "NOT SELECTED" for c in rec["cases"]), 14)
        self.assertEqual(next(c for c in rec["cases"] if c["caseId"] == "AHT-01")["result"], "PASS")
        clean = I.LR.sanitize_record(rec)
        with self.assertRaisesRegex(I.LR.Refused, "not-selected-rows"):     # NOT SELECTED smoke rows only for the R10 one-off campaign
            I.LR.sanitize_record(dict(rec, campaignId="C1"))
        running = I.LR.begin(I.LR.parse_body(""), "123", 1, "c" * 40, record["startedUtc"])
        pending = I.LR.pending_completion(running, clean, "2026-11-01T14:40:00Z", "8" * 64, "9" * 64)
        self.assertEqual(I.LR.parse_body(I.LR.render(pending))["pendingCompletion"]["record"]["coverage"], "smoke")
        done = I.LR.complete(running, clean)
        self.assertEqual(I.LR.parse_body(I.LR.render(done)), done)
        self.assertEqual((done["latestCompleted"]["outcome"], done["history"]["occurrences"][0]["coverage"]), ("passed", "smoke"))
        self.assertEqual(done["history"]["rows"], {}, "smoke never enters acceptance history")
        # a failing AHT-01 row stays a qualified FAIL, publishable as such
        self.write_case("AHT-01", [("a", "PASS"), ("b", "FAIL")], "FAIL")
        q2 = self.qualify(selected=["AHT-01"], mode="smoke")
        self.assertEqual((q2["coverage"], q2["outcome"]), ("smoke", "failed"))

    def test_a_smoke_subset_of_any_other_campaign_never_qualifies(self):
        self.make_selected_smoke(["AHT-01"])
        refused(self, "plan-not-an-all-fifteen-smoke-plan", self.qualify, selected=["AHT-01"], mode="smoke")

    def test_incomplete_smoke_keeps_its_source_depth_and_never_becomes_acceptance_history(self):
        """The real frozen verifier/qualifier/project/pending/readback/complete path for the reviewer's incomplete-smoke RETURN."""
        self.make_smoke()
        self.write_case("AHT-15", [("a", "PASS"), ("b", "NOT RUN")], "NOT RUN")
        request = self.request(mode="smoke")
        record = self.collect(request)
        q = self.qualify(mode="smoke")
        self.assertEqual((q["coverageMode"], q["assertionDepth"], q["coverage"], q["outcome"]),
                         ("smoke", "smoke", "incomplete", "failed"))
        with open(self.results, "rb") as f:
            case_results_raw = f.read()
        request_path = os.path.join(self.d, "request-%d.json" % self.runs)
        with open(request_path, "rb") as f:
            request_raw = f.read()
        catalog = {"cases": {cid: {"requiredAssertions": ["%s-a" % cid.lower(), "%s-b" % cid.lower()]}
                             for cid in I.ALL_CASES}}
        rec = I.project(record, "123", 1, "c" * 40, SHA, q, q["requestSha256"], prov_of(q),
                        case_results_raw, catalog, request_raw, b"synthetic-smoke-media")
        self.assertEqual((rec["coverageMode"], rec["assertionDepth"], rec["coverage"], rec["outcome"]),
                         ("smoke", "smoke", "incomplete", "failed"))
        clean = I.LR.sanitize_record(rec)
        running = I.LR.begin(I.LR.parse_body(""), "123", 1, "c" * 40, record["startedUtc"])
        pending = I.LR.pending_completion(running, clean, "2026-11-01T14:40:00Z", "8" * 64, "9" * 64)
        reread = I.LR.parse_body(I.LR.render(pending))["pendingCompletion"]["record"]
        self.assertEqual((reread["coverageMode"], reread["coverage"]), ("smoke", "incomplete"))
        done = I.LR.complete(running, clean)
        self.assertEqual((done["history"]["occurrences"][0]["coverageMode"],
                          done["history"]["occurrences"][0]["coverage"],
                          done["history"]["occurrences"][0]["rowEvidence"]), ("smoke", "incomplete", False))
        self.assertEqual(done["history"]["rows"], {})
        self.assertEqual(I.LR.qualified_comparable(done["history"], clean["comparability"]), [])

        # A second incomplete smoke remains diagnostic, and a later acceptance record with a different catalog is not blocked by either.
        second = dict(clean, runId="124", startedUtc="2026-11-01T14:41:00Z", endedUtc="2026-11-01T15:00:00Z")
        twice = I.LR.complete(I.LR.begin(done, "124", 1, "c" * 40, second["startedUtc"]), second)
        self.assertEqual(I.LR.qualified_comparable(twice["history"], clean["comparability"]), [])
        batch = I.LR.sanitize_record({"runId": "125", "attempt": 1, "sourceSha": "c" * 40, "testedSha": SHA,
            "servedSha": SHA, "campaignId": "later-full-depth", "coverage": "batch", "coverageMode": "partial",
            "assertionDepth": "full", "requestSha256": "d" * 64, "catalogSha256": "e" * 64,
            "startedUtc": "2026-11-01T15:01:00Z", "endedUtc": "2026-11-01T15:20:00Z", "outcome": "passed",
            "cases": [{"caseId": "AHT-05", "result": "PASS", "rows": {"pass": 1, "fail": 0, "notRun": 0}, "codes": []}],
            "codes": [], "rowVerdicts": {"AHT-05": "P"}, "comparability": clean["comparability"],
            "evidence": {"planSha256": "f" * 64, "caseResultsSha256": "0" * 64}})
        accepted = I.LR.complete(I.LR.begin(twice, "125", 1, "c" * 40, batch["startedUtc"]), batch)
        self.assertEqual(accepted["history"]["rows"]["AHT-05"]["last"]["runId"], "125")

    def test_a_request_substituted_after_admission_keeping_the_five_checked_fields_never_qualifies(self):
        # the five execution-identity checks (runId, selection, tested release, mode, harness CODE pin) do not bind the
        # request blob. Substitute window, approval and budget fields after admission while preserving those five exactly.
        record = self.collect(live_request(list(self.SELECTED), runId="C1"))
        request_file = os.path.join(self.d, "admitted.json")
        put(request_file, self.request())
        admitted = self.sha(request_file)
        substitute = self.request()
        substitute["window"].update(endUtc="2099-01-01T00:00:00Z", approvalRef="slack:1000000014.000014")
        substitute["selectionApprovalRef"] = "slack:1000000015.000015"
        substitute["approvedLimits"].update(runCapRequests=4000, cumulativeCeilingRequests=99999, identityCap=999, approvalRef="slack:1000000016.000016")
        substitute["estimate"]["requests"]["runCap"] = 4000
        self.assertEqual({k: substitute[k] for k in ("runId", "selection", "release", "coverageMode", "harness")},
                         {k: self.request()[k] for k in ("runId", "selection", "release", "coverageMode", "harness")})
        put(request_file, substitute)
        # The five field checks alone accept the substitute: they are not a blob binding.
        q = I.qualify(self.plan, self.results, self.cases, self.SELECTED, self.approval, self.code, os.path.join(self.d, "snapshot-substitute"),
                      "partial", self.ids(request_file))
        self.assertEqual((q["qualified"], q["outcome"]), (True, "passed"))
        self.assertNotEqual(q["requestSha256"], admitted)
        # The admission digest refuses it at qualification (bytes read once, hashed and parsed from the same bytes)...
        refused(self, "request-changed-since-admission", I.identities, request_file, "config-not-reached", admitted)
        for bad in (None, "", "1" * 63, "A" * 64, admitted.upper()):
            refused(self, "admitted-request-digest", I.admitted_request, request_file, bad)
        # ...and a qualification bound to any other request never projects as qualified.
        for digest in (admitted, None, "x"):
            rec = I.project(record, "123", 1, "c" * 40, SHA, q, digest)
            self.assertEqual((rec["outcome"], rec["coverage"], rec["requestSha256"], rec["codes"]), ("failed", "unqualified", None, ["not-qualified"]), digest)
        self.assertEqual(I.project(record, "123", 1, "c" * 40, SHA, q, q["requestSha256"], prov_of(q))["outcome"], "passed", "the same bytes still bind")

    def test_a_complete_authenticated_fail_baseline_is_full_and_failed(self):
        # every required row executed (PASS or FAIL) is full coverage; FAILs make the outcome failed, never unqualified.
        self.make_full()
        self.write_case("AHT-03", [("a", "PASS"), ("b", "FAIL")], "FAIL")
        self.write_case("AHT-12", [("a", "FAIL"), ("b", "FAIL")], "FAIL")
        self.write_results()
        record = self.collect(live_request(runId="C1"))
        q = self.qualify(mode="full")
        self.assertEqual((q["qualified"], q["coverage"], q["outcome"], q["requiredRows"], q["passRows"], q["failRows"], q["notRunRows"]),
                         (True, "full", "failed", 30, 27, 3, 0))
        self.assertEqual(J(os.path.join(self.d, "snapshot-%d" % self.runs, "verification.json"))["failed"], 0)
        rec = I.project(record, "123", 1, "c" * 40, SHA, q, q["requestSha256"], prov_of(q))
        self.assertEqual((rec["coverage"], rec["outcome"], rec["codes"], len(rec["cases"])), ("full", "failed", [], 15))
        self.assertEqual(sorted(c["caseId"] for c in rec["cases"] if c["result"] == "FAIL"), ["AHT-03", "AHT-12"])

    def test_a_not_run_or_missing_required_row_is_incomplete_never_full(self):
        for rows, result in ([("a", "PASS"), ("b", "NOT RUN")], "NOT RUN"), ([("a", "PASS")], "PASS"):
            self.setUp()
            self.write_case("AHT-09", rows, result)
            self.write_results()
            q = self.qualify()
            self.assertEqual((q["coverage"], q["outcome"], q["notRunRows"]), ("incomplete", "failed", 1), rows)

    def test_verifier_errors_malformed_evidence_and_missing_rows_never_qualify(self):
        # Real verify_run_binding semantics: a dispatched case without its case-result.json, or with unreadable JSON, makes it exit non-zero.
        os.remove(os.path.join(self.cases, "AHT-09", "case-result.json"))
        refused(self, "binding-verifier-failed", self.qualify)
        self.setUp()
        put(os.path.join(self.cases, "AHT-09", "case-result.json"), "{not json")
        refused(self, "binding-verifier-failed", self.qualify)
        self.setUp()
        put(os.path.join(self.cases, "AHT-09", "aht-09-1.json"), {"tampered": True})  # evidence no longer matches its digest
        refused(self, "binding-verifier-failed", self.qualify)
        self.setUp()
        self.write_case("AHT-09", [("a", "PASS"), ("b", "FAIL")], "PASS")  # the harness case result contradicts its rows
        refused(self, "case-result-inconsistent:AHT-09", self.qualify)
        self.setUp()
        self.write_case("AHT-09", [("a", "PASS"), ("b", "MAYBE")], "PASS")
        refused(self, "assertion-result-unknown:AHT-09", self.qualify)

    def test_required_assertions_must_be_exactly_the_catalog_set(self):
        # Remove a required assertion from AHT-09's config and refresh the plan's config digest: every hash stays coherent, the case can
        # even PASS, but it no longer covers the catalog (the reviewer RETURN 546429c4 #1).
        config = os.path.join(self.d, "cfg", "AHT-09.json")
        put(config, {"caseId": "AHT-09", "requiredAssertions": ["aht-09-a"]})
        plan = J(self.plan)
        for row in plan["cases"]:
            if row["id"] == "AHT-09":
                row["configSha256"] = self.sha(config)
        put(self.plan, plan)
        self.write_case("AHT-09", [("a", "PASS")], "PASS")
        refused(self, "required-assertions-not-the-catalog:AHT-09", self.qualify)
        # And a catalog that requires more than the config declares refuses the same way.
        self.setUp()
        catalog = {c: ["%s-a" % c.lower(), "%s-b" % c.lower()] for c in I.ALL_CASES}
        catalog["AHT-05"].append("aht-05-c")
        put(os.path.join(self.d, "req.json"), self.request())
        refused(self, "required-assertions-not-the-catalog:AHT-05", I.qualify, self.plan, self.results, self.cases, self.SELECTED, self.approval,
                self.code, os.path.join(self.d, "snapshot-cat"), "partial", self.ids(os.path.join(self.d, "req.json"), catalog))

    def test_a_substituted_request_refuses(self):
        for code, mutate in (("request-campaign-mismatch", lambda r: r.update(runId="C2")),
                             ("request-selection-mismatch", lambda r: r.update(selection=r["selection"][:1])),
                             ("request-release-mismatch", lambda r: r["release"].update(testedSha="b" * 40)),
                             ("request-mode-mismatch", lambda r: r.update(coverageMode="full")),
                             ("request-harness-mismatch", lambda r: r["harness"].update(codeManifestSha256="0" * 64))):
            self.runs += 1
            req = self.request()
            mutate(req)
            path = os.path.join(self.d, "sub-%d.json" % self.runs)
            put(path, req)
            refused(self, code, I.qualify, self.plan, self.results, self.cases, self.SELECTED, self.approval, self.code,
                    os.path.join(self.d, "snapshot-sub-%d" % self.runs), "partial", self.ids(path))

    def test_a_campaign_row_that_contradicts_its_case_file_refuses_even_when_the_outcome_is_failed(self):
        # AHT-09 genuinely FAILs (overall outcome failed either way); the campaign row reports a different status for one assertion.
        self.write_case("AHT-09", [("a", "PASS"), ("b", "FAIL")], "FAIL")
        self.write_results(patch={"AHT-09": lambda r: {**r, "assertions": [{"id": "aht-09-a", "result": "FAIL"}, {"id": "aht-09-b", "result": "FAIL"}]}})
        refused(self, "campaign-row-disagrees:AHT-09", self.qualify)
        for change in (lambda r: {**r, "result": "PASS"}, lambda r: {**r, "assertions": r["assertions"][:1]},
                       lambda r: {**r, "assertions": r["assertions"] + [{"id": "aht-09-z", "result": "FAIL"}]},
                       lambda r: {k: v for k, v in r.items() if k != "assertions"}):
            self.write_results(patch={"AHT-09": change})
            refused(self, "campaign-row-disagrees:AHT-09", self.qualify)
        self.write_results()
        self.assertEqual(self.qualify()["outcome"], "failed", "the agreeing artifacts qualify as failed")

    def test_the_assertion_catalog_must_be_the_pinned_bytes(self):
        cfg = copy.deepcopy(CFG)
        cfg["modes"]["full"]["assertionCatalog"]["sha256"] = "0" * 64
        d = os.path.join(self.d, "cfgroot", "config")
        os.makedirs(d)
        put(os.path.join(d, "test-config.v1.json"), cfg)
        shutil.copy(os.path.join(ROOT, cfg["modes"]["full"]["assertionCatalog"]["file"]), os.path.join(d, os.path.basename(cfg["modes"]["full"]["assertionCatalog"]["file"])))
        put(os.path.join(self.d, "r.json"), {})
        refused(self, "assertion-catalog-not-pinned", I.identities, os.path.join(self.d, "r.json"), os.path.join(d, "test-config.v1.json"),
                self.sha(os.path.join(self.d, "r.json")))

    def test_the_real_verifier_on_the_frozen_snapshot_and_every_selected_row_pass_qualifies_with_bindings(self):
        q = self.qualify()
        self.assertEqual({k: q[k] for k in ("qualified", "campaignId", "testedSha", "servedSha", "cases", "coverage", "outcome", "planCases",
                                            "requiredRows", "passRows", "failRows", "notRunRows")},
                         {"qualified": True, "campaignId": "C1", "testedSha": SHA, "servedSha": SHA, "cases": self.SELECTED, "coverage": "batch",
                          "outcome": "passed", "planCases": 15, "requiredRows": 4, "passRows": 4, "failRows": 0, "notRunRows": 0})
        self.assertEqual(q["codeManifestSha256"], self.sha(self.code))
        self.assertEqual(q["catalogSha256"], "c" * 64, "the fixture's synthetic catalog; identities() pins the real one")
        self.assertEqual((q["planSha256"], q["caseResultsSha256"]), (self.sha(self.plan), self.sha(self.results)))
        snap = os.path.join(self.d, "snapshot-1")
        self.assertEqual(J(os.path.join(snap, "verification.json"))["failed"], 0)
        self.assertEqual(stat.S_IMODE(os.stat(snap).st_mode), 0o700)

    def test_verifier_success_never_passes_a_failed_row_and_a_duplicate_refuses(self):
        self.write_case("AHT-09", [("a", "PASS"), ("b", "FAIL")], "FAIL")
        q = self.qualify()
        self.assertEqual((q["coverage"], q["outcome"], q["failRows"]), ("batch", "failed", 1))
        self.write_case("AHT-09", [("a", "PASS"), ("b", "FAIL"), ("b", "PASS")], "FAIL")
        refused(self, "duplicate-assertion:AHT-09", self.qualify)
        self.assertEqual(J(os.path.join(self.d, "snapshot-%d" % self.runs, "verification.json"))["failed"], 0, "the verifier itself passes")

    def test_omitted_inputs_are_frozen_and_verified_too(self):
        mutations = {"approval": lambda: put(self.approval, {"reviewedCodeManifestSha256": "0" * 64}),
                     "listed packet file": lambda: put(os.path.join(self.d, "packet", "draft-adapters", "AHT-01.cjs"), "// changed\n"),
                     "planned driver": lambda: put(os.path.join(self.d, "packet", "draft-adapters", "AHT-09.cjs"), "// changed\n"),
                     "summary": lambda: put(os.path.join(self.cases, "AHT-09", "summary.json"), {"caseId": "other"}),
                     "evidence": lambda: put(os.path.join(self.cases, "AHT-09", "aht-09-1.json"), {"changed": True}),
                     }
        for name, mutate in mutations.items():
            self.setUp()
            mutate()
            refused(self, "binding-verifier-failed", self.qualify)
        # The verifier skips undispatched rows, so qualify checks every planned byte against the plan's own digests.
        self.setUp()
        put(os.path.join(self.d, "cfg", "AHT-01.json"), {"changed": True})
        refused(self, "planned-bytes-differ:AHT-01", self.qualify)

    def test_a_failed_missing_or_stale_verifier_output_is_refused(self):
        def passing_then(rc, write=True, stale=False):
            def run(*a):
                real = I._run_verifier(*a)
                self.assertEqual(real, 0)
                if not write:
                    os.remove(a[-1])
                elif stale:
                    v = J(a[-1]); v["caseResultsSha256"] = "0" * 64; put(a[-1], v)
                return rc
            return run
        refused(self, "binding-verifier-failed", self.qualify, passing_then(1))
        refused(self, "binding-verification-missing", self.qualify, passing_then(0, write=False))
        refused(self, "binding-verification-stale", self.qualify, passing_then(0, stale=True))

    def test_originals_swapped_during_verification_and_restored_cannot_change_the_result(self):
        originals = [self.plan, self.results, self.approval, self.code, os.path.join(self.cases, "AHT-09", "case-result.json"),
                     os.path.join(self.d, "cfg", "AHT-09.json"), os.path.join(self.d, "packet", "draft-adapters", "AHT-09.cjs")]

        def swap_restore(*a):
            saved = {}
            for p in originals:
                with open(p, "rb") as f:
                    saved[p] = f.read()
            for p in originals:
                with open(p, "wb") as f:
                    f.write(b"garbage")
            try:
                self.assertTrue(all(os.path.commonpath([x, self.d]) == self.d and "snapshot-" in x for x in a))
                return I._run_verifier(*a)
            finally:
                for p, data in saved.items():
                    with open(p, "wb") as f:
                        f.write(data)
        self.assertTrue(self.qualify(swap_restore)["qualified"])
        self.write_case("AHT-09", [("a", "PASS"), ("b", "FAIL")], "FAIL")
        self.write_results()
        self.assertEqual(self.qualify(swap_restore)["outcome"], "failed", "the frozen FAIL decides, not the swapped bytes")

    def test_a_snapshot_changed_during_verification_is_refused(self):
        def tamper(*a):
            rc = I._run_verifier(*a)
            put(os.path.join(os.path.dirname(a[0]), "cases", "AHT-09", "case-result.json"), {"caseId": "AHT-09"})
            return rc
        refused(self, "snapshot-changed-during-verification", self.qualify, tamper)

    def test_undispatched_unselected_dispatched_denominator_and_selection_controls(self):
        self.write_results(patch={"AHT-09": lambda r: {**r, "reason": "not dispatched"}})
        refused(self, "case-not-dispatched:AHT-09", self.qualify)
        self.setUp()
        self.write_case("AHT-01", [("a", "PASS"), ("b", "PASS")])  # receipts present, so the verifier itself passes
        self.write_results(patch={"AHT-01": lambda r: {"caseId": "AHT-01"}})
        refused(self, "unselected-case-dispatched:AHT-01", self.qualify)
        self.setUp()
        self.write_results(campaignId="C2")
        refused(self, "binding-verifier-failed", self.qualify)
        self.setUp()
        refused(self, "plan-selection-not-the-selected-cases", self.qualify, I._run_verifier, ["AHT-05"])
        plan = J(self.plan); plan["cases"] = [r for r in plan["cases"] if r["id"] in self.SELECTED]
        put(self.plan, plan)
        refused(self, "plan-denominator-not-fifteen", self.qualify)
        plan["cases"] = plan["cases"] + plan["cases"][:1]
        put(self.plan, plan)
        refused(self, "duplicate-plan-case", self.qualify)


class Project(unittest.TestCase):
    """The real collector keeps all 15 rows; qualification binds to THIS record's case-results digest and releases (the reviewer RETURN 3e0279d6 #3)."""

    def record(self):
        rows = [{"case": c, "result": "PASS" if c in ("AHT-05", "AHT-09") else "NOT RUN", "reason": None if c in ("AHT-05", "AHT-09") else "Not selected",
                 "assertions": {"PASS": 2, "FAIL": 0, "NOT RUN": 0} if c in ("AHT-05", "AHT-09") else {"PASS": 0, "FAIL": 0, "NOT RUN": 0}}
                for c in I.ALL_CASES]
        return {"schema": "speaksharp.cloud-test.run-record.v1", "runId": "R6-unit", "release": {"testedSha": SHA, "servedShaAtAdmission": SHA},
                "startedUtc": "2026-11-01T14:00:00Z", "endedUtc": "2026-11-01T14:30:00Z", "cases": rows, "artifactDigests": {"case-results.json": "d" * 64},
                "harness": {"codeManifestSha256": "f" * 64}}

    def q(self, **over):
        value = dict({"qualified": True, "campaignId": "R6-unit", "testedSha": SHA, "servedSha": SHA, "caseResultsSha256": "d" * 64,
                      "planSha256": "e" * 64, "cases": ["AHT-05", "AHT-09"], "coverageMode": "partial", "assertionDepth": "full",
                      "coverage": "batch", "outcome": "passed",
                      "codeManifestSha256": "f" * 64, "requestSha256": "1" * 64, "catalogSha256": "2" * 64}, **over)
        if over.get("coverage") == "full" and "coverageMode" not in over:
            value.update(coverageMode="full", assertionDepth="full")
        elif over.get("coverage") == "smoke" and "coverageMode" not in over:
            value.update(coverageMode="smoke", assertionDepth="smoke")
        return value

    def project(self, *a):
        """Projection against the admitted request digest and the execution-provenance verdict this qualification fixture is bound to."""
        return I.project(*a, "1" * 64, prov_of(a[5] if len(a) > 5 else None))

    def test_the_verdict_must_name_the_collectors_case_results_too(self):
        # The qualification and the verdict agree with each other but not with the collector's recorded case-results digest.
        q, record = self.q(caseResultsSha256="b" * 64), self.record()
        rec = I.project(record, "123", 1, "c" * 40, SHA, q, "1" * 64, prov_of(q))
        self.assertEqual(rec["coverage"], "unqualified")
        rec = I.project(record, "123", 2, "c" * 40, SHA, self.q(), "1" * 64, prov_of(self.q()))
        self.assertEqual(rec["coverage"], "unqualified", "a rerun attempt never projects as qualified")

    def test_no_or_a_foreign_execution_provenance_verdict_never_qualifies(self):
        q = self.q()
        self.assertEqual(self.project(self.record(), "123", 1, "c" * 40, SHA, q)["coverage"], "batch")
        # A-qualified / B-provenance: a verdict for another results snapshot under the same plan; a foreign run, attempt or campaign.
        for prov in (None, {}, dict(prov_of(q), requestSha256="0" * 64), dict(prov_of(q), planSha256="0" * 64),
                     dict(prov_of(q), cases=["AHT-05"]), dict(prov_of(q), cases=["AHT-09", "AHT-05"]),
                     dict(prov_of(q), caseResultsSha256="b" * 64), dict(prov_of(q), runId="124"), dict(prov_of(q), runId=123),
                     dict(prov_of(q), attempt=2), dict(prov_of(q), attempt=True), dict(prov_of(q), campaignId="R6-other")):
            rec = I.project(self.record(), "123", 1, "c" * 40, SHA, q, "1" * 64, prov)
            self.assertEqual((rec["outcome"], rec["coverage"], rec["codes"]), ("failed", "unqualified", ["not-qualified"]), prov)

    def test_a_bound_batch_keeps_all_fifteen_rows_with_the_others_not_selected(self):
        rec = self.project(self.record(), "123", 1, "c" * 40, SHA, self.q())
        self.assertEqual((rec["outcome"], rec["coverage"], rec["campaignId"], len(rec["cases"])), ("passed", "batch", "R6-unit", 15))
        self.assertEqual(sorted(c["caseId"] for c in rec["cases"] if c["result"] == "PASS"), ["AHT-05", "AHT-09"])
        self.assertEqual({c["result"] for c in rec["cases"] if c["caseId"] not in ("AHT-05", "AHT-09")}, {"NOT SELECTED"})
        self.assertEqual((rec["sourceSha"], rec["testedSha"], rec["servedSha"]), ("c" * 40, SHA, SHA))

    def test_the_campaign_must_match_exactly_on_both_sides(self):
        for record_run, q_campaign in (("R6-other", "R6-unit"), ("R6-unit", "R6-other"), ("", ""), (None, None), ("R6-unit", None)):
            rec = self.project(dict(self.record(), runId=record_run), "123", 1, "c" * 40, SHA, self.q(campaignId=q_campaign))
            self.assertEqual((rec["outcome"], rec["coverage"], rec["campaignId"]), ("failed", "unqualified", None), (record_run, q_campaign))
        self.assertEqual(self.project(self.record(), "123", 1, "c" * 40, SHA, self.q())["campaignId"], "R6-unit")

    def test_a_qualification_for_another_record_campaign_or_release_never_passes(self):
        for over in ({"caseResultsSha256": "f" * 64}, {"servedSha": "b" * 40}, {"testedSha": "b" * 40}, {"qualified": False},
                     {"coverage": "unqualified"}, {"cases": ["AHT-05", "AHT-16"]}, {"codeManifestSha256": "0" * 64}, {"outcome": None}):
            rec = self.project(self.record(), "123", 1, "c" * 40, SHA, self.q(**over))
            self.assertEqual((rec["outcome"], rec["coverage"], rec["codes"]), ("failed", "unqualified", ["not-qualified"]), over)
            self.assertNotIn("NOT SELECTED", {c["result"] for c in rec["cases"]})
        rec = self.project(self.record(), "123", 1, "c" * 40, SHA, None)
        self.assertEqual((rec["outcome"], rec["codes"]), ("failed", ["not-qualified"]))
        for admitted in ("0" * 64, None, "", "1" * 63, "A" * 64):
            rec = I.project(self.record(), "123", 1, "c" * 40, SHA, self.q(), admitted)
            self.assertEqual((rec["outcome"], rec["coverage"], rec["requestSha256"]), ("failed", "unqualified", None), admitted)
        refused(self, "run-record-for-another-release", I.project, self.record(), "123", 1, "c" * 40, "b" * 40, self.q())

    def test_a_failed_or_incomplete_qualification_never_publishes_passed(self):
        failed = self.record()
        failed["cases"][8].update(result="FAIL", assertions={"PASS": 1, "FAIL": 1, "NOT RUN": 0})  # AHT-09
        rec = self.project(failed, "123", 1, "c" * 40, SHA, self.q(outcome="failed"))
        self.assertEqual((rec["outcome"], rec["coverage"], rec["codes"]), ("failed", "batch", []))
        rec = self.project(self.record(), "123", 1, "c" * 40, SHA, self.q(outcome="failed", coverage="incomplete"))
        self.assertEqual((rec["outcome"], rec["coverage"], rec["codes"]), ("failed", "incomplete", []))
        # A qualification whose outcome disagrees with the record's rows is not bound to this record.
        for record, q in ((self.record(), self.q(outcome="failed")), (failed, self.q(outcome="passed"))):
            rec = I.project(record, "123", 1, "c" * 40, SHA, q, q["requestSha256"], prov_of(q))
            self.assertEqual((rec["outcome"], rec["coverage"], rec["codes"]), ("failed", "unqualified", ["not-qualified"]))

    def test_full_coverage_needs_all_fifteen_selected(self):
        record = self.record()
        for c in record["cases"]:
            c.update(result="PASS", reason=None, assertions={"PASS": 2, "FAIL": 0, "NOT RUN": 0})
        self.assertEqual(self.project(record, "123", 1, "c" * 40, SHA, self.q(cases=I.ALL_CASES, coverage="full"))["coverage"], "full")
        rec = self.project(self.record(), "123", 1, "c" * 40, SHA, self.q(coverage="full"))
        self.assertEqual((rec["outcome"], rec["coverage"]), ("failed", "unqualified"), "a 'full' claim for two cases is not bound")



# SHARED with tests/unit/verifyTestUsersLiveJourney.test.js: the identical vector text, pinned by the same sha256 in both suites, so the
# two consumers of the CLOUD_TEST_LIVE_ACCOUNTS bundle agree on every accepted and refused shape and its code.
VECTORS_TEXT = r'''{"bundles": [
["valid", "ok", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["missing", "bundle-missing", ""],
["whitespace only", "bundle-missing", "   \n"],
["not JSON", "bundle-not-json", "{not json"],
["too large", "bundle-too-large", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"],
["version 2", "bundle-shape", "{\"version\": 2, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["version true", "bundle-shape", "{\"version\": true, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["top-level password", "bundle-shape", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}, \"password\": \"p\"}"],
["top-level array", "bundle-shape", "[]"],
["account password", "bundle-shape", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\", \"password\": \"p\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["account id missing", "bundle-shape", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\"}}}"],
["role missing", "bundle-shape", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}}}"],
["extra role", "bundle-shape", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}, \"pro\": {\"email\": \"p@x.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}}}"],
["project uppercase", "bundle-project", "{\"version\": 1, \"projectRef\": \"ABCDEFGHIJKLMNOPQRST\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["project short", "bundle-project", "{\"version\": 1, \"projectRef\": \"abc\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email LF", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"a@x.invalid\\nX: y\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email CR", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"a@x.invalid\\r\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email tab", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"a\\t@x.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email DEL", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"a@x.invalid\\u007f\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email no at", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email two at", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"a@b@x.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email leading space", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \" a@x.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email not string", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": 7, \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["account id uppercase", "bundle-account-id", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"AAAAAAAA-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["account id v1", "bundle-account-id", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-1111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["account id not string", "bundle-account-id", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": 1}}}"],
["same email any case", "bundle-duplicate", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"THROWAWAY.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["same account id", "bundle-duplicate", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}}}"],
["email U+0085", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"a\\u0085@x.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email supplementary character", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"a\\ud83d\\ude00@x.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email non-ASCII letter", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"caf\\u00e9@x.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email NBSP", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"throwaway.synthetic@example.invalid\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"a\\u00a0b@x.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email 255 characters", "bundle-email", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@x.invalid12\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"],
["email 254 characters", "ok", "{\"version\": 1, \"projectRef\": \"abcdefghijklmnopqrst\", \"accounts\": {\"existing-disposable\": {\"email\": \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@x.invalid12\", \"accountId\": \"11111111-1111-4111-8111-111111111111\"}, \"maintained-read-only\": {\"email\": \"free.synthetic@example.invalid\", \"accountId\": \"22222222-2222-4222-8222-222222222222\"}}}"]
],
"urls": [
["origin", "ok", "https://abcdefghijklmnopqrst.supabase.co"],
["origin with slash", "ok", "https://abcdefghijklmnopqrst.supabase.co/"],
["default port", "ok", "https://abcdefghijklmnopqrst.supabase.co:443"],
["upper-case host", "ok", "https://ABCDEFGHIJKLMNOPQRST.supabase.co"],
["http", "bundle-project-mismatch", "http://abcdefghijklmnopqrst.supabase.co"],
["other project", "bundle-project-mismatch", "https://zzzzzzzzzzzzzzzzzzzz.supabase.co"],
["suffixed domain", "bundle-project-mismatch", "https://abcdefghijklmnopqrst.supabase.co.evil.example"],
["wrong domain", "bundle-project-mismatch", "https://abcdefghijklmnopqrst.evil.example"],
["userinfo", "bundle-project-mismatch", "https://user:pw@abcdefghijklmnopqrst.supabase.co"],
["empty userinfo", "bundle-project-mismatch", "https://@abcdefghijklmnopqrst.supabase.co"],
["unexpected port", "bundle-project-mismatch", "https://abcdefghijklmnopqrst.supabase.co:8443"],
["path", "bundle-project-mismatch", "https://abcdefghijklmnopqrst.supabase.co/rest/v1"],
["query", "bundle-project-mismatch", "https://abcdefghijklmnopqrst.supabase.co?x=1"],
["fragment", "bundle-project-mismatch", "https://abcdefghijklmnopqrst.supabase.co#f"],
["not a URL", "bundle-project-mismatch", "not a url"],
["empty", "bundle-project-mismatch", ""]
]}'''
VECTORS_SHA256 = "ca05b324277e3c5318a6bd398204bb5e9fbc21941141b396161171f837108d58"
VECTOR_DOC = json.loads(VECTORS_TEXT)
VECTORS, URL_VECTORS = VECTOR_DOC["bundles"], VECTOR_DOC["urls"]
PROJECT = "abcdefghijklmnopqrst"
SUPABASE_URL_OK = "https://%s.supabase.co" % PROJECT


def prov_of(q, run_id="123"):
    """The execution-provenance verdict the workflow's provenance step writes for this qualification (its bound fields only)."""
    return {"requestSha256": q.get("requestSha256"), "planSha256": q.get("planSha256"), "cases": sorted(q.get("cases") or []),
            "caseResultsSha256": q.get("caseResultsSha256"), "campaignId": q.get("campaignId"), "runId": run_id, "attempt": 1} \
        if isinstance(q, dict) else None


def bundle_with(throwaway_id):
    d = json.loads(next(v[2] for v in VECTORS if v[0] == "valid"))
    d["accounts"]["existing-disposable"]["accountId"] = throwaway_id
    return json.dumps(d)


class ExecutionProvenance(unittest.TestCase):
    """The I4' receiver against the CLI developer's producer shapes at 75b47b2c, with every expectation derived from a COMPLETE frozen plan: the
    build-plan consumption receipt, the nightly reservation's request consumption, each case's execution receipt and runtime-start file, and
    the collector's executionProvenance. Includes A-admitted / B-consumed-at-runtime / A-restored with reserve and collector reporting A."""
    A, B = "a" * 64, "b" * 64
    SELECTED = ["AHT-05", "AHT-09"]
    ID = {"campaignId": "C1", "runId": "123", "attempt": 1}
    SOURCE, SERVED = "1" * 40, "2" * 40

    @staticmethod
    def jcanon(doc):  # the producers' canonical file bytes (build_plan.put_canonical / campaign-runner canonicalBytes)
        return (json.dumps(doc, sort_keys=True, separators=(",", ":")) + "\n").encode()

    def plan(self, built_from=None, **over):
        doc = {"version": 1, "campaignId": "C1", "sourceSha": self.SOURCE, "servedSha": self.SERVED, "requestSha256": built_from or self.A,
               "coverageMode": "partial", "assertionDepth": "full", "selection": {"ids": list(self.SELECTED), "order": list(self.SELECTED)},
               "cases": [{"id": c, "configSha256": hashlib.sha256(c.encode()).hexdigest()} for c in I.ALL_CASES]}
        doc.update(over)
        return (json.dumps(doc, indent=2) + "\n").encode()  # build_plan.put: indented, one LF

    def world(self, built_from=None, priority="full-coverage", plan_raw=None):
        plan_raw = plan_raw or self.plan(built_from)
        plan = json.loads(plan_raw)
        plan_sha = hashlib.sha256(plan_raw).hexdigest()
        rows = {r["id"]: r for r in plan.get("cases") or [] if isinstance(r, dict)} if isinstance(plan.get("cases"), list) else {}
        reader = lambda consumer, digest=None, **extra: dict(self.ID, consumer=consumer, requestSha256=digest or self.A,  # noqa: E731
                                                             consumedAtUtc="2026-11-01T17:00:00Z", **extra)
        build = reader("build-plan", built_from or self.A, schema="speaksharp.cloud-test.build-plan-consumption.v1", planSha256=plan_sha,
                       admissionConfigSha256="c" * 64, sourceSha=plan.get("sourceSha"), servedSha=plan.get("servedSha"))
        starts, results = {}, []
        for c in self.SELECTED:
            common = dict(self.ID, caseId=c, requestSha256=self.A, planSha256=plan_sha, configSha256=(rows.get(c) or {}).get("configSha256"),
                          sourceSha=plan.get("sourceSha"), servedSha=plan.get("servedSha"))
            starts[c] = self.jcanon(dict(common, schema="speaksharp.cloud-test.runtime-start-consumption.v1", consumer="runtime-start",
                                         consumedAtUtc="2026-11-01T17:01:00Z"))
            results.append({"caseId": c, "result": "PASS", "executionReceipt": dict(common, schema="speaksharp.cloud-test.case-execution-receipt.v1",
                            runtimeStartReceipt="/runner/cases/%s/runtime-start-consumption.json" % c,
                            runtimeStartReceiptSha256=hashlib.sha256(starts[c]).hexdigest(), exitCode=0)})
        w = {"admitted": self.A, "identity": dict(self.ID), "priority": priority, "plan_raw": plan_raw, "build_receipt_raw": self.jcanon(build),
             "reservation_record": reader("reservation", allocation={}) if priority == "nightly-regression" else None,
             "case_results_raw": json.dumps({"campaignId": "C1", "cases": results}).encode(), "runtime_start_raws": starts,
             "selected": list(self.SELECTED)}
        self.recollect(w)
        return w

    def recollect(self, w):
        rows = {r["caseId"]: r for r in json.loads(w["case_results_raw"])["cases"]}
        w["run_record"] = {"schema": "speaksharp.cloud-test.run-record.v1", "executionProvenance": dict(
            self.ID, consumer="collector", requestSha256=self.A, consumedAtUtc="2026-11-01T17:30:00Z",
            caseResultsSha256=hashlib.sha256(w["case_results_raw"]).hexdigest(),
            runtimeReceiptDigests={c: I._canon_digest(rows[c]["executionReceipt"]) for c in rows if rows[c].get("executionReceipt")},
            runtimeReceipts={})}

    def set_receipt(self, w, cid, **over):
        results = json.loads(w["case_results_raw"])
        for r in results["cases"]:
            if r["caseId"] == cid:
                r["executionReceipt"].update(over)
        w["case_results_raw"] = json.dumps(results).encode()

    def check(self, w):
        return I.check_execution_provenance(**w)

    def test_an_honest_manual_and_nightly_execution_binds(self):
        self.assertEqual(self.check(self.world())["readers"], ["build-plan", "collector"])
        self.assertEqual(self.check(self.world(priority="nightly-regression"))["readers"], ["reservation", "build-plan", "collector"])

    def test_a_admitted_b_consumed_a_restored_is_refused_at_build_plan_and_a_misreporting_builder_at_the_plan(self):
        w = self.world(built_from=self.B, priority="nightly-regression")
        self.assertEqual((w["reservation_record"]["requestSha256"], w["run_record"]["executionProvenance"]["requestSha256"]), (self.A, self.A))
        refused(self, "request-not-the-admitted-request:build-plan", self.check, w)
        build = json.loads(w["build_receipt_raw"])
        build["requestSha256"] = self.A
        w["build_receipt_raw"] = self.jcanon(build)
        refused(self, "runtime-plan-not-from-the-admitted-request", self.check, w)

    def test_each_reader_swap_is_refused_at_that_reader(self):
        w = self.world(priority="nightly-regression")
        w["reservation_record"]["requestSha256"] = self.B
        refused(self, "request-not-the-admitted-request:reservation", self.check, w)
        w = self.world()
        w["run_record"]["executionProvenance"]["requestSha256"] = self.B
        refused(self, "request-not-the-admitted-request:collector", self.check, w)
        w = self.world()
        start = json.loads(w["runtime_start_raws"]["AHT-05"])
        start["requestSha256"] = self.B
        w["runtime_start_raws"]["AHT-05"] = self.jcanon(start)
        self.set_receipt(w, "AHT-05", runtimeStartReceiptSha256=hashlib.sha256(w["runtime_start_raws"]["AHT-05"]).hexdigest())
        self.recollect(w)
        refused(self, "request-not-the-admitted-request:runtime-start", self.check, w)

    def test_reservation_is_required_for_nightly_and_absent_for_manual(self):
        w = self.world(priority="nightly-regression")
        w["reservation_record"] = None
        refused(self, "request-reader-record:reservation", self.check, w)
        w = self.world()
        w["reservation_record"] = {"consumer": "reservation"}
        refused(self, "unexpected-reservation-record", self.check, w)
        w = self.world(priority="nightly-regression")
        w["reservation_record"]["attempt"] = True
        refused(self, "reader-not-this-attempt:reservation", self.check, w)

    def test_runtime_receipts_and_start_files_bind_this_plan_config_releases_and_attempt(self):
        for over, code in (({"planSha256": "0" * 64}, "runtime-receipt-not-bound:AHT-09"), ({"configSha256": "0" * 64}, "runtime-receipt-not-bound:AHT-09"),
                           ({"servedSha": "3" * 40}, "runtime-receipt-not-bound:AHT-09"), ({"attempt": True}, "runtime-receipt-not-bound:AHT-09"),
                           ({"runtimeStartReceiptSha256": "0" * 64}, "runtime-start-not-bound:AHT-09")):
            w = self.world()
            self.set_receipt(w, "AHT-09", **over)
            self.recollect(w)  # coherent: the collector recorded the substituted receipt
            refused(self, code, self.check, w)
        w = self.world()
        w["runtime_start_raws"]["AHT-09"] += b" "
        refused(self, "runtime-start-not-bound:AHT-09", self.check, w)
        w = self.world()
        del w["runtime_start_raws"]["AHT-05"]
        refused(self, "runtime-start-not-bound:AHT-05", self.check, w)
        w = self.world()
        results = json.loads(w["case_results_raw"])
        results["cases"][1].pop("executionReceipt")
        w["case_results_raw"] = json.dumps(results).encode()
        refused(self, "runtime-receipt-not-bound:AHT-09", self.check, w)

    def test_the_collector_binds_these_results_and_each_execution_receipt(self):
        w = self.world()
        w["case_results_raw"] = w["case_results_raw"].replace(b'"PASS"', b'"FAIL"', 1)
        refused(self, "collection-not-these-case-results", self.check, w)
        w = self.world()
        w["run_record"]["executionProvenance"]["runtimeReceiptDigests"]["AHT-05"] = "0" * 64
        refused(self, "collection-runtime-digests", self.check, w)
        for record in (None, {}, {"executionProvenance": None}):
            w = self.world()
            w["run_record"] = record
            refused(self, "request-reader-record:collector", self.check, w)

    def test_the_plan_bytes_and_the_builder_record_agree(self):
        w = self.world()
        build = json.loads(w["build_receipt_raw"])
        build["planSha256"] = "0" * 64
        w["build_receipt_raw"] = self.jcanon(build)
        refused(self, "runtime-plan-not-the-built-plan", self.check, w)
        w = self.world()
        build = json.loads(w["build_receipt_raw"])
        build["servedSha"] = "3" * 40
        w["build_receipt_raw"] = self.jcanon(build)
        refused(self, "build-plan-release", self.check, w)
        for over, code in (({"campaignId": "C2"}, "plan-not-this-campaign"), ({"sourceSha": "s" * 40}, "plan-release"), ({"cases": None}, "plan-cases")):
            refused(self, code, self.check, self.world(plan_raw=self.plan(**over)))
        for raw in (b"{not json", b"[]", None):
            w = self.world()
            w["build_receipt_raw"] = raw
            refused(self, "request-reader-record:build-plan", self.check, w)

    def test_the_admission_identity_is_strict_and_attempt_one(self):
        for over in ({"attempt": 2}, {"attempt": True}, {"runId": 123}, {"runId": "123.1"}, {"campaignId": ""}):
            w = self.world()
            w["identity"].update(over)
            refused(self, "execution-identity", self.check, w)
        for key, value, code in (("admitted", "A" * 64, "admitted-request-digest"), ("selected", [[]], "case-selection"),
                                 ("plan_raw", "x", "provenance-inputs"), ("runtime_start_raws", None, "runtime-start-records")):
            w = self.world()
            w[key] = value
            refused(self, code, self.check, w)


class ProvenanceFromFiles(unittest.TestCase):
    """The provenance command's file reading: admitted request bytes, the plan, build receipt, nightly reservation ledger, case results,
    runtime-start files and the run record, each read once as written by the producers."""

    def setUp(self):
        self.d = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.d)
        self.ep = ExecutionProvenance()

    def write(self, priority):
        req = live_request(None if priority == "nightly-regression" else ["AHT-05", "AHT-09"], runId="C1", priority=priority)
        req_raw = json.dumps(req).encode()
        self.ep.A = hashlib.sha256(req_raw).hexdigest()  # every producer record names the digest of exactly these request bytes
        w = self.ep.world(priority=priority)
        paths = {n: os.path.join(self.d, n) for n in ("request.json", "plan.json", "build.json", "results.json", "record.json", "ledger.json")}
        for name, raw in (("request.json", req_raw), ("plan.json", w["plan_raw"]), ("build.json", w["build_receipt_raw"]), ("results.json", w["case_results_raw"]),
                          ("record.json", json.dumps(w["run_record"]).encode()),
                          ("ledger.json", json.dumps({"events": [{"event": "reserve", "runId": "C1", "requestConsumption": w["reservation_record"]}]}).encode())):
            with open(paths[name], "wb") as f:
                f.write(raw)
        for cid, raw in w["runtime_start_raws"].items():
            os.makedirs(os.path.join(self.d, "cases", cid))
            with open(os.path.join(self.d, "cases", cid, "runtime-start-consumption.json"), "wb") as f:
                f.write(raw)
        return w, paths

    def run_files(self, w, paths, reservations=None):
        return I.provenance_from_files(paths["request.json"], w["admitted"], "123", paths["plan.json"], paths["build.json"], reservations,
                                       paths["results.json"], os.path.join(self.d, "cases"), paths["record.json"], ["AHT-05", "AHT-09"])

    def test_a_manual_run_reads_every_record_from_the_files_the_producers_wrote(self):
        w, paths = self.write("full-coverage")
        self.assertEqual(self.run_files(w, paths)["readers"], ["build-plan", "collector"])
        os.remove(os.path.join(self.d, "cases", "AHT-09", "runtime-start-consumption.json"))
        refused(self, "runtime-start-not-bound:AHT-09", self.run_files, w, paths)

    def test_a_nightly_run_reads_its_reservation_consumption_from_the_ledger(self):
        w, paths = self.write("nightly-regression")
        self.assertEqual(self.run_files(w, paths, paths["ledger.json"])["readers"], ["reservation", "build-plan", "collector"])
        refused(self, "request-reader-record:reservation", self.run_files, w, paths, None)
        with open(paths["ledger.json"], "w") as f:
            json.dump({"events": []}, f)
        refused(self, "request-reader-record:reservation", self.run_files, w, paths, paths["ledger.json"])

    def test_the_request_must_be_the_admitted_bytes(self):
        w, paths = self.write("full-coverage")
        with open(paths["request.json"], "ab") as f:
            f.write(b" ")
        refused(self, "request-changed-since-admission", self.run_files, w, paths)


class NightlyMode(unittest.TestCase):
    """a scheduled run admits exactly the bytes the nightly gate derived and admitted (its request_b64 beside
    request_sha256), never a committed file; a nightly-regression request is admitted only that way."""
    def setUp(self):
        from test_nightly_request import SHA as NSHA, SLOT as NSLOT, derive as nightly_derive
        self.sha, self.slot = NSHA, NSLOT
        self.raw = nightly_derive(run_id="101", sha=NSHA)
        self.digest = hashlib.sha256(self.raw).hexdigest()
        self.d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.d)
        self.path = os.path.join(self.d, "nightly-request.json")
        with open(self.path, "wb") as f:
            f.write(self.raw)

    def write(self, raw):
        path = os.path.join(self.d, "other-%d.json" % len(os.listdir(self.d)))
        with open(path, "wb") as f:
            f.write(raw)
        return path

    def test_the_gate_admitted_bytes_are_this_runs_request_and_pass_the_unchanged_request_checks(self):
        path, blob, raw = I.nightly_request(self.path, self.digest, "101", self.sha)
        self.assertEqual((path, raw, blob), (self.path, self.raw, hashlib.sha1(b"blob %d\0" % len(raw) + raw).hexdigest()))
        req = json.loads(raw)
        self.assertEqual(I.check_request(req, self.slot + timedelta(minutes=1), KEYS, nightly=True), I.ALL_CASES)

    def test_bytes_other_than_the_gate_admission_or_for_another_run_or_source_refuse(self):
        refused(self, "nightly-request-not-the-gate-admission", I.nightly_request, self.path, "0" * 64, "101", self.sha)
        refused(self, "nightly-request-not-the-gate-admission", I.nightly_request, self.write(self.raw + b"\n"), self.digest, "101", self.sha)
        refused(self, "nightly-gate-digest", I.nightly_request, self.path, "", "101", self.sha)
        refused(self, "nightly-gate-digest", I.nightly_request, self.path, self.digest.upper(), "101", self.sha)
        refused(self, "nightly-request-unreadable", I.nightly_request, os.path.join(self.d, "absent.json"), self.digest, "101", self.sha)
        refused(self, "nightly-request-not-this-run", I.nightly_request, self.path, self.digest, "102", self.sha)
        refused(self, "nightly-request-not-this-source", I.nightly_request, self.path, self.digest, "101", "5" * 40)
        manual = json.dumps(live_request()).encode()
        refused(self, "nightly-request-not-nightly", I.nightly_request, self.write(manual), hashlib.sha256(manual).hexdigest(), "101", SHA)
        doc = json.loads(self.raw)
        doc["nightly"]["attempt"] = True
        rerun = json.dumps(doc).encode()
        refused(self, "nightly-request-not-this-run", I.nightly_request, self.write(rerun), hashlib.sha256(rerun).hexdigest(), "101", self.sha)

    def test_a_nightly_request_is_admitted_only_in_nightly_mode_and_a_manual_one_never_there(self):
        nightly = json.loads(self.raw)
        refused(self, "request-schema", I.check_request, nightly, self.slot + timedelta(minutes=1), KEYS)
        refused(self, "nightly-request-needs-the-gate", I.check_request, dict(live_request(), priority="nightly-regression"), NOW, KEYS)
        refused(self, "nightly-request-not-nightly", I.check_request, dict(live_request(), nightly=nightly["nightly"]), NOW, KEYS, True)
        self.assertEqual(I.check_request(live_request(), NOW, KEYS), I.ALL_CASES)

    def test_prepare_takes_exactly_one_request_source(self):
        x = mock.Mock(repo=self.d, run_id="101", attempt=1, source_sha=self.sha, request="tools/cloud-test/config/runs/r.json",
                      nightly_request_file=self.path, nightly_request_sha256=self.digest)
        refused(self, "request-source-ambiguous", I.prepare, x, self.slot)

    def test_nightly_facts_are_only_the_committed_file_with_the_pinned_bytes(self):
        repo = os.path.join(self.d, "repo")
        refused(self, "nightly-facts-not-pinned", I.nightly_facts, repo)
        self.assertIsNone(I.NIGHTLY_FACTS_SHA256)
        refused(self, "nightly-facts-unreadable", I.nightly_facts, repo, "0" * 64)
        raw = json.dumps(facts(ownerApprovalReference="slack:1000000008.000008")).encode()
        os.makedirs(os.path.join(repo, os.path.dirname(I.NIGHTLY_FACTS_PATH)))
        with open(os.path.join(repo, I.NIGHTLY_FACTS_PATH), "wb") as f:
            f.write(raw)
        self.assertEqual(I.nightly_facts(repo, hashlib.sha256(raw).hexdigest()), json.loads(raw))
        refused(self, "nightly-facts-not-the-pinned-bytes", I.nightly_facts, repo, hashlib.sha256(raw + b" ").hexdigest())

    def test_a_scheduled_prepare_refuses_a_facts_input_and_reads_only_the_pinned_file(self):
        from _fixtures import REPO
        x = mock.Mock(repo=REPO, run_id="101", attempt=1, source_sha=self.sha, request=None, nightly_request_file=self.path,
                      nightly_request_sha256=self.digest, config="tools/cloud-test/config/test-config.v1.json", job_timeout_minutes=340,
                      facts=json.dumps(facts()))
        with mock.patch.object(I, "_git", return_value=self.sha):
            refused(self, "nightly-facts-input-refused", I.prepare, x, self.slot + timedelta(minutes=1))
            x.facts = None
            refused(self, "nightly-facts-not-pinned", I.prepare, x, self.slot + timedelta(minutes=1))

    def test_each_nightly_occurrence_derives_its_own_action_envelope_from_the_admitted_request(self):
        from test_nightly_request import derive as nightly_derive
        first = json.loads(self.raw)
        second_raw = nightly_derive(run_id="102", sha=self.sha)
        second = json.loads(second_raw)
        reconciliation = b'{"accepted":"synthetic-unit-control"}\n'
        committed = facts(ownerApprovalReference="slack:1000000008.000008")
        self.assertNotIn("actionApproval", committed)
        def standing(request, raw):
            # D1(a): the stand-in for standing_envelope, whose gates are controlled in StandingEnvelope; it returns the request- and
            # reconciliation-bound envelope that derivation produces once every gate has passed.
            lim = request["approvedLimits"]
            return lambda: I.check_action_approval(
                {"schema": I.ACTION_APPROVAL_SCHEMA, "requestSha256": hashlib.sha256(raw).hexdigest(),
                 "reconciliationSha256": hashlib.sha256(reconciliation).hexdigest(), "approvalRef": lim["approvalRef"],
                 "approvedBy": lim["approvedBy"], "selectionApprovalRef": request["selectionApprovalRef"]},
                hashlib.sha256(raw).hexdigest(), reconciliation, request)
        one = I.occurrence_action_approval(committed, hashlib.sha256(self.raw).hexdigest(), reconciliation, first, nightly=True,
                                           standing=standing(first, self.raw))
        two = I.occurrence_action_approval(committed, hashlib.sha256(second_raw).hexdigest(), reconciliation, second, nightly=True,
                                           standing=standing(second, second_raw))
        self.assertNotEqual(one["requestSha256"], two["requestSha256"])
        self.assertEqual(one["reconciliationSha256"], hashlib.sha256(reconciliation).hexdigest())
        for envelope, request in ((one, first), (two, second)):
            self.assertEqual(envelope["approvalRef"], request["approvedLimits"]["approvalRef"])
            self.assertEqual(envelope["approvedBy"], request["approvedLimits"]["approvedBy"])
            self.assertEqual(envelope["selectionApprovalRef"], request["selectionApprovalRef"])
        refused(self, "nightly-action-approval-must-be-derived", I.occurrence_action_approval,
                dict(committed, actionApproval=one), one["requestSha256"], reconciliation, first, True, standing(first, self.raw))
        # Without the standing gate nothing is derived; a gate that returns another occurrence's envelope refuses.
        refused(self, "action-approval-standing-not-pinned", I.occurrence_action_approval, committed, one["requestSha256"],
                reconciliation, first, True)
        refused(self, "action-approval-standing-reference", I.occurrence_action_approval, committed, one["requestSha256"],
                reconciliation, first, True, standing(second, second_raw))

    def test_manual_action_envelopes_remain_approver_supplied_and_occurrence_bound(self):
        request = live_request(["AHT-05"])
        reconciliation = b'{"accepted":"manual-unit-control"}\n'
        digest = "4" * 64
        supplied = action_approval(request, digest, reconciliation)
        self.assertEqual(I.occurrence_action_approval(dict(facts(), actionApproval=supplied), digest,
                                                      reconciliation, request), supplied)
        refused(self, "action-approval-shape", I.occurrence_action_approval, facts(), digest,
                reconciliation, request)


from test_accounting_rollup import Journal, bootstrap as rollup_bootstrap, scope as rollup_scope  # noqa: E402
import state_ref_writer as W  # noqa: E402


class ContinuityCheckpoint(Journal):
    """Increment I : the continuity checkpoint is the accepted rollup over the verified journal, bound to the admitted
    request, written as the exact bytes the stage runner consumes before plan construction. Synthetic inputs and test-only pins only."""

    APPROVAL = FIXTURE_APPROVAL

    def setUp(self):
        super().setUp()
        self.checkout = os.path.join(self.d, "checkout")
        now = datetime.now(timezone.utc).replace(microsecond=0)
        self.req = live_request(["AHT-07"])
        self.req["window"].update(startUtc=utc(now - timedelta(hours=1)), endUtc=utc(now + timedelta(hours=3)))
        self.now = now
        self.scope_doc = rollup_scope(approvalRef=self.APPROVAL, periodStartUtc=utc(now - timedelta(days=1)), periodEndUtc=utc(now + timedelta(days=30)),
                                      ceilings={"requests": 12000, "protectedReserveRequests": 300, "identityReads": 126, "starts": 120, "takes": 80})
        self.write(self.raw, json.dumps(self.scope_doc, sort_keys=True).encode())

    def write(self, bootstrap_raw, scope_raw):
        os.makedirs(os.path.join(self.checkout, I.CONTINUITY_DIR), exist_ok=True)
        for name, raw in ((I.CONTINUITY_BOOTSTRAP, bootstrap_raw), (I.CONTINUITY_SCOPE, scope_raw)):
            with open(os.path.join(self.checkout, I.CONTINUITY_DIR, name), "wb") as f:
                f.write(raw)
        self.scope_raw = scope_raw

    def all_pins(self, **over):
        p = dict(self.pins, accepted_scope_sha256=hashlib.sha256(self.scope_raw).hexdigest(), reviewed_root=self.root)
        p.update(over)
        return p

    def manual_reserve(self, request_sha, campaign, run="123"):
        """#1772 review 4446137323: the journal-reserve writer job appends a manual dispatch's reserve through the REAL writer BEFORE the
        read-only live job prepares (the approver's checkpoint is the one before it)."""
        from reservations import CATS
        head = W.fetch_head(self.repo, self.remote, self.remote)
        W.propose(self.repo, self.remote, head, {"type": "reserve", "campaignId": campaign, "runId": run, "attempt": 1,
                                                 "allocation": {k: 1 for k in CATS}, "provenance": "request-sha256:" + request_sha,
                                                 "atUtc": utc(self.now)}, self.root, self.remote)

    def test_manual_prepare_admits_the_checkpoint_before_its_own_reserve_and_nothing_else(self):
        # #1772 review 4446137323 (broken before: the in-job manual reserve could never push). The verified head must add exactly this
        # execution's own open reserve to its parent; the approver's checkpoint is that parent.
        own = ("R-camp", "123", 1, "a" * 64)
        mine = {"type": "reserve", "campaignId": "R-camp", "runId": "123", "attempt": 1, "allocation": {}, "provenance": "request-sha256:" + "a" * 64,
                "atUtc": "2026-11-02T01:00:00Z"}
        other = dict(mine, runId="999")
        root = ("r" * 40, [], b"")
        parent = ("p" * 40, [other], b"")
        self.assertEqual(I.manual_approval_chain([root, parent, ("h" * 40, [other, mine], b"")], own), [root, parent])
        for label, chain in (("no own reserve at the head", [root, parent]),
                             ("an event after the own reserve", [root, ("p" * 40, [mine], b""), ("h" * 40, [mine, other], b"")]),
                             ("another run's reserve at the head", [root, ("h" * 40, [other], b"")]),
                             ("a different request digest", [root, ("h" * 40, [dict(mine, provenance="request-sha256:" + "b" * 64)], b"")]),
                             ("the own reserve already settled", [root, ("p" * 40, [mine], b""),
                                                                   ("h" * 40, [mine, dict(mine, type="settle")], b"")])):
            with self.assertRaisesRegex(I.Refused, "manual-reserve-not-at-head", msg=label):
                I.manual_approval_chain(chain, own)

    def check(self, req=None, pins=None):
        reader = lambda root: W.validate_chain(self.repo, W.fetch_head(self.repo, self.remote, self.remote), root)
        return I.verified_checkpoint(self.checkout, req or self.req, pins or self.all_pins(), reader)

    def refused(self, code, *a, **k):
        with self.assertRaises(I.Refused) as e:
            self.check(*a, **k)
        self.assertEqual(str(e.exception), code)

    def test_the_production_pins_are_set_and_reject_unaccepted_inputs(self):
        pins = I.continuity_pins()
        self.assertEqual(set(pins), {"accepted_sha256", "accepted_root", "accepted_scope_sha256", "reviewed_root"})
        self.assertTrue(all(isinstance(value, str) and len(value) in (40, 64) for value in pins.values()))
        self.assertEqual(pins["accepted_root"], pins["reviewed_root"])
        with self.assertRaises(I.Refused) as e:
            I.verified_checkpoint(self.checkout, self.req)
        self.assertEqual(str(e.exception), "continuity-manual-reservation-scope-not-accepted")

    def test_each_missing_acceptance_refuses_by_name_before_any_input_is_read(self):
        self.refused("continuity-rollup-not-accepted", pins=self.all_pins(accepted_sha256=None))
        self.refused("continuity-rollup-not-accepted", pins=self.all_pins(accepted_root=None))
        self.refused("continuity-state-root-not-pinned", pins=self.all_pins(reviewed_root=None))
        self.refused("continuity-state-root-not-pinned", pins=self.all_pins(reviewed_root="f" * 40))
        self.refused("continuity-scope-not-accepted", pins=self.all_pins(accepted_scope_sha256=None))
        os.remove(os.path.join(self.checkout, I.CONTINUITY_DIR, I.CONTINUITY_SCOPE))
        self.refused("continuity-inputs-missing")

    def test_the_hashed_bytes_are_the_bytes_the_runner_consumes_before_plan_construction(self):
        rc_bytes = self.check()
        rc = json.loads(rc_bytes)
        self.assertEqual(rc_bytes, (json.dumps(rc, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii"))
        self.assertEqual((rc["source"], rc["scopeApprovalRef"], rc["headSha"]), ("accepted-rollup", self.APPROVAL, self.root))
        private = os.path.join(self.d, "private")
        os.mkdir(private, 0o700)
        rc_file, req_file, env_file = (os.path.join(private, n) for n in ("reconciliation.json", "req.json", "env.txt"))
        with open(rc_file, "wb") as f:
            f.write(rc_bytes)
        put(req_file, self.req)
        r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "run_env.py"), "--request", req_file,
                            "--request-sha256", I._sha(req_file), "--reconciliation", rc_file, "--execution-deadline", self.req["window"]["endUtc"],
                            "--out", env_file], capture_output=True, text=True, env=LIVE_ORIGIN_ENV)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(env_file, encoding="utf-8") as f:
            bp = dict(line.rstrip("\n").split("=", 1) for line in f if "=" in line)
        self.assertEqual((bp["BP_RECONCILIATION_FILE"], bp["BP_RECONCILIATION_SHA256"]), (rc_file, hashlib.sha256(rc_bytes).hexdigest()))
        import case_start_caps as CS
        self.assertEqual(CS.reconcile_caps(self.req, rc, execution=True)[0], "selected-full")

    def test_outstanding_reservations_count_toward_the_checkpoint(self):
        self.append("reserve", "41400000001", {"requests": 4342, "identityReads": 32, "starts": 3, "takes": 2, "coachingRequests": 1,
                                               "runnerMinutes": 30}, at=utc(self.now))
        rc = json.loads(self.check())
        self.assertEqual((rc["outstandingReservations"], rc["requests"]["conservativeUsed"], rc["starts"]["ownerCounted"]), (1, 4342, 3))

    def test_the_checkpoint_is_bound_to_the_request_approval_and_every_stated_cumulative_ceiling(self):
        self.refused("continuity-approval-not-the-request", req=dict(self.req, approvedLimits=dict(self.req["approvedLimits"], approvalRef="slack:1")))
        for limit, ceiling in (("cumulativeCeilingRequests", "requests"), ("identityCap", "identityReads")):
            with self.subTest(limit=limit):
                bad = dict(self.req, approvedLimits=dict(self.req["approvedLimits"], **{limit: self.req["approvedLimits"][limit] - 1}))
                self.refused("continuity-ceiling-not-the-request:" + ceiling, req=bad)
        for limit, ceiling, ok in (("startsCap", "starts", 120), ("takesCap", "takes", 80)):
            with self.subTest(limit=limit):
                stated = dict(self.req, approvedLimits=dict(self.req["approvedLimits"], **{limit: ok}))
                self.check(req=stated)
                self.refused("continuity-ceiling-not-the-request:" + ceiling, req=dict(stated, approvedLimits=dict(stated["approvedLimits"], **{limit: ok + 1})))

    def rescope(self, **over):
        doc = dict(self.scope_doc, **over)
        raw = json.dumps(doc, sort_keys=True).encode()
        self.write(self.raw, raw)
        return self.all_pins(accepted_scope_sha256=hashlib.sha256(raw).hexdigest())

    def test_the_execution_window_must_lie_inside_the_accepted_period(self):
        w = self.req["window"]
        start, end = I._utc(w["startUtc"]), I._utc(w["endUtc"])
        for label, period in (("future period", (start + timedelta(minutes=1), end + timedelta(days=1))),
                              ("expired period", (start - timedelta(days=1), end - timedelta(minutes=1))),
                              ("crossing the start", (start + timedelta(seconds=1), end + timedelta(days=1))),
                              ("crossing the end", (start - timedelta(days=1), end - timedelta(seconds=1)))):
            with self.subTest(label):
                self.refused("continuity-window-outside-period", pins=self.rescope(periodStartUtc=utc(period[0]), periodEndUtc=utc(period[1])))
        self.check(pins=self.rescope(periodStartUtc=w["startUtc"], periodEndUtc=w["endUtc"]))  # exactly the window is inside

    def test_a_nightly_identity_cap_is_per_run_and_must_fit_the_period_headroom(self):
        nightly = dict(self.req, priority="nightly-regression", approvedLimits=dict(self.req["approvedLimits"], identityCap=32))
        self.check(req=nightly)  # a valid per-run cap that differs from the 126 period ceiling
        self.refused("continuity-ceiling-not-the-request:identityReads", req=dict(nightly, priority="full-coverage"))
        over = dict(nightly, approvedLimits=dict(nightly["approvedLimits"], identityCap=127))
        self.refused("continuity-run-identity-exceeds-period", req=over)
        self.append("reserve", "41400000001", {"requests": 100, "identityReads": 100, "starts": 1, "takes": 1, "coachingRequests": 0,
                                               "runnerMinutes": 1}, at=utc(self.now))
        self.refused("continuity-run-identity-exceeds-period", req=nightly)  # 126 - 100 = 26 left < 32

    def test_prepare_admits_only_the_supplied_envelope_and_the_real_builder_binding_accepts_the_placed_bytes(self):
        # RETURN #1: prepare -> placement -> the real case_start_caps.bind_inputs, with substitution refusals.
        import contextlib
        import io
        import case_start_caps as CS
        repo = GitRepo()
        self.addCleanup(shutil.rmtree, repo.dir)
        req = live_request(["AHT-05"])
        req["window"] = dict(self.req["window"])
        prior_release = repo.commit({"tools/cloud-test/config/test-config.v1.json": CFG,
                                     I.CONTINUITY_DIR + "/" + I.CONTINUITY_BOOTSTRAP: self.raw.decode(),
                                     I.CONTINUITY_DIR + "/" + I.CONTINUITY_SCOPE: self.scope_raw.decode()})
        release = repo.commit({"frontend/src/services/SpeechRuntimeController.ts":
                               "export const objectivePublicationWitness = true;\n"})
        repo.git("commit", "--amend", "-q", "-m", "feat(r5): bind objective publication witness (#1772)")
        release = repo.git("rev-parse", "HEAD")
        req["release"]["testedSha"] = release
        req["release"]["lastRunTestedSha"] = prior_release
        head = repo.commit({RUNS + "r6.json": req})
        request_sha = hashlib.sha256(repo.git("cat-file", "blob", head + ":" + RUNS + "r6.json").encode()).hexdigest()
        pins = self.all_pins()
        reader = lambda root: W.validate_chain(self.repo, W.fetch_head(self.repo, self.remote, self.remote), root)
        rc_bytes = I.verified_checkpoint(repo.dir, req, pins, reader)
        self.manual_reserve(request_sha, req["runId"])  # the journal-reserve writer job, before the live job prepares

        def prepare(envelope):
            out, env, outputs = (os.path.join(repo.dir, "%s-%d" % (n, len(os.listdir(repo.dir)))) for n in ("out", "env", "outputs"))
            argv = ["init_run_inputs.py", "prepare", "--repo", repo.dir, "--config", "tools/cloud-test/config/test-config.v1.json", "--request",
                    RUNS + "r6.json", "--facts", json.dumps(facts(**({"actionApproval": envelope} if envelope is not None else {}))),
                    "--run-id", "123", "--attempt", "1", "--source-sha", head, "--job-timeout-minutes", "150", "--out", out,
                    "--env-file", env, "--outputs", outputs]
            err = io.StringIO()
            with mock.patch.object(I, "continuity_pins", lambda: pins), mock.patch.object(I, "state_chain", reader), \
                    mock.patch.dict(os.environ, {"CLOUD_TEST_LIVE_ACCOUNTS": bundle_with(ACCOUNT_ID), "SUPABASE_URL": SUPABASE_URL_OK}), \
                    contextlib.redirect_stderr(err):
                code = I.main(argv)
            return code, err.getvalue().strip(), out, outputs

        good = action_approval(req, request_sha, rc_bytes)
        for envelope, code in ((None, "action-approval-shape"), (dict(good, extra=1), "action-approval-shape"),
                               (dict(good, schema="x"), "action-approval-shape"),
                               (dict(good, requestSha256="0" * 64), "action-approval-not-the-request"),
                               (dict(good, reconciliationSha256="0" * 64), "action-approval-not-the-checkpoint"),
                               (dict(good, approvalRef="approval-" + "f" * 32), "action-approval-reference"),
                               (dict(good, approvedBy="someone-else"), "action-approval-reference"),
                               (dict(good, selectionApprovalRef="approval-" + "f" * 32), "action-approval-selection")):
            with self.subTest(code=code, envelope=str(envelope)[:60]):
                result = prepare(envelope)
                self.assertEqual(result[:2], (78, "BLOCKED_SETUP: " + code))
                self.assertFalse(os.path.exists(result[2]), "a refused prepare writes nothing")
        code, err, out, outputs = prepare(good)
        self.assertEqual(code, 0, err)
        with open(outputs, encoding="utf-8") as f:
            published = dict(line.split("=", 1) for line in f.read().splitlines())
        self.assertEqual((published["request_sha256"], published["reconciliation_sha256"]), (request_sha, hashlib.sha256(rc_bytes).hexdigest()))
        # One composed, deterministic route: prepare's genuine pre-reserve
        # reconciliation -> the authenticated own-reserve transition -> the
        # existing identity-ledger producer (synthetic transport, no network)
        # -> the real current-release verifier -> the real aggregate receiver.
        # No future identity or current journal state is retained in the bundle.
        private_identity = os.path.join(self.d, "identity-private")
        os.mkdir(private_identity, 0o700)
        identity_ledger = os.path.join(private_identity, "identity-ledger.json")
        active_config_path = os.path.join(ROOT, "config", "test-config.v1.json")
        active_config = J(active_config_path)
        target = active_config["target"]["url"].rstrip("/") + "/"
        identity_module = os.path.join(ROOT, "harness", "bundle", "harness", "identity-check.cjs")
        identity_script = r"""
const fs = require('node:fs');
const { runIdentity } = require(process.argv[1]);
const ledger = process.argv[2], url = process.argv[3], sha = process.argv[4];
const body = Buffer.from('<!doctype html><script>window.__APP_RELEASE__ = ' + JSON.stringify(sha) + ';</script>');
const transport = (_cmd, args) => {
  const output = args[args.indexOf('--output') + 1];
  fs.writeFileSync(output, body, { mode: 0o600 });
  return { status: 0, stdout: `200 0 ${body.length}` };
};
const result = runIdentity({ ledger, binding: { url, expectedSha: sha, cap: 32, phase: 'admission' } }, transport);
process.stdout.write(JSON.stringify(result.receipt));
process.exitCode = result.exitCode;
"""
        identity = subprocess.run(["node", "-e", identity_script, identity_module, identity_ledger, target, release],
                                  capture_output=True, text=True)
        self.assertEqual(identity.returncode, 0, identity.stdout + identity.stderr)
        self.assertEqual(stat.S_IMODE(os.lstat(identity_ledger).st_mode), 0o600)

        release_out = os.path.join(self.d, "current-release-verification.json")
        release_check = subprocess.run([
            sys.executable, "-I", os.path.join(ROOT, "scripts", "verify_release.py"),
            "--request", os.path.join(out, "request.json"),
            "--ledger", os.path.join(ROOT, "config", "aggregate", "gap-ledger.json"),
            "--config", active_config_path, "--repo", repo.dir,
            "--current-identity-ledger", identity_ledger, "--out", release_out,
        ], capture_output=True, text=True)
        self.assertEqual(release_check.returncode, 0, release_check.stderr)
        release_bytes = open(release_out, "rb").read()
        self.assertEqual(json.loads(release_bytes)["needs"], [])

        # The accepted #1772 feature is exact: it cannot authorize a later,
        # unrelated product change in the same composed release path.
        unrelated = repo.commit({"frontend/src/unrelated.ts": "export const unrelated = true;\n"})
        repo.git("commit", "--amend", "-q", "-m", "feat(other): unrelated product change (#9999)")
        unrelated = repo.git("rev-parse", "HEAD")
        bad_request = json.loads(open(os.path.join(out, "request.json"), encoding="utf-8").read())
        bad_request["release"]["lastRunTestedSha"] = release
        bad_request["release"]["testedSha"] = unrelated
        bad_request_file = os.path.join(self.d, "unrelated-request.json")
        put(bad_request_file, bad_request)
        bad_identity_dir = os.path.join(self.d, "unrelated-identity-private")
        os.mkdir(bad_identity_dir, 0o700)
        bad_identity_ledger = os.path.join(bad_identity_dir, "identity-ledger.json")
        bad_identity = subprocess.run(["node", "-e", identity_script, identity_module, bad_identity_ledger, target, unrelated],
                                      capture_output=True, text=True)
        self.assertEqual(bad_identity.returncode, 0, bad_identity.stdout + bad_identity.stderr)
        bad_release_out = os.path.join(self.d, "unrelated-release-verification.json")
        bad_release_check = subprocess.run([
            sys.executable, "-I", os.path.join(ROOT, "scripts", "verify_release.py"),
            "--request", bad_request_file, "--ledger", os.path.join(ROOT, "config", "aggregate", "gap-ledger.json"),
            "--config", active_config_path, "--repo", repo.dir, "--current-identity-ledger", bad_identity_ledger,
            "--out", bad_release_out,
        ], capture_output=True, text=True)
        self.assertEqual(bad_release_check.returncode, 0, bad_release_check.stderr)
        bad_release_doc = json.loads(open(bad_release_out, encoding="utf-8").read())
        self.assertTrue(any("unreviewed" in need for need in bad_release_doc["needs"]), bad_release_doc)
        self.assertEqual(next(v["decision"] for v in bad_release_doc["commitVerdicts"] if v["pr"] == "9999"), "rejected")

        import aggregate_receiver as AR
        state_chain = reader(self.root)
        current_head, current_events, _current_raw = state_chain[-1]
        occurrence = {
            "journalSnapshot": json.dumps({"schema": AR.JOURNAL_SNAPSHOT_SCHEMA, "headSha": current_head,
                                            "events": current_events}, sort_keys=True).encode(),
            "reconciliation": open(os.path.join(out, "reconciliation.json"), "rb").read(),
            "releaseVerification": release_bytes,
        }
        manifest_path = os.path.join(ROOT, "config", "aggregate", "manifest.json")
        manifest_raw = open(manifest_path, "rb").read()
        request_raw = open(os.path.join(out, "request.json"), "rb").read()
        pins = active_config["aggregateReceiver"]
        with mock.patch.object(C, "JOURNAL_URL", self.remote), mock.patch.object(C, "JOURNAL_ROOT", self.root):
            _docs, accepted, envelope = AR.receive_bundle(manifest_raw, os.path.dirname(manifest_path), request_raw,
                                                          active_config, pins, occurrence)
        self.assertEqual((envelope["requestSha256"], envelope["reconciliationSha256"], envelope["testedSha"]),
                         (request_sha, hashlib.sha256(rc_bytes).hexdigest(), release))
        self.assertEqual(hashlib.sha256(accepted["release-verification"]).hexdigest(),
                         envelope["releaseVerificationSha256"])
        # Placement (the workflow step copies these exact bytes), then the runner's own reader, then the real builder binding.
        ct_out = os.path.join(self.d, "ct-out")
        os.mkdir(ct_out, 0o700)
        placed = os.path.join(ct_out, "reconciliation.json")
        shutil.copyfile(os.path.join(out, "reconciliation.json"), placed)

        def bind():
            env_file = os.path.join(ct_out, "plan-env-%d.txt" % len(os.listdir(ct_out)))
            r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "run_env.py"), "--request", os.path.join(out, "request.json"),
                                "--request-sha256", published["request_sha256"], "--reconciliation", placed,
                                "--execution-deadline", published["execution_deadline"], "--out", env_file],
                               capture_output=True, text=True, env=LIVE_ORIGIN_ENV)
            self.assertEqual(r.returncode, 0, r.stderr)
            import shlex
            with open(env_file, encoding="utf-8") as f:  # execute_run.sh sources this file; values are shlex-quoted
                bp = {k: (shlex.split(v)[0] if v else "") for k, v in (line.rstrip("\n").split("=", 1) for line in f if "=" in line)}
            with open(os.path.join(out, "facts.json"), encoding="utf-8") as f:
                return CS.bind_inputs(bp, json.load(f))
        binding = bind()
        self.assertEqual((binding["reconciliationSha256"], binding["requestSha256"], binding["approval"]),
                         (published["reconciliation_sha256"], request_sha, good))
        # Substituting the placed bytes after admission is refused by the real consumer against the supplied envelope.
        os.chmod(placed, 0o600)
        with open(placed, "wb") as f:
            f.write(rc_bytes.replace(b'"outstandingReservations":0', b'"outstandingReservations":1'))
        with self.assertRaises(CS.InputValidationError) as e:
            bind()
        self.assertEqual(str(e.exception), "action-digests")

    def test_prepare_outputs_drive_the_real_builder_through_phase_two_and_its_consumption_receipt(self):
        # the positive control continues from prepare and the placed bytes through the actual
        # build_plan entry point (phase 1, then phase 2) to its bound outputs, with complete admitted facts; synthetic, no browser/network.
        import contextlib
        import io
        import shlex
        from pathlib import Path
        from test_case_start_caps import BUILDER, REPO, SyntheticBuilder
        repo = GitRepo()
        self.addCleanup(shutil.rmtree, repo.dir)
        # The release checkout carries the repository's own lockfile and reviewed media fixtures, as the workflow's checkout does.
        shutil.copytree(os.path.join(REPO, "tests", "fixtures", "rwt"), os.path.join(repo.dir, "tests", "fixtures", "rwt"))
        shutil.copyfile(os.path.join(REPO, "pnpm-lock.yaml"), os.path.join(repo.dir, "pnpm-lock.yaml"))
        repo.git("add", "--", "tests/fixtures/rwt", "pnpm-lock.yaml")
        req = live_request(["AHT-05"])
        req["window"] = dict(self.req["window"])
        req["release"]["testedSha"] = repo.commit({"tools/cloud-test/config/test-config.v1.json": CFG,
                                                   I.CONTINUITY_DIR + "/" + I.CONTINUITY_BOOTSTRAP: self.raw.decode(),
                                                   I.CONTINUITY_DIR + "/" + I.CONTINUITY_SCOPE: self.scope_raw.decode()})
        head = repo.commit({RUNS + "r6.json": req})
        request_sha = hashlib.sha256(repo.git("cat-file", "blob", head + ":" + RUNS + "r6.json").encode()).hexdigest()
        pins = self.all_pins()
        reader = lambda root: W.validate_chain(self.repo, W.fetch_head(self.repo, self.remote, self.remote), root)
        rc_bytes = I.verified_checkpoint(repo.dir, req, pins, reader)
        self.manual_reserve(request_sha, req["runId"])  # the journal-reserve writer job, before the live job prepares
        backend = {"manifestRef": "synthetic:backend-manifest@1", "generation": 6, "completion": "OFF", "migration129": "absent"}
        admitted = facts(backend=backend, actionApproval=action_approval(req, request_sha, rc_bytes))
        out, env_out, outputs = (os.path.join(repo.dir, n) for n in ("out", "env", "outputs"))
        argv = ["init_run_inputs.py", "prepare", "--repo", repo.dir, "--config", "tools/cloud-test/config/test-config.v1.json", "--request",
                RUNS + "r6.json", "--facts", json.dumps(admitted), "--run-id", "123", "--attempt", "1", "--source-sha", head,
                "--job-timeout-minutes", "150", "--out", out, "--env-file", env_out, "--outputs", outputs]
        err = io.StringIO()
        with mock.patch.object(I, "continuity_pins", lambda: pins), mock.patch.object(I, "state_chain", reader), \
                mock.patch.dict(os.environ, {"CLOUD_TEST_LIVE_ACCOUNTS": bundle_with(ACCOUNT_ID), "SUPABASE_URL": SUPABASE_URL_OK}), \
                contextlib.redirect_stderr(err):
            self.assertEqual(I.main(argv), 0, err.getvalue())
        with open(outputs, encoding="utf-8") as f:
            published = dict(line.split("=", 1) for line in f.read().splitlines())
        # Placement: the workflow step copies exactly these bytes as the runner's reconciliation.json.
        ct_out = Path(self.d) / "ct-out"
        ct_out.mkdir(mode=0o700)
        placed = ct_out / "reconciliation.json"
        shutil.copyfile(os.path.join(out, "reconciliation.json"), placed)
        self.assertEqual(hashlib.sha256(placed.read_bytes()).hexdigest(), published["reconciliation_sha256"])
        # The runner's own reader derives the builder's BP_* environment from the admitted request and the placed bytes.
        plan_env = ct_out / "plan-env.txt"
        r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "run_env.py"), "--request", os.path.join(out, "request.json"),
                            "--request-sha256", published["request_sha256"], "--reconciliation", str(placed),
                            "--execution-deadline", published["execution_deadline"], "--out", str(plan_env)],
                           capture_output=True, text=True, env=LIVE_ORIGIN_ENV)
        self.assertEqual(r.returncode, 0, r.stderr)
        bp = {k: (shlex.split(v)[0] if v else "") for k, v in (line.split("=", 1) for line in plan_env.read_text().splitlines() if "=" in line)}
        # Non-caller scaffolding (packet, checkout, private dir, browser identity, account bindings) from the builder's own synthetic fixture,
        # bound to THIS campaign; every caller-produced input comes from prepare.
        (ct_out / "builder").mkdir(mode=0o700)
        builder = SyntheticBuilder(ct_out / "builder")
        bindings = json.loads(Path(builder.env["BP_ACCOUNT_BINDINGS_FILE"]).read_text())
        bindings["campaignId"] = req["runId"]
        Path(builder.env["BP_ACCOUNT_BINDINGS_FILE"]).write_text(json.dumps(bindings))
        env = {k: v for k, v in builder.env.items() if not k.startswith("BP_") or k in (
            "BP_PACKET", "BP_CHECKOUT", "BP_PRIVATE", "BP_ACCOUNT_BINDINGS_FILE", "BP_LIVE_ACCOUNTS_SHA256", "BP_BROWSER_IDENTITY",
            "BP_TASK_ID", "BP_SOURCE_REFERENCE", "BP_ENV_ID", "BP_CASES")}
        env.update(bp, BP_FACTS=os.path.join(out, "facts.json"), BP_CHECKOUT=repo.dir, GITHUB_ACTIONS="true",
                   GITHUB_REPOSITORY="relativityE/speaksharp", GITHUB_RUN_ID="123", GITHUB_RUN_ATTEMPT="1", GITHUB_JOB="live", GITHUB_SHA=head)

        def build(phase, **over):
            return subprocess.run([sys.executable, "-I", str(BUILDER), phase], env=dict(env, **over), capture_output=True, text=True, timeout=60)
        private = Path(env["BP_PRIVATE"])
        # Substitution negatives at the builder boundary refuse before any output.
        bad_rc = ct_out / "substituted-reconciliation.json"
        bad_rc.write_bytes(rc_bytes.replace(b'"outstandingReservations":0', b'"outstandingReservations":1'))
        bad_facts = ct_out / "substituted-facts.json"
        changed = json.loads(Path(env["BP_FACTS"]).read_text())
        changed["actionApproval"]["selectionApprovalRef"] = "slack:1000000017.000017"
        bad_facts.write_text(json.dumps(changed))
        for label, over in (("reconciliation bytes", {"BP_RECONCILIATION_FILE": str(bad_rc),
                                                      "BP_RECONCILIATION_SHA256": hashlib.sha256(bad_rc.read_bytes()).hexdigest()}),
                            ("action envelope", {"BP_FACTS": str(bad_facts)}),
                            ("request digest", {"BP_REQUEST_SHA256": "0" * 64})):
            with self.subTest(substituted=label):
                result = build("phase1", **over)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(private.exists() and any(p.is_file() for p in private.rglob("*")), "a refused build writes nothing")
        first = build("phase1")
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        second = build("phase2")
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        plan_raw = (private / "cfg" / "campaign-plan.json").read_bytes()
        receipt = json.loads((private / "cfg" / "build-plan-consumption.json").read_text())
        self.assertEqual(receipt["schema"], "speaksharp.cloud-test.build-plan-consumption.v1")
        self.assertEqual((receipt.get("requestSha256"), receipt.get("planSha256")), (request_sha, hashlib.sha256(plan_raw).hexdigest()))
        self.assertEqual(json.loads(plan_raw)["runIdentity"]["backend"]["manifestRef"], backend["manifestRef"])

    def test_fresh_period_preserves_unresolved_history_while_unapproved_and_unanchored_inputs_refuse(self):
        fresh_scope = self.scope_raw
        unresolved = rollup_bootstrap(unresolved=[{"kind": "diagnostic", "ref": "gha-run:41071743003", "disposition": "UNRESOLVED", "usage": None}])
        self.write(unresolved, fresh_scope)
        fresh = json.loads(self.check(pins=self.all_pins(accepted_sha256=hashlib.sha256(unresolved).hexdigest())))
        self.assertTrue(fresh["historicalIncomplete"])
        self.assertEqual(fresh["historicalResolution"], [{"kind": "diagnostic", "ref": "gha-run:41071743003",
                                                           "disposition": "UNRESOLVED", "usage": None}])
        self.assertEqual(fresh["requests"]["conservativeUsed"], 0)
        historical = json.dumps(dict(self.scope_doc, carryover="historical"), sort_keys=True).encode()
        self.write(unresolved, historical)
        self.refused("continuity-rollup-unresolved-usage",
                     pins=self.all_pins(accepted_sha256=hashlib.sha256(unresolved).hexdigest(),
                                        accepted_scope_sha256=hashlib.sha256(historical).hexdigest()))
        self.write(self.raw, fresh_scope)
        other = json.dumps(dict(self.scope_doc, carryover="historical"), sort_keys=True).encode()
        self.refused("continuity-manual-reservation-scope-not-accepted", pins=self.all_pins(accepted_scope_sha256=hashlib.sha256(other).hexdigest()))
        self.refused("continuity-rollup-bootstrap-not-accepted", pins=self.all_pins(accepted_sha256="0" * 64))
        self.refused("continuity-state-root-replaced", pins=self.all_pins(accepted_root="e" * 40, reviewed_root="e" * 40))


class StandingEnvelope(Journal):
    """Option A , design only: a nightly occurrence's action envelope is DERIVED under the explicit grant in the pinned
    recurring approval. Every approval, grant, pin and checkpoint here is SYNTHETIC, supplied through test-only overrides; the production pin
    stays unset, so production derivation refuses."""
    GRANT = {"scope": "per-occurrence-start-take", "cases": I.ALL_CASES, "grantRef": "SYNTHETIC-NOT-A-GRANT"}
    REF = "slack:1000000008.000008"  # the synthetic recurring approval's reference (test_nightly_request.approval)

    def setUp(self):
        super().setUp()
        # The synthetic standing period begins at 2026-11-01T00:00:00Z. Its
        # retained bootstrap must be wholly pre-period just like the real
        # no-carryover boundary; an overlapping cutoff is intentionally refused.
        self.raw = rollup_bootstrap(asOfUtc="2026-10-31T23:59:59Z")
        self.pins["accepted_sha256"] = hashlib.sha256(self.raw).hexdigest()
        from test_nightly_request import CFG as NCFG, SLOT, approval as nightly_approval, derive as nightly_derive
        self.cfg, self.slot, self.nightly_approval, self.nightly_derive = NCFG, SLOT, nightly_approval, nightly_derive
        self.now = SLOT + timedelta(minutes=1)
        self.checkout = os.path.join(self.d, "checkout")
        # A real verified checkpoint over this journal, for the same approval and period as the synthetic standing approval.
        self.scoped()
        self.use(self.nightly_approval(startTakeGrant=self.GRANT))

    def use(self, approval_raw, derive_from=None):
        """Writes the recurring approval the checkout carries; the request is derived from `derive_from` (default: the same bytes)."""
        path = os.path.join(self.checkout, I.RECURRING_APPROVAL_PATH)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(approval_raw)
        self.pin = hashlib.sha256(approval_raw).hexdigest()
        self.req_raw = self.nightly_derive(ap=derive_from or approval_raw, run_id="101")
        self.req = json.loads(self.req_raw)

    def scoped(self, **over):
        """Writes the accepted period scope (the standing approval's own period and ceilings unless overridden)."""
        doc = rollup_scope(approvalRef=self.REF, periodStartUtc="2026-11-01T00:00:00Z", periodEndUtc="2026-12-01T00:00:00Z",
                           ceilings={"requests": 132000, "protectedReserveRequests": 300, "identityReads": 960, "starts": 1260, "takes": 1200})
        doc.update(over)
        self.scope_raw = json.dumps(doc, sort_keys=True).encode()
        os.makedirs(os.path.join(self.checkout, I.CONTINUITY_DIR), exist_ok=True)
        for name, raw in ((I.CONTINUITY_BOOTSTRAP, self.raw), (I.CONTINUITY_SCOPE, self.scope_raw)):
            with open(os.path.join(self.checkout, I.CONTINUITY_DIR, name), "wb") as f:
                f.write(raw)

    def checkpoint_and_scope(self, req=None, own=None):
        pins = dict(self.pins, accepted_scope_sha256=hashlib.sha256(self.scope_raw).hexdigest(), reviewed_root=self.root)
        return I.checkpoint_and_scope(self.checkout, req or self.req, pins, lambda root: self.chain(), own=own)

    def checkpoint(self, req=None):
        return self.checkpoint_and_scope(req)[0]

    def derive(self, req=None, cases=None, now=None, attempt=1, prior=frozenset(), pin="", own=None):
        req = self.req if req is None else req
        raw = self.req_raw if req is self.req else json.dumps(req, sort_keys=True).encode()
        rc_bytes, scope = self.checkpoint_and_scope(own=own)
        held = I.own_held_allocation(self.chain(), own) if own is not None else None
        return I.standing_envelope(self.checkout, req, hashlib.sha256(raw).hexdigest(), rc_bytes, scope, cases or I.ALL_CASES, self.cfg,
                                   now or self.now, attempt, prior, pin=self.pin if pin == "" else pin, held=held)

    def changed(self, mutate):
        req = copy.deepcopy(self.req)
        mutate(req)
        return req

    def ordinary_errors(self, req=None):
        """Runs the actual ordinary request validator on this derived request."""
        import validate_run_request as V
        from test_nightly_request import budget, fake_rv, reconciliation, sample
        req = self.req if req is None else req
        s = sample()
        cfg = copy.deepcopy(s["cfg"])
        cfg["harness"]["expectedCodeManifestSha256"] = req["harness"]["codeManifestSha256"]
        rc = reconciliation()
        period = json.loads(self.nightly_approval(startTakeGrant=self.GRANT))["periodCaps"]
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
        return V.validate(req, cfg, s["ledger"], s["wf"], fake_rv(), rc, accepted_budget)[0]

    def reserve_on_chain(self, run="101", request_sha=None, at="2026-11-02T03:00:30Z", allocation=None, kind="reserve"):
        """Appends a nightly reserve (or its settle) through the REAL state-ref writer, as journal-reserve/-settle do around the live job."""
        from reservations import CATS
        head = W.fetch_head(self.repo, self.remote, self.remote)
        e = {"type": kind, "campaignId": self.req["runId"], "runId": run, "attempt": 1,
             "allocation": dict({k: 1 for k in CATS}, **(allocation or {})),
             "provenance": "request-sha256:" + (request_sha or hashlib.sha256(self.req_raw).hexdigest()), "atUtc": at}
        W.propose(self.repo, self.remote, head, e, self.root, self.remote)

    def need(self):
        lim, est = self.req["approvedLimits"], self.req["estimate"]
        return {"requests": lim["runCapRequests"], "identityReads": lim["identityCap"], "starts": est["starts"], "takes": est["takes"]}

    def own(self, run="101"):
        return (self.req["runId"], run, 1, hashlib.sha256(self.req_raw).hexdigest())

    def test_an_exact_fit_already_reserved_request_is_admitted_against_its_held_allocation(self):
        # the reviewer RETURN : the rollup charges the open reserve; admission must not demand the same headroom a second time.
        rc0 = json.loads(self.checkpoint())
        need = self.need()
        filler = {k: rc0["currentHeadroom"][k] - need[k] for k in I.STANDING_PERIOD_DIMENSIONS}
        self.assertTrue(all(v >= 0 for v in filler.values()), filler)
        self.append("reserve", "41400000099", dict({"coachingRequests": 0, "runnerMinutes": 0}, **filler))  # another run's open usage
        self.reserve_on_chain(allocation=dict(need, coachingRequests=0, runnerMinutes=0))  # this run holds exactly its need
        rc = json.loads(self.checkpoint_and_scope(own=self.own())[0])
        self.assertEqual({k: rc["currentHeadroom"][k] for k in I.STANDING_PERIOD_DIMENSIONS}, {k: 0 for k in I.STANDING_PERIOD_DIMENSIONS})
        self.assertTrue(self.derive(prior=I.reserved_occurrences(self.chain(), self.own()), own=self.own()))  # exact fit admitted
        # the double-charge the RETURN found: without the execution identity the same chain refuses on its own reserve
        refused(self, "continuity-run-identity-exceeds-period", self.derive, prior=I.reserved_occurrences(self.chain(), self.own()))

    def test_a_released_own_reserve_holds_nothing(self):
        # the CLI developer's review of 7ab42417: a release returns the allocation exactly like a settle; it must not still count as held.
        need = self.need()
        self.reserve_on_chain(allocation=dict(need, coachingRequests=0, runnerMinutes=0))
        self.assertIsNotNone(I.own_held_allocation(self.chain(), self.own()))
        self.reserve_on_chain(kind="release", allocation=dict(need, coachingRequests=0, runnerMinutes=0), at="2026-11-02T03:10:00Z")
        self.assertIsNone(I.own_held_allocation(self.chain(), self.own()))
        refused(self, "action-approval-standing-occurrence-replayed", self.derive,
                prior=I.reserved_occurrences(self.chain(), self.own()), own=self.own())

    def test_two_own_open_reserves_are_ambiguous_and_refuse_rather_than_fall_back(self):
        # The writer opens a key once, so a verified chain cannot carry this; the refusal is defensive, so the chain here is constructed.
        own = self.own()
        e = {"type": "reserve", "campaignId": own[0], "runId": own[1], "attempt": 1, "allocation": {}, "provenance": "request-sha256:" + own[3]}
        chain = [("0" * 40, [e, dict(e)])]
        refused(self, "action-approval-own-reserve-ambiguous", I.own_held_allocation, chain, own)
        refused(self, "action-approval-own-reserve-ambiguous", I.reserved_occurrences, chain, own)
        self.assertIsNone(I.own_held_allocation([("0" * 40, [])], own))  # zero matches keep the pre-reserve path

    def test_insufficient_wrong_or_settled_held_reserves_refuse(self):
        need = self.need()
        # insufficient: the own reserve holds one Start fewer than the request needs
        held = dict(need, starts=need["starts"] - 1, coachingRequests=0, runnerMinutes=0)
        self.reserve_on_chain(allocation=held)
        refused(self, "action-approval-standing-held-insufficient:starts", self.derive,
                prior=I.reserved_occurrences(self.chain(), self.own()), own=self.own())
        # wrong run / wrong request: not this execution's reserve, so nothing is held for it
        self.assertIsNone(I.own_held_allocation(self.chain(), self.own(run="102")))
        self.assertIsNone(I.own_held_allocation(self.chain(), (self.req["runId"], "101", 1, "b" * 64)))
        # settled: once its settle is appended the reserve no longer holds anything, and the occurrence is a replay
        self.reserve_on_chain(kind="settle", allocation=held, at="2026-11-02T03:30:00Z")
        self.assertIsNone(I.own_held_allocation(self.chain(), self.own()))
        refused(self, "action-approval-standing-occurrence-replayed", self.derive,
                prior=I.reserved_occurrences(self.chain(), self.own()), own=self.own())

    def test_this_executions_own_open_reserve_is_not_a_replay_but_any_other_reserve_is(self):
        # the reviewer RETURN #2: journal-reserve appends THIS run's reserve before prepare; it must not reject itself.
        own = (self.req["runId"], "101", 1, hashlib.sha256(self.req_raw).hexdigest())
        self.reserve_on_chain()
        prior = I.reserved_occurrences(self.chain(), own)
        self.assertNotIn(self.req["runId"], prior)
        self.assertTrue(self.derive(prior=prior))  # connected reserve -> prepare positive
        # without the execution identity, the same reserve is a replay (the old behaviour, kept for any other caller)
        refused(self, "action-approval-standing-occurrence-replayed", self.derive,
                prior=I.reserved_occurrences(self.chain()))
        # a second run of the same occurrence (foreign or replayed) still refuses, even alongside this run's own reserve
        self.reserve_on_chain(run="102", at="2026-11-02T03:00:40Z")
        refused(self, "action-approval-standing-occurrence-replayed", self.derive, prior=I.reserved_occurrences(self.chain(), own))

    def test_a_reserve_bound_to_another_request_is_never_this_executions_own(self):
        own = (self.req["runId"], "101", 1, hashlib.sha256(self.req_raw).hexdigest())
        self.reserve_on_chain(request_sha="b" * 64)
        refused(self, "action-approval-standing-occurrence-replayed", self.derive, prior=I.reserved_occurrences(self.chain(), own))

    def test_the_derived_envelope_names_exactly_this_occurrence_request_and_checkpoint(self):
        rc_bytes = self.checkpoint()
        self.assertEqual((self.req["proposedLimits"]["runCapRequests"], self.req["approvedLimits"]["runCapRequests"],
                          self.req["estimate"]["requests"]["runCap"]), (4310, 4310, 4310))
        self.assertLess(self.req["approvedLimits"]["runCapRequests"],
                        json.loads(self.nightly_approval(startTakeGrant=self.GRANT))["perRunCaps"]["runCapRequests"])
        self.assertEqual(self.ordinary_errors(), [], "the actual derive -> ordinary-validator leg must admit 4310 under 4400")
        self.assertEqual(self.derive(), {"schema": I.ACTION_APPROVAL_SCHEMA, "requestSha256": hashlib.sha256(self.req_raw).hexdigest(),
                                         "reconciliationSha256": hashlib.sha256(rc_bytes).hexdigest(), "approvalRef": self.REF,
                                         "approvedBy": "owner", "selectionApprovalRef": self.REF})
        # The next occurrence derives a different envelope: one envelope is never valid for two occurrences.
        self.use(self.nightly_approval(startTakeGrant=self.GRANT))
        nxt_raw = self.nightly_derive(ap=self.nightly_approval(startTakeGrant=self.GRANT), run_id="102", slot=self.slot + timedelta(days=1))
        nxt = json.loads(nxt_raw)
        other = I.standing_envelope(self.checkout, nxt, hashlib.sha256(nxt_raw).hexdigest(), rc_bytes, self.checkpoint_and_scope()[1], I.ALL_CASES, self.cfg,
                                    self.now + timedelta(days=1), 1, frozenset({self.req["runId"]}), pin=self.pin)
        self.assertNotEqual(other["requestSha256"], self.derive()["requestSha256"])

    def test_the_derived_envelope_names_this_occurrence_and_the_real_builder_binding_accepts_it(self):
        import shlex
        import case_start_caps as CS
        rc_bytes = self.checkpoint()
        envelope = self.derive()
        request_sha = hashlib.sha256(self.req_raw).hexdigest()
        self.assertEqual(envelope, {"schema": I.ACTION_APPROVAL_SCHEMA, "requestSha256": request_sha,
                                    "reconciliationSha256": hashlib.sha256(rc_bytes).hexdigest(), "approvalRef": self.REF,
                                    "approvedBy": "owner", "selectionApprovalRef": self.REF})
        # The real consumer: the runner's env reader over the request and checkpoint bytes, then case_start_caps.bind_inputs.
        private = os.path.join(self.d, "private")
        os.mkdir(private, 0o700)
        req_file, rc_file, env_file = (os.path.join(private, n) for n in ("request.json", "reconciliation.json", "env.txt"))
        for path, raw in ((req_file, self.req_raw), (rc_file, rc_bytes)):
            with open(path, "wb") as f:
                f.write(raw)
        r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "run_env.py"), "--request", req_file, "--request-sha256", request_sha,
                            "--reconciliation", rc_file, "--execution-deadline", json.loads(self.req_raw)["window"]["endUtc"], "--out", env_file],
                           capture_output=True, text=True, env=LIVE_ORIGIN_ENV)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(env_file, encoding="utf-8") as f:
            bp = {k: (shlex.split(v)[0] if v else "") for k, v in (line.rstrip("\n").split("=", 1) for line in f if "=" in line)}
        binding = CS.bind_inputs(bp, {"actionApproval": envelope})
        self.assertEqual((binding["requestSha256"], binding["approval"]), (request_sha, envelope))
        # The next occurrence's request cannot reuse this envelope: the real consumer refuses it.
        nxt = self.nightly_derive(ap=self.nightly_approval(startTakeGrant=self.GRANT), run_id="102",
                                  slot=self.slot + timedelta(days=1))
        with open(req_file, "wb") as f:
            f.write(nxt)
        with self.assertRaises(CS.InputValidationError):
            CS.bind_inputs(dict(bp, BP_REQUEST_SHA256=hashlib.sha256(nxt).hexdigest()), {"actionApproval": envelope})

    def test_composed_nightly_occurrence_runs_gate_reserve_observation_prepare_and_both_builder_phases(self):
        # ONE composed all-15 synthetic control. Real: nightly derive, the observation's accepted reserve on the journal,
        # its settle, prepare (continuity checkpoint, standing envelope, Case 10 admission), run_env, and build_plan phase 1 and 2 in-process,
        # to the consumption receipt. Explicit test-only substitutions, nothing else: the approval/facts/continuity pins, the trusted reader
        # identity, the synthetic packet scaffold, producer descriptor and PDF-parser file. Admission and accounting are not stubbed.
        import contextlib
        import importlib.util
        import io
        import shlex
        from pathlib import Path
        import case10_observation as O
        from test_case10_request_bound import projection
        from test_case_start_caps import BUILDER, REPO, SyntheticBuilder
        from test_nightly_request import derive as nightly_derive
        now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        slot = now - timedelta(minutes=1)
        # The 360-minute nightly window holds setup + live + collect from an admission a few seconds after the slot.
        approval_raw = self.nightly_approval(startTakeGrant=self.GRANT, perRunCaps={"windowMinutes": 360})
        bundle = json.loads(bundle_with(ACCOUNT_ID))
        maintained = bundle["accounts"]["maintained-read-only"]["accountId"]
        nightly_facts = facts(backend={"manifestRef": "synthetic:backend-manifest@1", "generation": 6, "completion": "OFF", "migration129": "absent"},
                              producerReviewReference="UNIT-INDEPENDENT-REVIEW-NOT-A-RUN", ownerApprovalReference=self.REF,
                              accounts={"existing-disposable": {"idSha256": hashlib.sha256(ACCOUNT_ID.encode()).hexdigest(), "historyRef": "history:throwaway@r5"},
                                        "maintained-read-only": {"idSha256": hashlib.sha256(maintained.encode()).hexdigest(), "historyRef": "history:free@r5"}})
        # The release checkout: config, continuity inputs, the standing approval, the pinned nightly facts, lockfile and media fixtures.
        repo = GitRepo()
        self.addCleanup(shutil.rmtree, repo.dir)
        shutil.copytree(os.path.join(REPO, "tests", "fixtures", "rwt"), os.path.join(repo.dir, "tests", "fixtures", "rwt"))
        shutil.copyfile(os.path.join(REPO, "pnpm-lock.yaml"), os.path.join(repo.dir, "pnpm-lock.yaml"))
        repo.git("add", "--", "tests/fixtures/rwt", "pnpm-lock.yaml")
        for rel, raw in ((I.RECURRING_APPROVAL_PATH, approval_raw), (I.NIGHTLY_FACTS_PATH, json.dumps(nightly_facts).encode())):
            os.makedirs(os.path.dirname(os.path.join(repo.dir, rel)), exist_ok=True)
            with open(os.path.join(repo.dir, rel), "wb") as f:
                f.write(raw)
            repo.git("add", "--", rel)
        head = repo.commit({"tools/cloud-test/config/test-config.v1.json": CFG,
                            I.CONTINUITY_DIR + "/" + I.CONTINUITY_BOOTSTRAP: self.raw.decode(),
                            I.CONTINUITY_DIR + "/" + I.CONTINUITY_SCOPE: self.scope_raw.decode()})
        # 1. The gate's derivation for this occurrence (real), on exactly this source.
        req_raw = nightly_derive(ap=approval_raw, run_id="123", sha=head, slot=slot)
        req, request_sha = json.loads(req_raw), hashlib.sha256(req_raw).hexdigest()
        private = Path(self.d) / "composed"
        private.mkdir(mode=0o700)
        (private / "nightly-request.json").write_bytes(req_raw)
        pins = dict(self.pins, accepted_scope_sha256=hashlib.sha256(self.scope_raw).hexdigest(), reviewed_root=self.root)
        reader_id = O.contract_of(req)["reader"]
        # 2. The observation's reserve accepted on the SAME journal before its read (real writer), then the read and its settle.
        journal = O.StateJournal(repo.dir, req, url=self.remote, root=self.root, pins=pins)  # the real adapter on the synthetic journal
        record, reserve, _ = O.reserve_then_read(lambda keys: {k: projection()[k] for k in keys}, journal, req, request_sha, "123", 1,
                                                 ACCOUNT_ID, now)
        journal.propose(O.settlement_event(reserve, record, now), journal.head())
        (private / "case10-observation.json").write_text(json.dumps(record))
        # 3. prepare (real), with the explicit synthetic pins and reader trust.
        out, env_out, outputs = (str(private / n) for n in ("out", "env", "outputs"))
        argv = ["init_run_inputs.py", "prepare", "--repo", repo.dir, "--config", "tools/cloud-test/config/test-config.v1.json",
                "--nightly-request-file", str(private / "nightly-request.json"), "--nightly-request-sha256", request_sha,
                "--case10-observation", str(private / "case10-observation.json"), "--run-id", "123", "--attempt", "1", "--source-sha", head,
                "--job-timeout-minutes", "340", "--out", out, "--env-file", env_out, "--outputs", outputs]
        trust = mock.patch.object(O, "TRUSTED_READERS", frozenset({reader_id}))
        err = io.StringIO()
        with trust, mock.patch.object(I, "continuity_pins", lambda: pins), mock.patch.object(I, "state_chain", lambda root: self.chain()), \
                mock.patch.object(I, "RECURRING_APPROVAL_SHA256", hashlib.sha256(approval_raw).hexdigest()), \
                mock.patch.object(I, "NIGHTLY_FACTS_SHA256", hashlib.sha256(json.dumps(nightly_facts).encode()).hexdigest()), \
                mock.patch.dict(os.environ, {"CLOUD_TEST_LIVE_ACCOUNTS": json.dumps(bundle), "SUPABASE_URL": "https://%s.supabase.co" % bundle["projectRef"]}), \
                contextlib.redirect_stderr(err):
            self.assertEqual(I.main(argv), 0, err.getvalue())
        with open(outputs, encoding="utf-8") as f:
            published = dict(line.split("=", 1) for line in f.read().splitlines())
        builder_facts = json.loads(Path(out, "facts.json").read_text())
        self.assertEqual(builder_facts["case10Observation"], record)
        self.assertEqual(builder_facts["actionApproval"]["requestSha256"], request_sha)
        # 4. Placement and the runner's own reader (real).
        ct_out = private / "ct-out"
        ct_out.mkdir(mode=0o700)
        shutil.copyfile(os.path.join(out, "reconciliation.json"), ct_out / "reconciliation.json")
        r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "run_env.py"), "--request", os.path.join(out, "request.json"),
                            "--request-sha256", published["request_sha256"], "--reconciliation", str(ct_out / "reconciliation.json"),
                            "--execution-deadline", published["execution_deadline"], "--out", str(ct_out / "plan-env.txt")],
                           capture_output=True, text=True, env=LIVE_ORIGIN_ENV)
        self.assertEqual(r.returncode, 0, r.stderr)
        bp = {k: (shlex.split(v)[0] if v else "") for k, v in (line.split("=", 1) for line in (ct_out / "plan-env.txt").read_text().splitlines() if "=" in line)}
        # 5. Both builder phases (real build_plan, in-process so the explicit reader trust applies), on the synthetic packet scaffold.
        (ct_out / "builder").mkdir(mode=0o700)
        scaffold = SyntheticBuilder(ct_out / "builder", cases=tuple(range(1, 16)))
        bindings = json.loads(Path(scaffold.env["BP_ACCOUNT_BINDINGS_FILE"]).read_text())
        bindings["campaignId"] = req["runId"]
        Path(scaffold.env["BP_ACCOUNT_BINDINGS_FILE"]).write_text(json.dumps(bindings))
        packet = Path(ROOT) / "harness"
        receiver = "draft-adapters/receivers/github-job-evidence-reader.cjs"
        descriptor = ct_out / "producer-descriptor.json"
        descriptor.write_text(json.dumps({"producerIdentity": "github-actions:relativityE/speaksharp:123:1:live", "jobId": "live",
                                          "producerCodeSha256": hashlib.sha256((packet / "bundle/harness/authenticated-job-producer.cjs").read_bytes()).hexdigest(),
                                          "receiverSourceSha256": hashlib.sha256((packet / receiver).read_bytes()).hexdigest(),
                                          "receiverRelativePath": receiver, "workflowSourceSha": head,
                                          "reviewReference": "UNIT-INDEPENDENT-REVIEW-NOT-A-RUN"}))
        from test_full_plan import selected_pdf_source  # the existing pin-verified parser bytes; never installed or copied here
        pdf_source = selected_pdf_source()
        env = {k: v for k, v in scaffold.env.items() if not k.startswith("BP_") or k in (
            "BP_PACKET", "BP_PRIVATE", "BP_ACCOUNT_BINDINGS_FILE", "BP_LIVE_ACCOUNTS_SHA256", "BP_BROWSER_IDENTITY", "BP_TASK_ID",
            "BP_SOURCE_REFERENCE", "BP_ENV_ID", "BP_CASES")}
        env.update(bp, BP_FACTS=os.path.join(out, "facts.json"), BP_CHECKOUT=repo.dir, BP_PDFJS_DIR=pdf_source,
                   BP_PRODUCER_MODE="same-github-job", BP_PRODUCER_DESCRIPTOR=str(descriptor),
                   BP_PRODUCER_DESCRIPTOR_SHA256=hashlib.sha256(descriptor.read_bytes()).hexdigest(), GITHUB_ACTIONS="true",
                   GITHUB_REPOSITORY="relativityE/speaksharp", GITHUB_RUN_ID="123", GITHUB_RUN_ATTEMPT="1", GITHUB_JOB="live", GITHUB_SHA=head)
        spec = importlib.util.spec_from_file_location("build_plan_composed", str(BUILDER))
        BP = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(BP)
        with trust:
            for phase in ("phase1", "phase2"):
                BP.emit_verified_inputs(BP.read_binding_inputs(dict(env), [phase]))
        built = Path(env["BP_PRIVATE"])
        plan_raw = (built / "cfg" / "campaign-plan.json").read_bytes()
        receipt = json.loads((built / "cfg" / "build-plan-consumption.json").read_text())
        self.assertEqual((receipt.get("requestSha256"), receipt.get("planSha256")), (request_sha, hashlib.sha256(plan_raw).hexdigest()))
        self.assertEqual([c["id"] for c in json.loads(plan_raw)["cases"]], I.ALL_CASES)
        # 6. Accounting: the observation's reserve and settle are on the journal the next occurrence's checkpoint reads.
        rc = json.loads(I.verified_checkpoint(repo.dir, req, pins, lambda root: self.chain()))
        self.assertEqual((rc["outstandingReservations"], rc["period"]["requests"]), (0, 12))
        # The same occurrence cannot reserve its observation again; without the reader trust prepare refuses the record.
        with self.assertRaises(O.Refused):
            O.reserve_then_read(lambda keys: {}, journal, req, request_sha, "123", 1, ACCOUNT_ID, now)

    def test_the_production_pin_is_unset_so_no_grant_is_in_force_and_derivation_refuses(self):
        self.assertIsNone(I.RECURRING_APPROVAL_SHA256)
        self.assertFalse(I.standing_grant_in_force(self.checkout))
        refused(self, "action-approval-standing-not-pinned", self.derive, pin=None)

    def test_the_approval_must_be_the_pinned_bytes_the_request_was_derived_from_and_still_valid(self):
        refused(self, "action-approval-standing-not-the-pinned-bytes", self.derive, pin="0" * 64)
        other = self.nightly_approval(startTakeGrant=self.GRANT, expiresUtc="2026-12-14T00:00:00Z")
        self.use(other, derive_from=self.nightly_approval(startTakeGrant=self.GRANT))
        refused(self, "action-approval-standing-not-the-request-approval", self.derive)
        self.use(self.nightly_approval(startTakeGrant=self.GRANT))
        refused(self, "action-approval-standing-recurring-approval-expired", self.derive, now=datetime(2026, 12, 15, tzinfo=timezone.utc))
        os.remove(os.path.join(self.checkout, I.RECURRING_APPROVAL_PATH))
        refused(self, "action-approval-standing-unreadable", self.derive)

    def test_no_grant_or_a_malformed_grant_derives_nothing(self):
        self.use(self.nightly_approval())
        refused(self, "action-approval-standing-not-granted", self.derive)
        self.assertFalse(I.standing_grant_in_force(self.checkout, self.pin))
        for bad in (dict(self.GRANT, scope="per-run"), dict(self.GRANT, extra=1), dict(self.GRANT, cases=[]),
                    dict(self.GRANT, cases=list(reversed(I.ALL_CASES))), dict(self.GRANT, cases=I.ALL_CASES + ["AHT-16"]),
                    dict(self.GRANT, cases=["AHT-01", "AHT-01"]), dict(self.GRANT, grantRef=""), {k: self.GRANT[k] for k in ("scope", "cases")}):
            with self.subTest(grant=str(bad)[:70]):
                self.use(self.nightly_approval(startTakeGrant=bad))
                refused(self, "action-approval-standing-grant-shape", self.derive)

    def test_attempt_occurrence_and_replay_are_checked_before_derivation(self):
        refused(self, "action-approval-standing-attempt", self.derive, attempt=2)
        refused(self, "action-approval-standing-attempt", self.derive, req=self.changed(lambda r: r["nightly"].update(attempt=True)))
        refused(self, "action-approval-standing-occurrence", self.derive, req=self.changed(lambda r: r.update(runId="nightly-other")))
        refused(self, "action-approval-standing-occurrence", self.derive,
                req=self.changed(lambda r: r["nightly"].update(occurrenceId="nightly-other")))
        refused(self, "action-approval-standing-occurrence", self.derive,
                req=self.changed(lambda r: r["nightly"].update(occurrence="2026-12-20T03:00:00Z")))  # outside the approval period
        refused(self, "action-approval-standing-occurrence-replayed", self.derive, prior=frozenset({self.req["runId"]}))
        self.assertTrue(self.derive(prior=frozenset({"nightly-20261101T0000Z-20261101T0300Z"})))

    def test_cases_window_per_run_period_and_references_are_checked_before_derivation(self):
        self.use(self.nightly_approval(startTakeGrant=dict(self.GRANT, cases=I.ALL_CASES[:14])))
        refused(self, "action-approval-standing-case", self.derive)
        self.use(self.nightly_approval(startTakeGrant=self.GRANT))
        end = self.req["window"]["endUtc"]
        for label, kw, code in (
                ("window longer", {"req": self.changed(lambda r: r["window"].update(endUtc="2026-11-02T08:31:00Z"))}, "window"),
                ("window moved", {"req": self.changed(lambda r: r["window"].update(startUtc="2026-11-02T03:01:00Z"))}, "window"),
                ("before start", {"now": self.slot - timedelta(minutes=1)}, "window"),
                ("at end", {"now": I._utc(end)}, "window"),
                ("run cap", {"req": self.changed(lambda r: r["approvedLimits"].update(runCapRequests=4399))}, "per-run"),
                ("proposed allocation", {"req": self.changed(lambda r: r["proposedLimits"].update(runCapRequests=4309))}, "per-run"),
                ("estimated allocation", {"req": self.changed(lambda r: r["estimate"]["requests"].update(runCap=4309))}, "per-run"),
                ("allocation over ceiling", {"req": self.changed(lambda r: (r["proposedLimits"].update(runCapRequests=4401),
                                                                               r["approvedLimits"].update(runCapRequests=4401),
                                                                               r["estimate"]["requests"].update(runCap=4401)))}, "per-run"),
                ("identity cap", {"req": self.changed(lambda r: r["approvedLimits"].update(identityCap=31))}, "per-run"),
                ("estimate takes", {"req": self.changed(lambda r: r["estimate"].update(takes=41))}, "per-run"),
                ("estimate starts", {"req": self.changed(lambda r: r["estimate"].update(starts=46))}, "per-run"),
                ("estimate requests", {"req": self.changed(lambda r: r["estimate"]["requests"].update(runCap=4401))}, "per-run"),
                ("period ceiling", {"req": self.changed(lambda r: r["approvedLimits"].update(cumulativeCeilingRequests=131999))}, "period"),
                ("approver", {"req": self.changed(lambda r: r["approvedLimits"].update(approvedBy="someone-else"))}, "reference"),
                ("selection", {"req": self.changed(lambda r: r.update(selectionApprovalRef="slack:1000000017.000017"))}, "reference"),
                ("standing ref", {"req": self.changed(lambda r: r["nightly"].update(standingApprovalRef="slack:1000000017.000017"))}, "reference")):
            with self.subTest(label):
                refused(self, "action-approval-standing-" + code, self.derive, **kw)

    def test_the_checkpoint_period_and_every_period_ceiling_must_be_the_standing_approvals_own(self):
        # RETURN : a different accounting scope can never extend the standing grant.
        self.assertTrue(self.derive())
        ceilings = {"requests": 132000, "protectedReserveRequests": 300, "identityReads": 960, "starts": 1260, "takes": 1200}
        for label, over in (("period starts later", {"periodStartUtc": "2026-11-02T00:00:00Z"}),
                            ("period ends later", {"periodEndUtc": "2026-12-02T00:00:00Z"}),
                            ("higher accounting Starts ceiling", {"ceilings": dict(ceilings, starts=2000)}),
                            ("higher takes ceiling", {"ceilings": dict(ceilings, takes=1300)}),
                            ("higher identity ceiling", {"ceilings": dict(ceilings, identityReads=999)})):
            with self.subTest(label):
                self.scoped(**over)
                refused(self, "action-approval-standing-period", self.derive)
        self.scoped()
        self.assertTrue(self.derive())

    def test_an_exhausted_standing_limit_refuses_in_every_dimension(self):
        need = self.need()
        self.assertTrue(self.derive())  # bootstrap + no period usage leaves headroom in every dimension
        for k in I.STANDING_PERIOD_DIMENSIONS:
            with self.subTest(k):
                rc = json.loads(self.checkpoint())
                left = rc["currentHeadroom"][k]
                use = {"requests": 0, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": 0, "runnerMinutes": 0}
                use[k] = left - need[k] + 1  # leaves exactly one less than this run needs
                self.append("reserve", "4140000000%d" % I.STANDING_PERIOD_DIMENSIONS.index(k), use, at="2026-11-01T12:00:00Z")
                # Identity exhaustion is already refused by the checkpoint's own per-run identity headroom check (RETURN #3), first.
                refused(self, "continuity-run-identity-exceeds-period" if k == "identityReads" else "action-approval-standing-exhausted:" + k,
                        self.derive)
                self.append("release", "4140000000%d" % I.STANDING_PERIOD_DIMENSIONS.index(k), use, at="2026-11-01T12:00:01Z")
                self.assertTrue(self.derive())

    def test_prepare_derives_only_through_the_standing_gate_and_refuses_any_supplied_nightly_envelope(self):
        # The prepare branch itself: the admission steps before it are stubbed to a nightly result; the checkpoint, the derivation and the
        # supplied-envelope path are the real ones.
        import contextlib
        rc_bytes = self.checkpoint()
        request_sha = hashlib.sha256(self.req_raw).hexdigest()
        supplied = {"schema": I.ACTION_APPROVAL_SCHEMA, "requestSha256": request_sha, "reconciliationSha256": hashlib.sha256(rc_bytes).hexdigest(),
                    "approvalRef": self.REF, "approvedBy": "owner", "selectionApprovalRef": self.REF}
        path = os.path.join(self.d, "nightly-request.json")
        with open(path, "wb") as f:
            f.write(self.req_raw)
        pins = dict(self.pins, accepted_scope_sha256=hashlib.sha256(self.scope_raw).hexdigest(), reviewed_root=self.root)
        binding = {"role": "existing-disposable", "credentials": {"email": "THROWAWAY_TEST_EMAIL", "password": "THROWAWAY_TEST_PASSWORD"}}

        def prepare(nightly_facts, pin):
            x = mock.Mock(repo=self.checkout, run_id="101", attempt=1, source_sha=self.req["release"]["testedSha"], request=None,
                          nightly_request_file=path, nightly_request_sha256=request_sha, config="cfg.json", job_timeout_minutes=340, facts=None)
            stubs = {"_git": lambda *a: x.source_sha, "_load": lambda p: self.cfg, "check_ceilings": lambda *a: 300,
                     "check_window_fit": lambda *a: None, "nightly_facts": lambda repo: nightly_facts, "check_release_lineage": lambda *a: "same",
                     "parse_live_accounts_bundle": lambda raw: {}, "account_bindings": lambda *a: [binding],
                     "role_account": lambda *a: {"accountId": ACCOUNT_ID, "email": "SYNTHETIC"}, "check_case10_bound": lambda *a: None,
                     "translate_facts": lambda f, *a: dict(f), "compose_scope": lambda *a: {}, "canonical_bundle_bytes": lambda b: b"{}",
                     "continuity_pins": lambda: pins, "state_chain": lambda root: self.chain(), "RECURRING_APPROVAL_SHA256": pin}
            with contextlib.ExitStack() as stack:
                for name, value in stubs.items():
                    stack.enter_context(mock.patch.object(I, name, value))
                return I.prepare(x, self.now)

        # Granted and pinned, nothing supplied: derived for this occurrence; the result equals the envelope an approver would have supplied.
        self.assertEqual(prepare(facts(), self.pin)["facts"]["actionApproval"], supplied)
        # a nightly (unshared) run binds no reservation; only a manual run's own verified reserve does
        self.assertIsNone(prepare(facts(), self.pin)["reservationBinding"])
        # D1(a): a supplied nightly envelope always refuses (no fallback); the production pin unset refuses derivation by name.
        refused(self, "nightly-action-approval-must-be-derived", prepare, facts(actionApproval=supplied), self.pin)
        refused(self, "action-approval-standing-not-pinned", prepare, facts(), None)
        # A pinned approval WITHOUT a grant: the supplied path is unchanged, and nothing is derived when nothing is supplied.
        self.use(self.nightly_approval())
        request_sha = hashlib.sha256(self.req_raw).hexdigest()
        with open(path, "wb") as f:
            f.write(self.req_raw)
        supplied.update(requestSha256=request_sha)
        # D1(a): no grant means no envelope; a supplied one is refused whether or not the pin is set (the older fallback is not restored).
        refused(self, "nightly-action-approval-must-be-derived", prepare, facts(actionApproval=supplied), self.pin)
        refused(self, "action-approval-standing-not-granted", prepare, facts(), self.pin)
        refused(self, "nightly-action-approval-must-be-derived", prepare, facts(actionApproval=supplied), None)


class Case10Bound(unittest.TestCase):
    """item 2: prepare admits the Case 10 projection only through the builder's own validator; synthetic only."""
    ENTRIES = {"existing-disposable": {"accountId": ACCOUNT_ID}}

    def record(self, req, **over):
        from test_case10_request_bound import projection
        rec = {"schema": "speaksharp.cloud-test.case10-projection.v1", "runId": req["runId"], "sourceSha": req["release"]["testedSha"],
               "accountSubjectSha256": hashlib.sha256(ACCOUNT_ID.encode()).hexdigest(), "evidenceRef": "SYNTHETIC-NOT-A-RUN",
               "projection": projection()}
        rec.update(over)
        return rec

    def bound_request(self, rec):
        req = live_request(["AHT-10"])
        encoded = json.dumps(rec, sort_keys=True, separators=(",", ":")).encode()
        req["selection"][0]["requestBoundSha256"] = hashlib.sha256(encoded).hexdigest()
        return req

    def test_a_selected_case10_needs_exactly_the_bound_record_the_builder_validator_accepts(self):
        req = live_request(["AHT-10"])
        rec = self.record(req)
        req = self.bound_request(rec)
        report = I.check_case10_bound(req, facts(case10RequestBound=rec), ["AHT-10"], self.ENTRIES)
        self.assertEqual((report["allowance"], report["projectionSha256"]), (240, req["selection"][0]["requestBoundSha256"]))
        self.assertLessEqual(report["transmittedBound"], req["selection"][0]["plannedRequests"])
        refused(self, "case10-bound-missing", I.check_case10_bound, req, facts(), ["AHT-10"], self.ENTRIES)
        for change, code in (({"evidenceRef": "SYNTHETIC-CHANGED"}, "case10-bound-digest"),
                             ({"accountSubjectSha256": "0" * 64}, "case10-bound-account"),
                             ({"runId": "R0-other"}, "case10-bound-identity"),
                             ({"schema": "x"}, "case10-bound-schema")):
            with self.subTest(code=code):
                refused(self, code, I.check_case10_bound, req, facts(case10RequestBound=dict(rec, **change)), ["AHT-10"], self.ENTRIES)
        refused(self, "case10-bound-shape", I.check_case10_bound, req, facts(case10RequestBound=dict(rec, extra=1)), ["AHT-10"], self.ENTRIES)

    def test_no_record_is_admitted_when_case10_needs_none(self):
        req = live_request(["AHT-05"])
        self.assertIsNone(I.check_case10_bound(req, facts(), ["AHT-05"], self.ENTRIES))
        refused(self, "case10-bound-not-applicable", I.check_case10_bound, req, facts(case10RequestBound=self.record(req)), ["AHT-05"],
                self.ENTRIES)
        self.assertIn("case10RequestBound", I.FACT_OPTIONAL)
        self.assertNotIn("case10RequestBound", I.FACT_REQUIRED)


class JournalReservationRecord(unittest.TestCase):
    """I4' on the journal (RETURN ): a nightly run's reservation record is the journal's own reserve event."""
    def snapshot(self, *events):
        return {"schema": "speaksharp.cloud-test.journal-snapshot.v1", "headSha": "a" * 40, "events": list(events)}

    def reserve(self, campaign="nightly-c", provenance="request-sha256:" + "b" * 64):
        return {"type": "reserve", "campaignId": campaign, "runId": "123", "attempt": 1, "allocation": {}, "provenance": provenance,
                "atUtc": "2026-11-02T03:05:00Z"}

    def test_the_reserve_event_is_the_reader_record_and_anything_else_refuses(self):
        self.assertEqual(I.reservation_consumption(self.snapshot(self.reserve(), self.reserve("other")), "nightly-c"),
                         {"campaignId": "nightly-c", "runId": "123", "attempt": 1, "consumer": "reservation", "requestSha256": "b" * 64,
                          "consumedAtUtc": "2026-11-02T03:05:00Z"})
        for events in ((), (self.reserve(), self.reserve()), (self.reserve(provenance="evidence-sha256:" + "b" * 64),),
                       (dict(self.reserve(), type="settle"),)):
            with self.subTest(events=len(events)):
                refused(self, "request-reader-record:reservation", I.reservation_consumption, self.snapshot(*events), "nightly-c")


class Case10ObservationAdmission(unittest.TestCase):
    """Design A in prepare : a nightly AHT-10 row pinning an observationContract admits only the placed fresh
    observation, through the builder's own validator, for this request digest, run and time; synthetic reader trusted by test override only."""
    ENTRIES = {"existing-disposable": {"accountId": ACCOUNT_ID}}

    def setUp(self):
        import case10_observation as O
        from test_case10_request_bound import projection
        from test_nightly_request import SLOT, derive as nightly_derive
        self.O = O
        self.raw = nightly_derive(run_id="101")
        self.req = json.loads(self.raw)
        self.sha = hashlib.sha256(self.raw).hexdigest()
        self.now = SLOT + timedelta(minutes=2)
        self.record = O.observe(lambda keys: {k: projection()[k] for k in keys}, self.req, self.sha, "101", 1, ACCOUNT_ID, SLOT + timedelta(minutes=1))
        self.d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.d)

    def check(self, observation, facts_over=None, trusted=True, run_id="101"):
        readers = frozenset({self.O.contract_of(self.req)["reader"]}) if trusted else frozenset()
        with mock.patch.object(self.O, "TRUSTED_READERS", readers):
            return I.check_case10_bound(self.req, facts(**(facts_over or {})), I.ALL_CASES, self.ENTRIES, self.sha, run_id, self.now, observation)

    def test_the_placed_observation_is_admitted_and_read_from_a_private_regular_file(self):
        self.assertEqual(self.check(self.record)["allowance"], 240)
        path = os.path.join(self.d, "case10-observation.json")
        put(path, self.record)
        self.assertEqual(I.read_case10_observation(path), self.record)
        self.assertIsNone(I.read_case10_observation(None))
        refused(self, "case10-observation-unreadable", I.read_case10_observation, os.path.join(self.d, "absent.json"))
        with open(path, "w") as f:
            f.write("[]")
        refused(self, "case10-observation-unreadable", I.read_case10_observation, path)

    def test_missing_untrusted_replayed_or_two_source_observations_refuse(self):
        refused(self, "case10-observation-missing", self.check, None)
        refused(self, "case10-observation-reader-not-trusted", self.check, self.record, trusted=False)
        refused(self, "case10-observation-replayed", self.check, self.record, run_id="102")
        refused(self, "case10-observation-two-sources", self.check, self.record, {"case10RequestBound": {"schema": "x"}})


class WindowAtAdmission(unittest.TestCase):
    def test_the_remaining_window_must_hold_live_and_collect_and_is_never_reset(self):
        r = live_request(["AHT-05"])
        r["window"]["endUtc"] = "2026-11-01T14:57:00Z"  # 47 live + 10 collect = 57 minutes from NOW
        I.check_window_remaining(r, NOW, 47)
        refused(self, "approved-window-too-short-at-admission", I.check_window_remaining, r, NOW + timedelta(seconds=1), 47)
        refused(self, "live-minutes", I.check_window_remaining, r, NOW, 0)


class LiveAccountsBundle(unittest.TestCase):
    # Cross-language golden fixture (the reviewer RETURN 89949827): the synthetic "valid" vector's exact canonical file bytes
    # and their digest. The resolver side pins the same two literals, so caller and resolver agree byte for byte.
    GOLDEN_BYTES = (b'{"accounts":{"existing-disposable":{"accountId":"11111111-1111-4111-8111-111111111111",'
                    b'"email":"throwaway.synthetic@example.invalid"},"maintained-read-only":{"accountId":"22222222-2222-4222-8222-222222222222",'
                    b'"email":"free.synthetic@example.invalid"}},"projectRef":"abcdefghijklmnopqrst","version":1}\n')
    GOLDEN_SHA256 = "9f26df52a410b60729da7fe84a8799d5baca9336fab64a48d274ed0e619aab82"

    def test_the_cross_language_golden_bytes_and_digest(self):
        out = I.canonical_bundle_bytes(I.parse_live_accounts_bundle(next(v[2] for v in VECTORS if v[0] == "valid")))
        self.assertEqual((out, len(out), hashlib.sha256(out).hexdigest()), (self.GOLDEN_BYTES, 301, self.GOLDEN_SHA256))
        self.assertTrue(out.endswith(b"}\n") and not out.endswith(b"\n\n") and b" " not in out)

    def test_the_shared_vectors_are_the_pinned_ones_and_every_code_agrees(self):
        self.assertEqual(hashlib.sha256(VECTORS_TEXT.encode()).hexdigest(), VECTORS_SHA256)
        self.assertGreater(len(VECTORS), 20)
        for name, code, raw in VECTORS:
            if code == "ok":
                self.assertEqual(I.parse_live_accounts_bundle(raw)["projectRef"], PROJECT, name)
            else:
                refused(self, code, I.parse_live_accounts_bundle, raw)

    def test_the_origin_is_one_full_string_match_with_no_url_parser(self):
        # the caller imports no network-capable module, and the origin is matched in full, bound to the project.
        with open(os.path.join(ROOT, "scripts", "init_run_inputs.py"), encoding="utf-8") as f:
            self.assertNotRegex(f.read(), r"(?m)^\s*(import|from)\s+(socket|urllib|http|requests|ssl)\b")
        for url in ("https://%s.supabase.co:0443" % PROJECT, "https://%s.supabase.co:" % PROJECT, "https://%s.supabase.co\n" % PROJECT,
                    "https://%s.supabase.co/ " % PROJECT, " https://%s.supabase.co" % PROJECT, "https://%sXsupabaseXco" % PROJECT,
                    "https://%s.supabase.co//" % PROJECT, "https://%s.supabase.co:443:443" % PROJECT):
            with self.subTest(url=url):
                self.assertFalse(I.is_project_origin(url, PROJECT))
        self.assertTrue(I.is_project_origin("HTTPS://%s.SUPABASE.CO:443/" % PROJECT.upper(), PROJECT))
        for ref in (PROJECT + ".supabase.co", "a.c", "", None):
            with self.subTest(ref=ref):
                self.assertFalse(I.is_project_origin("https://%s.supabase.co" % ref, ref))
        # the reviewer RETURN : a newline-terminated reference paired with its URL, and Unicode case-folding (long s).
        self.assertFalse(I.is_project_origin("https://%s\n.supabase.co" % PROJECT, PROJECT + "\n"))
        for url in ("https://%s.\u017fupabase.co" % PROJECT, "https://%s.supabase.\u0441o" % PROJECT, "https://%s.\u017fUPABASE.CO" % PROJECT):
            with self.subTest(url=url):
                self.assertFalse(I.is_project_origin(url, PROJECT))
        self.assertTrue(I.is_project_origin("https://%s.SuPaBaSe.Co" % PROJECT, PROJECT))

    def test_the_shared_origin_vectors_agree(self):
        for name, code, url in URL_VECTORS:
            self.assertEqual(I.is_project_origin(url, PROJECT), code == "ok", name)
        b = I.parse_live_accounts_bundle(bundle_with(ACCOUNT_ID))
        for name, code, url in URL_VECTORS:
            if code != "ok":
                refused(self, code, I.role_account, b, "existing-disposable", url)

    def test_role_truth_project_binding_and_each_role_returns_only_its_own_entry(self):
        b = I.parse_live_accounts_bundle(bundle_with(ACCOUNT_ID))
        self.assertEqual(I.role_account(b, "existing-disposable", SUPABASE_URL_OK)["accountId"], ACCOUNT_ID)
        # Case15 : maintained-read-only returns its OWN entry, never THROWAWAY's; whether it may run at all is the
        # run-stage allowlist's decision in account_bindings (refused today: Account.test_an_all_fifteen_selection_binds_fourteen_plus_one...).
        self.assertEqual(I.role_account(b, "maintained-read-only", SUPABASE_URL_OK)["accountId"], "22222222-2222-4222-8222-222222222222")
        refused(self, "account-role-not-in-bundle", I.role_account, b, "other-role", SUPABASE_URL_OK)
        for url in ("https://zzzzzzzzzzzzzzzzzzzz.supabase.co", "", None, "not a url"):
            refused(self, "bundle-project-mismatch", I.role_account, b, "existing-disposable", url)

    def test_masks_cover_the_whole_bundle_even_when_malformed_and_every_extracted_value(self):
        self.assertEqual(I.mask_values("{not json"), ["{not json"])
        raw = bundle_with(ACCOUNT_ID)
        b = I.parse_live_accounts_bundle(raw)
        want = {raw} | {v for a in b["accounts"].values() for v in (a["email"], a["email"].lower(), a["accountId"])}
        self.assertEqual(set(I.mask_values(raw)), want)
        self.assertEqual(I.mask_commands(["a%b", "x\ny"]), ["::add-mask::a%25b", "::add-mask::x%0Ay", "::add-mask::x", "::add-mask::y"])
        self.assertEqual(I.mask_commands(["%0A"]), ["::add-mask::%250A"])
        for cmd in I.mask_commands(I.mask_values('{"a":\n"b"}')):
            self.assertNotRegex(cmd, r"[\r\n]")

    def test_the_env_file_writer_refuses_any_unsafe_name_or_value_before_writing(self):
        d = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, d)
        path = os.path.join(d, "env")
        for bad in ({"THROWAWAY_TEST_EMAIL": "a@x.invalid\nINJECTED=1"}, {"THROWAWAY_TEST_EMAIL": "a@x.invalid\r"}, {"lower": "v"},
                    {"A-B": "v"}, {"OK": 7}, {"OK": "tab\tvalue"}):
            refused(self, "unsafe-environment-value", I.write_env_file, path, bad)
            self.assertFalse(os.path.exists(path))
        I.write_env_file(path, {"B": "2", "A": "1@x.invalid"})
        with open(path) as f:
            self.assertEqual(f.read(), "A=1@x.invalid\nB=2\n")

    def test_prepare_masks_before_any_refusal_and_never_prints_a_value(self):
        for raw in (bundle_with(ACCOUNT_ID), "{not json\nsecond line"):
            p = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "init_run_inputs.py"), "prepare", "--repo", "/nonexistent",
                                "--run-id", "1", "--attempt", "1", "--source-sha", SHA], capture_output=True, text=True,
                               env={"PATH": os.environ["PATH"], "GITHUB_ACTIONS": "true", "CLOUD_TEST_LIVE_ACCOUNTS": raw})
            self.assertEqual(p.returncode, 78)
            lines = p.stdout.splitlines()
            self.assertTrue(lines and all(line.startswith("::add-mask::") for line in lines), lines)
            self.assertIn(I.mask_commands([raw])[0], lines)
            for line in raw.splitlines() + ([ACCOUNT_ID, "synthetic"] if raw.startswith("{\"") else []):
                self.assertNotIn(line, p.stderr)


if __name__ == "__main__":
    unittest.main()


class CaseDiagnosticTests(unittest.TestCase):
    """Run 42483030590 : each bound timing row carries a CLOSED, content-free cause: the guard stop code from the
    digest-verified summary, the receipt exit code, the first non-passing catalog assertion id; early guard exits without a summary are
    classified from the exit code; nothing free-text, injected or unlisted is ever projected."""
    BIND = {"runId": "42483030590", "runAttempt": "1", "headSha": "2" * 40, "workflowStartUtc": "2026-11-08T13:02:28Z"}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cases = self.tmp.name
        self.results = os.path.join(self.cases, "case-results.json")
        self.started = os.path.join(self.cases, "started.txt")
        with open(self.started, "w", encoding="utf-8") as f:
            f.write("2026-11-08T13:10:40Z\n")

    def tearDown(self):
        self.tmp.cleanup()

    def run_one(self, summary=None, exit_code=0, assertions=None, result="FAIL", case_result=None, extra_rows=()):
        directory = os.path.join(self.cases, "AHT-01")
        os.makedirs(directory, exist_ok=True)
        receipt = {"caseId": "AHT-01", "runId": "42483030590", "exitCode": exit_code, "summarySha256": None}
        if case_result is not None:      # the case's own case-result.json, bound by the receipt's caseResultSha256
            with open(os.path.join(directory, "case-result.json"), "wb") as f:
                f.write(case_result)
            receipt["caseResultSha256"] = hashlib.sha256(case_result).hexdigest()
        if summary is not None:
            raw = (json.dumps(dict({"startedAt": "2026-11-08T13:11:56.988Z", "endedAt": "2026-11-08T13:11:58.127Z"}, **summary)) + "\n").encode()
            with open(os.path.join(directory, "summary.json"), "wb") as f:
                f.write(raw)
            receipt["summarySha256"] = hashlib.sha256(raw).hexdigest()
        row = {"caseId": "AHT-01", "result": result, "executionReceipt": receipt, "assertions": assertions or []}
        with open(self.results, "w", encoding="utf-8") as f:
            json.dump({"cases": [row] + list(extra_rows)}, f)
        out = I.run_timing_export(self.cases, self.results, ["AHT-01"] + [r["caseId"] for r in extra_rows], self.started, None, self.BIND)
        return next(c for c in out["cases"] if c["caseId"] == "AHT-01"), json.dumps(out)

    def test_closed_stop_codes_from_the_verified_summary(self):
        for reason, code in (("sandbox-check-failed", "sandbox-check-failed"), ("step-error", "step-error"), ("completed", "completed"),
                             ("fatal:uncaughtException", "fatal-uncaught-exception"), ("signal:SIGTERM", "signal-sigterm"),
                             ("guard-fatal", "guard-fatal")):
            with self.subTest(reason):
                row, _ = self.run_one(summary={"reason": reason}, exit_code=3)
                self.assertEqual(row["diagnostic"]["stopCode"], code)
                self.assertEqual(row["diagnostic"]["exitCode"], 3)

    def test_an_injected_or_unknown_reason_is_other_and_never_projected(self):
        evil = "step-error; cat /etc/passwd password=hunter2"
        row, text = self.run_one(summary={"reason": evil, "privateError": "must-not-be-exported"}, exit_code=3)
        self.assertEqual(row["diagnostic"]["stopCode"], "other")
        self.assertNotIn("passwd", text)
        self.assertNotIn("hunter2", text)
        self.assertNotIn("must-not-be-exported", text)

    def test_guard_exits_without_a_summary_are_classified_from_the_exit_code(self):
        for exit_code, code in ((2, "guard-usage-refused"), (78, "guard-refused-before-start"), (1, "guard-exited-without-summary"),
                                (None, "unknown"), ("78", "unknown"), (999, "unknown")):
            with self.subTest(exit_code):
                row, _ = self.run_one(summary=None, exit_code=exit_code)
                self.assertEqual(row["diagnostic"]["stopCode"], code)
                self.assertEqual(row["timingStatus"], "NOT OBSERVED")

    def test_first_non_passing_assertion_is_a_catalog_id_or_unlisted(self):
        row, _ = self.run_one(summary={"reason": "step-error"}, exit_code=3,
                              assertions=[{"id": "owned-pages-closed", "result": "PASS"}, {"id": "start-press-budget", "result": "FAIL"}])
        self.assertEqual(row["diagnostic"]["firstNonPassingAssertion"], {"id": "start-press-budget", "result": "FAIL"})
        row, text = self.run_one(summary={"reason": "step-error"}, exit_code=3,
                                 assertions=[{"id": "Sign in as alice@example.com", "result": "FAIL"}])
        self.assertEqual(row["diagnostic"]["firstNonPassingAssertion"], {"id": "unlisted", "result": "FAIL"})
        self.assertNotIn("alice@example.com", text)
        row, _ = self.run_one(summary={"reason": "completed"}, exit_code=0, assertions=[{"id": "owned-pages-closed", "result": "PASS"}], result="PASS")
        self.assertIsNone(row["diagnostic"]["firstNonPassingAssertion"])


class DriverInterruptionDiagnosticTests(CaseDiagnosticTests):
    """a driver that caught an early error records FAIL and returns normally (guard `completed`, exit 0); its
    content-safe interruption evidence names the cause ONLY when bound to this case and its retained receipt, through the reviewed
    vocabularies. Format-valid injected values are dropped, mismatched or ambiguous refs are `unknown`, malformed shapes never raise."""
    DOC = {"contentSafe": True, "caseId": "AHT-01", "kind": "interruption-diagnostic", "stage": "start-press", "step": "owner-bound",
           "error": {"name": "TimeoutError", "code": None, "api": "locator.click", "kind": "timeout", "timeoutMs": 30000,
                     "testIds": ["sign-in-submit"]}}
    NAME = "aht-01-interruption.json"

    def bound(self, doc, name=NAME, refs=None, digest=None, raw=None):
        """Write the interruption file and a case-result.json listing its digest; return (assertions, case_result bytes)."""
        directory = os.path.join(self.cases, "AHT-01")
        os.makedirs(directory, exist_ok=True)
        raw = raw if raw is not None else json.dumps(doc).encode()
        with open(os.path.join(directory, name), "wb") as f:
            f.write(raw)
        refs = [name] if refs is None else refs
        case_result = json.dumps({"evidenceDigests": {r: digest or hashlib.sha256(raw).hexdigest() for r in refs}}).encode()
        return ([{"id": "owner-bound", "result": "FAIL", "evidenceRefs": []},
                 {"id": "owned-pages-closed", "result": "NOT RUN", "evidenceRefs": refs}], case_result)

    def project(self, doc=None, **kw):
        assertions, case_result = self.bound(self.DOC if doc is None else doc, **kw)
        row, text = self.run_one(summary={"reason": "completed"}, exit_code=0, assertions=assertions, case_result=case_result)
        return row["diagnostic"]["driverInterruption"], text

    def test_a_completed_guard_with_a_caught_error_is_named_by_the_bound_driver_interruption(self):
        assertions, case_result = self.bound(self.DOC)
        row, _ = self.run_one(summary={"reason": "completed"}, exit_code=0, assertions=assertions, case_result=case_result)
        d = row["diagnostic"]
        self.assertEqual((d["stopCode"], d["exitCode"]), ("completed", 0))
        self.assertEqual(d["firstNonPassingAssertion"], {"id": "owner-bound", "result": "FAIL"})
        self.assertEqual(d["driverInterruption"], {"stage": "start-press", "step": "owner-bound",
                                                   "error": {"name": "TimeoutError", "code": None, "kind": "timeout", "api": "locator.click",
                                                             "timeoutMs": 30000, "testIds": ["sign-in-submit"], "netError": None}, "trail": []})

    def test_sams_format_valid_injected_values_are_dropped(self):
        doc = dict(self.DOC, stage="password-huntertwo", step="password-huntertwo",
                   error={"name": "SecretError", "code": "LEAK", "api": "secret.token", "kind": "password=x", "timeoutMs": -5,
                          "testIds": ["password-huntertwo", "sign-in-submit", "user-12345678", "Bad Id"], "message": "token=abc"})
        got, text = self.project(doc)
        self.assertEqual(got, {"stage": "other", "step": "unlisted",
                               "error": {"name": "Error", "code": None, "kind": "other", "api": None, "timeoutMs": None,
                                         "testIds": ["sign-in-submit"], "netError": None}, "trail": []})
        for leak in ("huntertwo", "secret.token", "token=abc", "password=x", "LEAK", "SecretError", "user-12345678"):
            self.assertNotIn(leak, text)

    def test_the_document_must_be_this_cases_own(self):
        got, _ = self.project(dict(self.DOC, caseId="AHT-15"))          # the reviewer's repro: an AHT-15 document under AHT-01
        self.assertEqual(got, {"stage": "unknown", "step": None, "error": None, "trail": []})
        got, _ = self.project(dict(self.DOC, caseId=["AHT-01"]))
        self.assertEqual(got, {"stage": "unknown", "step": None, "error": None, "trail": []})

    def test_mismatched_or_ambiguous_refs_are_unknown(self):
        for label, kw in (("another case's file name", {"name": "aht-15-interruption.json"}),
                          ("two interruption refs", {"refs": [self.NAME, "aht-02-interruption.json"]}),
                          ("an escaping ref", {"refs": ["../" + self.NAME]}),
                          ("a nested ref", {"refs": ["sub/" + self.NAME]})):
            with self.subTest(label):
                got, _ = self.project(**kw)
                self.assertEqual(got, {"stage": "unknown", "step": None, "error": None, "trail": []})

    def test_the_file_must_be_bound_by_the_receipt_and_case_result_digests(self):
        got, _ = self.project(digest="0" * 64)                            # case-result names another digest for the file
        self.assertEqual(got, {"stage": "unknown", "step": None, "error": None, "trail": []})
        assertions, case_result = self.bound(self.DOC)
        row, _ = self.run_one(summary={"reason": "completed"}, exit_code=0, assertions=assertions)   # no caseResultSha256 in the receipt
        self.assertEqual(row["diagnostic"]["driverInterruption"], {"stage": "unknown", "step": None, "error": None, "trail": []})
        assertions, case_result = self.bound(self.DOC)
        row, _ = self.run_one(summary={"reason": "completed"}, exit_code=0, assertions=assertions, case_result=case_result)
        with open(os.path.join(self.cases, "AHT-01", "case-result.json"), "ab") as f:                # case-result changed after the receipt
            f.write(b" ")
        rows, _ = I.isolated_case_rows(self.cases, self.results, ["AHT-01"], "42483030590")
        self.assertEqual(rows["AHT-01"]["diagnostic"]["driverInterruption"], {"stage": "unknown", "step": None, "error": None, "trail": []})

    def test_a_symlinked_interruption_file_is_refused_by_its_original_identity(self):
        assertions, case_result = self.bound(self.DOC, name="real.json")
        directory = os.path.join(self.cases, "AHT-01")
        os.symlink(os.path.join(directory, "real.json"), os.path.join(directory, self.NAME))
        with open(os.path.join(directory, "real.json"), "rb") as f:
            raw = f.read()
        case_result = json.dumps({"evidenceDigests": {self.NAME: hashlib.sha256(raw).hexdigest()}}).encode()
        assertions = [{"id": "owner-bound", "result": "FAIL", "evidenceRefs": [self.NAME]}]
        row, _ = self.run_one(summary={"reason": "completed"}, exit_code=0, assertions=assertions, case_result=case_result)
        self.assertEqual(row["diagnostic"]["driverInterruption"], {"stage": "unknown", "step": None, "error": None, "trail": []})

    def test_malformed_shapes_never_raise_and_never_destroy_peer_rows(self):
        peer = {"caseId": "AHT-02", "result": "FAIL", "assertions": [],
                "executionReceipt": {"caseId": "AHT-02", "runId": "42483030590", "exitCode": 2, "summarySha256": None}}
        shapes = {"reason=[]": dict(summary={"reason": []}),
                  "reason={}": dict(summary={"reason": {"a": 1}}),
                  "assertions=dict": dict(summary={"reason": "completed"}, assertions={"id": "x"}),
                  "assertion id list": dict(summary={"reason": "completed"}, assertions=[{"id": ["owner-bound"], "result": "FAIL"}]),
                  "result list": dict(summary={"reason": "completed"}, assertions=[{"id": "owner-bound", "result": ["FAIL"]}]),
                  "evidenceRefs dict": dict(summary={"reason": "completed"},
                                            assertions=[{"id": "owner-bound", "result": "FAIL", "evidenceRefs": {self.NAME: 1}}])}
        for label, kw in shapes.items():
            with self.subTest(label):
                row, _ = self.run_one(extra_rows=[peer], **kw)
                self.assertIn(row["diagnostic"]["stopCode"], ("other", "completed", "unknown"))
        row, _ = self.run_one(summary={"reason": []}, extra_rows=[peer])
        self.assertEqual(row["diagnostic"]["stopCode"], "other")
        for label, err in (("name list", {"name": ["Error"]}), ("code dict", {"code": {"a": 1}}), ("kind list", {"kind": ["timeout"]}),
                           ("api list", {"api": ["locator.click"]}), ("testIds dict", {"testIds": {"sign-in-submit": 1}}),
                           ("testIds string", {"testIds": "sign-in-submit"}), ("testIds nested", {"testIds": [["sign-in-submit"]]})):
            with self.subTest(label):
                got, _ = self.project(dict(self.DOC, error=dict(self.DOC["error"], **err)))
                self.assertEqual(got["stage"], "start-press")
                self.assertTrue(isinstance(got["error"], dict))
        for label, doc in (("stage list", dict(self.DOC, stage=["start-press"])), ("step dict", dict(self.DOC, step={"a": 1}))):
            with self.subTest(label):
                got, _ = self.project(doc)
                self.assertIn(got["stage"], ("other", "start-press"))
        got, _ = self.project(raw=b"[1, 2")
        self.assertEqual(got, {"stage": "unknown", "step": None, "error": None, "trail": []})
        with mock.patch.object(I, "_case_diagnostic", side_effect=RuntimeError("boom")):
            row, _ = self.run_one(summary={"reason": "completed"}, extra_rows=[peer])
        self.assertEqual(row["diagnostic"], I.UNKNOWN_DIAGNOSTIC)

    def test_the_exact_net_error_is_kept_only_from_the_closed_allowlist(self):
        for given, kept in (("ERR_HTTP_RESPONSE_CODE_FAILURE", "ERR_HTTP_RESPONSE_CODE_FAILURE"), ("ERR_PROXY_CONNECTION_FAILED", "ERR_PROXY_CONNECTION_FAILED"),
                            ("other", "other"), ("ERR_SECRET_token=abc", None), (["ERR_FAILED"], None), ("err_failed", None)):
            with self.subTest(given=given):
                doc = dict(self.DOC, error=dict(self.DOC["error"], api="page.goto", kind="network-error", netError=given))
                got, text = self.project(doc)
                self.assertEqual((got["error"]["api"], got["error"]["kind"], got["error"]["netError"]), ("page.goto", "network-error", kept))
                self.assertNotIn("token=abc", text)

    def test_the_guard_upstream_configuration_and_reasons_are_closed_and_never_carry_values(self):
        guard = {"upstreamConfig": {"mode": "env-proxy", "proxyConfigured": False, "proxyValid": False, "noProxyMatched": False,
                                    "proxy": "http://user:s3cr3t@proxy.internal:3128"},
                 "counters": {"upstreamReasons": {"proxy-not-configured": 3, "secret.host.example": 1, "dns": "2", "tls": -1}}}
        row, text = self.run_one(summary={"reason": "completed", "guard": guard}, exit_code=0)
        self.assertEqual(row["diagnostic"]["guard"], {"upstreamMode": "env-proxy", "proxyConfigured": False, "proxyValid": False,
                                                      "noProxyMatched": False, "upstreamReasons": {"proxy-not-configured": 3}})
        for leak in ("s3cr3t", "proxy.internal", "3128", "secret.host"):
            self.assertNotIn(leak, text)
        for bad in ({"upstreamConfig": {"mode": "socks", "proxyConfigured": "yes"}}, {"upstreamConfig": [], "counters": []}, "guard"):
            with self.subTest(bad=bad):
                row, _ = self.run_one(summary={"reason": "completed", "guard": bad}, exit_code=0)
                g = row["diagnostic"]["guard"]
                self.assertTrue(g is None or (g["upstreamMode"] is None and g["proxyConfigured"] is None and g["upstreamReasons"] == {}))
        row, _ = self.run_one(summary={"reason": "completed"}, exit_code=0)
        self.assertIsNone(row["diagnostic"]["guard"])

    def test_the_ordered_navigation_trail_is_closed_bounded_and_never_carries_text(self):
        trail = [{"event": "nav-start", "route": "route-signin", "statusClass": None, "netError": None, "ms": 0},
                 {"event": "nav-error", "route": "route-signin", "statusClass": None, "netError": "ERR_HTTP_RESPONSE_CODE_FAILURE", "ms": 1179},
                 {"event": "nav-response", "route": "https://secret.example/x?token=abc", "statusClass": "status-200", "netError": "ERR_X", "ms": -3},
                 {"event": "password=hunter2", "route": "route-signin"}, "nav-start", {"event": ["nav-start"]}]
        got, text = self.project(dict(self.DOC, trail=trail))
        self.assertEqual(got["trail"], [
            {"event": "nav-start", "route": "route-signin", "statusClass": None, "netError": None, "ms": 0},
            {"event": "nav-error", "route": "route-signin", "statusClass": None, "netError": "ERR_HTTP_RESPONSE_CODE_FAILURE", "ms": 1179},
            {"event": "nav-response", "route": "route-other", "statusClass": None, "netError": None, "ms": None}])
        for leak in ("secret.example", "token=abc", "hunter2", "status-200"):
            self.assertNotIn(leak, text)
        got, _ = self.project(dict(self.DOC, trail=[{"event": "nav-start", "route": "route-practice", "ms": i} for i in range(40)]))
        self.assertEqual([e["ms"] for e in got["trail"]], list(range(16, 40)), "the newest TRAIL_MAX entries, in order")
        for bad in ("trail", {"a": 1}, None):
            with self.subTest(bad=bad):
                got, _ = self.project(dict(self.DOC, trail=bad))
                self.assertEqual(got["trail"], [])

    def test_no_interruption_named_is_none(self):
        row, _ = self.run_one(summary={"reason": "completed"}, assertions=[{"id": "owner-bound", "result": "FAIL", "evidenceRefs": []}])
        self.assertIsNone(row["diagnostic"]["driverInterruption"])


class DriverVocabularyPins(unittest.TestCase):
    """The closed vocabularies are the reviewed driver's own sets, not format checks: drift in either direction fails here."""
    ADAPTERS = os.path.join(ROOT, "harness", "draft-adapters")

    def sources(self):
        out = {}
        for d, dirs, files in os.walk(self.ADAPTERS):
            dirs[:] = sorted(x for x in dirs if x != "tests")
            for name in sorted(files):
                if name.endswith(".cjs"):
                    with open(os.path.join(d, name), encoding="utf-8") as f:
                        out[os.path.relpath(os.path.join(d, name), self.ADAPTERS)] = f.read()
        return out

    def test_stages_equal_the_drivers_STAGES_set(self):
        src = self.sources()["browser-actions.cjs"]
        stages = set(re.findall(r"'([a-z-]+)'", re.search(r"const STAGES=new Set\(\[(.*?)\]\)", src).group(1)))
        self.assertEqual(set(I.DRIVER_STAGES), stages)

    def test_test_ids_equal_the_exact_ids_the_adapters_address(self):
        ids = set()
        for text in self.sources().values():
            ids |= set(re.findall(r"getByTestId\('([a-z][a-z0-9-]{1,40})'\)", text))
            ids |= set(re.findall(r'data-testid="([a-z][a-z0-9-]{1,40})"', text))
        self.assertEqual(set(I.DRIVER_TEST_IDS), {i for i in ids if not i.endswith("-")}, "dynamic prefixes are never ids")

    def test_net_errors_equal_the_drivers_allowlist_and_upstream_reasons_the_guards(self):
        src = self.sources()["browser-actions.cjs"]
        net = set(re.findall(r"'(ERR_[A-Z_]+)'", re.search(r"const NET_ERRORS=new Set\(\[(.*?)\]\)", src).group(1)))
        self.assertEqual(set(I.DRIVER_NET_ERRORS) - {"other"}, net)
        with open(os.path.join(ROOT, "harness", "bundle", "harness", "guard-proxy.cjs"), encoding="utf-8") as f:
            guard = f.read()
        reasons = set(re.findall(r"'([a-z-]+)'", re.search(r"const UPSTREAM_REASONS = new Set\(\[(.*?)\]\)", guard, re.S).group(1)))
        self.assertEqual(set(I.GUARD_UPSTREAM_REASONS), reasons)
        modes = set(re.findall(r"'([a-z-]+)'", re.search(r"\['env-proxy','direct','override'\]", guard).group(0)))
        self.assertEqual(set(I.GUARD_UPSTREAM_MODES), modes)

    def test_trail_vocabularies_equal_the_drivers(self):
        src = self.sources()["browser-actions.cjs"]
        events = set(re.findall(r"'([a-z-]+)'", re.search(r"const TRAIL_EVENTS=new Set\(\[(.*?)\]\)", src).group(1)))
        routes = set(re.findall(r"'([a-z-]+)'", re.search(r"const TRAIL_ROUTES=new Set\(\[(.*?)\]\)", src).group(1)))
        self.assertEqual((set(I.TRAIL_EVENTS), set(I.TRAIL_ROUTES)), (events, routes))
        self.assertIn("'status-'+Math.floor(status/100)+'xx'", src)
        self.assertEqual(I.TRAIL_MAX, int(re.search(r"TRAIL_MAX=(\d+)", src).group(1)))

    def test_apis_are_playwright_page_or_locator_calls_and_the_page_calls_are_used(self):
        used = set()
        for text in self.sources().values():
            used |= {"page." + m for m in re.findall(r"\bpage\.([a-zA-Z]+)\(", text)}
        for api in I.DRIVER_APIS:
            self.assertRegex(api, r"^(page|locator)\.[a-zA-Z]+$")
            if api.startswith("page."):
                self.assertIn(api, used, api)
