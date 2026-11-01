"""Accepted-rollup receiving mode (Sam 1793553421.029269), offline: a SYNTHETIC bootstrap accepted through test-only pins, and the real
state-ref writer on a temporary bare repository. Anchor, period, predecessor and replay negatives; unresolved usage is never zeroed."""
import copy
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest

from _fixtures import ROOT  # noqa: F401  (sys.path setup)
import accounting_rollup as R
import state_ref_writer as W

CAPS = {"requests": 800, "identityReads": 20, "starts": 6, "takes": 4, "coachingRequests": 5, "runnerMinutes": 340}
SHA_REF = "sha256:" + "a" * 64


def bootstrap(**over):
    """Historical usage only: no period, no ceiling. Coaching and runner minutes are unknown (null), never 0."""
    doc = {"schema": R.SCHEMA, "asOfUtc": "2026-11-01T17:00:00Z", "sourceRecords": [SHA_REF],
           "usage": {"requests": 7956, "identityReads": 122, "starts": 64, "takes": 38, "coachingRequests": None, "runnerMinutes": None},
           "authority": {"approvalRef": "slack:1793553421.029269", "expired": True},
           "unresolved": [{"kind": "diagnostic", "ref": "sha256:" + "b" * 64, "disposition": "MEASURED",
                           "usage": {"requests": 40, "identityReads": 2, "starts": 1, "takes": 0, "coachingRequests": 0, "runnerMinutes": 12}}]}
    doc.update(over)
    return json.dumps(doc, sort_keys=True).encode()


def scope(**over):
    """An explicitly approved period scope (synthetic): its own period, ceilings and carryover rule."""
    s = {"schema": R.SCOPE_SCHEMA, "approvalRef": "slack:1793555433.084449", "periodStartUtc": "2026-11-02T00:00:00Z",
         "periodEndUtc": "2026-12-02T00:00:00Z", "carryover": "none",
         "ceilings": {"requests": 12000, "protectedReserveRequests": 300, "identityReads": 200, "starts": 120, "takes": 80}}
    s.update(over)
    return s


def refused(test, code, fn, *a, **k):
    with test.assertRaises(R.Refused) as e:
        fn(*a, **k)
    test.assertEqual(str(e.exception), code)


class Journal(unittest.TestCase):
    """A genesis-rooted state ref on a temporary bare repository, with the synthetic bootstrap accepted through test-only pins."""
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
        self.git = git
        blob = git("hash-object", "-w", "--stdin", data=W.ledger_bytes([]))
        tree = git("mktree", data=("100644 blob %s\tledger.json\n" % blob).encode())
        self.root = git("commit-tree", tree, data=b"genesis\n")
        git("push", "-q", self.remote, "%s:%s" % (self.root, W.STATE_REF))
        self.raw = bootstrap()
        self.pins = {"accepted_sha256": hashlib.sha256(self.raw).hexdigest(), "accepted_root": self.root}

    def chain(self):
        return W.validate_chain(self.repo, W.fetch_head(self.repo, self.remote, self.remote), self.root)

    def append(self, kind, run, allocation, at="2026-11-02T04:00:00Z"):
        head = W.fetch_head(self.repo, self.remote, self.remote)
        e = {"type": kind, "campaignId": "R10-manual", "runId": run, "attempt": 1, "allocation": dict(allocation),
             "provenance": "approval:slack-1793553421.029269", "atUtc": at}
        return W.propose(self.repo, self.remote, head, e, self.root, self.remote)

    def receive(self, sc=None, chain=None, raw=None):
        return R.receive(raw or self.raw, sc or scope(), chain if chain is not None else self.chain(), **self.pins)


class Rollup(Journal):
    def test_historical_usage_stays_distinct_and_is_counted_only_under_an_approved_carryover(self):
        none = self.receive()
        self.assertEqual((none["requests"]["conservativeUsed"], none["period"]["requests"], none["historical"]["requests"]), (0, 0, 7996))
        hist = self.receive(scope(carryover="historical"))
        self.assertEqual((hist["requests"]["conservativeUsed"], hist["identityReads"]["conservativeUsed"], hist["starts"]["ownerCounted"],
                          hist["takes"]["ownerCounted"]), (7996, 124, 65, 38), "an empty journal under carryover is the bootstrap, never zero")
        # Unknown coaching/runner dimensions stay unknown, never 0.
        self.assertEqual((hist["historical"]["coachingRequests"], hist["unknown"]), (None, {"coachingRequests": True, "runnerMinutes": True}))
        self.assertEqual(none["unknown"], {"coachingRequests": False, "runnerMinutes": False})

    def test_settles_and_outstanding_reservations_count_inside_the_approved_period(self):
        self.append("reserve", "101", CAPS)
        out = self.receive()
        self.assertEqual((out["requests"]["conservativeUsed"], out["outstandingReservations"]), (800, 1), "an open reservation counts as used")
        self.append("settle", "101", dict(CAPS, requests=640, identityReads=9, starts=4, takes=3))
        out = self.receive()
        self.assertEqual((out["requests"]["conservativeUsed"], out["identityReads"]["conservativeUsed"], out["starts"]["ownerCounted"],
                          out["takes"]["ownerCounted"], out["outstandingReservations"]), (640, 9, 4, 3, 0))
        self.append("reserve", "102", CAPS)
        self.append("release", "102", CAPS)
        self.assertEqual(self.receive()["requests"]["conservativeUsed"], 640, "a released reservation is no longer counted")

    def test_scope_and_carryover_must_be_explicitly_approved(self):
        for sc, code in ((None, "rollup-period-scope-unapproved"), ({}, "rollup-period-scope-unapproved"),
                         (scope(approvalRef=""), "rollup-period-scope-unapproved"), (scope(periodEndUtc="2026-11-01T00:00:00Z"), "rollup-period-scope-unapproved"),
                         (scope(carryover=None), "rollup-carryover-unapproved"), (scope(carryover="lifetime"), "rollup-carryover-unapproved"),
                         (scope(ceilings={"requests": 1}), "rollup-ceilings")):
            with self.subTest(code=code, sc=str(sc)[:40]):
                refused(self, code, R.receive, self.raw, sc, self.chain(), **self.pins)

    def test_anchor_negatives(self):
        refused(self, "rollup-not-accepted", R.receive, self.raw, scope(), self.chain())  # the production pins are unset today
        self.assertEqual((R.ACCEPTED_BOOTSTRAP_SHA256, R.ACCEPTED_ROOT), (None, None))
        refused(self, "rollup-bootstrap-not-accepted", R.receive, bootstrap(asOfUtc="2026-11-01T18:00:00Z"), scope(), self.chain(), **self.pins)
        refused(self, "rollup-predecessor-gap", R.receive, self.raw, scope(), self.chain(), accepted_sha256=self.pins["accepted_sha256"],
                accepted_root="f" * 40)

    def test_period_and_replay_negatives(self):
        self.append("reserve", "101", CAPS, at="2026-11-01T23:00:00Z")  # before the approved period starts
        refused(self, "rollup-event-outside-period", self.receive)
        chain = self.chain()
        self.append("settle", "101", dict(CAPS, requests=10), at="2026-11-01T23:30:00Z")
        doubled = copy.deepcopy(self.chain())
        doubled[-1][1].append(dict(doubled[-1][1][-1]))
        refused(self, "rollup-event-outside-period", self.receive, None, doubled)
        sha, events, raw = copy.deepcopy(chain[-1])  # chain entries are (sha, events, ledger bytes) tuples
        events[0]["atUtc"] = "2026-11-03T00:00:00Z"
        settle = dict(events[0], type="settle")
        inside = chain[:-1] + [(sha, events + [settle, dict(settle)], raw)]
        refused(self, "rollup-settle-replayed", self.receive, None, inside)

    def test_unresolved_usage_is_never_zeroed_or_charged_to_the_expired_ceiling(self):
        unknown = bootstrap(unresolved=[{"kind": "evaluator-start", "ref": "sha256:" + "c" * 64, "disposition": "UNRESOLVED", "usage": None}])
        refused(self, "rollup-unresolved-usage", R.receive, unknown, scope(), self.chain(), accepted_sha256=hashlib.sha256(unknown).hexdigest(),
                accepted_root=self.root)
        zero = {"requests": 0, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": None, "runnerMinutes": None}
        for bad in ([{"kind": "evaluator-start", "ref": SHA_REF, "disposition": "UNRESOLVED", "usage": zero}],
                    [{"kind": "evaluator-start", "ref": SHA_REF, "disposition": "MEASURED", "usage": None}],
                    [{"kind": "other", "ref": SHA_REF, "disposition": "MEASURED", "usage": zero}],
                    [{"kind": "diagnostic", "ref": SHA_REF, "disposition": "MEASURED", "usage": dict(zero, requests=None)}]):
            raw = bootstrap(unresolved=bad)
            refused(self, "rollup-unresolved", R.parse_bootstrap, raw)

    def test_a_github_run_id_is_only_a_locator_for_an_unresolved_item(self):
        # Sam 1793556731.837039: the six later R9 runs are located by run id, never accepted; their usage stays null.
        runs = ("41071743003", "41115876890", "41134025368", "41231659142", "41322870182", "41325698722")
        located = [{"kind": "diagnostic", "ref": "gha-run:" + r, "disposition": "UNRESOLVED", "usage": None} for r in runs]
        self.assertEqual([i["ref"] for i in R.parse_bootstrap(bootstrap(unresolved=located))["unresolved"]], ["gha-run:" + r for r in runs])
        raw = bootstrap(unresolved=located)
        refused(self, "rollup-unresolved-usage", R.receive, raw, scope(), self.chain(), accepted_sha256=hashlib.sha256(raw).hexdigest(),
                accepted_root=self.root)
        measured = {"requests": 1, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": None, "runnerMinutes": None}
        for bad in ({"kind": "diagnostic", "ref": "gha-run:41071743003", "disposition": "MEASURED", "usage": measured},
                    {"kind": "diagnostic", "ref": "gha-run:041071743003", "disposition": "UNRESOLVED", "usage": None},
                    {"kind": "diagnostic", "ref": "gha-run:", "disposition": "UNRESOLVED", "usage": None},
                    {"kind": "diagnostic", "ref": "run:41071743003", "disposition": "UNRESOLVED", "usage": None}):
            with self.subTest(ref=bad["ref"], disposition=bad["disposition"]):
                refused(self, "rollup-unresolved", R.parse_bootstrap, bootstrap(unresolved=[bad]))

    def test_the_bootstrap_is_historical_closed_and_content_free(self):
        for over, code in (({"email": "x@y.invalid"}, "rollup-bootstrap-shape"), ({"period": {}}, "rollup-bootstrap-shape"),
                           ({"ceilings": {}}, "rollup-bootstrap-shape"), ({"schema": "x"}, "rollup-bootstrap-shape"),
                           ({"sourceRecords": ["free text"]}, "rollup-source-records"), ({"sourceRecords": []}, "rollup-source-records"),
                           ({"usage": {"requests": -1, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": None, "runnerMinutes": None}}, "rollup-usage"),
                           ({"usage": {"requests": None, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": None, "runnerMinutes": None}}, "rollup-usage"),
                           ({"authority": {"approvalRef": "", "expired": True}}, "rollup-authority")):
            with self.subTest(code=code):
                refused(self, code, R.parse_bootstrap, bootstrap(**over))


if __name__ == "__main__":
    unittest.main()
