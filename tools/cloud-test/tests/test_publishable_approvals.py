"""Public-repository rule: what a dispatch publishes to GitHub (the committed grant, request, base template and period scope, the
materialized request and the dispatch facts input) names no person and no chat message. Approvals are opaque codes and the approver a
role token; the approval check itself still requires a valid reference equal to the request's own."""
import json
import os
import unittest

from _fixtures import ROOT
import init_run_inputs as I

COMMITTED = ["config/runs/R10-3b040043-aht01-grant.json", "config/runs/R10-3b040043-aht01.json", "config/runs/R10-3b040043-all15.json",
             "config/runs/R10-3b040043-one-off-grant.json", "config/aggregate/period-scope.json"]


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


class Publishable(unittest.TestCase):
    def test_every_committed_r10_input_is_publishable(self):
        for rel in COMMITTED:
            with self.subTest(rel):
                self.assertTrue(I.publishable(load(rel)), rel)

    def test_the_committed_grant_carries_opaque_codes_and_the_role_token(self):
        g = load(I.ONE_OFF_GRANT_PATH.replace("tools/cloud-test/", ""))
        self.assertRegex(g["approvalRef"], I.APPROVAL_CODE)
        self.assertRegex(g["scopeApprovalRef"], I.APPROVAL_CODE)
        self.assertEqual(g["approvedBy"], I.APPROVER_ROLE)
        r = load("config/runs/R10-3b040043-aht01.json")
        self.assertEqual(r["approvedLimits"]["approvedBy"], I.APPROVER_ROLE)
        for ref in (r["approvedLimits"]["approvalRef"], r["window"]["approvalRef"], r["harness"]["ownerApprovalRef"], r["selectionApprovalRef"]):
            self.assertRegex(ref, I.APPROVAL_CODE)

    def test_the_materialized_occurrence_is_publishable(self):
        occ = I.materialize_authoritative_smoke_occurrence(os.path.abspath(os.path.join(ROOT, "..", "..")), load("config/runs/R10-3b040043-aht01.json"),
                                                           "2026-11-09T00:30:00Z")
        self.assertTrue(I.publishable(occ))

    def test_chat_references_user_ids_and_names_are_not_publishable_anywhere_in_a_document(self):
        for bad in ("slack:1794145532.283429", "see slack:1.2", "chatgpt:Sentinel_x", "Slack_ref", "U0CA39HPCV8", "Akin", "approved by Sam",
                    "Sam-I-am", "elon", "Jensen", "bezos"):
            with self.subTest(bad):
                self.assertFalse(I.publishable({"facts": {"receipts": {"disp": bad}}}))
                self.assertFalse(I.publishable([bad]))
                self.assertFalse(I.publishable({bad: 1}))
        for ok in ("approval-" + "0" * 32, I.APPROVER_ROLE, "release-reviewer", "sample", "same-target-repeat", "Samuel-free text",
                   "receipt:pre@aaaaaaaaaaaa", "history:throwaway@r5", 7, None, True):
            with self.subTest(ok):
                self.assertTrue(I.publishable({"v": ok}))

    def test_chat_references_are_refused_by_structure_not_only_by_prefix(self):
        for bad in ("https://speaksharp.slack.com/archives/C0C9RE8KNHG/p1794180342464149", "slack-1794180342.464149", "slack.1794180342.464149",
                    "SLACK:1", "see 1794180342.464149", "p1794180342464149", "/archives/C0C9RE8KNHG/", "chatgpt_x", "chatgpt.com/share/abc",
                    "https://chat.openai.com/c/abc"):
            with self.subTest(bad):
                self.assertFalse(I.publishable({"receipts": {"disp": bad}}))
        for ok in ("pooledSlack", "structural slack; limit", "receipt:pre@aaaaaaaaaaaa", "2026-11-09T12:00:00Z", "1794180342",
                   "r10-preflight:" + "a" * 64, "first-observation:existing-disposable@R10-3b040043-smoke15"):
            with self.subTest(ok):
                self.assertTrue(I.publishable({"v": ok}))

    def test_the_dispatch_approval_reference_must_be_an_opaque_code(self):
        with open(os.path.join(ROOT, "scripts", "init_run_inputs.py"), encoding="utf-8") as f:
            src = f.read()
        self.assertIn('APPROVAL_CODE.fullmatch(facts["ownerApprovalReference"]) is not None', src)
        self.assertIn('"facts-approval-not-opaque"', src)
        self.assertIsNone(I.APPROVAL_CODE.fullmatch("slack-1794180342.464149"))
        self.assertIsNotNone(I.APPROVAL_CODE.fullmatch("approval-" + "0" * 32))

    def test_prepare_refuses_unpublishable_dispatch_facts_and_a_named_approver(self):
        with open(os.path.join(ROOT, "scripts", "init_run_inputs.py"), encoding="utf-8") as f:
            src = f.read()
        block = src[src.index("    if not nightly:     # a dispatch's facts input"):]
        block = block[:block.index("\n\n")]
        for code in ('"facts-not-publishable"', '"facts-approver-not-a-role"', '"request-not-publishable"'):
            self.assertIn(code, block)
        self.assertIn('facts.get("approvedBy") == APPROVER_ROLE and facts.get("reviewer") in REVIEWER_ROLES', block)


if __name__ == "__main__":
    unittest.main()
