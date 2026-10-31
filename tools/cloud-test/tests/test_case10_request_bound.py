"""Case 10 request bound (R5 dossier, Case 10 acceptance tests and falsifying controls).

The allowance and pagination controls run the REAL harness modules under node. ArithmeticOnly checks the planning
module's arithmetic and input refusal; it observes no traffic. The product mechanisms are observed, and compared with
this module's declared components, by frontend/tests/unit/case10RequestBound.observed.test.ts. Baseline 99/100 refusal
and the 98 Start boundary are covered by harness/draft-adapters/tests/case10-admission.offline.test.cjs.
"""
import json
import copy
import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import unittest

from _fixtures import ROOT, prerequisite
import case10_request_bound as B

HARNESS = os.path.join(ROOT, "harness")


def node(script, *args):
    r = subprocess.run(["node", "-e", script, *args], capture_output=True, text=True, timeout=120)
    if r.returncode:
        raise AssertionError("node control failed: " + r.stderr[-2000:])
    return json.loads(r.stdout)


def projection(**over):
    p = {"snapshotSizes": [3, 3, 4, 4, 5, 5], "leaseHeldIntervalsMs": [60000], "scanObligationCounts": [10, 10],
         "loadQueueSizes": [2], "saveEvaluationInvocations": 2, "distinctRetryDebtsUpperBound": 1,
         "historyQueryLifecycles": 2, "recommendationSettlementInvocations": 1, "leaseAcquisitions": 2,
         "leaseConfirmations": 2, "openAttemptAdvances": 1, "cancelledAttempts": 1,
         "localRetrySkips": 4, "bootstrap": 5, "auth": 3, "navigation": 4, "modelAcquisition": 2, "preflights": 2,
         "successorSave": 3, "evidenceTail": 2}
    p.update(over)
    return p


class RealAllowanceAndPagination(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        prerequisite(shutil.which("node"), "node")

    def test_allowance_240_admits_240_requests_and_refuses_request_241(self):
        d = os.path.realpath(tempfile.mkdtemp(prefix="ct-case10-ledger-"))  # the ledger refuses a symlinked parent (macOS /var)
        self.addCleanup(shutil.rmtree, d, True)
        r = node("""
const {Ledger}=require(process.argv[1]);
const l=new Ledger(process.argv[2]+'/campaign-ledger.json',{total:1000});
try{l.setCaseAllowance(240);const out=[];for(let i=1;i<=241;i++)out.push(l.tryReserve(['total']));
console.log(JSON.stringify({first240:out.slice(0,240).every(x=>x===null),r241:out[240],state:l.caseAllowanceState()}));}finally{l.release();}
""", os.path.join(HARNESS, "bundle", "harness", "campaign-ledger.cjs"), d)
        self.assertTrue(r["first240"])
        self.assertEqual(r["r241"], "case-allowance")
        self.assertEqual(r["state"], {"allowance": 240, "used": 240, "exhausted": True})

    def test_offset_1100_is_refused_before_a_twelfth_network_page(self):
        # A history far larger than one complete read: every page is full, so the reader keeps paging until the
        # owner query refuses the range starting at 1100 without calling the browser.
        r = node("""
const {createOwnerDb}=require(process.argv[1]),capture=require(process.argv[2]);
const uid='00000000-0000-4000-8000-000000000010';let calls=0;
const config={caseId:'AHT-10',sourceSha:'a'.repeat(40),servedSha:'a'.repeat(40),campaignId:'offline',account:{id:uid},
 readback:{origin:'https://unit.invalid',projectRef:'unit',anonKey:'public-unit-key',schemaSha256:'a'.repeat(64),ownerReadApproved:true,rlsReadQualificationReceipt:'private/unit.json'}};
const page={evaluate:async()=>{calls++;
 return {data:Array.from({length:100},(_,i)=>({id:'r'+calls+'-'+i,user_id:uid})),error:null,count:5000};}};
const db=createOwnerDb(page,config);let refused=false;
try{db.from('sessions').select('id,user_id').range(1100,1199);}catch(e){refused=e.code==='NOT_RUN';}
const before=calls;
capture.readBaselineRows(db,uid).then(res=>console.log(JSON.stringify({directRefusedWithoutHttp:refused&&before===0,
 pages:calls,complete:res.rows.complete===true})));
""", os.path.join(HARNESS, "draft-adapters", "oracles", "owner-query.cjs"),
            os.path.join(HARNESS, "draft-adapters", "oracles", "pure", "rwtRecoveryCapture.cjs"))
        self.assertTrue(r["directRefusedWithoutHttp"])
        self.assertEqual(r["pages"], B.MAX_PAGES)
        self.assertFalse(r["complete"], "an over-capacity history must never read as complete")

    def test_the_post_fence_path_has_exactly_one_explicit_harness_get(self):
        with open(os.path.join(HARNESS, "draft-adapters", "source-adapters.cjs"), encoding="utf-8") as f:
            src = f.read()
        m = re.search(r"oracleAssertion\('lease-fenced'.*?check\('next-take-isolated'", src, re.S)
        self.assertIsNotNone(m, "the recovery tail moved; re-derive the count")
        self.assertEqual(len(re.findall(r"\brows\(\)", m.group(0))), 1)


class ArithmeticOnly(unittest.TestCase):
    """The calculator's arithmetic over supplied integers. These prove no mechanism fits the bound."""

    def test_six_one_page_scans_plus_six_other_gets_total_twelve(self):
        self.assertEqual(B.compute(projection())["components"]["harness"], 12)
        self.assertEqual(B.compute(projection())["harnessAttemptedCeiling"], 72)

    def test_paged_scans_charge_every_page(self):
        self.assertEqual(B.compute(projection(snapshotSizes=[100, 101, 200, 0, 1, 1100]))["components"]["harness"],
                         6 + 1 + 2 + 2 + 1 + 1 + 11)

    def test_a_scan_beyond_eleven_pages_is_refused_not_truncated(self):
        with self.assertRaisesRegex(B.BoundRefused, "SNAPSHOT_EXCEEDS_READ_CAPACITY"):
            B.compute(projection(snapshotSizes=[1101, 1, 1, 1, 1, 1]))

    def test_local_retry_skips_add_no_http_but_a_later_load_retry_is_charged(self):
        base = B.compute(projection())["transmittedBound"]
        self.assertEqual(B.compute(projection(localRetrySkips=400))["transmittedBound"], base)
        self.assertEqual(B.compute(projection(loadQueueSizes=[2, 1]))["transmittedBound"], base + 1)
        self.assertEqual(B.compute(projection(distinctRetryDebtsUpperBound=2))["transmittedBound"], base + 3)

    def test_immediate_calls_retries_cancelled_attempts_and_each_tick_are_charged(self):
        base = B.compute(projection())["transmittedBound"]
        self.assertEqual(B.compute(projection(cancelledAttempts=2))["transmittedBound"], base + 1)
        self.assertEqual(B.compute(projection(leaseConfirmations=3))["transmittedBound"], base + 1)
        self.assertEqual(B.compute(projection(leaseAcquisitions=3))["transmittedBound"], base + 2)
        self.assertEqual(B.compute(projection(openAttemptAdvances=2))["transmittedBound"], base + 3)
        self.assertEqual(B.compute(projection(leaseHeldIntervalsMs=[65000]))["transmittedBound"], base + 1)
        self.assertEqual(B.compute(projection(saveEvaluationInvocations=3))["transmittedBound"], base + 3)

    def test_worst_path_component_sum_equals_the_transmitted_bound_and_names_every_term(self):
        r = B.compute(projection())
        self.assertEqual(sum(r["components"].values()), r["transmittedBound"])
        for term in ("harness", "heartbeat", "leaseControl", "obligations", "evaluation", "history", "recommendation",
                     "attemptAdvance", "cancelledAttempts", "bootstrap", "auth", "navigation", "modelAcquisition", "preflights", "successorSave", "evidenceTail"):
            self.assertIn(term, r["components"])
        self.assertGreater(r["components"]["successorSave"], 0)
        self.assertGreater(r["components"]["evidenceTail"], 0)

    def test_every_input_is_required_and_none_silently_becomes_zero(self):
        for name in B.INPUTS:
            p = projection()
            del p[name]
            with self.subTest(missing=name), self.assertRaisesRegex(B.BoundRefused, "INPUT_MISSING:" + name):
                B.compute(p)
        for bad in (None, -1, 1.5, True, "3"):
            with self.subTest(bad=bad), self.assertRaises(B.BoundRefused):
                B.compute(projection(bootstrap=bad))
        with self.assertRaisesRegex(B.BoundRefused, "INPUT_UNKNOWN"):
            B.compute(projection(allowance=480))

    def test_the_allowance_stays_240_and_the_report_never_authorizes(self):
        big = B.compute(projection(bootstrap=500))
        self.assertEqual((big["allowance"], big["fitsAllowance"]), (240, False))
        small = B.compute(projection())
        self.assertEqual((small["allowance"], small["fitsAllowance"]), (240, True))
        self.assertIn("planning report only", small["authority"])

    def test_the_cli_refuses_a_bad_projection_with_exit_78_and_reports_a_good_one(self):
        d = tempfile.mkdtemp(prefix="ct-case10-cli-")
        self.addCleanup(shutil.rmtree, d, True)
        good, bad = os.path.join(d, "good.json"), os.path.join(d, "bad.json")
        with open(good, "w") as f:
            json.dump(projection(), f)
        p = projection()
        del p["successorSave"]
        with open(bad, "w") as f:
            json.dump(p, f)
        script = os.path.join(ROOT, "scripts", "case10_request_bound.py")
        ok = subprocess.run(["python3", "-I", script, good], capture_output=True, text=True, timeout=60)
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertEqual(json.loads(ok.stdout)["transmittedBound"], B.compute(projection())["transmittedBound"])
        refused = subprocess.run(["python3", "-I", script, bad], capture_output=True, text=True, timeout=60)
        self.assertEqual(refused.returncode, 78)
        self.assertIn("INPUT_MISSING:successorSave", refused.stderr)


class BoundExecutionConsumer(unittest.TestCase):
    """Exercise the actual plan builder, not merely the arithmetic report."""
    def setUp(self):
        from test_case_start_caps import SyntheticBuilder
        self.temp = tempfile.TemporaryDirectory(prefix="ct-case10-bound-builder-")
        self.addCleanup(self.temp.cleanup)
        self.fixture = SyntheticBuilder(os.path.realpath(self.temp.name), cases=(10,))

    def facts(self):
        with open(self.fixture.env["BP_FACTS"], encoding="utf-8") as f:
            return json.load(f)

    def write_facts(self, value):
        with open(self.fixture.env["BP_FACTS"], "w", encoding="utf-8") as f:
            json.dump(value, f)

    def refused(self, code):
        from case_start_caps import case10_execution_bound, InputValidationError
        with self.assertRaisesRegex(InputValidationError, code):
            case10_execution_bound(self.fixture.request, self.facts(), "00000000-0000-4000-8000-000000000001")
        before = self.fixture.outputs()
        result = self.fixture.run()
        self.assertEqual(result.returncode, 78)
        self.assertEqual(result.stderr.strip(), "BLOCKED_SETUP: INVALID_BINDING_INPUT")
        self.assertEqual(self.fixture.outputs(), before, "refusal must precede all phase outputs")

    def test_actual_builder_carries_exact_selected_projection(self):
        result = self.fixture.run()
        self.assertEqual(result.returncode, 0, result.stderr)
        with open(os.path.join(self.fixture.env["BP_PRIVATE"], "cases/AHT-10.json")) as f:
            cfg = json.load(f)
        bound = cfg["requestBound"]
        self.assertEqual(bound["allowance"], 240)
        self.assertEqual(bound["transmittedBound"], B.compute(projection())["transmittedBound"])
        self.assertEqual(bound["projectionSha256"], self.fixture.request["selection"][0]["requestBoundSha256"])

    def test_missing_projection_refuses_before_output(self):
        facts = self.facts(); del facts["case10RequestBound"]; self.write_facts(facts)
        self.refused("case10-bound-missing")

    def test_wrong_run_source_or_account_cannot_be_reused(self):
        original = self.facts()
        for field, value, code in (("runId", "OTHER", "case10-bound-identity"),
                                   ("sourceSha", "f" * 40, "case10-bound-identity"),
                                   ("accountSubjectSha256", "f" * 64, "case10-bound-account")):
            with self.subTest(field=field):
                facts = copy.deepcopy(original); facts["case10RequestBound"][field] = value; self.write_facts(facts)
                self.refused(code)

    def test_facts_replacement_cannot_change_the_approved_projection(self):
        facts = self.facts(); facts["case10RequestBound"]["projection"]["bootstrap"] += 1; self.write_facts(facts)
        self.refused("case10-bound-digest")

    def test_selected_over_240_or_under_planned_bound_is_refused(self):
        from case_start_caps import case10_execution_bound, InputValidationError
        original = self.facts()
        for planned in (B.compute(projection())["transmittedBound"] - 1, 241):
            with self.subTest(planned=planned):
                request = copy.deepcopy(self.fixture.request)
                request["selection"][0]["plannedRequests"] = planned
                with self.assertRaisesRegex(InputValidationError, "case10-bound-over-allowance"):
                    case10_execution_bound(request, original, "00000000-0000-4000-8000-000000000001")

    def test_all_missing_or_malformed_components_refuse_even_with_selected_digest(self):
        from case_start_caps import case10_execution_bound, InputValidationError
        for field in B.INPUTS:
            with self.subTest(missing=field):
                facts = self.facts(); del facts["case10RequestBound"]["projection"][field]
                request = copy.deepcopy(self.fixture.request)
                request["selection"][0]["requestBoundSha256"] = hashlib.sha256(json.dumps(facts["case10RequestBound"], sort_keys=True, separators=(",", ":")).encode()).hexdigest()
                with self.assertRaisesRegex(InputValidationError, "case10-bound-projection"):
                    case10_execution_bound(request, facts, "00000000-0000-4000-8000-000000000001")

    def test_bound_above_240_refuses_even_if_the_request_estimate_is_larger(self):
        from case_start_caps import case10_execution_bound, InputValidationError
        facts = self.facts(); facts["case10RequestBound"]["projection"]["bootstrap"] = 500
        request = copy.deepcopy(self.fixture.request)
        request["selection"][0].update(plannedRequests=700, requestBoundSha256=hashlib.sha256(json.dumps(facts["case10RequestBound"], sort_keys=True, separators=(",", ":")).encode()).hexdigest())
        with self.assertRaisesRegex(InputValidationError, "case10-bound-over-allowance"):
            case10_execution_bound(request, facts, "00000000-0000-4000-8000-000000000001")


if __name__ == "__main__":
    unittest.main()
