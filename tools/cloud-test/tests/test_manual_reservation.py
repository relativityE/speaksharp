"""Manual-dispatch reservation integration (RETURN ), offline, with EXPLICIT SYNTHETIC inputs only:
the synthetic full-coverage request fixture, a synthetic bootstrap and period scope accepted through test-only pins, synthetic run-record
bytes, and the real state-ref writer on a temporary bare repository. Reserve -> counted by the rollup as G5 would charge it -> settle from
verified record bytes; headroom boundary, staleness, admission, scope, period, identity and replay negatives."""
import hashlib
import json
import os
import subprocess
import sys
from unittest import mock

from _fixtures import ROOT, request_path
import accounting_rollup as R
import unexecuted_attempt_evidence as U
import manual_reservation as M
import state_ref_writer as W
from test_accounting_rollup import Journal, scope

AT = "2026-11-02T04:00:00Z"
RUN = "41400000001"
EVIDENCE = "e" * 64
# R7-full-coverage: run cap 4310 + 32 identity reads = a G5 request charge of 4342.
ALLOCATION = {"requests": 4342, "identityReads": 32, "starts": 42, "takes": 31, "coachingRequests": 40, "runnerMinutes": 30}


def read(path):
    with open(path, "rb") as f:
        return f.read()


def scope_raw(**over):
    return json.dumps(scope(**over), sort_keys=True).encode()


class ManualReservation(Journal):
    def setUp(self):
        super().setUp()
        request = json.loads(read(request_path("R7-full-coverage-proposal.json")))
        request["approvedLimits"]["runCapRequests"] = request["estimate"]["requests"]["runCap"]
        # the request's own approval references, which the action approval must name (init_run_inputs.check_action_approval)
        request["approvedLimits"].update(approvalRef="slack:1000000002.000002", approvedBy="synthetic-owner")
        request["selectionApprovalRef"] = "slack:1000000002.000002"
        self.req = json.dumps(request, sort_keys=True).encode()
        self.sha = hashlib.sha256(self.req).hexdigest()
        self.scope = scope_raw()
        self.all_pins = dict(self.pins, accepted_scope_sha256=hashlib.sha256(self.scope).hexdigest())

    def head(self):
        return W.fetch_head(self.repo, self.remote, self.remote)

    def push(self, event):
        return W.propose(self.repo, self.remote, self.head(), event, self.root, self.remote)

    def reserved(self, run=RUN, sc=None):
        e = M.reserve(self.req, self.sha, run, self.receive(sc), self.head(), AT)
        self.push(e)
        return e

    def refused(self, code, fn, *a):
        with self.assertRaises(M.Refused) as e:
            fn(*a)
        self.assertEqual(str(e.exception), code)

    def record(self, run=RUN, **spend):
        s = {"requests": 2900, "identityReads": 30, "starts": 15, "takes": 14, "byCategory": {}, "source": "synthetic"}
        s.update(spend)
        return json.dumps({"schema": M.RUN_RECORD_SCHEMA, "runId": "R7-full-coverage", "spend": s,
                           "executionProvenance": {"campaignId": "R7-full-coverage", "runId": run, "attempt": 1, "requestSha256": self.sha}},
                          sort_keys=True).encode()

    def execute(self, command, inputs, name, root=None, pins=None):
        d = os.path.join(self.d, name)
        os.mkdir(d)
        return M.execute(command, inputs, self.repo, self.remote, root or self.root, os.path.join(d, "journal.json"),
                         os.path.join(d, "receipt.json"), pins or self.all_pins, self.remote)

    def facts(self, **over):
        """The dispatched facts: an action approval naming this request and the checkpoint at the CURRENT head (what the approver saw)."""
        req = json.loads(self.req)
        a = {"schema": "speaksharp.case-start-approval.v1", "requestSha256": self.sha,
             "reconciliationSha256": hashlib.sha256(R.checkpoint_bytes(self.receive())).hexdigest(),
             "approvalRef": req["approvedLimits"]["approvalRef"], "approvedBy": req["approvedLimits"]["approvedBy"],
             "selectionApprovalRef": req["selectionApprovalRef"]}
        a.update(over)
        return json.dumps({"actionApproval": a}).encode()

    def reserve_inputs(self, **over):
        i = {"request": self.req, "admittedSha256": self.sha, "runId": RUN, "bootstrap": self.raw, "scope": self.scope, "facts": self.facts(),
             "atUtc": AT}
        i.update(over)
        return i

    def test_the_writer_admits_the_action_approval_before_any_append(self):
        # #1772 RETURN #2 (broken before: the reserve was appended with no approval check, so an invalid or stale approval
        # consumed caps and left an open reservation). Every refusal leaves the journal head unchanged.
        before = self.head()
        stale = self.facts()
        for label, facts, code in (
                ("no facts", None, "manual-reservation-approval-facts"),
                ("no action approval", json.dumps({}).encode(), "manual-reservation-approval-facts"),
                ("another request", self.facts(requestSha256="b" * 64), "manual-reservation-action-approval-not-the-request"),
                ("another checkpoint", self.facts(reconciliationSha256="c" * 64), "manual-reservation-action-approval-not-the-checkpoint"),
                ("another approver", self.facts(approvedBy="someone-else"), "manual-reservation-action-approval-reference"),
                ("an extra field", self.facts(extra=1), "manual-reservation-action-approval-shape")):
            self.refused(code, self.execute, "reserve", self.reserve_inputs(facts=facts), "a-" + label.replace(" ", "-"))
            self.assertEqual(self.head(), before, label)
        # a STALE approval: another run reserved after the approver saw the checkpoint, so it no longer names the append's checkpoint
        self.reserved(run="41400000077")
        moved = self.head()
        self.refused("manual-reservation-action-approval-not-the-checkpoint", self.execute, "reserve", self.reserve_inputs(facts=stale), "a-stale")
        self.assertEqual(self.head(), moved)
        # fixed after: the current approval is admitted and the reserve appended
        e = self.execute("reserve", self.reserve_inputs(), "a-ok")
        self.assertEqual(e["provenance"], "request-sha256:" + self.sha)
        self.assertNotEqual(self.head(), moved)

    def test_the_writer_never_uses_a_configured_checkout_as_its_transport(self):
        # #1772 RETURN #1: the workflow checkout has remotes and config, which the writer refuses (unsafe-git-config);
        # without --repo the CLI uses a fresh `git init` repository that passes the same check.
        hostile = os.path.join(self.d, "checkout-like")
        subprocess.run(["git", "init", "-q", hostile], check=True)
        subprocess.run(["git", "-C", hostile, "remote", "add", "origin", "https://example.invalid/repo.git"], check=True)
        with self.assertRaises(W.Refused) as e:
            W.check_repo(hostile)
        self.assertEqual(str(e.exception), "unsafe-git-config")
        isolated = M._isolated_repo()
        self.assertIsNone(W.check_repo(isolated))
        self.assertEqual(os.listdir(os.path.dirname(isolated)).count(os.path.basename(isolated)), 1)

    def test_a_settle_from_the_closed_input_keeps_the_run_records_own_digest_as_evidence(self):
        # #1772 RETURN #3 (broken before: the evidence became the projection's digest, losing the run record's provenance)
        import settle_input
        self.execute("reserve", self.reserve_inputs(), "r")
        projection = settle_input.project(self.record())
        settle = {"campaignId": "R7-full-coverage", "runId": RUN, "record": projection, "settleInput": True, "scope": self.scope, "atUtc": AT}
        s = self.execute("settle", settle, "s")
        self.assertEqual(s["provenance"], "evidence-sha256:" + hashlib.sha256(self.record()).hexdigest())
        self.assertNotEqual(s["provenance"], "evidence-sha256:" + hashlib.sha256(projection).hexdigest())
        self.assertEqual(s["allocation"]["requests"], 2930)  # the same settled usage as from the full record

    def test_a_reservation_charges_requests_plus_identity_reads_as_g5_does(self):
        e = self.reserved()
        self.assertEqual((e["campaignId"], e["runId"], e["attempt"], e["provenance"]), ("R7-full-coverage", RUN, 1, "request-sha256:" + self.sha))
        self.assertEqual(e["allocation"], ALLOCATION)
        out = self.receive()
        self.assertEqual((out["outstandingReservations"], out["requests"]["conservativeUsed"], out["identityReads"]["conservativeUsed"]),
                         (1, 4342, 32), "an open reservation counts exactly G5's charge")

    def test_the_headroom_boundary_admits_4342_and_refuses_4341(self):
        # headroom = requests ceiling - protected reserve (300) - used (0). 4310 would fit 4341; G5's 4342 charge does not.
        for ceiling, fits in ((4300 + 300 + 41, False), (4300 + 300 + 42, True)):
            with self.subTest(headroom=ceiling - 300):
                rollup = self.receive(scope(ceilings=dict(scope()["ceilings"], requests=ceiling)))
                if fits:
                    self.assertEqual(M.reserve(self.req, self.sha, RUN, rollup, self.head(), AT)["allocation"]["requests"], 4342)
                else:
                    self.refused("manual-reservation-exceeds-headroom", M.reserve, self.req, self.sha, RUN, rollup, self.head(), AT)

    def test_a_measured_settlement_charges_campaign_requests_plus_identity_reads_once(self):
        e = self.reserved()
        usage, evidence = M.usage_from_record(self.record(), e)
        self.assertEqual((usage, evidence), ({"requests": 2930, "identityReads": 30, "starts": 15, "takes": 14, "coachingRequests": None,
                                              "runnerMinutes": None}, hashlib.sha256(self.record()).hexdigest()))
        s = M.settle(e, usage, evidence, "2026-11-02T06:00:00Z")
        self.assertEqual(s["allocation"], dict(ALLOCATION, requests=2930, identityReads=30, starts=15, takes=14),
                         "unmeasured coaching and runner minutes settle at the reserved cap, never 0")
        self.push(s)
        out = self.receive()
        self.assertEqual((out["outstandingReservations"], out["requests"]["conservativeUsed"], out["identityReads"]["conservativeUsed"]), (0, 2930, 30))
        for unknown in ({"requests": None}, {"identityReads": None}, {"requests": None, "identityReads": None}):
            unmeasured, _ = M.usage_from_record(self.record(**unknown), e)
            self.assertIsNone(unmeasured["requests"])
            self.assertEqual(M.settle(e, unmeasured, EVIDENCE, AT)["allocation"]["requests"], 4342,
                             "either unknown component keeps the full reserved G5 request charge")

    def test_measured_zero_starts_and_takes_bound_coaching_at_zero_and_nothing_else(self):
        """Consultant P1-4: a run measured at 0 Starts and 0 takes made no coaching call; any other measurement keeps coaching at the cap."""
        e = self.reserved()
        usage, _ = M.usage_from_record(self.record(requests=10, identityReads=0, starts=0, takes=0), e)
        self.assertEqual(usage, {"requests": 10, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": 0, "runnerMinutes": None})
        settled = M.settle(e, usage, EVIDENCE, AT)["allocation"]
        self.assertEqual((settled["coachingRequests"], settled["runnerMinutes"]), (0, ALLOCATION["runnerMinutes"]))
        for kept in ({"starts": 1, "takes": 0}, {"starts": 0, "takes": 1}, {"starts": None, "takes": 0}, {"starts": 0, "takes": None}):
            with self.subTest(kept):
                u, _ = M.usage_from_record(self.record(requests=10, identityReads=0, **kept), e)
                self.assertIsNone(u["coachingRequests"])

    def test_headroom_is_recomputed_at_the_proposed_head(self):
        self.refused("manual-reservation-exceeds-headroom", M.reserve, self.req, self.sha, RUN, self.receive(scope(carryover="historical")), self.head(), AT)
        stale = self.receive()
        self.reserved("41400000002")
        self.refused("manual-reservation-rollup-stale", M.reserve, self.req, self.sha, "41400000003", stale, self.head(), AT)
        self.refused("manual-reservation-rollup", M.reserve, self.req, self.sha, "41400000003", dict(self.receive(), source="legacy"), self.head(), AT)
        self.reserved("41400000004")  # two outstanding full runs hold 62 of the 80 takes
        self.refused("manual-reservation-exceeds-headroom", M.reserve, self.req, self.sha, "41400000005", self.receive(), self.head(), AT)

    def test_only_the_admitted_manual_request_with_known_caps_is_reserved(self):
        args = (RUN, self.receive(), self.head(), AT)
        self.refused("manual-reservation-request-not-admitted", M.reserve, self.req + b" ", self.sha, *args)
        self.refused("manual-reservation-request-not-admitted", M.reserve, self.req, self.sha.upper(), *args)
        nightly = read(request_path("R8-nightly-regression-proposal.json"))
        self.refused("manual-reservation-nightly", M.reserve, nightly, hashlib.sha256(nightly).hexdigest(), *args)
        doc = json.loads(self.req)
        del doc["estimate"]["providerBillableRequests"]["coachingCap"]
        unknown = json.dumps(doc).encode()
        self.refused("manual-reservation-caps-unknown", M.reserve, unknown, hashlib.sha256(unknown).hexdigest(), *args)
        self.refused("manual-reservation-event-run-id", M.reserve, self.req, self.sha, "0123", *args[1:])
        self.refused("manual-reservation-event-run-id", M.reserve, self.req, self.sha, 41400000001, *args[1:])

    def test_the_reservation_holds_the_enforced_approved_request_cap(self):
        doc = json.loads(self.req)
        doc["approvedLimits"]["runCapRequests"] = 4400
        raw = json.dumps(doc, sort_keys=True).encode()
        event = M.reserve(raw, hashlib.sha256(raw).hexdigest(), RUN, self.receive(), self.head(), AT)
        self.assertEqual(event["allocation"]["requests"], 4432,
                         "the approved browser allowance plus identity reads is reserved")

        for value in (None, True, 4309):
            with self.subTest(approved=value):
                bad = json.loads(self.req)
                bad["approvedLimits"]["runCapRequests"] = value
                encoded = json.dumps(bad, sort_keys=True).encode()
                self.refused("manual-reservation-approved-request-cap", M.reserve, encoded,
                             hashlib.sha256(encoded).hexdigest(), RUN, self.receive(), self.head(), AT)

    def test_settlement_is_bound_to_the_record_bytes_and_the_reservation(self):
        e = self.reserved()
        for raw, code in ((self.record(run="41400000009"), "manual-settle-record-identity"), (b"not json", "manual-settle-record"),
                          (self.record().replace(self.sha.encode(), b"f" * 64), "manual-settle-record-identity"),
                          (self.record(requests=-1), "manual-settle-usage"), (self.record(requests=True), "manual-settle-usage"),
                          (json.dumps(dict(json.loads(self.record()), runId="R8")).encode(), "manual-settle-record")):
            with self.subTest(code=code):
                self.refused(code, M.usage_from_record, raw, e)
        attempt2 = json.loads(self.record())
        attempt2["executionProvenance"]["attempt"] = True
        self.refused("manual-settle-record-identity", M.usage_from_record, json.dumps(attempt2).encode(), e)
        over, _ = M.usage_from_record(self.record(requests=4343), e)
        self.refused("manual-settle-exceeds-reservation", M.settle, e, over, EVIDENCE, AT)
        self.assertEqual(self.receive()["requests"]["conservativeUsed"], 4342, "a refused settle leaves the reservation open and counted")
        self.refused("manual-settle-evidence", M.settle, e, M.usage_from_record(self.record(), e)[0], "not-a-digest", AT)
        self.refused("manual-reservation-not-reserved", M.settle, dict(e, type="settle"), M.usage_from_record(self.record(), e)[0], EVIDENCE, AT)

    def test_the_integrated_path_reserves_then_settles_the_reservation_it_finds_on_the_chain(self):
        e = self.execute("reserve", self.reserve_inputs(), "r1")
        with open(os.path.join(self.d, "r1", "receipt.json"), encoding="utf-8") as f:
            self.assertTrue(W.verify(self.repo, self.remote, json.load(f), e, self.root, self.remote)["verified"])
        self.assertEqual((self.receive()["outstandingReservations"], self.receive()["requests"]["conservativeUsed"]), (1, 4342))
        settle = {"campaignId": "R7-full-coverage", "runId": RUN, "record": self.record(), "scope": self.scope, "atUtc": AT}
        s = self.execute("settle", settle, "s1")
        self.assertEqual((s["allocation"]["requests"], s["provenance"]), (2930, "evidence-sha256:" + hashlib.sha256(self.record()).hexdigest()))
        self.assertEqual((self.receive()["outstandingReservations"], self.receive()["requests"]["conservativeUsed"]), (0, 2930))
        self.refused("manual-reservation-transition-without-open-reservation", self.execute, "settle", settle, "s2")
        self.refused("manual-reservation-not-reserved", self.execute, "settle", dict(settle, runId="41400000009"), "s3")

    def test_reserve_check_admits_exactly_as_reserve_does_and_writes_nothing(self):
        """Consultant P2-3: the pre-dispatch check runs every read and admission check of the reserve at the current head and appends
        nothing; it defers when the journal ends with an open reserve (that attempt is recovered first by the dispatch's own path), and
        it refuses exactly where the reserve would."""
        def check(inputs, name):
            d = os.path.join(self.d, name)
            os.mkdir(d)
            return M.execute("reserve", inputs, self.repo, self.remote, self.root, os.path.join(d, "journal.json"),
                             os.path.join(d, "receipt.json"), self.all_pins, self.remote, dry_run=True)
        before = self.head()
        would = check(self.reserve_inputs(), "c1")
        self.assertEqual((would["type"], would["runId"], would["allocation"]), ("reserve", RUN, ALLOCATION))
        self.assertEqual(self.head(), before, "the check appends nothing")
        self.assertFalse(os.path.exists(os.path.join(self.d, "c1", "journal.json")))
        real = self.execute("reserve", self.reserve_inputs(), "r1")
        self.assertEqual(real, would, "the check predicts the real reserve's event exactly")
        self.assertIsNone(check(dict(self.reserve_inputs(), runId="41400000077"), "c2"), "an open reserve defers to the dispatch's own recovery")
        settle = {"campaignId": "R7-full-coverage", "runId": RUN, "record": self.record(), "scope": self.scope, "atUtc": AT}
        self.execute("settle", settle, "s1")
        self.refused("manual-reservation-outside-period", check, dict(self.reserve_inputs(), atUtc="2099-01-01T00:00:00Z"), "c3")
        with self.assertRaises(M.Refused):
            M.execute("settle", settle, self.repo, self.remote, self.root, os.path.join(self.d, "j"), os.path.join(self.d, "o"),
                      self.all_pins, self.remote, dry_run=True)

    def test_the_reserve_path_sends_a_current_format_long_token_and_refuses_an_injected_one_before_any_append(self):
        """Run 41933223835 refused manual-reservation-push-token-missing on GitHub's ~520-character GITHUB_TOKEN. Offline, the whole
        reserve path runs as if over https: each https git call is captured, then replayed against the temporary bare remote without the
        credential. A synthetic opaque 520-character token reaches only the push and the reservation lands; an injected one refuses with
        nothing appended."""
        long_token = "ghs_123456_" + ".".join(("eyJ" + "aB3-_x9Z" * 64)[:n] for n in (36, 391, 80))
        self.assertEqual(len(long_token), 520)
        real, seen = W._git, []

        def over_https(repo, *args, data=None, scheme="file", extra=None):
            if scheme == "https":
                seen.append((args[0], dict(extra or {})))
                return real(repo, *args, data=data, scheme="file", extra=None)
            return real(repo, *args, data=data, scheme=scheme, extra=extra)
        before = self.head()
        with mock.patch.object(W, "_transport", lambda url, approved: "https"), mock.patch.object(W, "_git", over_https):
            with mock.patch.dict(os.environ, {W.PUSH_TOKEN_ENV: long_token + "\nX-Injected: 1"}):
                self.refused("manual-reservation-push-token-missing", self.execute, "reserve", self.reserve_inputs(), "bad")
            self.assertEqual(self.head(), before, "an injected token appends nothing")
            self.assertNotIn("push", [c for c, _ in seen])
            with mock.patch.dict(os.environ, {W.PUSH_TOKEN_ENV: long_token}):
                e = self.execute("reserve", self.reserve_inputs(), "good")
        self.assertEqual(e["type"], "reserve")
        self.assertNotEqual(self.head(), before)
        self.assertEqual(self.receive()["outstandingReservations"], 1)
        pushes = [x for c, x in seen if c == "push"]
        self.assertEqual(len(pushes), 1)
        self.assertEqual(pushes[0]["GIT_CONFIG_KEY_0"], "http.%s.extraheader" % self.remote)
        self.assertTrue(all(x == {} for c, x in seen if c != "push"), "only the push carries the credential")
        self.assertFalse(any(long_token in json.dumps(x) for _, x in seen), "the token is sent only base64-encoded in the header")

    def test_phase_bound_journals_allow_exact_retries_and_refuse_cross_phase_reuse(self):
        directory = os.path.join(self.d, "phase-journals")
        os.mkdir(directory)
        reserve_journal = os.path.join(directory, "reserve-journal.json")
        reserve_receipt = os.path.join(directory, "reserve-receipt.json")
        settle_journal = os.path.join(directory, "settle-journal.json")
        settle_receipt = os.path.join(directory, "settle-receipt.json")

        first = M.execute("reserve", self.reserve_inputs(), self.repo, self.remote, self.root,
                          reserve_journal, reserve_receipt, self.all_pins, self.remote)
        receipt_bytes = read(reserve_receipt)
        retry = M.execute("reserve", self.reserve_inputs(), self.repo, self.remote, self.root,
                          reserve_journal, reserve_receipt, self.all_pins, self.remote)
        self.assertEqual(retry, first)
        self.assertEqual(read(reserve_receipt), receipt_bytes)
        self.assertEqual([event["type"] for event in self.chain()[-1][1]], ["reserve"],
                         "an exact transition retry must not append a duplicate reserve")

        settle = {"campaignId": "R7-full-coverage", "runId": RUN, "record": self.record(),
                  "scope": self.scope, "atUtc": AT}
        with self.assertRaises(M.Refused) as error:
            M.execute("settle", settle, self.repo, self.remote, self.root,
                      reserve_journal, settle_receipt, self.all_pins, self.remote)
        self.assertEqual(str(error.exception), "manual-reservation-journal-conflict")
        self.assertEqual(self.receive()["outstandingReservations"], 1,
                         "cross-phase journal reuse must refuse before settling the held reservation")

        settled = M.execute("settle", settle, self.repo, self.remote, self.root,
                            settle_journal, settle_receipt, self.all_pins, self.remote)
        settle_receipt_bytes = read(settle_receipt)
        settled_retry = M.execute("settle", settle, self.repo, self.remote, self.root,
                                  settle_journal, settle_receipt, self.all_pins, self.remote)
        self.assertEqual(settled_retry, settled)
        self.assertEqual(read(settle_receipt), settle_receipt_bytes)
        self.assertEqual([event["type"] for event in self.chain()[-1][1]], ["reserve", "settle"],
                         "an exact settle retry must not append a duplicate transition")

    def test_a_landed_transition_with_a_durable_journal_recovers_its_missing_receipt(self):
        directory = os.path.join(self.d, "interrupted-publication")
        os.mkdir(directory)
        journal = os.path.join(directory, "reserve-journal.json")
        receipt = os.path.join(directory, "reserve-receipt.json")
        original_publish = W.publish_atomic

        def interrupt_receipt(path, body, conflict):
            if path == receipt:
                raise RuntimeError("synthetic interruption after remote append")
            return original_publish(path, body, conflict)

        before = self.head()
        with mock.patch.object(W, "publish_atomic", side_effect=interrupt_receipt):
            with self.assertRaisesRegex(RuntimeError, "synthetic interruption"):
                M.execute("reserve", self.reserve_inputs(), self.repo, self.remote, self.root,
                          journal, receipt, self.all_pins, self.remote)
        landed = self.head()
        self.assertNotEqual(landed, before, "the interruption must occur after the append lands")
        self.assertTrue(os.path.isfile(journal))
        self.assertFalse(os.path.exists(receipt))
        journal_bytes = read(journal)

        os.unlink(journal)
        with self.assertRaises(M.Refused):
            M.execute("reserve", self.reserve_inputs(), self.repo, self.remote, self.root,
                      journal, receipt, self.all_pins, self.remote)
        self.assertEqual(self.head(), landed, "a missing journal cannot authorize recovery or append a duplicate")
        with open(journal, "wb") as f:
            f.write(journal_bytes)

        changed_event = dict(self.reserve_inputs(), atUtc="2026-11-02T04:00:01Z")
        with self.assertRaises(M.Refused):
            M.execute("reserve", changed_event, self.repo, self.remote, self.root,
                      journal, receipt, self.all_pins, self.remote)
        self.assertEqual(self.head(), landed, "a changed event cannot be recovered through the old journal")

        recovered = M.execute("reserve", self.reserve_inputs(), self.repo, self.remote, self.root,
                              journal, receipt, self.all_pins, self.remote)
        self.assertEqual(recovered, self.chain()[-1][1][-1])
        self.assertEqual(read(journal), journal_bytes)
        with open(receipt, encoding="utf-8") as f:
            self.assertTrue(W.verify(self.repo, self.remote, json.load(f), recovered, self.root, self.remote)["verified"])
        self.assertEqual(self.head(), landed, "receipt recovery must preserve the already-landed head")
        self.assertEqual([event["type"] for event in self.chain()[-1][1]], ["reserve"],
                         "receipt recovery must not append a duplicate transition")

        with open(receipt, "w", encoding="utf-8") as f:
            f.write("conflicting output\n")
        self.refused("manual-reservation-receipt-conflict", M.execute, "reserve", self.reserve_inputs(),
                     self.repo, self.remote, self.root, journal, receipt, self.all_pins, self.remote)
        self.assertEqual(self.head(), landed)

        os.unlink(receipt)
        changed = json.loads(journal_bytes)
        changed["newSha"] = "f" * 40
        with open(journal, "w", encoding="utf-8") as f:
            json.dump(changed, f)
        self.refused("manual-reservation-receipt-commit-not-on-state-ref", M.execute, "reserve", self.reserve_inputs(),
                     self.repo, self.remote, self.root, journal, receipt, self.all_pins, self.remote)
        self.assertFalse(os.path.exists(receipt), "a non-matching journal must not recreate a receipt")
        self.assertEqual([event["type"] for event in self.chain()[-1][1]], ["reserve"])

    def test_the_integrated_path_keeps_the_trust_boundaries(self):
        r = self.reserve_inputs()
        self.refused("manual-reservation-root-mismatch", self.execute, "reserve", r, "x1", "f" * 40)
        # scope: the accepted BYTES, not any parseable scope with a nonempty approvalRef
        self.refused("manual-reservation-scope-not-accepted", self.execute, "reserve", dict(r, scope=scope_raw(approvalRef="slack:1")), "x2")
        self.refused("manual-reservation-scope-not-accepted", self.execute, "reserve", r, "x3", None, dict(self.all_pins, accepted_scope_sha256=None))
        # period checked BEFORE the append: the chain stays empty
        self.refused("manual-reservation-outside-period", self.execute, "reserve", dict(r, atUtc="2026-11-01T23:59:59Z"), "x4")
        self.refused("manual-reservation-outside-period", self.execute, "reserve", dict(r, atUtc="2026-12-02T00:00:00Z"), "x5")
        self.assertEqual(self.chain()[-1][1], [])
        self.refused("manual-reservation-rollup-bootstrap-not-accepted", self.execute, "reserve", r, "x6", None,
                     dict(self.all_pins, accepted_sha256="0" * 64))
        # release: refused on the integrated path until never-started evidence can be verified
        self.execute("reserve", r, "x7")
        self.refused("manual-release-never-started-unverified", self.execute, "release", {"campaignId": "R7-full-coverage", "runId": RUN}, "x8")
        self.assertEqual(self.receive()["outstandingReservations"], 1)

    def test_a_late_settle_is_refused_before_the_append_and_the_reservation_stays_held(self):
        self.execute("reserve", self.reserve_inputs(), "r1")
        head = self.head()
        late = {"campaignId": "R7-full-coverage", "runId": RUN, "record": self.record(), "scope": self.scope, "atUtc": "2026-12-02T00:00:00Z"}
        self.refused("manual-settle-outside-period", self.execute, "settle", late, "s1")
        self.refused("manual-settle-outside-period", self.execute, "settle", dict(late, atUtc="2026-11-01T23:59:59Z"), "s2")
        self.refused("manual-reservation-scope-not-accepted", self.execute, "settle", dict(late, scope=scope_raw(carryover="historical")), "s3")
        self.assertEqual(self.head(), head, "nothing was appended")
        out = self.receive()
        self.assertEqual((out["outstandingReservations"], out["requests"]["conservativeUsed"]), (1, 4342), "the reservation stays held at its caps")
        self.execute("settle", dict(late, atUtc="2026-12-01T23:59:59Z"), "s4")
        self.assertEqual(self.receive()["outstandingReservations"], 0)

    # ---- settle-unexecuted: a reserved attempt whose live job failed in setup (the real run 41960376782; any such run) ----
    UNEXEC_RUN = "41960376782"

    def unexec(self, scope_bytes=None):
        """A journal whose open last event is the attempt's reserve, and the closed evidence built from the REAL run, jobs and workflow fixtures
        against it (no pin: the reserve is read from the journal). Returns (doc, digest, reserve event, head before)."""
        import test_unexecuted_attempt_evidence as T
        event = self.reserved(run=self.UNEXEC_RUN)
        head = self.head()
        doc = U.build_evidence(T.load("run-41960376782.json"), T.load("jobs-41960376782.json"), self.chain(), T.workflow())
        return doc, U.check_evidence(doc)[0], event, head

    def settle_unexec(self, doc, digest, name, scope_bytes=None, url=None, pins=None):
        d = os.path.join(self.d, name)
        os.mkdir(d)
        inputs = {"unexecuted": doc, "unexecutedSha256": digest, "scope": scope_bytes or self.scope}
        return M.execute("settle-unexecuted", inputs, self.repo, url or self.remote, self.root, os.path.join(d, "journal.json"),
                         os.path.join(d, "receipt.json"), pins or self.all_pins, url or self.remote)

    def test_the_unexecuted_settle_closes_the_reservation_with_measured_usage_and_restores_the_headroom(self):
        before_rollup = self.receive()
        doc, digest, event, head = self.unexec()
        held = self.receive()
        self.assertEqual((held["outstandingReservations"], held["requests"]["conservativeUsed"]), (1, 4342))
        e = self.settle_unexec(doc, digest, "s1")
        self.assertEqual((e["type"], e["campaignId"], e["runId"], e["attempt"], e["atUtc"]), ("settle", event["campaignId"], self.UNEXEC_RUN, 1, "2026-11-05T03:21:44Z"))
        self.assertEqual(e["allocation"], {"requests": 0, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": 0, "runnerMinutes": 6})
        self.assertEqual(e["provenance"], "evidence-sha256:" + digest)
        chain = self.chain()
        self.assertEqual([x["type"] for x in chain[-1][1]], ["reserve", "settle"], "the reserve stays in the history; nothing is released or reset")
        self.assertEqual(chain[-1][1][0], event)
        after = self.receive()
        self.assertEqual(after["outstandingReservations"], 0)
        self.assertEqual(after["currentHeadroom"], before_rollup["currentHeadroom"], "the period's caps are fully available again")

    def test_the_unexecuted_settle_head_is_deterministic(self):
        import shutil
        doc, digest, _, _ = self.unexec()
        twin = os.path.join(self.d, "twin.git")
        shutil.copytree(self.remote, twin)
        self.settle_unexec(doc, digest, "a")
        self.settle_unexec(doc, digest, "b", url=twin)
        self.assertEqual(W.fetch_head(self.repo, self.remote, self.remote), W.fetch_head(self.repo, twin, twin))

    def test_an_identical_unexecuted_settle_already_on_the_chain_is_a_no_op(self):
        doc, digest, _, _ = self.unexec()
        e = self.settle_unexec(doc, digest, "first")
        landed = self.head()
        self.assertEqual(self.settle_unexec(doc, digest, "retry"), e)
        self.assertEqual(self.head(), landed, "a retry appends nothing")

    def test_the_unexecuted_settle_refuses_any_other_head_and_appends_nothing(self):
        doc, digest, _, head = self.unexec()
        self.append("reserve", "41400000077", ALLOCATION)                  # another reserve lands first: the head is no longer the evidence's
        moved = self.head()
        self.refused("manual-unexecuted-journal-moved", self.settle_unexec, doc, digest, "m1")
        self.assertEqual(self.head(), moved)

    def test_the_unexecuted_settle_refuses_a_journal_that_is_already_closed_differently(self):
        doc, digest, event, head = self.unexec()
        self.append("settle", self.UNEXEC_RUN, {"requests": 100, "identityReads": 1, "starts": 1, "takes": 1, "coachingRequests": 0, "runnerMinutes": 1},
                    campaign=event["campaignId"], provenance="evidence-sha256:" + "9" * 64)
        closed = self.head()
        self.refused("manual-unexecuted-journal-moved", self.settle_unexec, doc, digest, "c1")
        self.assertEqual(self.head(), closed)

    def test_the_unexecuted_settle_refuses_a_wrong_digest_a_tampered_document_and_another_run(self):
        doc, digest, _, head = self.unexec()
        self.refused("manual-unexecuted-evidence-digest", self.settle_unexec, doc, "0" * 64, "d1")
        bad = json.loads(json.dumps(doc))
        bad["usage"]["runnerMinutes"] = 30                                   # claims the whole reservation
        self.refused("manual-unexecuted-usage-differs", self.settle_unexec, bad, U.canon(bad) and hashlib.sha256(U.canon(bad)).hexdigest(), "d2")
        other = json.loads(json.dumps(doc))
        other["identity"]["runId"] = "41933223835"
        self.refused("manual-unexecuted-run-differs", self.settle_unexec, other, digest, "d3")
        ran = json.loads(json.dumps(doc))
        live = next(j for j in ran["jobs"] if j["name"].startswith("Selected live journeys"))
        next(s for s in live["steps"] if s["name"].startswith("Stage runner (run)"))["conclusion"] = "success"
        self.refused("manual-unexecuted-credential-step-ran", self.settle_unexec, ran, hashlib.sha256(U.canon(ran)).hexdigest(), "d4")
        self.assertEqual(self.head(), head, "nothing was appended")

    def test_the_unexecuted_settle_keeps_the_period_and_scope_boundaries(self):
        doc, digest, _, head = self.unexec()
        early = scope_raw(periodEndUtc="2026-11-05T03:21:44Z")               # the settle time must be INSIDE the accepted period (end exclusive)
        pins = dict(self.all_pins, accepted_scope_sha256=hashlib.sha256(early).hexdigest())
        self.refused("manual-settle-outside-period", lambda: self.settle_unexec(doc, digest, "p1", scope_bytes=early, pins=pins))
        self.refused("manual-reservation-scope-not-accepted", lambda: self.settle_unexec(doc, digest, "p2", scope_bytes=scope_raw(carryover="historical")))
        self.assertEqual(self.head(), head)
        self.assertEqual(self.receive()["outstandingReservations"], 1, "the reservation stays held at its caps until a valid settle")

    def test_the_unexecuted_command_refuses_a_missing_evidence_input_on_the_cli(self):
        p = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "manual_reservation.py"), "settle-unexecuted", "--scope", "/nonexistent"],
                           capture_output=True, text=True)
        self.assertEqual((p.returncode, p.stdout, p.stderr.strip()), (78, "", "BLOCKED_SETUP: manual-unexecuted-evidence"))

    def test_the_release_event_needs_never_started_and_an_approval(self):
        e = self.reserved()
        self.refused("manual-release-run-started", M.release, e, True, "slack-1000000021.000021", AT)
        self.refused("manual-release-run-started", M.release, e, None, "slack-1000000021.000021", AT)
        self.refused("manual-release-approval", M.release, e, False, "free text", AT)
        self.assertEqual(M.release(e, False, "slack-1000000021.000021", AT)["allocation"], ALLOCATION)

    def test_the_activated_cli_still_refuses_unreadable_inputs(self):
        expected = {
            "reserve": "manual-reservation-inputs-unreadable",
            "settle": "manual-settle-input-source",
            "release": "manual-release-never-started-unverified",
        }
        for command, code in expected.items():
            p = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "manual_reservation.py"), command, "--request", "/nonexistent"],
                               capture_output=True, text=True)
            self.assertEqual((p.returncode, p.stdout, p.stderr.strip()), (78, "", "BLOCKED_SETUP: " + code))
        self.assertTrue(M.activated())
        self.assertEqual((W.REVIEWED_ROOT, R.ACCEPTED_BOOTSTRAP_SHA256, R.ACCEPTED_ROOT, M.ACCEPTED_SCOPE_SHA256),
                         ("92d6ebf902351750c368d7d513116c6b1f19f80c",
                          "0a3e60271dc703f12cf02684450a9f74bc7f60d5c3f610a86bb9eaddc268f174",
                          "92d6ebf902351750c368d7d513116c6b1f19f80c",
                          "ab44af95da89cb07e28c6680f0f2e92278574f6c6bd4611dfb15afe60416eff4"))


if __name__ == "__main__":
    import unittest
    unittest.main()
