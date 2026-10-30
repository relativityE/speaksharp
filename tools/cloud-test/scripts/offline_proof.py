#!/usr/bin/env python3
"""Executed-offline-proof index. Maps each harness correction to the executed tests (from TAP files) and mutation controls that prove it.
Usage: offline_proof.py --tap FILE [--tap FILE ...] --mutations neg-controls.json --plan-controls plan-controls.json --out proof.json"""
import os as _o, sys as _s
_s.path.insert(0, _o.path.dirname(_o.path.abspath(__file__)))
import _netguard  # noqa: F401  (offline control plane)
import argparse,json,re,sys
CORR=[
 ('diagnostic-codes','Strict diagnostic-code allowlist',[r'^D1 error codes come from a CLOSED allowlist'],['M01']),
 ('duplicate-markers','Duplicate-marker detection',[r'^F1 a duplicate marker',r'^F4 the live sampler counts markers per sample'],['M02','M03']),
 ('contradictory-observations','Contradictory-state handling',[r'^F2 a status that goes backwards',r'^F3 a real marker defect is never hidden'],['M04']),
 ('request-latency','Honest request latency',[r'^D2 latency is honest',r'^D3 through the real driver'],['M05']),
 ('failure-path-evidence','Evidence saved when later actions fail',[r'^E1 Stop fails after the live window',r'^E2 static: the live window is recorded exactly once'],['M06']),
 ('effective-speech-stimulus','Effective speech stimulus on the real fixtures',[r'^M1 real fixtures',r'^R1 real WAVs through real Chrome',r'^R2 negative control: the r14 window-only mask',r'^R3 refusals stay refusals on real media',r'^P1 a complete receipt passes'],['M10']),
 ('selected-case-execution','Selected-case execution, gates and identity cap',[r'^S1 selection validation',r'^S2 identity cap scales',r'^S3 a selected run dispatches only the selected cases',r'^S4 stimulus gates',r'^S5 gates chain',r'^S6 request budget with a selection'],['M07','M08','M11']),
 ('run-identity-binding','Run identity binding',[r'^I1 run identity',r'^I2 the report carries the run identity',r'^I3 the runner refuses a run whose loaded runner code differs'],['M09']),
 ('outcome-classes','Outcome classes and cleanup receipts',[r'^O1 outcome classes separate'],[]),
]
def tap(files):
    out={}
    for f in files:
        for l in open(f):
            m=re.match(r'^(not )?ok \d+ - (.*)$',l.rstrip('\n'))
            if m: out[m.group(2).strip()]=('FAIL' if m.group(1) else 'PASS')
    return out
a=argparse.ArgumentParser();a.add_argument('--tap',action='append',required=True);a.add_argument('--mutations');a.add_argument('--plan-controls');a.add_argument('--code-manifest-sha256');a.add_argument('--out',required=True);x=a.parse_args()
results=tap(x.tap);mut=json.load(open(x.mutations)) if x.mutations else {};pc=json.load(open(x.plan_controls)) if x.plan_controls else {}
rows=[];ok=True
for cid,title,pats,ms in CORR:
    tests=[]
    for p in pats:
        hit=[(t,r) for t,r in results.items() if re.search(p,t)]
        if not hit: tests.append({'pattern':p,'title':None,'result':'MISSING'})
        for t,r in hit: tests.append({'title':t[:160],'result':r})
    muts=[{'control':k,'caught':v['fail']>0,'failingTests':v['fail']} for k,v in mut.items() if any(k.startswith(m+'-') for m in ms)]
    good=all(t['result']=='PASS' for t in tests) and all(m['caught'] for m in muts) and bool(tests)
    ok&=good
    rows.append({'id':cid,'correction':title,'tests':tests,'mutationControls':muts,'result':'PASS' if good else 'FAIL'})
pos=[k for k in pc if k.startswith('positive')];neg=[k for k in pc if k.startswith('negative')]
doc={'schema':'speaksharp.offline-proof.v1','corrections':rows,'tapFiles':x.tap,'distinctTestTitlesPassed':sum(1 for v in results.values() if v=='PASS'),'distinctTestTitlesFailed':sum(1 for v in results.values() if v=='FAIL'),
 'planControls':{'positiveAccepted':sum(1 for k in pos if pc[k]=='ACCEPTED'),'positive':len(pos),'negativeRefused':sum(1 for k in neg if str(pc[k]).startswith('REFUSED')),'negative':len(neg)},'result':'PASS' if ok else 'FAIL'}
doc['codeManifestSha256']=x.code_manifest_sha256
json.dump(doc,open(x.out,'w'),indent=1)
print(doc['result'],len(rows),'corrections;',doc['distinctTestTitlesPassed'],'distinct test titles passed,',doc['distinctTestTitlesFailed'],'failed;',doc['planControls'])
sys.exit(0 if ok else 1)
