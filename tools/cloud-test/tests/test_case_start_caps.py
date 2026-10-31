"""R5 admission controls. Every input is made up; no browser or product traffic.

The subprocess tests exercise the actual isolated builder and assert both the
exit and the absence of new phase files. Reusable fixture helpers are explicit
about their synthetic authority; they never rewrite retained receipts.
"""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

from _fixtures import ROOT, REPO, J
from case_start_caps import FULL_MINIMA, MINIMAL_MINIMA, request_caps, reconcile_caps, verified_contracts

SOURCE = "66328703bf47e865b730e229005411e78481d34c"
BUILDER = Path(ROOT) / "harness-adapter/build_plan.py"


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def synthetic_allocation(request):
    """Migrate a made-up scenario, keeping its selected cases and mode explicit."""
    minimum = MINIMAL_MINIMA if request["sampleMode"] == "minimal" else FULL_MINIMA
    caps = {row["case"]: minimum[row["case"]] for row in request["selection"]}
    for row in request["selection"]:
        row["startPressCap"] = caps[row["case"]]
    request["estimate"]["starts"] = sum(caps.values())
    request["proposedLimits"]["startPressCaps"] = dict(caps)
    request["approvedLimits"]["startPressCaps"] = dict(caps)
    return request


def synthetic_reconciliation():
    return {"synthetic": "NOT-A-RUN", "starts": {"ownerCounted": 5},
            "ceilings": {"starts": 100, "requests": 20000, "identityReads": 200, "takes": 100,
                         "protectedReserveRequests": 50},
            "requests": {"conservativeUsed": 0}, "identityReads": {"conservativeUsed": 0},
            "takes": {"ownerCounted": 0}}


def bind_synthetic_files(root, request, facts=None, reconciliation=None):
    """Raw-byte hashes are calculated only after writing synthetic inputs."""
    root = Path(root)
    reqp, rcp, factp = [root / name for name in ("request.json", "reconciliation.json", "facts.json")]
    facts = copy.deepcopy(facts or J("tests", "fixtures", "plan-facts.PLACEHOLDER.json"))
    rc = copy.deepcopy(reconciliation if reconciliation is not None else synthetic_reconciliation())
    for path, value in ((reqp, request), (rcp, rc)):
        path.write_text(json.dumps(value))
        path.chmod(0o600)
    approved = request.get("approvedLimits") if type(request.get("approvedLimits")) is dict else {}
    facts["actionApproval"] = {"schema": "speaksharp.case-start-approval.v1",
        "requestSha256": digest(reqp), "reconciliationSha256": digest(rcp),
        "approvalRef": approved.get("approvalRef"), "approvedBy": approved.get("approvedBy"),
        "selectionApprovalRef": request["selectionApprovalRef"]}
    factp.write_text(json.dumps(facts)); factp.chmod(0o600)
    return {"BP_REQUEST_FILE": str(reqp), "BP_REQUEST_SHA256": digest(reqp),
            "BP_RECONCILIATION_FILE": str(rcp), "BP_RECONCILIATION_SHA256": digest(rcp), "BP_FACTS": str(factp)}


class SyntheticBuilder:
    def __init__(self, root, cases=(13,), minimal=False):
        self.root = Path(root).resolve()
        self.request = J("tests", "fixtures", "partial-request.json")
        r = self.request
        r.update(runId="SYNTHETIC-NOT-A-RUN", coverageMode="partial", sampleMode="minimal" if minimal else "full")
        r["release"]["testedSha"] = SOURCE
        r["selection"] = [{"order": i + 1, "case": "AHT-%02d" % n, "plannedRequests": 100, "gate": None}
                          for i, n in enumerate(cases)]
        r["estimate"].update(identityReads=2 * len(cases) + 2,
            requests={"planned": 100 * len(cases), "cleanupReserve": 50, "pooledSlack": 0, "runCap": 100 * len(cases) + 50},
            providerBillableRequests={"coachingCap": 0, "basis": "SYNTHETIC-NOT-A-RUN"})
        r["approvedLimits"].update(runCapRequests=r["estimate"]["requests"]["runCap"], startsCap=100,
            approvalRef="SYNTHETIC-NOT-A-RUN", approvedBy="SYNTHETIC-NOT-A-RUN")
        r["window"] = {"startUtc": "2020-01-01T00:00:00Z", "endUtc": "2099-01-01T00:00:00Z"}
        r["selectionApprovalRef"] = "SYNTHETIC-NOT-A-RUN"
        synthetic_allocation(r)
        uid = self.root / "uid"
        uid.write_text("00000000-0000-4000-8000-000000000001"); uid.chmod(0o600)
        self.env = {"PATH": os.environ["PATH"], "HOME": str(self.root), "BP_PACKET": str(Path(ROOT) / "harness"),
                    "BP_CHECKOUT": REPO, "BP_PRIVATE": str(self.root / "private"), "BP_ACCOUNT_ID_FILE": str(uid),
                    "BP_TASK_ID": "SYNTHETIC", "BP_SOURCE_REFERENCE": "https://claude.ai/code/SYNTHETIC",
                    "BP_ENV_ID": "SYNTHETIC", "VITE_SUPABASE_ANON_KEY": "SYNTHETIC-PUBLISHABLE"}
        self.repin()

    def repin(self, facts=None, rc=None):
        r = self.request
        self.env.update(bind_synthetic_files(self.root, r, facts, rc))
        self.env.update(BP_MODE="minimal" if r["sampleMode"] == "minimal" else "selected-full",
            BP_RUNTIME=r.get("executionRuntime", "Claude SpeakSharp R4"), BP_SOURCE_SHA=r["release"]["testedSha"],
            BP_CAMPAIGN=r["runId"], BP_T0=r["window"]["startUtc"], BP_T1=r["window"]["endUtc"],
            BP_SELECT=",".join(str(int(row["case"][-2:])) for row in r["selection"]),
            BP_SELECT_REF=r["selectionApprovalRef"], BP_SELECT_REASON="SYNTHETIC-NOT-A-RUN", BP_CASES=",".join(map(str, range(1,16))),
            BP_EST=",".join("%d:%d" % (int(row["case"][-2:]), row["plannedRequests"]) for row in r["selection"]),
            BP_IDENT=str(r["estimate"]["identityReads"]), BP_TOTAL=str(r["approvedLimits"]["runCapRequests"]),
            BP_CLEANUP=str(r["estimate"]["requests"]["cleanupReserve"]),
            BP_COACHING_CAP=str(r["estimate"]["providerBillableRequests"]["coachingCap"]))

    def run(self, phase="phase1", builder=BUILDER):
        return subprocess.run([sys.executable, "-I", str(builder), phase], env=self.env,
                              capture_output=True, text=True, timeout=30)

    def outputs(self):
        out = Path(self.env["BP_PRIVATE"])
        return {str(p.relative_to(out)): digest(p) for p in out.rglob("*") if p.is_file()} if out.exists() else {}


class CaseStartContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="r5-start-control-")
        self.addCleanup(self.temp.cleanup)
        self.f = SyntheticBuilder(self.temp.name)

    def rejected(self, phase="phase1"):
        before = self.f.outputs()
        result = self.f.run(phase)
        self.assertEqual(result.returncode, 78, result.stdout + result.stderr)
        self.assertEqual(result.stderr.strip(), "BLOCKED_SETUP: INVALID_BINDING_INPUT")
        self.assertEqual(self.f.outputs(), before)
        self.assertFalse((self.f.root / "media").exists())
        self.assertFalse(any("reservation" in name or "run/" in name for name in self.f.outputs()))

    def test_full_minima_and_assertions_are_verified_not_aggregated_guesses(self):
        self.assertEqual(sum(FULL_MINIMA.values()), 42)
        contracts = verified_contracts(J("harness", "draft-adapters", "contracts.json"))
        self.assertEqual(sum(len(c["requiredAssertions"]) for c in contracts.values()), 204)
        self.assertEqual(sum(c["requiredTakeCap"] for c in contracts.values()), 31)

    def test_selected_case_emits_all_fifteen_configs_only_selected_has_approval(self):
        result = self.f.run()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(list((self.f.root / "private/cases").glob("*.json"))), 15)
        for cid in FULL_MINIMA:
            cfg = json.loads((self.f.root / ("private/cases/" + cid + ".json")).read_text())
            self.assertEqual("startPressApproval" in cfg, cid == "AHT-13")
            self.assertEqual(cfg["startPressCap"], 2 if cid == "AHT-14" else FULL_MINIMA[cid])
        approval = json.loads((self.f.root / "private/cases/AHT-13.json").read_text())["startPressApproval"]
        self.assertEqual(approval["requestSha256"], self.f.env["BP_REQUEST_SHA256"])

    def test_selected_private_evidence_cases_refuse_unavailable_receiver_before_builder_outputs(self):
        for case in (1, 2, 3, 7, 8):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as root:
                self.f = SyntheticBuilder(root, cases=(case,))
                self.rejected()

    def test_selected_feedback_cases_use_real_descriptor_binding_without_live_credentials(self):
        from proof_prep_cases import synthetic_producer_environment
        for case in (7, 8):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as root:
                f = SyntheticBuilder(root, cases=(case,))
                f.request['executionRuntime'] = 'GitHub Actions SpeakSharp'
                facts = J('tests', 'fixtures', 'plan-facts.PLACEHOLDER.json')
                producer_env = synthetic_producer_environment(f.root, str(Path(ROOT) / 'harness'), facts)
                f.repin(facts=facts)
                f.env.update(producer_env)
                result = f.run()
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                cfg = json.loads((f.root / ('private/cases/AHT-%02d.json' % case)).read_text())
                self.assertTrue(all(p['producerIdentity'].endswith(':123:1:live') for p in cfg['privateEvidenceProducers'].values()))
                self.assertNotIn('SUPABASE_SERVICE_ROLE_KEY', f.env)
                self.assertNotIn('POSTHOG_PERSONAL_API_KEY', f.env)
                self.assertEqual(f.run('phase2').returncode, 0)
                # Compare the REAL builder postimage with the REAL launcher's
                # instance gate. Synthetic job labels here establish no auth.
                check = """const fs=require('node:fs'),path=require('node:path');
const {validatePlanProducers}=require(process.argv[1]);
const {jobIdentity}=require(path.join(path.dirname(process.argv[1]),'authenticated-job-producer.cjs'));
const plan=JSON.parse(fs.readFileSync(process.argv[2])),config=JSON.parse(fs.readFileSync(process.argv[3]));
const scope={campaignId:plan.campaignId,ownerAccountId:config.account.id,sourceSha:plan.sourceSha,servedSha:plan.servedSha,notBefore:plan.notBefore,deadlineAt:plan.deadlineAt,caseIds:[config.caseId],maxDeliveries:8,maxSupabaseRequests:16,maxTelemetryReads:2,producerReviewReference:config.privateEvidenceProducers['feedback-association'].reviewReference};
validatePlanProducers(plan,scope,[{caseId:config.caseId,config}],{job:jobIdentity(process.env)});
console.log('SYNTHETIC-BUILDER-LAUNCHER-BINDING-PASS');"""
                checked = subprocess.run(['node', '--input-type=commonjs', '-e', check,
                    str(Path(ROOT) / 'harness/bundle/harness/with-authenticated-evidence.cjs'),
                    str(f.root / 'private/cfg/campaign-plan.json'), str(f.root / ('private/cases/AHT-%02d.json' % case))],
                    env=f.env, capture_output=True, text=True, timeout=15)
                self.assertEqual(checked.returncode, 0, checked.stderr)
                self.assertEqual(checked.stdout.strip(), 'SYNTHETIC-BUILDER-LAUNCHER-BINDING-PASS')

    def test_minimal_and_future_phase_one_preserve_existing_floor(self):
        self.f = SyntheticBuilder(self.temp.name, cases=(13,14), minimal=True)
        self.f.request["window"]["startUtc"] = "2098-01-01T00:00:00Z"; self.f.repin()
        result = self.f.run()
        self.assertEqual(result.returncode, 0, result.stderr)
        for n in (13,14):
            self.assertEqual(json.loads((self.f.root / ("private/cases/AHT-%02d.json" % n)).read_text())["startPressCap"], 1)

    def test_phase_two_does_not_require_phase_one_credential(self):
        self.assertEqual(self.f.run().returncode, 0)
        del self.f.env["VITE_SUPABASE_ANON_KEY"]
        result = self.f.run("phase2")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(json.loads((self.f.root / "private/cfg/campaign-plan.json").read_text())["cases"]), 15)

    def test_changed_phase_two_binding_preserves_phase_one_without_new_outputs(self):
        self.assertEqual(self.f.run().returncode, 0)
        self.f.env["BP_GATES"] = "13:99:fake"
        self.rejected("phase2")

    def test_bridge_emits_raw_bytes_and_both_digests(self):
        output = self.f.root / "env.txt"
        result = subprocess.run([sys.executable, "-I", str(Path(ROOT) / "scripts/run_env.py"), "--request", self.f.env["BP_REQUEST_FILE"],
            "--reconciliation", self.f.env["BP_RECONCILIATION_FILE"], "--out", str(output)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        values = {line.split("=",1)[0]: shlex.split(line.split("=",1)[1])[0] for line in output.read_text().splitlines() if shlex.split(line.split("=",1)[1])}
        for key in ("BP_REQUEST_FILE", "BP_REQUEST_SHA256", "BP_RECONCILIATION_FILE", "BP_RECONCILIATION_SHA256"):
            self.assertEqual(values[key], self.f.env[key])

    def test_boolean_cap_is_not_integer_even_when_equal(self):
        f = SyntheticBuilder(self.temp.name, minimal=True)
        f.request["approvedLimits"]["startPressCaps"]["AHT-13"] = True
        f.repin(); self.f=f; self.rejected()

    def test_proposed_ceiling_can_validate_but_never_authorizes_execution(self):
        r=self.f.request
        r['approvedLimits']['startsCap']=None
        r['proposedLimits']['startsCap']=100
        rc=synthetic_reconciliation();rc['ceilings']['starts']=7
        self.assertEqual(reconcile_caps(r,rc)[1],{'AHT-13':3})
        with self.assertRaises(ValueError):reconcile_caps(r,rc,execution=True)
        self.f.repin(rc=rc);self.rejected()

    def test_every_required_and_optional_container_rejects_wrong_present_types(self):
        paths = [("estimate",), ("proposedLimits",), ("approvedLimits",), ("release",), ("harness",), ("window",),
                 ("estimate","requests"), ("estimate","providerBillableRequests"), ("estimate","window"),
                 ("proposedLimits","startPressCaps"), ("approvedLimits","startPressCaps"),
                 ("proposedLimits","guardCaps"), ("release","backend")]
        original = copy.deepcopy(self.f.request)
        for path in paths:
            for value in (None, [], "PRIVATE-CANARY", 3, True):
                with self.subTest(path=path,value=value):
                    self.f.request = copy.deepcopy(original)
                    target=self.f.request
                    for part in path[:-1]: target=target[part]
                    target[path[-1]]=value
                    # Do not rely on the fixture's own accesses to malformed fields.
                    self.f.env.update(bind_synthetic_files(self.f.root, self.f.request))
                    self.rejected()

    def test_invalid_selection_and_caps_refuse_without_output(self):
        mutations = [lambda r:r.update(selection=[]), lambda r:r.update(selection=[None]),
            lambda r:r["selection"].append(copy.deepcopy(r["selection"][0])),
            lambda r:r["selection"][0].update(case="AHT-99"), lambda r:r["selection"][0].update(startPressCap=2),
            lambda r:r["selection"][0].update(startPressCap=True), lambda r:r["selection"][0].pop("startPressCap"),
            lambda r:r["approvedLimits"].update(startPressCaps={}), lambda r:r["proposedLimits"].update(startPressCaps={"AHT-14":3}),
            lambda r:r["estimate"].update(starts=4), lambda r:r["approvedLimits"].update(startsCap=7),
            lambda r:r.update(coverageMode="full"), lambda r:r.update(sampleMode="breadth")]
        original=copy.deepcopy(self.f.request)
        for mutate in mutations:
            self.f.request=copy.deepcopy(original); mutate(self.f.request)
            self.f.env.update(bind_synthetic_files(self.f.root,self.f.request)); self.rejected()

    def test_missing_changed_or_unreadable_raw_inputs_refuse(self):
        for key in ("BP_REQUEST_FILE","BP_RECONCILIATION_FILE","BP_FACTS"):
            path=Path(self.f.env[key]); original=path.read_bytes()
            samples = (b"[]",b"null",b"true",b"1",b"\xff",b"{}")
            if key != "BP_FACTS": samples += (original+b" ",)
            for data in samples:
                with self.subTest(key=key,data=data[:8]):
                    path.write_bytes(data); self.rejected()
            path.write_bytes(original)
            self.f.env[key]=str(self.f.root/"missing"); self.rejected(); self.f.env[key]=str(path)

    def test_environment_substitution_and_press_extra_refuse_before_parsing(self):
        for key,value in (("BP_MODE","full"),("BP_RUNTIME","wrong"),("BP_SOURCE_SHA","a"*40),
            ("BP_T0","2021-01-01T00:00:00Z"),("BP_T1","2098-01-01T00:00:00Z"),("BP_CAMPAIGN","other"),
            ("BP_SELECT","14"),("BP_EST","13:100,13:100"),("BP_SELECT_REF","different"),
            ("BP_PRESS_EXTRA","13:3"),("BP_PRESS_EXTRA","not-even-a-map"),("BP_SKIP","13")):
            old=dict(self.f.env); self.f.env[key]=value; self.rejected(); self.f.env=old

    def test_bad_contract_and_missing_parser_under_isolated_python_refuse(self):
        root=self.f.root/"package"
        (root/"harness-adapter").mkdir(parents=True)
        shutil.copy2(BUILDER,root/"harness-adapter/build_plan.py")
        result=self.f.run(builder=root/"harness-adapter/build_plan.py")
        self.assertEqual(result.returncode,78); self.assertEqual(self.f.outputs(),{})
        packet=self.f.root/"packet"; shutil.copytree(self.f.env["BP_PACKET"],packet)
        self.f.env["BP_PACKET"]=str(packet)
        file=packet/"draft-adapters/contracts.json"
        for value in (None,[],[None],{"cases":[]}, {"cases":[{"caseId":"AHT-13","requiredStartPressCap":2}]}):
            file.write_text(json.dumps(value)); self.rejected()

    def test_emit_write_error_is_not_an_input_refusal(self):
        spec=importlib.util.spec_from_file_location("builder_under_test", BUILDER)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        verified=module.read_binding_inputs(self.f.env,["phase1"])
        private=self.f.root/"private";private.mkdir(mode=0o700);(private/"cases").write_text("write-stage-obstruction")
        with self.assertRaises(OSError):module.emit_verified_inputs(verified)

    def test_phase_two_invalid_fields_preserve_every_phase_one_file(self):
        self.assertEqual(self.f.run().returncode,0)
        original=dict(self.f.env)
        for key,value in (("BP_TASK_ID",""),("BP_T1","2020-01-02T00:00:00Z"),("BP_STIM",str(self.f.root/"missing"))):
            with self.subTest(key=key):
                self.f.env=dict(original);self.f.env[key]=value;self.rejected("phase2")
        self.f.env=original
        path=self.f.root/"private/cfg/phase1-index.json";raw=path.read_bytes()
        for value in (None,[],True,{"cases":[]}):
            path.write_text(json.dumps(value));self.rejected("phase2")
        path.write_bytes(raw)

    def test_protected_approval_and_reconciliation_nested_shapes(self):
        original=Path(self.f.env["BP_FACTS"]).read_bytes()
        facts=json.loads(original)
        for key in ("receipts","actionApproval","backend"):
            for value in (None,[],True,1,"PRIVATE-CANARY"):
                bad=copy.deepcopy(facts);bad[key]=value
                Path(self.f.env["BP_FACTS"]).write_text(json.dumps(bad));self.rejected()
        for key in ("requestSha256","reconciliationSha256","approvalRef","approvedBy","selectionApprovalRef"):
            bad=copy.deepcopy(facts);bad['actionApproval'][key]='different'
            Path(self.f.env["BP_FACTS"]).write_text(json.dumps(bad));self.rejected()
        Path(self.f.env["BP_FACTS"]).write_bytes(original)
        for key in ("starts","ceilings","requests","identityReads","takes"):
            for value in (None,[],True,1,"PRIVATE-CANARY"):
                rc=synthetic_reconciliation();rc[key]=value;self.f.repin(rc=rc);self.rejected()


class RegressionWitness(unittest.TestCase):
    """Run unchanged against the pinned parent builder and the corrected one."""
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='r5-witness-');self.addCleanup(self.temp.cleanup)
        self.f=SyntheticBuilder(self.temp.name)
        self.builder=Path(os.environ.get('R5_WITNESS_BUILDER',str(BUILDER)))

    def test_download_retry_start_all_three_are_funded(self):
        result=self.f.run(builder=self.builder)
        self.assertEqual(result.returncode,0,result.stderr)
        cfg=json.loads((self.f.root/'private/cases/AHT-13.json').read_text())
        self.assertEqual(cfg['startPressCap'],3)

    def test_changed_request_bytes_refuse_without_new_case_files(self):
        self.f.env['BP_REQUEST_SHA256']='0'*64
        result=self.f.run(builder=self.builder)
        self.assertEqual(result.returncode,78,result.stderr)
        self.assertEqual(self.f.outputs(),{})

    def test_invalid_receipts_container_is_closed_refusal(self):
        p=Path(self.f.env['BP_FACTS']);facts=json.loads(p.read_text());facts['receipts']=['PRIVATE-CANARY'];p.write_text(json.dumps(facts))
        result=self.f.run(builder=self.builder)
        self.assertEqual(result.returncode,78,result.stderr)
        self.assertNotIn('Traceback',result.stderr)
        self.assertEqual(self.f.outputs(),{})


if __name__ == "__main__":
    unittest.main()
