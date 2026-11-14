"""Run 42483030590 RESERVED, its live job completed with failure, and it was SETTLED, but its record was not publishable, so the latest
record stayed `incomplete` and every later `begin` refused . Real data: GitHub's run and jobs JSON for that run
(trimmed to the fields used, tests/fixtures/settled), the journal's real reserve 96605dd and settle 2e68640, and the stored record before.
It retires as `settled-unpublished` history (case execution is not asserted) bound to that exact pair: no re-settlement, no amount change, no case result. Every negative
control changes one fact and must refuse."""
import copy
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
import unittest.mock

from _fixtures import ROOT  # noqa: F401  (puts scripts/ on sys.path)
import settled_attempt_evidence as E
import publish_latest_record as P

FX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "settled")
RUN_ID = "42483030590"
HEAD = "204190f5ad872e4747da56cdbd23dd719104fb8c"
ROOT_SHA = "92d6ebf902351750c368d7d513116c6b1f19f80c"
RESERVE_SHA = "96605dd50194703cbd9e93f8b3c7ff8455ce72ba"
SETTLE_SHA = "2e68640581beca58453bb9a3bc5b1a13ed4169e9"
COLLECTED = "2026-11-08T14:11:52Z"
RESERVE = {"allocation": {"coachingRequests": 20, "identityReads": 32, "requests": 3361, "runnerMinutes": 60, "starts": 16, "takes": 16},
           "atUtc": "2026-11-08T13:02:52Z", "attempt": 1, "campaignId": "R10-3b040043-smoke15",
           "provenance": "request-sha256:2e1415a6bcc5b5492b279489c96590abfd6ab82db6790637c349049478da5248", "runId": RUN_ID, "type": "reserve"}
SETTLE = {"allocation": {"coachingRequests": 20, "identityReads": 32, "requests": 57, "runnerMinutes": 60, "starts": 0, "takes": 0},
          "atUtc": "2026-11-08T13:12:38Z", "attempt": 1, "campaignId": "R10-3b040043-smoke15",
          "provenance": "evidence-sha256:3ee665effbebf7ea8f9d407fc27ee2dbfbdf27f65067eb8f00a342558fae17bb", "runId": RUN_ID, "type": "settle"}
OTHER = {"allocation": dict(SETTLE["allocation"]), "atUtc": "2026-11-08T08:00:00Z", "attempt": 1, "campaignId": "R10-3b040043-smoke15",
         "provenance": "evidence-sha256:" + "1" * 64, "runId": "42472935773", "type": "settle"}
DIGEST = "0ba6d177610a0c7b6b042d7a8d992173dc280c445671175070cf811c15ecadf7"   # the document collected from the real journal at 14:11:52Z


def load(name):
    with open(os.path.join(FX, name), encoding="utf-8") as f:
        return json.load(f)


def chain(events=None, shas=None):
    """The validated chain's shape [(sha, events-so-far)]: the root, an earlier event, then this run's reserve and its settle."""
    events = [OTHER, RESERVE, SETTLE] if events is None else events
    shas = shas or (["a" * 40] + [RESERVE_SHA, SETTLE_SHA] if len(events) == 3 else ["%040x" % (i + 1) for i in range(len(events))])
    return [(ROOT_SHA, [])] + [(shas[i], [dict(e) for e in events[:i + 1]]) for i in range(len(events))]


def build(run=None, jobs=None, ch=None, collected=COLLECTED):
    return E.build_evidence(run or load("run-42483030590.json"), jobs or load("jobs-42483030590.json"), ch or chain(), ROOT_SHA, collected)


def record_before():
    with open(os.path.join(FX, "record-before-42483030590.md"), encoding="utf-8") as f:
        return f.read()


class Evidence(unittest.TestCase):
    def test_the_real_run_binds_its_exact_reserve_and_settle_and_copies_the_settled_amounts(self):
        doc = build()
        self.assertEqual(doc["identity"], {"runId": RUN_ID, "attempt": 1, "headSha": HEAD})
        self.assertEqual(doc["jobs"], {"beginJob": "success", "reserveJob": "success", "liveJob": "failure", "settleJob": "success",
                                       "recordJob": "success"})
        j = doc["journal"]
        self.assertEqual((j["reserveSha"], j["settleSha"], j["headSha"]), (RESERVE_SHA, SETTLE_SHA, SETTLE_SHA))
        self.assertEqual(j["settledAllocation"], SETTLE["allocation"], "copied, never recomputed or changed")
        self.assertEqual(j["reservedAllocation"], RESERVE["allocation"])
        self.assertEqual(j["settleEvidenceSha256"], SETTLE["provenance"].split(":")[1])
        digest, settled = E.check_evidence(doc)
        self.assertEqual((digest, settled), (DIGEST, SETTLE["allocation"]))
        self.assertEqual(hashlib.sha256(E.canon(build())).hexdigest(), DIGEST, "deterministic")

    def test_a_later_event_of_another_run_keeps_the_pair_but_moves_the_head(self):
        later = dict(OTHER, runId="42999999999", atUtc="2026-11-08T15:00:00Z")
        doc = build(ch=chain([OTHER, RESERVE, SETTLE, later], ["a" * 40, RESERVE_SHA, SETTLE_SHA, "b" * 40]))
        self.assertEqual((doc["journal"]["settleSha"], doc["journal"]["headSha"]), (SETTLE_SHA, "b" * 40))

    def test_the_journal_must_hold_exactly_one_reserve_directly_followed_by_its_settle(self):
        release = dict(SETTLE, type="release")
        cases = {"no event of the run": [OTHER],
                 "reserve still open": [OTHER, RESERVE],
                 "released, not settled": [OTHER, RESERVE, release],
                 "settled twice": [OTHER, RESERVE, SETTLE, SETTLE],
                 "an event between reserve and settle": [RESERVE, OTHER, SETTLE],
                 "another campaign's settle": [OTHER, RESERVE, dict(SETTLE, campaignId="other")],
                 "attempt 2": [OTHER, dict(RESERVE, attempt=2), dict(SETTLE, attempt=2)]}
        for label, events in cases.items():
            with self.assertRaises(E.Refused, msg=label):
                build(ch=chain(events))

    def test_the_settle_and_reserve_provenance_and_amounts_are_closed(self):
        for label, settle in (("request provenance", dict(SETTLE, provenance=RESERVE["provenance"])),
                              ("missing allocation key", dict(SETTLE, allocation={k: v for k, v in SETTLE["allocation"].items() if k != "takes"})),
                              ("negative amount", dict(SETTLE, allocation=dict(SETTLE["allocation"], requests=-1))),
                              ("bool amount", dict(SETTLE, allocation=dict(SETTLE["allocation"], starts=True)))):
            with self.assertRaises(E.Refused, msg=label):
                build(ch=chain([OTHER, RESERVE, settle]))
        over = build()
        over["journal"]["settledAllocation"]["requests"] = 3362
        with self.assertRaisesRegex(E.Refused, "settled-settle-exceeds-reservation"):
            E.check_evidence(over)

    def test_the_root_must_be_the_pinned_one(self):
        ch = chain()
        ch[0] = ("f" * 40, [])
        with self.assertRaisesRegex(E.Refused, "settled-journal-root"):
            build(ch=ch)

    def test_the_run_must_be_completed_and_failed_attempt_one(self):
        for field, value in (("status", "in_progress"), ("conclusion", "success"), ("conclusion", "cancelled"), ("run_attempt", 2),
                             ("head_sha", "short")):
            with self.assertRaises(E.Refused, msg=field):
                build(run=dict(load("run-42483030590.json"), **{field: value}))

    def test_every_job_must_belong_to_the_run_and_carry_its_expected_conclusion(self):
        def jobs_with(change):
            j = load("jobs-42483030590.json")
            change(j["jobs"])
            return j
        name = lambda jobs, prefix: next(x for x in jobs if x["name"].startswith(prefix))
        cases = {"settle failed": lambda js: name(js, "Settle").update(conclusion="failure"),
                 "reserve skipped": lambda js: name(js, "Reserve").update(conclusion="skipped"),
                 "live succeeded": lambda js: name(js, "Selected live").update(conclusion="success"),
                 "record-complete still running": lambda js: name(js, "Complete or interrupt").update(status="in_progress", conclusion=None),
                 "record-begin failed": lambda js: name(js, "Record the attempt").update(conclusion="failure"),
                 "a job of another run": lambda js: js[0].update(run_id=42483030591),
                 "a job of another head": lambda js: js[0].update(head_sha="c" * 40),
                 "settle duplicated": lambda js: js.append(dict(name(js, "Settle"))),
                 "settle missing": lambda js: js.remove(name(js, "Settle"))}
        for label, change in cases.items():
            with self.assertRaises(E.Refused, msg=label):
                build(jobs=jobs_with(change))

    def test_the_collection_time_is_not_before_the_run_finished(self):
        with self.assertRaisesRegex(E.Refused, "settled-collected-time"):
            build(collected="2026-11-08T13:12:55Z")

    def test_the_document_shape_is_closed(self):
        for label, change in (("extra key", lambda d: d.update(extra=1)),
                              ("schema", lambda d: d.update(schema="x")),
                              ("live succeeded", lambda d: d["jobs"].update(liveJob="success")),
                              ("same reserve and settle", lambda d: d["journal"].update(settleSha=RESERVE_SHA)),
                              ("bad digest", lambda d: d["journal"].update(settleEvidenceSha256="x"))):
            doc = build()
            change(doc)
            with self.assertRaises(E.Refused, msg=label):
                E.check_evidence(doc)

    def test_the_cli_checks_a_document_and_refuses_with_exit_78(self):
        script = os.path.join(os.path.dirname(os.path.abspath(E.__file__)), "settled_attempt_evidence.py")
        with tempfile.TemporaryDirectory() as d:
            good, bad = os.path.join(d, "good.json"), os.path.join(d, "bad.json")
            with open(good, "wb") as f:
                f.write(E.canon(build()))
            doc = build()
            doc["jobs"]["liveJob"] = "success"
            with open(bad, "wb") as f:
                f.write(E.canon(doc))
            ok = subprocess.run([sys.executable, "-I", script, "check", "--evidence", good], capture_output=True, text=True)
            self.assertEqual((ok.returncode, ok.stdout.strip()), (0, DIGEST))
            no = subprocess.run([sys.executable, "-I", script, "check", "--evidence", bad], capture_output=True, text=True)
            self.assertEqual(no.returncode, 78)
            self.assertIn("BLOCKED_SETUP: settled-evidence-shape", no.stderr)


class RetireSettled(unittest.TestCase):
    def stuck(self):
        return P.parse_body(record_before())

    def pred(self):
        return hashlib.sha256(record_before().encode("utf-8")).hexdigest()

    def test_the_real_record_retires_as_settled_unpublished_and_the_next_run_can_begin(self):
        stuck = self.stuck()
        self.assertEqual(stuck["inProgress"], {"attempt": 1, "runId": RUN_ID, "sourceSha": HEAD, "startedUtc": "2026-11-08T13:02:28Z",
                                               "status": "incomplete"})
        with self.assertRaisesRegex(P.Refused, "previous-attempt-unreconciled"):
            P.begin(stuck, "42999999999", 1, HEAD, "2026-11-08T15:00:00Z")      # the wedge this removes
        self.assertEqual(P.settled_candidate(stuck, build()), RUN_ID)
        after = P.retire_settled(stuck, build(), self.pred())
        stored = P.parse_body(P.render(after))
        self.assertEqual(stored, after)
        self.assertIsNone(stored["inProgress"])
        self.assertEqual(stored["latestCompleted"], stuck["latestCompleted"], "no completion is manufactured")
        self.assertEqual(stored["retiredAttempts"][:-1], stuck["retiredAttempts"], "earlier entries byte-identical")
        last = stored["retiredAttempts"][-1]
        self.assertEqual((last["runId"], last["retiredReason"], last["predecessorSha256"]), (RUN_ID, "settled-unpublished", self.pred()))
        self.assertEqual(last["evidence"], {"runStatus": "completed", "runConclusion": "failure", "runUpdatedUtc": "2026-11-08T13:12:56Z",
                                            "collectedUtc": COLLECTED, "evidenceSha256": DIGEST, "journalHeadSha": SETTLE_SHA,
                                            "reserveSha": RESERVE_SHA, "settleSha": SETTLE_SHA, "settleAtUtc": "2026-11-08T13:12:38Z",
                                            "runnerMinutes": 60})
        self.assertIn("Settled, record unpublished (not a completed run; case execution not asserted; no case results recorded): run 42483030590",
                      P.render(after))
        self.assertNotIn("Executed", P.render(after))
        nxt = P.begin(stored, "42999999999", 1, HEAD, "2026-11-08T15:00:00Z")
        self.assertEqual(nxt["inProgress"]["runId"], "42999999999")

    def test_only_the_incomplete_attempt_the_evidence_is_about_is_a_candidate(self):
        stuck = self.stuck()
        live = stuck["inProgress"]
        for label, state in (("running", dict(stuck, inProgress=dict(live, status="running"))),
                             ("cancelled", dict(stuck, inProgress=dict(live, status="cancelled"))),
                             ("another run", dict(stuck, inProgress=dict(live, runId="42483030591"))),
                             ("another head", dict(stuck, inProgress=dict(live, sourceSha="c" * 40))),
                             ("nothing in progress", dict(stuck, inProgress=None)),
                             ("a pending completion", dict(stuck, pendingCompletion={"x": 1}))):
            self.assertIsNone(P.settled_candidate(state, build()), label)
            with self.assertRaisesRegex(P.Refused, "settled-not-a-candidate", msg=label):
                P.retire_settled(state, build(), self.pred())
        self.assertIsNone(P.settled_candidate(stuck, None))

    def test_the_evidence_is_rechecked_here_never_trusted(self):
        # rendering is offline: the journal pair was bound from the freshly validated chain by `collect` in the same step, and the entry's
        # evidenceSha256 binds that document byte for byte, so any edited document is visibly another digest
        edited = build()
        edited["journal"]["settledAllocation"]["requests"] = 1
        self.assertNotEqual(P.retire_settled(self.stuck(), edited, self.pred())["retiredAttempts"][-1]["evidence"]["evidenceSha256"], DIGEST)
        for label, change in (("live succeeded", lambda d: d["jobs"].update(liveJob="success")),
                              ("another root", lambda d: d["journal"].update(rootSha="f" * 40)),
                              ("settled before the attempt started", lambda d: d["journal"].update(settleAtUtc="2026-11-08T13:00:00Z"))):
            doc = build()
            change(doc)
            with self.assertRaises(P.Refused, msg=label):
                P.retire_settled(self.stuck(), doc, self.pred())
        with self.assertRaisesRegex(P.Refused, "settled-predecessor"):
            P.retire_settled(self.stuck(), build(), "x")

    def test_history_and_the_bound_are_preserved(self):
        stuck = self.stuck()
        real = P._with_retired
        with unittest.mock.patch.object(P, "_with_retired", lambda state, entry: dict(real(state, entry), latestCompleted=None)):
            with self.assertRaisesRegex(P.Refused, "settled-history-changed"):
                P.retire_settled(stuck, build(), self.pred())
        with unittest.mock.patch.object(P, "_with_retired", lambda state, entry: dict(real(state, entry), retiredAttempts=[entry])):
            with self.assertRaisesRegex(P.Refused, "settled-history-changed"):
                P.retire_settled(stuck, build(), self.pred())
        full = dict(stuck, retiredAttempts=[dict(stuck["retiredAttempts"][0], runId=str(41900000000 + i)) for i in range(P.RETIRED_MAX)])
        with self.assertRaisesRegex(P.Refused, "retired-attempts-bound"):
            P.retire_settled(full, build(), self.pred())
        twice = P.retire_settled(stuck, build(), self.pred())
        again = dict(twice, inProgress=stuck["inProgress"])
        with self.assertRaisesRegex(P.Refused, "retired-attempts-bound"):
            P.retire_settled(again, build(), self.pred())

    def test_a_stored_entry_outside_its_closed_shape_refuses_on_read(self):
        after = P.retire_settled(self.stuck(), build(), self.pred())
        for label, change in (("conclusion", lambda e: e["evidence"].update(runConclusion="success")),
                              ("same pair", lambda e: e["evidence"].update(settleSha=RESERVE_SHA)),
                              ("extra key", lambda e: e["evidence"].update(extra=1)),
                              ("settle after the run", lambda e: e["evidence"].update(settleAtUtc="2026-11-08T13:30:00Z"))):
            bad = copy.deepcopy(after)
            change(bad["retiredAttempts"][-1])
            with self.assertRaises(P.Refused, msg=label):
                P.sanitize_retired(bad["retiredAttempts"][-1])

    def test_the_cli_retires_and_a_refusal_writes_no_body(self):
        script = os.path.join(os.path.dirname(os.path.abspath(P.__file__)), "publish_latest_record.py")
        with tempfile.TemporaryDirectory() as d:
            prev, ev, out = os.path.join(d, "prev.md"), os.path.join(d, "ev.json"), os.path.join(d, "out.md")
            with open(prev, "w", encoding="utf-8") as f:
                f.write(record_before())
            with open(ev, "wb") as f:
                f.write(E.canon(build()))
            cand = subprocess.run([sys.executable, "-I", script, "settled-candidate", "--previous", prev, "--evidence", ev], capture_output=True, text=True)
            self.assertEqual((cand.returncode, cand.stdout.strip()), (0, RUN_ID))
            ok = subprocess.run([sys.executable, "-I", script, "retire-settled", "--previous", prev, "--evidence", ev, "--out", out],
                                capture_output=True, text=True)
            self.assertEqual(ok.returncode, 0, ok.stderr)
            with open(out, encoding="utf-8") as f:
                self.assertIsNone(P.parse_body(f.read())["inProgress"])
            doc = build()
            doc["jobs"]["settleJob"] = "failure"
            with open(ev, "wb") as f:
                f.write(E.canon(doc))
            no = subprocess.run([sys.executable, "-I", script, "retire-settled", "--previous", prev, "--evidence", ev, "--out", out + ".2"],
                                capture_output=True, text=True)
            self.assertEqual(no.returncode, 78)
            self.assertFalse(os.path.exists(out + ".2"))


if __name__ == "__main__":
    unittest.main()
