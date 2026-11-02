#!/usr/bin/env python3
"""Verifies that a completed run's original receipts are bound to its plan, case configs, drivers, media, approval record and evidence digests.
Usage: verify_run_binding.py --plan P --case-results C --approval A --code-manifest CODE.sha256 --packet-root DIR --cases-dir DIR [--case-config-dir DIR] [--plan-sha FILE] --out OUT.json
Offline; reads files only. Exit 0 only when every check passes."""
import os as _o, sys as _s
_s.path.insert(0, _o.path.dirname(_o.path.abspath(__file__)))
import _netguard  # noqa: F401  (offline control plane)
import argparse,hashlib,json,os,re,sys
def sha(p): return hashlib.sha256(open(p,'rb').read()).hexdigest()
a=argparse.ArgumentParser()
for k in ('plan','case-results','approval','code-manifest','packet-root','cases-dir','out'): a.add_argument('--'+k,required=True)
a.add_argument('--case-config-dir');a.add_argument('--supplement-cases-dir',action='append',default=[],help='extra directories holding evidence files missing from the export (same AHT-NN layout); bytes are still checked against evidenceDigests');a.add_argument('--plan-sha');a.add_argument('--label',default='run')
x=a.parse_args();checks=[]
def chk(i,d,ok,detail=''): checks.append({'id':i,'description':d,'result':'PASS' if ok else 'FAIL','detail':str(detail)[:200]})
plan=json.load(open(x.plan));cr=json.load(open(x.case_results));ap=json.load(open(x.approval))
psha=sha(x.plan)
if x.plan_sha: chk('plan-sha','plan.sha equals sha256 of the plan',open(x.plan_sha).read().strip()==psha,psha)
chk('code-manifest','approval reviewedCodeManifestSha256 equals the packet CODE.sha256',ap.get('reviewedCodeManifestSha256')==sha(x.code_manifest),sha(x.code_manifest))
bad=[]
for line in open(x.code_manifest):
    h,p=line.rstrip('\n').split('  ',1)
    f=os.path.join(os.path.dirname(x.code_manifest),p)
    if not os.path.exists(f) or sha(f)!=h: bad.append(p)
chk('code-files','every file in CODE.sha256 still has its recorded bytes',not bad,','.join(bad[:4]))
def nonblank(value): return isinstance(value,str) and bool(value.strip())
def git_sha(value): return isinstance(value,str) and re.fullmatch(r'[0-9a-f]{40}',value) is not None
campaign_bound = nonblank(plan.get('campaignId')) and nonblank(cr.get('campaignId')) and plan['campaignId'] == cr['campaignId']
source_bound = git_sha(plan.get('sourceSha')) and git_sha(cr.get('sourceSha')) and plan['sourceSha'] == cr['sourceSha']
served_bound = git_sha(plan.get('servedSha')) and git_sha(cr.get('servedSha')) and plan['servedSha'] == cr['servedSha']
chk('campaign','campaign id and source/served SHA match the plan',campaign_bound and source_bound and served_bound,
    f"campaign={campaign_bound} source={source_bound} served={served_bound}")
rows={c['id']:c for c in plan['cases']}
res={c['caseId']:c for c in cr['cases']}
for cid,row in sorted(rows.items()):
    d=os.path.join(x.cases_dir,cid)
    if not os.path.isdir(d):
        outcome=res.get(cid,{})
        receipt_present='executionReceipt' in outcome and outcome.get('executionReceipt') is not None
        requests_used=outcome.get('requestsUsed')
        zero_requests=requests_used is None or (type(requests_used) is int and requests_used==0)
        flag_names=('notSelected','gateBlocked','requestBudgetSkipped')
        flag_types_valid=all(name not in outcome or type(outcome[name]) is bool for name in flag_names)
        explicitly_prestart=flag_types_valid and any(outcome.get(name) is True for name in flag_names)
        execution_marker_valid=('executionInvalid' not in outcome or outcome.get('executionInvalid') is False) and type(outcome.get('executionInvalid',False)) is bool
        assertions=outcome.get('assertions')
        assertions_valid=assertions is None or (isinstance(assertions,list) and not any(isinstance(row,dict) and row.get('result') in ('PASS','FAIL') for row in assertions))
        undispatched=outcome.get('result')=='NOT RUN' and not receipt_present and zero_requests and explicitly_prestart and execution_marker_valid and assertions_valid
        chk('case.'+cid+'.dir','case receipt directory present or an explicit pre-start state proves the case was not dispatched',undispatched,'no directory')
        continue
    drv=row['driverFile']
    chk('case.'+cid+'.driver','driverSha256 equals the driver bytes in the packet',os.path.exists(drv) and sha(drv)==row['driverSha256'] or (x.packet_root and os.path.exists(os.path.join(x.packet_root,'draft-adapters',cid+'.cjs')) and sha(os.path.join(x.packet_root,'draft-adapters',cid+'.cjs'))==row['driverSha256']),row['driverSha256'][:16])
    cfgp=row['configFile'] if os.path.exists(row['configFile']) else (os.path.join(x.case_config_dir,cid+'.json') if x.case_config_dir else None)
    chk('case.'+cid+'.config','configSha256 equals the case config bytes',bool(cfgp) and os.path.exists(cfgp) and sha(cfgp)==row['configSha256'],row['configSha256'][:16])
    if row.get('mediaFile'): chk('case.'+cid+'.media','mediaSha256 equals the media bytes',os.path.exists(row['mediaFile']) and sha(row['mediaFile'])==row['mediaSha256'],row['mediaSha256'][:16])
    r=json.load(open(os.path.join(d,'case-result.json')))
    receipt_case_bound = r.get('caseId') == cid
    receipt_source_bound = git_sha(r.get('sourceSha')) and r['sourceSha'] == plan['sourceSha']
    receipt_served_bound = git_sha(r.get('servedSha')) and r['servedSha'] == plan['servedSha']
    chk('case.'+cid+'.identity','case receipt binds exact caseId and planned source/served SHAs',receipt_case_bound and receipt_source_bound and receipt_served_bound,
        f"case={receipt_case_bound} source={receipt_source_bound} served={receipt_served_bound}")
    chk('case.'+cid+'.evidence','every evidenceDigests entry matches the evidence file bytes ('+str(len(r.get('evidenceDigests',{})))+')',all(any(os.path.exists(os.path.join(b,k)) and sha(os.path.join(b,k))==v for b in [d]+[os.path.join(sd,cid) for sd in x.supplement_cases_dir]) for k,v in r.get('evidenceDigests',{}).items()))
    s=res.get(cid,{}).get('executionReceipt',{})
    if s and s.get('summarySha256'): chk('case.'+cid+'.summary','campaign summarySha256 equals summary.json',sha(os.path.join(d,'summary.json'))==s['summarySha256'])
out={'schema':'speaksharp.cloud-test.binding-verification.v1','label':x.label,'planSha256':psha,'caseResultsSha256':sha(x.case_results),'codeManifestSha256':sha(x.code_manifest),'checks':checks,'passed':sum(c['result']=='PASS' for c in checks),'failed':sum(c['result']=='FAIL' for c in checks)}
json.dump(out,open(x.out,'w'),indent=1);print(x.label,out['passed'],'PASS',out['failed'],'FAIL');sys.exit(0 if not out['failed'] else 1)
