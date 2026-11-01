"""The append-only refs/heads/cloud-test-state writer (Sam 1793548444.540999), exercised only against temporary bare repositories: exact
expected-head compare-and-swap through a non-force push, a single-parent commit holding exactly ledger.json, closed content-free events,
transition rules, and persisted-bytes receipt verification that never trusts the receipt JSON."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest

from _fixtures import ROOT  # noqa: F401  (sys.path setup)
import state_ref_writer as W

REF = "refs/heads/cloud-test-state"
CAPS = {"requests": 800, "identityReads": 20, "starts": 6, "takes": 4, "coachingRequests": 5, "runnerMinutes": 340}


def event(kind="reserve", run="101", attempt=1, campaign="R6-live", allocation=None, at="2026-11-01T16:00:00Z"):
    return {"type": kind, "campaignId": campaign, "runId": run, "attempt": attempt, "allocation": dict(allocation or CAPS),
            "provenance": "approval:slack-1793548444.540999", "atUtc": at}


def git(repo, *a, data=None, env=None):
    return subprocess.run(["git", "-C", repo, *a], input=data, capture_output=True, check=True, env=env).stdout.decode().strip()


class StateRef(unittest.TestCase):
    def setUp(self):
        self.d = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.d)
        self.remote = os.path.join(self.d, "remote.git")
        subprocess.run(["git", "init", "-q", "--bare", self.remote], check=True)
        self.repo = self.clone("writer")
        # The genesis commit is created HERE, in the temporary remote only; the module itself never creates the ref.
        blob = git(self.repo, "hash-object", "-w", "--stdin", data=W.ledger_bytes([]))
        tree = git(self.repo, "mktree", data=("100644 blob %s\tledger.json\n" % blob).encode())
        env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@invalid", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@invalid"}
        self.genesis = git(self.repo, "commit-tree", tree, data=b"genesis\n", env=env)
        git(self.repo, "push", "-q", "origin", "%s:%s" % (self.genesis, REF))

    def clone(self, name):
        path = os.path.join(self.d, name)
        subprocess.run(["git", "init", "-q", path], check=True)
        git(path, "remote", "add", "origin", self.remote)
        return path

    def refused(self, code, fn, *a):
        with self.assertRaises(W.Refused) as e:
            fn(*a)
        self.assertEqual(str(e.exception), code)

    def head(self):
        return git(self.repo, "ls-remote", "origin", REF).split()[0]

    def test_reserve_then_settle_append_exactly_one_event_each_with_verified_receipts(self):
        r1 = W.propose(self.repo, "origin", REF, self.genesis, event())
        self.assertEqual((r1["ref"], r1["previousSha"], self.head()), (REF, self.genesis, r1["newSha"]))
        self.assertEqual(W.verify(self.repo, "origin", r1, event())["events"], 1)
        used = dict(CAPS, requests=640, runnerMinutes=310)
        r2 = W.propose(self.repo, "origin", REF, r1["newSha"], event("settle", allocation=used, at="2026-11-01T21:00:00Z"))
        self.assertEqual(W.verify(self.repo, "origin", r2, event("settle", allocation=used, at="2026-11-01T21:00:00Z"))["events"], 2)
        # Still verifiable after later appends: r1's commit remains on the ref's history.
        self.assertTrue(W.verify(self.repo, "origin", r1, event())["verified"])
        parents = git(self.repo, "rev-list", "--parents", "-n", "1", r2["newSha"]).split()[1:]
        self.assertEqual(parents, [r1["newSha"]])

    def test_a_stale_expected_head_and_a_racing_writer_are_rejected_without_rewrite(self):
        r1 = W.propose(self.repo, "origin", REF, self.genesis, event())
        self.refused("stale-head", W.propose, self.repo, "origin", REF, self.genesis, event(run="102"))
        # Race: a second writer observed the same head, but the first push landed in between.
        other = self.clone("other")
        W.fetch_head(other, "origin", REF)
        real_fetch = W.fetch_head
        W.fetch_head = lambda *a: r1["newSha"]
        try:
            W.propose(self.repo, "origin", REF, r1["newSha"], event(run="103"))
            self.refused("state-ref-push-rejected", W.propose, other, "origin", REF, r1["newSha"], event(run="104"))
        finally:
            W.fetch_head = real_fetch
        events = W.parse_ledger(W.commit_ledger(self.repo, W.fetch_head(self.repo, "origin", REF))[1])
        self.assertEqual([e["runId"] for e in events], ["101", "103"], "the raced write never landed and nothing was rewritten")

    def test_duplicate_and_impossible_transitions_are_refused(self):
        r1 = W.propose(self.repo, "origin", REF, self.genesis, event())
        self.refused("duplicate-transition", W.propose, self.repo, "origin", REF, r1["newSha"], event())
        self.refused("transition-without-open-reservation", W.propose, self.repo, "origin", REF, r1["newSha"], event("settle", run="999"))
        self.refused("settle-exceeds-reservation", W.propose, self.repo, "origin", REF, r1["newSha"], event("settle", allocation=dict(CAPS, takes=5)))
        self.refused("release-differs-from-reservation", W.propose, self.repo, "origin", REF, r1["newSha"], event("release", allocation=dict(CAPS, takes=0)))
        r2 = W.propose(self.repo, "origin", REF, r1["newSha"], event("release"))
        self.refused("transition-without-open-reservation", W.propose, self.repo, "origin", REF, r2["newSha"], event("settle"))
        self.assertEqual(self.head(), r2["newSha"], "refusals push nothing")

    def test_events_are_closed_and_content_free(self):
        bad = [dict(event(), email="a@b.invalid"), dict(event(), allocation=dict(CAPS, password=1)), {k: v for k, v in event().items() if k != "atUtc"},
               dict(event(), type="adjust"), dict(event(), attempt=0), dict(event(), attempt=True), dict(event(), runId="abc"),
               dict(event(), provenance="has spaces"), dict(event(), allocation=dict(CAPS, requests=-1))]
        for e in bad:
            with self.assertRaises(W.Refused):
                W.propose(self.repo, "origin", REF, self.genesis, e)
        self.assertEqual(self.head(), self.genesis)

    def test_forged_receipts_and_rewritten_history_fail_persisted_bytes_verification(self):
        r1 = W.propose(self.repo, "origin", REF, self.genesis, event())
        for k, v in (("previousSha", "f" * 40), ("ledgerBlobSha256", "0" * 64), ("proposalSha256", "0" * 64)):
            with self.assertRaises(W.Refused):
                W.verify(self.repo, "origin", dict(r1, **{k: v}), event())
        self.refused("receipt-event-mismatch", W.verify, self.repo, "origin", r1, event(run="555"))
        # A commit that is not on the ref (an orphan with the right shape) does not verify.
        env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@invalid", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@invalid"}
        tree = git(self.repo, "rev-parse", r1["newSha"] + "^{tree}")
        orphan = git(self.repo, "commit-tree", tree, "-p", self.genesis, data=b"orphan\n", env=env)
        self.refused("receipt-commit-not-on-state-ref", W.verify, self.repo, "origin", dict(r1, newSha=orphan), event())
        # A non-canonical or rewritten ledger is refused even with a correct-looking parent.
        raw = W.commit_ledger(self.repo, r1["newSha"])[1]
        self.refused("ledger-not-canonical", W.parse_ledger, json.dumps(json.loads(raw), indent=1).encode())
        doc = json.loads(raw)
        doc["events"][0]["allocation"]["requests"] = 1
        self.assertNotEqual(W.ledger_bytes(doc["events"]), raw)

    def test_the_ref_is_never_created_by_the_writer(self):
        empty = os.path.join(self.d, "empty.git")
        subprocess.run(["git", "init", "-q", "--bare", empty], check=True)
        repo = os.path.join(self.d, "w2")
        subprocess.run(["git", "init", "-q", repo], check=True)
        git(repo, "remote", "add", "origin", empty)
        self.refused("state-ref-unavailable", W.propose, repo, "origin", REF, "a" * 40, event())
        self.assertEqual(git(repo, "ls-remote", "origin"), "")


if __name__ == "__main__":
    unittest.main()
