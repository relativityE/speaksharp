"""The append-only state-ref writer (Sam 1793548444.540999, RETURN 1793549143.187519), exercised only against temporary bare repositories:
the fixed ref, the pinned root and whole-chain validation from raw objects, exact expected-old-SHA appends under races, deletion and rewind,
journal-before-push crash recovery without a second transition, Git's trust boundary, and closed, typed, content-free events."""
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from _fixtures import ROOT
import state_ref_writer as W

REF = W.STATE_REF
CAPS = {"requests": 800, "identityReads": 20, "starts": 6, "takes": 4, "coachingRequests": 5, "runnerMinutes": 340}
APPROVAL = "approval:slack-1793548444.540999"
TEST_ENV = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@invalid", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@invalid"}


def event(kind="reserve", run="101", allocation=None, at="2026-11-01T16:00:00Z", **over):
    e = {"type": kind, "campaignId": "R6-live", "runId": run, "attempt": 1, "allocation": dict(allocation or CAPS), "provenance": APPROVAL, "atUtc": at}
    e.update(over)
    return e


def git(repo, *a, data=None):
    """Test-side Git (the module never runs these): fixture setup and adversarial remote changes."""
    return subprocess.run(["git", "-C", repo, *a], input=data, capture_output=True, check=True, env=TEST_ENV).stdout.decode().strip()


class StateRef(unittest.TestCase):
    def setUp(self):
        self.d = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.d)
        self.remote = os.path.join(self.d, "remote.git")
        subprocess.run(["git", "init", "-q", "--bare", self.remote], check=True)
        self.repo = self.fresh("writer")
        # The reviewed root is created HERE, in the temporary remote only; the module never creates the ref.
        self.root = self.commit(self.repo, [], None, "genesis")
        git(self.repo, "push", "-q", self.remote, "%s:%s" % (self.root, REF))

    def fresh(self, name):
        path = os.path.join(self.d, name)
        subprocess.run(["git", "init", "-q", path], check=True)
        return path

    def commit(self, repo, events, parent, msg):
        blob = git(repo, "hash-object", "-w", "--stdin", data=W.ledger_bytes(events))
        tree = git(repo, "mktree", data=("100644 blob %s\tledger.json\n" % blob).encode())
        return git(repo, "commit-tree", tree, *(["-p", parent] if parent else []), data=(msg + "\n").encode())

    def force(self, sha, repo=None):
        git(repo or self.repo, "push", "-q", "-f", self.remote, "%s:%s" % (sha, REF))

    def propose(self, expected, e, repo=None, **kw):
        return W.propose(repo or self.repo, self.remote, expected, e, self.root, self.remote, **kw)

    def verify(self, receipt, e, repo=None):
        return W.verify(repo or self.repo, self.remote, receipt, e, self.root, self.remote)

    def refused(self, code, fn, *a, **k):
        with self.assertRaises(W.Refused) as e:
            fn(*a, **k)
        self.assertEqual(str(e.exception), code)

    def head(self):
        out = git(self.remote, "for-each-ref", "--format=%(objectname)", REF)
        return out or None

    def events(self):
        return W.validate_chain(self.repo, W.fetch_head(self.repo, self.remote, self.remote), self.root)[-1][1]

    def test_reserve_then_settle_append_exactly_one_event_each_with_verified_receipts(self):
        r1 = self.propose(self.root, event())
        self.assertEqual((r1["ref"], r1["previousSha"], self.head()), (REF, self.root, r1["newSha"]))
        self.assertEqual(self.verify(r1, event())["events"], 1)
        used = dict(CAPS, requests=640, runnerMinutes=310)
        settle = event("settle", allocation=used, at="2026-11-01T21:00:00Z", provenance="evidence-sha256:" + "a" * 64)
        r2 = self.propose(r1["newSha"], settle)
        self.assertEqual(self.verify(r2, settle)["events"], 2)
        self.assertTrue(self.verify(r1, event())["verified"], "still verifiable after later appends")
        self.assertEqual(git(self.repo, "rev-list", "--parents", "-n", "1", r2["newSha"]).split()[1:], [r1["newSha"]])

    def test_a_stale_expected_head_and_a_racing_writer_are_rejected_without_rewrite(self):
        r1 = self.propose(self.root, event())
        self.refused("stale-head", self.propose, self.root, event(run="102"))
        other = self.fresh("other")
        real = W._push

        def race(repo, url, new, expected, scheme):  # the other writer lands between this writer's fetch and push
            with mock.patch.object(W, "_push", real):
                self.propose(r1["newSha"], event(run="103"), repo=other)
            return real(repo, url, new, expected, scheme)
        with mock.patch.object(W, "_push", race):
            self.refused("state-ref-push-rejected", self.propose, r1["newSha"], event(run="104"))
        self.assertEqual([e["runId"] for e in self.events()], ["101", "103"], "the raced write never landed and nothing was rewritten")

    def test_a_deletion_or_rewind_between_fetch_and_push_never_recreates_or_rewrites_the_ref(self):
        r1 = self.propose(self.root, event())
        r2 = self.propose(r1["newSha"], event(run="102"))
        real = W._push

        def delete_first(*a):
            git(self.remote, "update-ref", "-d", REF)
            return real(*a)
        with mock.patch.object(W, "_push", delete_first):
            self.refused("state-ref-unavailable", self.propose, r2["newSha"], event(run="103"))
        self.assertIsNone(self.head(), "the lease on a missing ref never creates it")
        git(self.remote, "update-ref", REF, r2["newSha"])

        def rewind_first(*a):
            git(self.remote, "update-ref", REF, r1["newSha"])
            return real(*a)
        with mock.patch.object(W, "_push", rewind_first):
            self.refused("state-ref-push-rejected", self.propose, r2["newSha"], event(run="103"))
        self.assertEqual(self.head(), r1["newSha"], "a rewound ref is not fast-forwarded by a writer that observed the later head")

    def test_duplicate_and_impossible_transitions_are_refused(self):
        r1 = self.propose(self.root, event())
        self.refused("duplicate-transition", self.propose, r1["newSha"], event(at="2026-11-01T16:01:00Z"))
        self.refused("transition-without-open-reservation", self.propose, r1["newSha"], event("settle", run="999"))
        self.refused("settle-exceeds-reservation", self.propose, r1["newSha"], event("settle", allocation=dict(CAPS, takes=5)))
        self.refused("release-differs-from-reservation", self.propose, r1["newSha"], event("release", allocation=dict(CAPS, takes=0)))
        r2 = self.propose(r1["newSha"], event("release"))
        self.refused("transition-without-open-reservation", self.propose, r2["newSha"], event("settle"))
        self.assertEqual(self.head(), r2["newSha"], "refusals push nothing")

    def test_events_are_closed_typed_full_string_and_content_free(self):
        bad = [dict(event(), email="a@b.invalid"), event(allocation=dict(CAPS, password=1)), {k: v for k, v in event().items() if k != "atUtc"},
               event(type="adjust"), event(attempt=0), event(attempt=2), event(attempt=True), event(run="abc"), event(run="101\n"),
               event(campaignId="R6-live\n"), event(provenance="has spaces"), event(provenance="approval:someone@example.invalid"),
               event(provenance="token:ghp_abcdefghijklmnopqrstuvwxyz"), event(provenance=APPROVAL + "\n"),
               event(provenance="request-sha256:" + "A" * 64), event(allocation=dict(CAPS, requests=-1)),
               event(at="2026-13-45T25:61:00Z"), event(at="2026-11-01T16:00:00Z\n"), event(at="2026-02-30T00:00:00Z")]
        for e in bad:
            with self.subTest(e=json.dumps(e)[-70:]), self.assertRaises(W.Refused):
                self.propose(self.root, e)
        self.assertEqual(self.head(), self.root)

    def test_forged_receipts_alternate_refs_and_off_ref_commits_fail_persisted_bytes_verification(self):
        r1 = self.propose(self.root, event())
        for k, v in (("previousSha", "f" * 40), ("ledgerBlobSha256", "0" * 64), ("proposalSha256", "0" * 64), ("newSha", "e" * 40)):
            with self.subTest(k=k), self.assertRaises(W.Refused):
                self.verify(dict(r1, **{k: v}), event())
        self.refused("receipt-event-mismatch", self.verify, r1, event(run="555"))
        for ref in ("refs/heads/other", "refs/heads/cloud-test-state-2", "refs/tags/cloud-test-state"):
            self.refused("state-ref-not-selected", self.verify, dict(r1, ref=ref), event())
        self.refused("state-ref-not-selected", self.verify, dict(r1, ref="refs/heads/other"), event())
        # A same-shaped commit that is not on the ref does not verify.
        orphan = self.commit(self.repo, [event()], self.root, "orphan")
        self.refused("receipt-commit-not-on-state-ref", self.verify, dict(r1, newSha=orphan), event())
        self.refused("ledger-not-canonical", W.parse_ledger, json.dumps(json.loads(W.ledger_bytes([event()])), indent=1).encode())

    def test_a_replaced_root_or_a_rewritten_descendant_is_refused(self):
        r1 = self.propose(self.root, event())
        r2 = self.propose(r1["newSha"], event(run="102"))
        # Rewritten descendants from the genuine root: a valid-looking chain, but not the history either receipt or expected head is on.
        a = self.commit(self.repo, [event(allocation=dict(CAPS, takes=1))], self.root, "rewritten")
        b = self.commit(self.repo, [event(allocation=dict(CAPS, takes=1)), event(run="102")], a, "rewritten")
        self.force(b)
        self.refused("receipt-commit-not-on-state-ref", self.verify, r2, event(run="102"))
        self.refused("stale-head", self.propose, r2["newSha"], event(run="103"))
        # A child that drops an event is not an append.
        self.force(self.commit(self.repo, [], r1["newSha"], "dropped"))
        self.refused("ledger-not-append-only", self.propose, r1["newSha"], event(run="103"))
        # A different parentless root, even with an empty canonical ledger and identical later events.
        fake = self.commit(self.repo, [], None, "another genesis")
        self.force(self.commit(self.repo, [event()], fake, "on fake root"))
        self.refused("state-root-replaced", self.verify, r1, event())
        self.refused("state-root-replaced", self.propose, r1["newSha"], event(run="103"))
        # A commit with two parents anywhere on the chain.
        rc = subprocess.run(["git", "-C", self.repo, "commit-tree", git(self.repo, "rev-parse", r2["newSha"] + "^{tree}"), "-p", r1["newSha"],
                             "-p", r2["newSha"]], input=b"merge\n", capture_output=True, env=TEST_ENV)
        self.force(rc.stdout.decode().strip())
        self.refused("state-commit-has-several-parents", self.propose, r2["newSha"], event(run="103"))
        self.refused("state-root-not-pinned", W.validate_chain, self.repo, self.root, None)

    def test_a_crash_after_the_push_is_recovered_by_the_identical_retry_without_a_second_transition(self):
        journal, out = os.path.join(self.d, "journal.json"), os.path.join(self.d, "receipt.json")
        run = lambda e=event(), expected=None: W.propose_to_files(self.repo, self.remote, expected or self.root, e, self.root, journal, out,  # noqa: E731
                                                                   self.remote)
        with mock.patch.object(W, "publish_receipt", side_effect=RuntimeError("crash after push")):
            with self.assertRaises(RuntimeError):
                run()
        self.assertFalse(os.path.exists(out))
        self.assertEqual(len(self.events()), 1, "the push landed once")
        run()
        with open(out, "rb") as f, open(journal, "rb") as g:
            receipt = json.loads(f.read())
            self.assertEqual(W.canon(receipt), g.read(), "the recovered receipt is the journaled one")
        self.assertEqual(stat.S_IMODE(os.stat(out).st_mode), 0o600)
        run()  # a further identical retry changes nothing
        self.assertEqual((len(self.events()), self.verify(receipt, event())["events"]), (1, 1))
        # A different operation never reuses the journal, and a new transition for the same key is a duplicate, not a recovery.
        self.refused("journal-conflict", run, event(run="102"), receipt["newSha"])
        self.refused("duplicate-transition", run, event(at="2026-11-01T16:05:00Z"), receipt["newSha"])
        self.assertEqual(len(self.events()), 1)
        self.refused("journal-and-receipt-paths", W.propose_to_files, self.repo, self.remote, self.root, event(), self.root, out, out, self.remote)

    def test_an_uncertain_push_outcome_is_settled_by_the_persisted_history(self):
        real = W._push
        with mock.patch.object(W, "_push", lambda *a: real(*a) or 1):  # landed, but the client saw an error
            r1 = self.propose(self.root, event())
        self.assertEqual(self.head(), r1["newSha"])
        with mock.patch.object(W, "_push", lambda *a: 0):  # reported success, nothing landed
            self.refused("state-ref-push-unconfirmed", self.propose, r1["newSha"], event(run="102"))
        self.assertEqual(self.head(), r1["newSha"])

    def test_git_runs_inside_a_closed_trust_boundary(self):
        for url in ("--upload-pack=touch pwned", "-oProxyCommand=x", os.path.join(self.d, "other.git"), "remote.git", "ext::sh -c x"):
            self.refused("remote-not-approved", W.propose, self.repo, url, self.root, event(), self.root, url if url == "remote.git" else self.remote)
        self.refused("remote-not-approved", W.propose, self.repo, "--upload-pack=x", self.root, event(), self.root, "--upload-pack=x")
        for key, value in (("url.%s.insteadOf" % self.remote, "/elsewhere"), ("core.hooksPath", self.d), ("remote.origin.url", self.remote),
                           ("include.path", os.path.join(self.d, "x")), ("credential.helper", "store")):
            repo = self.fresh("cfg-" + key.replace("/", "_"))
            git(repo, "config", key, value)
            self.refused("unsafe-git-config", self.propose, self.root, event(), repo=repo)
        # Hooks never run (the repo's own hooks directory and a reference-transaction hook).
        marker = os.path.join(self.d, "hook-ran")
        hooks = os.path.join(self.repo, ".git", "hooks")
        for name in ("pre-push", "reference-transaction", "post-checkout"):
            path = os.path.join(hooks, name)
            with open(path, "w") as f:
                f.write("#!/bin/sh\ntouch '%s'\n" % marker)
            os.chmod(path, 0o755)
        r1 = self.propose(self.root, event())
        self.assertFalse(os.path.exists(marker))
        # A local replace object cannot substitute history: verification reads the genuine raw objects.
        forged = self.commit(self.repo, [event(allocation=dict(CAPS, takes=0))], self.root, "forged")
        git(self.repo, "replace", r1["newSha"], forged)
        self.assertEqual(self.verify(r1, event())["events"], 1)

    def test_the_ref_is_never_created_and_the_cli_refuses_until_the_root_is_pinned(self):
        empty = os.path.join(self.d, "empty.git")
        subprocess.run(["git", "init", "-q", "--bare", empty], check=True)
        repo = self.fresh("w2")
        self.refused("state-ref-unavailable", W.propose, repo, empty, "a" * 40, event(), self.root, empty)
        self.assertEqual(git(empty, "for-each-ref"), "")
        ev = os.path.join(self.d, "event.json")
        with open(ev, "w") as f:
            json.dump(event(), f)
        script = os.path.join(ROOT, "scripts", "state_ref_writer.py")
        base = ["propose", "--repo", self.repo, "--remote", W.APPROVED_URL, "--root", self.root, "--expected", self.root, "--event", ev,
                "--journal", os.path.join(self.d, "j"), "--out", os.path.join(self.d, "o")]
        for extra, code in (([], "state-root-not-pinned"), (["--ref", "refs/heads/other"], "state-ref-not-selected")):
            p = subprocess.run([sys.executable, "-I", script, *base, *extra], capture_output=True, text=True, timeout=60)
            self.assertEqual((p.returncode, p.stderr.strip(), p.stdout), (78, "BLOCKED_SETUP: " + code, ""))
        self.assertIsNone(W.REVIEWED_ROOT, "the real root is pinned only by an independently reviewed change")


if __name__ == "__main__":
    unittest.main()
