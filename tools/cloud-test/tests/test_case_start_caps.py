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
    if request.get("sampleMode") == "full" and any(type(row) is dict and row.get("case") == "AHT-10"
                                                     for row in request.get("selection", [])):
        # Declared synthetic planning data, never reused as current live facts.
        from test_case10_request_bound import projection
        record = {"schema": "speaksharp.cloud-test.case10-projection.v1", "runId": request["runId"],
                  "sourceSha": request["release"]["testedSha"],
                  "accountSubjectSha256": hashlib.sha256(b"00000000-0000-4000-8000-000000000001").hexdigest(),
                  "evidenceRef": "SYNTHETIC-NOT-A-RUN", "projection": projection()}
        facts.setdefault("case10RequestBound", record)
        encoded = json.dumps(facts["case10RequestBound"], sort_keys=True, separators=(",", ":")).encode()
        for row in request["selection"]:
            if type(row) is dict and row.get("case") == "AHT-10":
                row["requestBoundSha256"] = hashlib.sha256(encoded).hexdigest()
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
        account_bindings = self.root / "account-bindings.json"
        account_bindings.write_text(json.dumps({
            "schema": "speaksharp.cloud-test.live-account-bindings.v1",
            "projectRef": "yxlapjuovrsvjswkwnrk",
            "projectOrigin": "https://yxlapjuovrsvjswkwnrk.supabase.co",
            "sourceBundleSha256": "a" * 64,
            "campaignId": r["runId"],
            "roles": {
                "existing-disposable": {"accountId": "00000000-0000-4000-8000-000000000001",
                    "credentialVars": {"email": "THROWAWAY_TEST_EMAIL", "password": "THROWAWAY_TEST_PASSWORD"}},
                "maintained-read-only": {"accountId": "00000000-0000-4000-8000-000000000002",
                    "credentialVars": {"email": "FREE_TEST_EMAIL", "password": "FREE_TEST_PASSWORD"}},
            },
        })); account_bindings.chmod(0o600)
        browser = self.root / "synthetic-browser"
        browser.write_bytes(b"SYNTHETIC-NOT-A-BROWSER\n"); browser.chmod(0o700)
        browser_identity = self.root / "browser-identity.json"
        browser_identity.write_text(json.dumps({"schema": "speaksharp.cloud-test.existing-browser.v1",
            "path": str(browser), "observedBinarySha256": digest(browser)}))
        self.env = {"PATH": os.environ["PATH"], "HOME": str(self.root), "BP_PACKET": str(Path(ROOT) / "harness"),
                    "BP_CHECKOUT": REPO, "BP_PRIVATE": str(self.root / "private"),
                    "BP_ACCOUNT_BINDINGS_FILE": str(account_bindings), "BP_LIVE_ACCOUNTS_SHA256": "a" * 64,
                    "BP_BROWSER_IDENTITY": str(browser_identity),
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

    def test_case10_consumes_the_bound_projection_without_changing_the_allowance(self):
        self.f = SyntheticBuilder(self.temp.name, cases=(10,))
        result = self.f.run()
        self.assertEqual(result.returncode, 0, result.stderr)
        config = json.loads((self.f.root / "private/cases/AHT-10.json").read_text())
        self.assertEqual(config["requestBound"], {
            "projectionSha256": self.f.request["selection"][0]["requestBoundSha256"],
            "transmittedBound": 84,
            "allowance": 240,
            "evidenceRef": "SYNTHETIC-NOT-A-RUN",
        })

    def test_case10_phase_two_consumes_the_bound_allowance_as_the_runtime_ceiling(self):
        self.f = SyntheticBuilder(self.temp.name, cases=(10,))
        row = self.f.request["selection"][0]
        row["plannedRequests"] = 240
        self.f.request["estimate"]["requests"] = {
            "planned": 240, "cleanupReserve": 50, "pooledSlack": 110, "runCap": 400,
        }
        self.f.request["approvedLimits"]["runCapRequests"] = 400
        self.f.repin()
        phase1 = self.f.run()
        self.assertEqual(phase1.returncode, 0, phase1.stderr)
        phase2 = self.f.run("phase2")
        self.assertEqual(phase2.returncode, 0, phase2.stderr)
        plan = json.loads((self.f.root / "private/cfg/campaign-plan.json").read_text())
        config = json.loads((self.f.root / "private/cases/AHT-10.json").read_text())
        self.assertEqual(plan["requestBudget"]["estimates"]["AHT-10"], 240)
        self.assertEqual(plan["requestBudget"]["ceilings"]["AHT-10"], 240)
        self.assertEqual(plan["requestBudget"]["ceilings"]["AHT-10"], config["requestBound"]["allowance"])
        runtime = subprocess.run(["node", "-e", r"""
const fs=require('node:fs'),path=require('node:path');
const plan=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
const core=require(process.argv[2]),{Ledger}=require(process.argv[3]);
const file=path.join(process.argv[4],'campaign-ledger.json');
const ledger=new Ledger(file,{total:plan.requestBudget.runCap});let seen=null,r241=null;
const io={
 now:Date.now,save:async()=>{},verifyBudgetBinding:async()=>{},verifyRunIdentity:async()=>{},
 preflightCase:async()=>{},admit:async()=>({result:'ADMISSION PASS'}),
 identity:async()=>({result:'MATCH',servedSha:plan.servedSha}),
 ledgerUsed:()=>Ledger.readUsedTotal(file),caseConfig:async c=>JSON.parse(fs.readFileSync(c.configFile,'utf8')),
 runCase:async(_c,_p,_a,o)=>{seen=o.requestAllowance;ledger.setCaseAllowance(seen);
   for(let i=0;i<240;i++){const denied=ledger.tryReserve(['total']);if(denied)throw new Error('early denial '+denied);}
   r241=ledger.tryReserve(['total']);return{assertions:[],allowanceExhausted:r241==='case-allowance',allowanceCleanupVerified:true};}
};
core.runCampaign(plan,io,{executeR0:true}).then(result=>{
 const row=result.report.cases.find(c=>c.caseId==='AHT-10');
 console.log(JSON.stringify({seen,r241,rowAllowance:row.requestAllowance,requestsUsed:row.requestsUsed}));
}).finally(()=>ledger.release());
""", str(self.f.root / "private/cfg/campaign-plan.json"),
            str(Path(ROOT) / "harness/bundle/harness/campaign-core.cjs"),
            str(Path(ROOT) / "harness/bundle/harness/campaign-ledger.cjs"), str(self.f.root)],
            capture_output=True, text=True, timeout=120)
        self.assertEqual(runtime.returncode, 0, runtime.stderr)
        self.assertEqual(json.loads(runtime.stdout), {
            "seen": 240, "r241": "case-allowance", "rowAllowance": 240, "requestsUsed": 240,
        })

    def test_case10_changed_projection_refuses_phase_two_without_new_outputs(self):
        self.f = SyntheticBuilder(self.temp.name, cases=(10,))
        self.assertEqual(self.f.run().returncode, 0)
        facts_path = Path(self.f.env["BP_FACTS"])
        facts = json.loads(facts_path.read_text())
        facts["case10RequestBound"]["projection"]["bootstrap"] += 1
        facts_path.write_text(json.dumps(facts))
        self.rejected("phase2")

    def test_case10_missing_changed_or_over_allowance_projection_refuses_before_output(self):
        mutations = ("missing", "account", "digest", "over-allowance")
        for mutation in mutations:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory(prefix="r5-case10-control-") as root:
                self.f = SyntheticBuilder(root, cases=(10,))
                facts_path = Path(self.f.env["BP_FACTS"])
                facts = json.loads(facts_path.read_text())
                if mutation == "missing":
                    del facts["case10RequestBound"]
                    facts_path.write_text(json.dumps(facts))
                elif mutation == "account":
                    facts["case10RequestBound"]["accountSubjectSha256"] = "0" * 64
                    facts_path.write_text(json.dumps(facts))
                elif mutation == "digest":
                    facts["case10RequestBound"]["evidenceRef"] = "SYNTHETIC-CHANGED"
                    facts_path.write_text(json.dumps(facts))
                else:
                    facts["case10RequestBound"]["projection"]["bootstrap"] = 500
                    self.f.repin(facts=facts)
                self.rejected()

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
            "--request-sha256", self.f.env["BP_REQUEST_SHA256"], "--reconciliation", self.f.env["BP_RECONCILIATION_FILE"],
            "--out", str(output)], capture_output=True, text=True)
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
