import importlib.util
import copy
import hashlib
import json
from datetime import datetime, timezone
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from case_start_caps import CASE_IDS, MINIMAL_MINIMA, InputValidationError, request_caps  # noqa: E402
import run_env  # noqa: E402
import init_run_inputs as init  # noqa: E402
import check_gates  # noqa: E402
import check_coverage as coverage  # noqa: E402
from test_init_run_inputs import ACCOUNT_ID, CFG, KEYS, NOW, SUPABASE_URL_OK, bundle_with, facts, live_request  # noqa: E402
from test_case_start_caps import SyntheticBuilder  # noqa: E402
import state_ref_writer  # noqa: E402


def request():
    caps = dict(MINIMAL_MINIMA)
    return {
        "schema": "speaksharp.cloud-test.run-request.v2",
        "coverageMode": "smoke",
        "sampleMode": "smoke",
        "runId": "UNIT-SMOKE",
        "executionRuntime": "GitHub Actions SpeakSharp",
        "selection": [
            {"case": cid, "order": i + 1, "startPressCap": caps[cid], "plannedRequests": 1}
            for i, cid in enumerate(CASE_IDS)
        ],
        "estimate": {"starts": sum(caps.values()), "requests": {}, "providerBillableRequests": {}},
        "proposedLimits": {"startPressCaps": dict(caps)},
        "approvedLimits": {"startPressCaps": dict(caps)},
        "window": {},
        "release": {"backend": {}},
        "harness": {},
    }


def live_smoke_request():
    value = live_request()
    value["coverageMode"] = "smoke"
    value["sampleMode"] = "smoke"
    value["priority"] = "journey-smoke"
    caps = dict(MINIMAL_MINIMA)
    for row in value["selection"]:
        row["startPressCap"] = caps[row["case"]]
    value["proposedLimits"]["startPressCaps"] = copy.deepcopy(caps)
    value["approvedLimits"]["startPressCaps"] = copy.deepcopy(caps)
    value["approvedLimits"]["runCapRequests"] = 3000
    value["estimate"]["starts"] = sum(caps.values())
    value["estimate"]["identityReads"] = 32
    value["estimate"]["requests"]["runCap"] = 3000
    value["estimate"].pop("window", None)
    return value


ROOT_HEAD = "92d6ebf902351750c368d7d513116c6b1f19f80c"
COMMITTED_GRANT = json.loads((ROOT / "config/runs/R10-3b040043-aht01-grant.json").read_text())
# The active one-off: one attempt of the R10 smoke campaign over the grant's explicit selectedCases .
ONE_OFF_TEMPLATE = "config/runs/R10-3b040043-aht01.json"
# The committed grant is APPROVED under the PO's pinned decision; the contract tests serve the same document as the reviewed bytes, so a
# later status change cannot silently alter what they exercise (ApprovalPin covers the committed status itself).
APPROVED_GRANT = dict(COMMITTED_GRANT, status="APPROVED")


def served_grant(doc):
    variant = json.dumps(doc, indent=2).encode() + b"\n"
    original = init._read
    reader = lambda path: variant if str(path).endswith(init.ONE_OFF_GRANT_PATH) else original(path)
    return mock.patch.multiple(init, _read=reader, ONE_OFF_GRANT_SHA256=hashlib.sha256(variant).hexdigest())


def root_pinned_grant():
    """The approved grant with its pre-reserve head moved back to the accepted root, served as reviewed bytes. It exercises the
    root-anchored setup-failure and real-reserve paths, which are independent of where the committed grant is pinned."""
    variant = json.dumps(dict(APPROVED_GRANT, preReserveStateHead=ROOT_HEAD), indent=2).encode() + b"\n"
    original = init._read
    reader = lambda path: variant if str(path).endswith(init.ONE_OFF_GRANT_PATH) else original(path)
    return mock.patch.multiple(init, _read=reader, ONE_OFF_GRANT_SHA256=hashlib.sha256(variant).hexdigest())


class ApprovalPin(unittest.TestCase):
    def test_the_committed_grant_pins_the_po_decision_and_an_awaiting_grant_refuses_every_dispatch_path(self):
        """, re-pinned for one run under : the committed grant is APPROVED only under the PO's
        verified relays (historically scope 2158 for the
        capacity and next run, grant 3342 for the 60-minute signal run); an AWAITING_OWNER_DECISION grant, even in reviewed bytes, refuses."""
        self.assertEqual((COMMITTED_GRANT["status"], COMMITTED_GRANT["approvalRef"], COMMITTED_GRANT["scopeApprovalRef"]),
                         ("APPROVED", "approval-bcde5476311b392d618839dd2ae6b2f0", "approval-2c749f7fca826f9e54d962517a702665"))
        self.assertEqual((COMMITTED_GRANT["limits"]["liveMinutes"], COMMITTED_GRANT["limits"]["endToEndMinutes"]), (60, 100))
        template = json.loads((ROOT / ONE_OFF_TEMPLATE).read_text())
        init.materialize_authoritative_smoke_occurrence(str(ROOT.parents[1]), template, "2026-11-08T16:00:00Z")
        with served_grant(dict(COMMITTED_GRANT, status="AWAITING_OWNER_DECISION")), \
                self.assertRaisesRegex(init.Refused, "^one-off-grant-not-approved$"):
            init.materialize_authoritative_smoke_occurrence(str(ROOT.parents[1]), template, "2026-11-08T16:00:00Z")
        # Any status other than the two reviewed values is a shape refusal, never an approval.
        for status in ("approved", "APPROVED ", "PROPOSED", None):
            with served_grant(dict(COMMITTED_GRANT, status=status)), self.assertRaisesRegex(init.Refused, "^one-off-grant-shape$"):
                init.one_off_grant(str(ROOT.parents[1]), template, "2026-11-08T16:00:00Z")


class ShortSmokeContract(unittest.TestCase):
    def setUp(self):
        patch = served_grant(APPROVED_GRANT)
        patch.start()
        self.addCleanup(patch.stop)

    def test_actual_initiation_derives_one_bounded_occurrence_that_admits(self):
        template = json.loads((ROOT / ONE_OFF_TEMPLATE).read_text())
        start = "2026-11-08T16:00:00Z"
        value = init.materialize_authoritative_smoke_occurrence(str(ROOT.parents[1]), template, start)
        self.assertEqual(value["window"]["startUtc"], start)
        self.assertEqual(value["window"]["endUtc"], "2026-11-08T17:40:00Z")
        self.assertEqual(value["window"]["endToEndMinutes"], 100)
        self.assertEqual(value["window"]["liveMinutes"], 60)
        self.assertIn("not measured runtime", value["window"]["basis"])
        now = datetime(2026, 11, 8, 16, 0, 0, tzinfo=timezone.utc)
        cases = init.check_request(value, now, init._request_keys())
        cfg = json.loads((ROOT / "config/test-config.v1.json").read_text())
        live = init.check_ceilings(cfg, value, cases, 85)
        self.assertEqual(live, 31)      # one selected case: its own case limit plus the fixed overhead, inside the unchanged 60
        self.assertEqual(check_gates.occurrence_window_limit(
            value, cfg["modes"]["smoke"]["limits"], False, 100), (100, []))
        init.check_window_fit(value, now, live)
        # A real dispatch has startup delay.  The occurrence must survive it,
        # while still refusing once less than live + collect remains.
        init.check_window_fit(value, datetime(2026, 11, 8, 16, 5, 0, tzinfo=timezone.utc), live)
        with self.assertRaisesRegex(init.Refused, "run-would-outlast-approved-window"):
            init.check_window_fit(value, datetime(2026, 11, 8, 16, 44, 1, tzinfo=timezone.utc), live)

    def test_occurrence_materializer_refuses_wrong_case_set_or_release(self):
        template = json.loads((ROOT / ONE_OFF_TEMPLATE).read_text())
        with self.assertRaisesRegex(init.Refused, "smoke-occurrence-release"):
            init.materialize_smoke_occurrence(template, "2026-11-03T16:00:00Z", "approval-fc4d9d2e4cd035ea2c1c7c941f334599", "approval-70496d0877a56e774637d598ed3f1792", "product-owner", "bad", "b" * 40, ["AHT-01"])
        init.materialize_smoke_occurrence(template, "2026-11-03T16:00:00Z", "approval-fc4d9d2e4cd035ea2c1c7c941f334599", "approval-70496d0877a56e774637d598ed3f1792", "product-owner", "a" * 40, "b" * 40, ["AHT-01"])
        # the selection must be exactly the grant's explicit selectedCases: never defaulted, widened, reordered or emptied
        for selected in (["AHT-01", "AHT-02"], ["AHT-02"], [], None, ["AHT-01", "AHT-01"], init.ALL_CASES):
            with self.assertRaises(init.Refused, msg=repr(selected)):
                init.materialize_smoke_occurrence(template, "2026-11-03T16:00:00Z", "approval-fc4d9d2e4cd035ea2c1c7c941f334599", "approval-70496d0877a56e774637d598ed3f1792", "product-owner", "a" * 40, "b" * 40, selected)
        all15 = json.loads((ROOT / "config/runs/R10-3b040043-all15.json").read_text())
        with self.assertRaisesRegex(init.Refused, "smoke-occurrence-selection"):
            init.materialize_smoke_occurrence(all15, "2026-11-03T16:00:00Z", "approval-fc4d9d2e4cd035ea2c1c7c941f334599", "approval-70496d0877a56e774637d598ed3f1792", "product-owner", "a" * 40, "b" * 40, ["AHT-01"])

    def test_exact_occurrence_bytes_are_rederived_from_the_committed_template(self):
        template_rel = init.ONE_OFF_TEMPLATE_PATH
        template = json.loads((ROOT / ONE_OFF_TEMPLATE).read_text())
        start = "2026-11-08T16:00:00Z"
        occurrence = init.materialize_authoritative_smoke_occurrence(str(ROOT.parents[1]), template, start)
        raw = json.dumps(occurrence, sort_keys=True, separators=(",", ":")).encode()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "occurrence.json"
            path.write_bytes(raw)
            selected = init.select_manual_occurrence(
                str(ROOT.parents[1]), template_rel, str(path),
                hashlib.sha256(raw).hexdigest(),
                init._git(str(ROOT.parents[1]), "rev-parse", "HEAD"), start)
            self.assertEqual(selected[2], raw)

            tampered = dict(occurrence)
            tampered["window"] = dict(occurrence["window"], endUtc="2026-11-08T15:51:00Z")
            bad = json.dumps(tampered, sort_keys=True, separators=(",", ":")).encode()
            path.write_bytes(bad)
            with self.assertRaisesRegex(init.Refused, "manual-occurrence-not-the-template-materialization"):
                init.select_manual_occurrence(
                    str(ROOT.parents[1]), template_rel, str(path),
                    hashlib.sha256(bad).hexdigest(),
                    init._git(str(ROOT.parents[1]), "rev-parse", "HEAD"), start)

    def test_occurrence_refuses_an_external_timestamp_or_expired_authority(self):
        template_rel = init.ONE_OFF_TEMPLATE_PATH
        template = json.loads((ROOT / ONE_OFF_TEMPLATE).read_text())
        occurrence = init.materialize_authoritative_smoke_occurrence(str(ROOT.parents[1]), template, "2026-11-08T16:00:00Z")
        raw = json.dumps(occurrence, sort_keys=True, separators=(",", ":")).encode()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "occurrence.json"
            path.write_bytes(raw)
            with self.assertRaisesRegex(init.Refused, "manual-occurrence-not-the-workflow-start"):
                init.select_manual_occurrence(
                    str(ROOT.parents[1]), template_rel, str(path), hashlib.sha256(raw).hexdigest(),
                    init._git(str(ROOT.parents[1]), "rev-parse", "HEAD"), "2026-11-08T16:00:01Z")
        # The committed grant's earliest start is exact.
        init.materialize_authoritative_smoke_occurrence(
            str(ROOT.parents[1]), template, "2026-11-08T15:36:22Z")
        # The window is extended so an immediate start is admitted; expiresUtc 20:00Z leaves the latest start at 18:20Z (a 100-minute
        # occurrence). 00:00Z is only a sample point inside the window.
        init.materialize_authoritative_smoke_occurrence(
            str(ROOT.parents[1]), template, "2026-11-09T00:00:00Z")
        init.materialize_authoritative_smoke_occurrence(
            str(ROOT.parents[1]), template, "2026-11-09T18:20:00Z")
        for outside in ("2026-11-08T15:36:21Z", "2026-11-09T18:20:01Z"):
            with self.assertRaisesRegex(init.Refused, "one-off-grant-expired"):
                init.materialize_authoritative_smoke_occurrence(str(ROOT.parents[1]), template, outside)

    def test_an_extended_window_names_its_source_and_never_relabels_the_approval(self):
        """The committed grant extends the window to 20:00Z (latest start 18:20Z; owner-approved re-issue at journal 39ec9ab2 after run 42615792133) and
        names the timing's approval source as an opaque windowSourceRef, while approvalRef stays
        the original approval and the selected case and every limit are unchanged.
        An extended window without a well-formed source, or a source on the original window, refuses."""
        self.assertEqual(COMMITTED_GRANT["expiresUtc"], "2026-11-09T20:00:00Z")
        self.assertEqual(COMMITTED_GRANT["windowSourceRef"], "approval-4ac57c91e91e89071ee0d42b05110655")
        self.assertEqual(COMMITTED_GRANT["approvalRef"], "approval-bcde5476311b392d618839dd2ae6b2f0")
        self.assertEqual(init.ONE_OFF_APPROVED_EXPIRES_UTC, "2026-11-09T00:00:00Z")
        # unchanged: the selected case, every limit, the scope, release and journal bindings
        self.assertEqual(COMMITTED_GRANT["selectedCases"], ["AHT-01"])
        self.assertEqual(COMMITTED_GRANT["limits"], {"endToEndMinutes": 100, "liveMinutes": 60, "requestsIncludingIdentity": 454, "identityReads": 4,
                                                     "starts": 2, "takes": 2, "coachingCalls": 3, "retries": 0})
        self.assertEqual((COMMITTED_GRANT["notBeforeUtc"], COMMITTED_GRANT["preReserveStateHead"], COMMITTED_GRANT["scopeApprovalRef"],
                          COMMITTED_GRANT["requestTemplateSha256"], COMMITTED_GRANT["testedSha"], COMMITTED_GRANT["backendSha"]),
                         ("2026-11-08T15:36:22Z", "39ec9ab27559662d003ad1a9b8f9b6586f86196f", "approval-2c749f7fca826f9e54d962517a702665",
                          "82b813fe207f5dea447eb5e02739879e743a25c3da62597fe7739d24c3530f5b", "5a7bf6a1cbd0fb2f4a1c2b363d891c8fcc462bd2",
                          "c32319f9121d4fef64dc48bb40fae5464dc6b65a"))
        repo = str(ROOT.parents[1])
        grant_path = os.path.join(repo, init.ONE_OFF_GRANT_PATH)
        real_read, real_sha = init._read, init.ONE_OFF_GRANT_SHA256

        def check(grant):
            raw = (json.dumps(grant, indent=2) + "\n").encode()
            init.ONE_OFF_GRANT_SHA256 = hashlib.sha256(raw).hexdigest()
            init._read = lambda path: raw if os.path.realpath(path) == os.path.realpath(grant_path) else real_read(path)
            try:
                return init.one_off_grant(repo)
            finally:
                init._read, init.ONE_OFF_GRANT_SHA256 = real_read, real_sha

        self.assertEqual(check(dict(COMMITTED_GRANT))["windowSourceRef"], COMMITTED_GRANT["windowSourceRef"])
        no_source = {k: v for k, v in COMMITTED_GRANT.items() if k != "windowSourceRef"}
        original_window = dict(no_source, expiresUtc="2026-11-09T00:00:00Z")
        self.assertNotIn("windowSourceRef", check(original_window))          # the original window needs no source
        for label, grant in {"extended window without a source": no_source,
                             "malformed source": dict(COMMITTED_GRANT, windowSourceRef="has a space"),
                             "empty source": dict(COMMITTED_GRANT, windowSourceRef=""),
                             "a source on the original window": dict(original_window, windowSourceRef=COMMITTED_GRANT["windowSourceRef"])}.items():
            with self.subTest(label), self.assertRaisesRegex(init.Refused, "one-off-grant-window-source"):
                check(grant)
        with self.assertRaisesRegex(init.Refused, "one-off-grant-shape"):    # any other extra key is still refused
            check(dict(COMMITTED_GRANT, somethingElse="x"))

    def test_one_off_grant_rejects_caller_authority_release_checkpoint_and_scope_tampering(self):
        repo = str(ROOT.parents[1])
        template = json.loads((ROOT / ONE_OFF_TEMPLATE).read_text())
        occurrence = init.materialize_authoritative_smoke_occurrence(repo, template, "2026-11-08T16:00:00Z")
        occurrence_raw = json.dumps(occurrence, sort_keys=True).encode()
        request_sha = hashlib.sha256(occurrence_raw).hexdigest()
        scope = json.loads((ROOT / "config/aggregate/period-scope.json").read_text())
        # The committed grant is pinned at the journal head after run 42318728005's capped settle (the reviewer's verified ChatGPT receipt ).
        # The re-issued AHT-01 grant is pinned at the journal head after run 42494152179's capped settle .
        self.assertEqual(COMMITTED_GRANT["preReserveStateHead"], "39ec9ab27559662d003ad1a9b8f9b6586f86196f")
        checkpoint = json.dumps({
            "headSha": COMMITTED_GRANT["preReserveStateHead"],
            "scopeApprovalRef": scope["approvalRef"],
        }, sort_keys=True).encode()
        at_root = json.dumps({"headSha": ROOT_HEAD, "scopeApprovalRef": scope["approvalRef"]}).encode()
        with self.assertRaisesRegex(init.Refused, "one-off-grant-checkpoint"):    # the executed attempt 42284568156 is not a setup failure
            init.occurrence_action_approval({}, request_sha, at_root, occurrence, repo=repo)
        for field in init.CALLER_AUTHORITY_FIELDS:
            with self.assertRaisesRegex(init.Refused, "one-off-caller-authority-refused"):
                init.occurrence_action_approval({field: {}}, request_sha, checkpoint, occurrence, repo=repo)
        # The same exact checker used immediately before the real reserve
        # accepts the committed grant + committed scope + verified checkpoint.
        init.manual_reservation.admit_action_approval(b"{}", occurrence_raw, request_sha, checkpoint, repo)
        envelope = init.occurrence_action_approval({}, request_sha, checkpoint, occurrence, repo=repo)
        self.assertEqual(envelope["approvalRef"], scope["approvalRef"])
        self.assertEqual(envelope["selectionApprovalRef"], "approval-bcde5476311b392d618839dd2ae6b2f0")
        wrong_release = copy.deepcopy(occurrence)
        wrong_release["release"]["testedSha"] = "f" * 40
        with self.assertRaisesRegex(init.Refused, "relative-occurrence-request-release"):
            init.occurrence_action_approval({}, request_sha, checkpoint, wrong_release, repo=repo)
        stale = json.dumps({"headSha": "f" * 40, "scopeApprovalRef": scope["approvalRef"]}).encode()
        with self.assertRaisesRegex(init.Refused, "one-off-grant-checkpoint"):
            init.occurrence_action_approval({}, request_sha, stale, occurrence, repo=repo)
        original = init.manual_reservation.ACCEPTED_SCOPE_SHA256
        try:
            init.manual_reservation.ACCEPTED_SCOPE_SHA256 = "f" * 64
            with self.assertRaisesRegex(init.Refused, "one-off-grant-accounting"):
                init.occurrence_action_approval({}, request_sha, checkpoint, occurrence, repo=repo)
        finally:
            init.manual_reservation.ACCEPTED_SCOPE_SHA256 = original

    def test_one_off_grant_survives_only_zero_usage_setup_failure_settles_past_its_pinned_head(self):
        """R10 runs 41933223835 and 41960376782 stopped in setup. A setup failure that reserved is settled from evidence with zero product
        usage, which moves the journal head. Past its pinned head the grant admits only a verified chain of complete reserve -> settle pairs
        with zero on all five product counters (runner minutes counted) whose accepted rollup agrees ; prepare excludes
        the current run's own reserve. A release, an executed or open attempt, a missing chain or any doubt still refuses."""
        with root_pinned_grant():
            repo = str(ROOT.parents[1])
            template = json.loads((ROOT / ONE_OFF_TEMPLATE).read_text())
            occurrence = init.materialize_authoritative_smoke_occurrence(repo, template, "2026-11-08T16:00:00Z")
            occurrence_raw = json.dumps(occurrence, sort_keys=True).encode()
            request_sha = hashlib.sha256(occurrence_raw).hexdigest()
            scope = json.loads((ROOT / "config/aggregate/period-scope.json").read_text())
            root, reserved_head, settled_head = ("92d6ebf902351750c368d7d513116c6b1f19f80c", "0909b53ff6dc767105633ddc14db520c762dff64",
                                                 "6430357513fcc5f4bba12f8deab3c06bb5b01996")
            # the real journal events of run 41960376782 and its evidence-bound settle (computed with the real writer and rollup)
            held = {"requests": 2032, "identityReads": 32, "starts": 16, "takes": 16, "coachingRequests": 20, "runnerMinutes": 40}
            reserve = {"type": "reserve", "campaignId": "R10-3b040043-smoke15", "runId": "41960376782", "attempt": 1, "allocation": held,
                       "provenance": "request-sha256:c7e6698a9c9aeb09504a83bff2078a1d41478943067f1084f39a901cdd2cc4ee", "atUtc": "2026-11-05T03:15:17Z"}
            settle = dict(reserve, type="settle", atUtc="2026-11-05T03:21:44Z",
                          allocation={"requests": 0, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": 0, "runnerMinutes": 6},
                          provenance="evidence-sha256:ee620b386e60dd988f8eac73a6c0c4901063f6614f119360b6759302c622925e")
            led = lambda events: json.dumps({"events": events, "schema": "speaksharp.cloud-test.state-ledger.v1"}, sort_keys=True).encode()
            node = lambda sha, events: (sha, events, led(events))   # validate_chain's (sha, events, ledger bytes)
            chain = [node(root, []), node(reserved_head, [reserve]), node(settled_head, [reserve, settle])]
            settled = {"source": "accepted-rollup", "root": root, "headSha": settled_head,
                       "scopeApprovalRef": scope["approvalRef"], "outstandingReservations": 0, "openReservationsByRequest": {},
                       "period": {"requests": 0, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": 0, "runnerMinutes": 6},
                       "unknown": {"coachingRequests": False, "runnerMinutes": False}}
            raw = lambda d: json.dumps(d, sort_keys=True).encode()
            approve = lambda cp, ch: init.occurrence_action_approval({}, request_sha, raw(cp), occurrence, repo=repo, chain=ch)
            init.manual_reservation.admit_action_approval(b"{}", occurrence_raw, request_sha, raw(settled), repo, chain)
            # a preflight-only setup failure (R10 run 42059286564) settles at its bound, 10 campaign requests and nothing else: still admitted
            bounded = chain[:2] + [node(settled_head, [reserve, dict(settle, allocation=dict(settle["allocation"], requests=10))])]
            self.assertEqual(approve(dict(settled, period=dict(settled["period"], requests=10)), bounded)["selectionApprovalRef"], "approval-bcde5476311b392d618839dd2ae6b2f0")
            self.assertEqual(approve(settled, chain)["selectionApprovalRef"], "approval-bcde5476311b392d618839dd2ae6b2f0")
            # prepare: the verified head adds this run's own open reserve; the approval chain is computed at its parent, which admits
            own_reserve = dict(reserve, runId="41999999999", provenance="request-sha256:" + request_sha, atUtc="2026-11-05T12:00:05Z")
            full = chain + [node("a" * 40, [reserve, settle, own_reserve])]
            parent = init.manual_approval_chain(full, ("R10-3b040043-smoke15", "41999999999", 1, request_sha))
            self.assertEqual(parent, chain)
            self.assertEqual(approve(settled, parent)["selectionApprovalRef"], "approval-bcde5476311b392d618839dd2ae6b2f0")
            bad_settle = lambda **over: chain[:2] + [node(settled_head, [reserve, dict(settle, **over)])]
            chain_refusals = [None, [], chain[:2], [node(root, []), node(settled_head, [reserve])],
                              bad_settle(type="release"), bad_settle(runId="41960376783"), bad_settle(attempt=2),
                              bad_settle(provenance="approval:slack-1000000022.000022"),
                              bad_settle(allocation=dict(settle["allocation"], runnerMinutes=41)),
                              [node("f" * 40, []), node(reserved_head, [reserve]), node(settled_head, [reserve, settle])],
                              chain[:2] + [node("b" * 40, [reserve, settle])]]
            for key in ("identityReads", "starts", "takes", "coachingRequests"):
                chain_refusals.append(bad_settle(allocation=dict(settle["allocation"], **{key: 1})))
            chain_refusals.append(bad_settle(allocation=dict(settle["allocation"], requests=11)))      # above the preflight's bounded charge
            for bad in chain_refusals:
                with self.assertRaisesRegex(init.Refused, "one-off-grant-checkpoint"):
                    approve(settled, bad)
            rollup_refusals = [dict(settled, headSha=reserved_head, outstandingReservations=1, openReservationsByRequest={"c7e6698a": 1}),
                               dict(settled, outstandingReservations=1), dict(settled, openReservationsByRequest={"x": 1}),
                               dict(settled, root="f" * 40), dict(settled, source="other"), dict(settled, scopeApprovalRef="approval-6dca8b0dda1efd6f49eee6840f42357b"),
                               dict(settled, unknown={"coachingRequests": True, "runnerMinutes": False}), dict(settled, unknown={}),
                               {k: v for k, v in settled.items() if k != "period"}]
            rollup_refusals.append(dict(settled, period=dict(settled["period"], requests=11)))          # more than one preflight's bound
            for key in ("identityReads", "starts", "takes", "coachingRequests"):
                rollup_refusals.append(dict(settled, period=dict(settled["period"], **{key: 1})))
                rollup_refusals.append(dict(settled, period={k: v for k, v in settled["period"].items() if k != key}))
            for bad in rollup_refusals:
                with self.assertRaisesRegex(init.Refused, "one-off-grant-checkpoint"):
                    approve(bad, chain)

    def test_committed_grant_scope_real_reserve_then_prepare_on_verified_chain(self):
        """The production reserve appends to a verified state chain, then the
        production prepare path consumes that exact open reserve. No hand-built
        checkpoint or direct approval-check shortcut participates."""
        with root_pinned_grant():
            repo = str(ROOT.parents[1])
            root = init.continuity_pins()["accepted_root"]
            template_rel = init.ONE_OFF_TEMPLATE_PATH
            template = json.loads((ROOT / ONE_OFF_TEMPLATE).read_text())
            start = "2026-11-08T16:00:00Z"
            occurrence = init.materialize_authoritative_smoke_occurrence(repo, template, start)
            occurrence_raw = json.dumps(occurrence, sort_keys=True, separators=(",", ":")).encode()
            request_sha = hashlib.sha256(occurrence_raw).hexdigest()
            bootstrap = (ROOT / "config/aggregate/accounting-bootstrap.json").read_bytes()
            scope = (ROOT / "config/aggregate/period-scope.json").read_bytes()
            source_sha = init._git(repo, "rev-parse", "HEAD")
            run_id = "41600000001"

            with tempfile.TemporaryDirectory(prefix="r10-real-path-") as tmp:
                remote = str(Path(tmp) / "state.git")
                writer = str(Path(tmp) / "writer")
                subprocess.run(["git", "init", "-q", "--bare", remote], check=True)
                subprocess.run(["git", "init", "-q", writer], check=True)
                subprocess.run(["git", "-C", writer, "fetch", "-q", repo, root], check=True)
                subprocess.run(["git", "-C", writer, "push", "-q", remote, "%s:%s" % (root, state_ref_writer.STATE_REF)], check=True)

                reserve_dir = Path(tmp) / "reserve"
                reserve_dir.mkdir()
                init.manual_reservation.execute(
                    "reserve",
                    {"request": occurrence_raw, "admittedSha256": request_sha, "runId": run_id,
                     "bootstrap": bootstrap, "scope": scope, "facts": b"{}", "atUtc": start},
                    writer, remote, root, str(reserve_dir / "journal.json"), str(reserve_dir / "receipt.json"),
                    init.continuity_pins(), remote, source_repo=repo)
                head = state_ref_writer.fetch_head(writer, remote, remote)
                chain = state_ref_writer.validate_chain(writer, head, root)
                self.assertEqual(chain[-1][1][-1]["provenance"], "request-sha256:" + request_sha)

                occurrence_file = Path(tmp) / "occurrence.json"
                occurrence_file.write_bytes(occurrence_raw)
                bundle = json.loads(bundle_with(ACCOUNT_ID))
                maintained_id = bundle["accounts"]["maintained-read-only"]["accountId"]
                nonsecret_facts = facts(
                    ownerApprovalReference="approval-bcde5476311b392d618839dd2ae6b2f0",
                    approvedBy="product-owner", reviewer="release-reviewer",
                    producerReviewReference="review:producer@1",
                    # AHT-01 alone needs only the existing-disposable role; the facts name exactly the selection's roles
                    accounts={
                        "existing-disposable": {"idSha256": hashlib.sha256(ACCOUNT_ID.encode()).hexdigest(),
                                                "historyRef": "history:throwaway@r10"},
                    },
                    backend={"manifestRef": "receipt:backend@r10", "generation": 1,
                             "completion": "OFF", "migration129": "absent"})
                args = SimpleNamespace(
                    repo=repo, config="tools/cloud-test/config/test-config.v1.json", request=template_rel,
                    manual_occurrence_file=str(occurrence_file), manual_occurrence_sha256=request_sha,
                    workflow_start_utc=start, nightly_request_file=None, nightly_request_sha256=None,
                    facts=json.dumps(nonsecret_facts), run_id=run_id, attempt=1, source_sha=source_sha,
                    job_timeout_minutes=85, case10_observation=None)
                with mock.patch.object(init, "state_chain", return_value=chain), \
                        mock.patch.dict(os.environ, {"CLOUD_TEST_LIVE_ACCOUNTS": json.dumps(bundle),
                                                     "SUPABASE_URL": SUPABASE_URL_OK}):
                    prepared = init.prepare(args, datetime(2026, 11, 8, 16, 5, 0, tzinfo=timezone.utc))
                self.assertEqual(prepared["requestSha256"], request_sha)
                self.assertEqual(prepared["liveMinutes"], 31)
                self.assertEqual(prepared["facts"]["actionApproval"]["selectionApprovalRef"],
                                 "approval-bcde5476311b392d618839dd2ae6b2f0")
                self.assertEqual(prepared["facts"]["actionApproval"]["approvalRef"],
                                 "approval-2c749f7fca826f9e54d962517a702665")
                # the manual R10 flow emits the binding from ITS verified own reserve at the real head (never own=None)
                b = prepared["reservationBinding"]
                self.assertEqual((b["campaignId"], b["runId"], b["attempt"], b["requestSha256"]), (template["runId"], run_id, 1, request_sha))
                self.assertEqual((b["journalHeadSha"], b["reconciliationHeadSha"], b["journalRootSha"]), (chain[-1][0], chain[-2][0], root))
                self.assertEqual(b["identityReads"], chain[-1][1][-1]["allocation"]["identityReads"])
                self.assertEqual((b["harnessSourceSha"], b["testedSha"]), (source_sha, template["release"]["testedSha"]))
                self.assertEqual(json.loads(prepared["reconciliationBytes"])["headSha"], b["reconciliationHeadSha"])

    def test_completion_deadline_marks_queue_delay_incomplete_without_changing_settlement_period(self):
        template = json.loads((ROOT / ONE_OFF_TEMPLATE).read_text())
        value = init.materialize_authoritative_smoke_occurrence(str(ROOT.parents[1]), template, "2026-11-08T16:00:00Z")
        raw = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
        self.assertTrue(init.completion_within_occurrence(raw, datetime(2026, 11, 8, 17, 40, 0, tzinfo=timezone.utc)))
        self.assertFalse(init.completion_within_occurrence(raw, datetime(2026, 11, 8, 17, 40, 1, tzinfo=timezone.utc)))
        scope = json.loads((ROOT / "config/aggregate/period-scope.json").read_text())
        self.assertLess(datetime(2026, 11, 8, 17, 40, 1, tzinfo=timezone.utc), init._utc(scope["periodEndUtc"]))
        with tempfile.TemporaryDirectory(prefix="completion-deadline-") as tmp:
            occurrence_file = Path(tmp) / "occurrence.json"
            occurrence_file.write_bytes(raw)
            self.assertEqual(init.main(["init_run_inputs.py", "completion-deadline",
                                        "--manual-occurrence-file", str(occurrence_file),
                                        "--now", "2026-11-08T17:40:00Z"]), 0)
            self.assertEqual(init.main(["init_run_inputs.py", "completion-deadline",
                                        "--manual-occurrence-file", str(occurrence_file),
                                        "--now", "2026-11-08T17:40:01Z"]), 79)

    def test_all_fifteen_smoke_maps_to_distinct_builder_mode(self):
        mode, caps = request_caps(request())
        self.assertEqual(mode, "smoke")
        self.assertEqual(tuple(caps), CASE_IDS)
        self.assertEqual(run_env.SAMPLE["smoke"], "smoke")
        self.assertEqual(run_env.BP_MODE["smoke"], "smoke")

    def test_smoke_never_accepts_a_subset_or_full_case_cap_invention(self):
        missing = request()
        missing["selection"].pop()
        missing["estimate"]["starts"] -= MINIMAL_MINIMA["AHT-15"]
        missing["proposedLimits"]["startPressCaps"].pop("AHT-15")
        missing["approvedLimits"]["startPressCaps"].pop("AHT-15")
        with self.assertRaisesRegex(InputValidationError, "full-selection"):
            request_caps(missing)

        wrong = request()
        wrong["sampleMode"] = "minimal"
        with self.assertRaisesRegex(InputValidationError, "mode-pair"):
            request_caps(wrong)

    def test_smoke_uses_minimum_actions_without_raising_any_case_cap(self):
        value = request()
        value["selection"][0]["startPressCap"] -= 1
        value["estimate"]["starts"] -= 1
        value["proposedLimits"]["startPressCaps"]["AHT-01"] -= 1
        value["approvedLimits"]["startPressCaps"]["AHT-01"] -= 1
        with self.assertRaisesRegex(InputValidationError, "selection-minimum"):
            request_caps(value)

    def test_config_is_short_non_full_and_keeps_case03_unchanged(self):
        cfg = json.loads((ROOT / "config" / "test-config.v1.json").read_text())
        smoke = cfg["modes"]["smoke"]
        self.assertFalse(smoke["countsAsFullLiveRun"])
        self.assertEqual(smoke["limits"]["maxSelectedCases"], 15)
        self.assertEqual(smoke["limits"]["maxWindowMinutes"], 60)
        self.assertEqual(smoke["recordingWindowMs"]["AHT-03"], 22000)
        self.assertEqual(smoke["recordingWindowMs"]["AHT-01"], 35000)
        self.assertEqual(smoke["recordingWindowMs"]["AHT-02"], 23100)
        self.assertTrue(all(v >= 5000 for v in smoke["recordingWindowMs"].values()))
        overhead = sum(smoke["window"][key] for key in ("admissionMaxMinutes", "interCaseAndReportMinutes", "cleanupReserveMinutes"))
        self.assertLessEqual(sum(smoke["caseMaxMs"].values()), (smoke["limits"]["maxWindowMinutes"] - overhead) * 60 * 1000)
        catalog = json.loads((ROOT / smoke["assertionCatalog"]["file"]).read_text())
        self.assertEqual(catalog["totalAssertions"], sum(len(row["requiredAssertions"]) for row in catalog["cases"].values()))
        self.assertEqual(catalog["minimumStarts"], sum(MINIMAL_MINIMA.values()))

    def test_live_input_admission_accepts_only_the_all_fifteen_smoke_pair(self):
        value = live_smoke_request()
        self.assertEqual(init.check_request(value, NOW, KEYS), init.ALL_CASES)
        subset = copy.deepcopy(value)
        subset["selection"].pop()
        with self.assertRaisesRegex(init.Refused, "smoke-mode-needs-all-fifteen"):
            init.check_request(subset, NOW, KEYS)
        wrong = copy.deepcopy(value)
        wrong["sampleMode"] = "full"
        with self.assertRaisesRegex(init.Refused, "smoke-mode-needs-smoke-sampling"):
            init.check_request(wrong, NOW, KEYS)

    def test_smoke_uses_its_own_sixty_minute_live_ceiling(self):
        value = live_smoke_request()
        self.assertEqual(init.check_ceilings(CFG, value, init.ALL_CASES, 85), 60)
        with self.assertRaisesRegex(init.Refused, "time-exceeds-job-timeout"):
            init.check_ceilings(CFG, value, init.ALL_CASES, 64)

    def test_pipeline_builds_executable_coverage_commands_from_the_request_mode(self):
        spec = importlib.util.spec_from_file_location("smoke_pipeline", SCRIPTS / "pipeline.py")
        pipeline = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(pipeline)
        cfg = json.loads((ROOT / "config" / "test-config.v1.json").read_text())
        with tempfile.TemporaryDirectory(prefix="smoke-pipeline-command-") as root:
            root = Path(root)
            request_path = root / "request.json"
            request_path.write_text(json.dumps(live_smoke_request()))
            command = pipeline.coverage_command(str(request_path), cfg, str(root / "coverage.json"))
            self.assertEqual(command[0], "check_coverage.py")
            self.assertEqual(Path(command[command.index("--catalog") + 1]).name, "smoke-assertion-catalog.json")
            full = live_request(); full_path = root / "full.json"; full_path.write_text(json.dumps(full))
            full_command = pipeline.coverage_command(str(full_path), cfg, str(root / "full-coverage.json"))
            self.assertEqual(Path(full_command[full_command.index("--catalog") + 1]).name, "assertion-catalog.json")

    def test_real_builder_emits_the_pinned_smoke_contract_for_all_fifteen(self):
        with tempfile.TemporaryDirectory(prefix="cloud-test-smoke-builder-") as root:
            fixture = SyntheticBuilder(root, cases=range(1, 16), minimal=True)
            fixture.request["coverageMode"] = "smoke"
            fixture.request["sampleMode"] = "smoke"
            fixture.request["executionRuntime"] = "GitHub Actions SpeakSharp"
            facts = json.loads((ROOT / "tests/fixtures/plan-facts.PLACEHOLDER.json").read_text())
            facts["producerReviewReference"] = "UNIT-INDEPENDENT-REVIEW-NOT-A-RUN"
            fixture.repin(facts=facts)
            packet = ROOT / "harness"
            receiver = "draft-adapters/receivers/github-job-evidence-reader.cjs"
            descriptor = {
                "producerIdentity": "github-actions:relativityE/speaksharp:123:1:live",
                "jobId": "live",
                "producerCodeSha256": hashlib.sha256((packet / "bundle/harness/authenticated-job-producer.cjs").read_bytes()).hexdigest(),
                "receiverSourceSha256": hashlib.sha256((packet / receiver).read_bytes()).hexdigest(),
                "receiverRelativePath": receiver,
                "workflowSourceSha": "b" * 40,
                "reviewReference": facts["producerReviewReference"],
            }
            descriptor_path = Path(root) / "producer-descriptor.json"
            descriptor_path.write_text(json.dumps(descriptor))
            descriptor_path.chmod(0o600)
            fixture.env["BP_MODE"] = "smoke"
            fixture.env.update(
                BP_PRODUCER_MODE="same-github-job",
                BP_PRODUCER_DESCRIPTOR=str(descriptor_path),
                BP_PRODUCER_DESCRIPTOR_SHA256=hashlib.sha256(descriptor_path.read_bytes()).hexdigest(),
                GITHUB_ACTIONS="true",
                GITHUB_REPOSITORY="relativityE/speaksharp",
                GITHUB_RUN_ID="123",
                GITHUB_RUN_ATTEMPT="1",
                GITHUB_JOB="live",
                GITHUB_SHA="b" * 40,
            )
            phase1 = fixture.run("phase1")
            self.assertEqual(phase1.returncode, 0, phase1.stderr)
            phase2 = fixture.run("phase2")
            self.assertEqual(phase2.returncode, 0, phase2.stderr)
            plan = json.loads((Path(root) / "private/cfg/campaign-plan.json").read_text())
            catalog = json.loads((ROOT / "config/smoke-assertion-catalog.json").read_text())
            self.assertEqual(plan["coverageMode"], "smoke")
            self.assertEqual(plan["assertionDepth"], "smoke")
            self.assertEqual([row["id"] for row in plan["cases"]], list(CASE_IDS))
            for case_id in CASE_IDS:
                config = json.loads((Path(root) / f"private/cases/{case_id}.json").read_text())
                self.assertEqual(config["sampleMode"], "smoke")
                self.assertEqual(config["requiredAssertions"], catalog["cases"][case_id]["requiredAssertions"])
                self.assertEqual(config["recordingWindowMs"], CFG["modes"]["smoke"]["recordingWindowMs"][case_id])

    def test_smoke_coverage_can_be_complete_but_never_full_live(self):
        value = live_smoke_request()
        value["runId"] = "UNIT-SMOKE-COVERAGE"
        value["release"]["testedSha"] = "a" * 40
        catalog = json.loads((ROOT / "config" / "smoke-assertion-catalog.json").read_text())
        cases = []
        for case_id, spec in catalog["cases"].items():
            assertions = [{"id": row, "result": "PASS"} for row in spec["requiredAssertions"]]
            identity = {"result": "MATCH", "servedSha": "a" * 40, "expectedSha": "a" * 40}
            cases.append({"caseId": case_id, "assertions": assertions, "identityBefore": identity, "identityAfter": identity})
        results = {"campaignId": value["runId"], "sourceSha": "a" * 40, "servedSha": "a" * 40, "finalIdentity": "MATCH", "cases": cases}
        out = coverage.assess(value, catalog, results)
        self.assertEqual(out["kind"], "SMOKE")
        self.assertTrue(out["coverageComplete"])
        self.assertFalse(out["fullLiveRun"])
        self.assertIn("a smoke run does not claim full coverage", out["reasons"])


if __name__ == "__main__":
    unittest.main()
