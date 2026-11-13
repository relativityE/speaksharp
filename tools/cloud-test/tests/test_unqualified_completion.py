"""Run 42423408284's pending completion through the EXISTING byte path . Fixtures are REAL, unmodified: the public
latest-record comment 6644906621 (GitHub server updated_at) and that run's completion artifact 13595275179 files, created 2026-11-07T23:12:13Z.

The record is unqualified (admission PASS, campaign refused before its first case, all 15 NOT RUN, code not-qualified), so the projection
emits campaignId null. reconcile_pending refused it completion-occurrence-identity, which would block the next record-begin before any
artifact expiry. It now folds as failed, unqualified history that is never row evidence, and the next attempt begins. A record that names a
campaign other than the occurrence's still refuses."""
import hashlib
import json
import os
import unittest

from _fixtures import ROOT
import publish_latest_record as P

FIX = os.path.join(ROOT, "tests", "fixtures", "completion-42423408284")
PUBLISHED_AT = "2026-11-07T23:12:11Z"
ARTIFACT_CREATED_AT = "2026-11-07T23:12:13Z"


def raw(name):
    with open(os.path.join(FIX, name), "rb") as f:
        return f.read()


COMMENT = json.loads(raw("comment-6644906621.json"))
BODY = COMMENT["body"]
ATTESTATION = json.loads(raw("completion-attestation.json"))


def reconcile(state=None, occurrence=None):
    return P.reconcile_pending(P.parse_body(BODY) if state is None else state, PUBLISHED_AT, ATTESTATION, raw("settle-receipt.json"),
                               raw("occurrence.json") if occurrence is None else occurrence, ARTIFACT_CREATED_AT, BODY)


class RealPendingCompletion(unittest.TestCase):
    def test_the_fixtures_are_the_published_pending_record_and_its_artifact(self):
        pending = P.parse_body(BODY)["pendingCompletion"]
        rec = pending["record"]
        self.assertEqual((rec["runId"], rec["campaignId"], rec["requestSha256"], rec["coverage"], rec["outcome"], rec["codes"]),
                         ("42423408284", None, None, "unqualified", "failed", ["not-qualified"]))
        self.assertEqual({c["result"] for c in rec["cases"]}, {"NOT RUN"})
        self.assertEqual(len(rec["cases"]), 15)
        self.assertEqual(COMMENT["updated_at"], PUBLISHED_AT)
        self.assertEqual(hashlib.sha256(raw("settle-receipt.json")).hexdigest(), pending["settleReceiptSha256"])
        self.assertEqual(hashlib.sha256(raw("occurrence.json")).hexdigest(), pending["occurrenceSha256"])
        self.assertEqual(hashlib.sha256(BODY.encode()).hexdigest(), ATTESTATION["publicIncompleteSha256"])
        self.assertEqual(json.loads(raw("occurrence.json"))["runId"], "R10-3b040043-smoke15")

    def test_the_byte_path_folds_it_as_failed_unqualified_history_and_the_next_attempt_begins(self):
        done = reconcile()
        self.assertEqual((done["latestCompleted"]["runId"], done["latestCompleted"]["outcome"], done["latestCompleted"]["coverage"],
                          done["inProgress"]), ("42423408284", "failed", "unqualified", None))
        self.assertNotIn("pendingCompletion", done)
        self.assertFalse(any(o["rowEvidence"] for o in done["history"]["occurrences"]))
        self.assertEqual(hashlib.sha256(P.render(done).encode()).hexdigest(), ATTESTATION["candidateSha256"])
        nxt = P.begin(done, "42500000001", 1, "b" * 40, "2026-11-08T00:30:00Z")
        self.assertEqual((nxt["inProgress"]["runId"], nxt["inProgress"]["status"]), ("42500000001", "running"))

    def test_a_named_campaign_that_is_not_the_occurrences_still_refuses(self):
        state = P.parse_body(BODY)
        named = dict(state["pendingCompletion"]["record"], campaignId="R10-other", requestSha256="1" * 64, catalogSha256="2" * 64,
                     coverage="smoke", coverageMode="smoke", assertionDepth="smoke", codes=[])
        state["pendingCompletion"] = dict(state["pendingCompletion"], record=named)
        with self.assertRaises(P.Refused):     # the public-state digest or the campaign identity: a changed record never folds
            reconcile(state)


if __name__ == "__main__":
    unittest.main()
