"""The protected recovery-only route (.github/workflows/cloud-test-recover.yml; work point 5, #1797, release review of e3f0b94c): its
static contract, read from the PARSED workflow. Protected main and an explicit RECOVER confirmation; the immutable source commit in every
job; the shared serialized concurrency group; evidence validated before any write and re-verified by digest downstream; the existing
settle-unexecuted calculation; a record retirement that refuses an unreconcilable record before the journal is settled; no secret, no live
job, no attempt record begun and no reservation appended."""
import os
import re
import unittest

from _fixtures import REPO

YML = os.path.join(REPO, ".github", "workflows", "cloud-test-recover.yml")
PROTECTED_MAIN = "github.ref == 'refs/heads/main' && github.ref_protected == true"


class RecoverWorkflowPolicy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import yaml
        with open(YML, encoding="utf-8") as f:
            cls.text = f.read()
        cls.wf = yaml.safe_load(cls.text)
        cls.jobs = cls.wf["jobs"]

    def run_of(self, job):
        return "\n".join(s.get("run", "") for s in self.jobs[job]["steps"])

    def test_manual_dispatch_only_with_an_explicit_recover_confirmation(self):
        on = self.wf.get("on", self.wf.get(True))
        self.assertEqual(set(on), {"workflow_dispatch"})
        self.assertEqual(set(on["workflow_dispatch"]["inputs"]), {"confirm"})
        first = self.jobs["validate"]["steps"][0]
        self.assertIn('[ "$CONFIRM" = RECOVER ] || { echo "BLOCKED_SETUP: recovery-not-confirmed"; exit 78; }', first["run"])
        self.assertEqual(first["env"], {"CONFIRM": "${{ inputs.confirm }}"})

    def test_every_job_runs_only_from_protected_main_on_the_immutable_source_commit(self):
        self.assertEqual(set(self.jobs), {"validate", "retire-record", "settle"})
        for name, job in self.jobs.items():
            with self.subTest(name):
                self.assertIn(PROTECTED_MAIN, job["if"])
                self.assertEqual(re.findall(r"refs/heads/[A-Za-z0-9._/-]+", job["if"]), ["refs/heads/main"])
                checkout = next(s for s in job["steps"] if s.get("uses", "").startswith("actions/checkout@"))
                self.assertEqual((checkout["with"]["ref"], checkout["with"]["persist-credentials"]), ("${{ github.sha }}", False))

    def test_it_shares_the_one_serialized_publisher_group_and_holds_no_default_permission(self):
        self.assertEqual(self.wf["concurrency"], {"group": "cloud-test-live", "cancel-in-progress": False})
        self.assertEqual(self.wf["permissions"], {})
        self.assertEqual(self.jobs["validate"]["permissions"], {"contents": "read", "actions": "read"})
        self.assertEqual(self.jobs["retire-record"]["permissions"], {"issues": "write", "pull-requests": "write"})
        self.assertEqual(self.jobs["settle"]["permissions"], {"contents": "write"})

    def test_no_secret_no_product_and_no_new_attempt_or_reservation(self):
        self.assertNotRegex(self.text, r"\$\{\{\s*secrets\.")
        for forbidden in ("execute_run.sh", "environment:", " begin ", "manual_reservation.py reserve", "reservations.py journal-reserve",
                          "prerequisite_preflight", "THROWAWAY", "SUPABASE", "POSTHOG", "VITE_", "issues/$TRACKING_ISSUE/comments\" -F",
                          "--method POST"):
            self.assertNotIn(forbidden, self.text, forbidden)
        tokens = re.findall(r"\$\{\{\s*([^}]*?)\s*\}\}", self.text)
        self.assertTrue(all(t.startswith(("github.", "inputs.confirm", "needs.validate.", "steps.collect.outputs.")) for t in tokens), tokens)
        self.assertEqual([t for t in tokens if t.startswith("github.token")], ["github.token"] * 3)

    def test_evidence_is_validated_before_any_write_and_reverified_downstream(self):
        run = self.run_of("validate")
        order = [run.index(x) for x in ('"$U" pending', '"$U" collect', '"$U" check')]
        self.assertEqual(order, sorted(order))
        self.assertIn('BLOCKED_SETUP: recovery-no-open-reservation', run)
        self.assertIn('BLOCKED_SETUP: recovery-own-run', run)
        self.assertEqual(self.jobs["retire-record"]["needs"], "validate")
        self.assertEqual(self.jobs["settle"]["needs"], ["validate", "retire-record"])
        self.assertIn("needs.retire-record.result == 'success'", self.jobs["settle"]["if"])
        retire = self.run_of("retire-record")
        self.assertIn('BLOCKED_SETUP: recovery-evidence-not-the-validated-bytes', retire)
        settle = self.run_of("settle")
        self.assertIn("manual_reservation.py settle-unexecuted", settle)
        self.assertIn('--unexecuted-sha256 "$EVIDENCE_SHA256"', settle)
        self.assertIn("--scope tools/cloud-test/config/aggregate/period-scope.json", settle)
        self.assertEqual(settle.count("manual_reservation.py"), 1, "exactly one journal write")
        self.assertNotIn("|| true", self.text)

    def test_the_record_is_retired_only_for_this_attempt_and_bound_to_the_consumed_comment(self):
        retire = self.run_of("retire-record")
        plan, retired, verify_pred, patch, verify = (retire.index("recovery-record-plan"), retire.index("retire-unexecuted"),
                                                     retire.index("verify-predecessor"), retire.index("--method PATCH"),
                                                     retire.index('"$P" verify --previous'))
        self.assertEqual([plan, retired, verify_pred, patch, verify], sorted([plan, retired, verify_pred, patch, verify]))
        self.assertIn('if [ "$plan" != retire ]; then echo "the latest record is not about this attempt; nothing to retire"; exit 0; fi', retire)
        self.assertNotIn("--method POST", retire, "the route never creates a record")
