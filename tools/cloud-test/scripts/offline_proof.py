#!/usr/bin/env python3
"""Executed-offline-proof index. Maps each harness correction to the executed tests (from TAP files) and mutation controls that prove it.
Fail-closed (Sam 1793378783/1793379188): every input is required; the manifest must be the checkout's own verified harness; every
correction needs its executed tests and each of its listed mutation controls; plan controls gate; any failed, skipped, duplicate or
conflicting TAP title fails the proof. A PASS is only ever the absence of every refusal below.
Usage: offline_proof.py --tap FILE [--tap FILE ...] --mutations neg-controls.json --plan-controls plan-controls.json
                        --code-manifest-sha256 HEX [--config test-config.v1.json] --out proof.json"""
import os as _o, sys as _s
import argparse,json,re,sys
HERE=_o.path.dirname(_o.path.abspath(__file__))
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
# The reviewed plan-control inventory (Sam 1793384532): exactly these 3 positive and 11 negative checks, each with its intended outcome,
# as both reviewed harness versions produced it. A setup error, missing file or reworded refusal is never a passing negative.
PLAN_CONTROLS={
    "positive: run identity": "ACCEPTED",
    "positive: stimulus preflight": "ACCEPTED",
    "positive: every selected case preflight": "ACCEPTED",
    "negative: AHT-12 ungranted request was not denied": "REFUSED: BLOCKED_SETUP: stimulus preflight not proven: AHT-12: an ungranted request was not denied with NotAllowedError",
    "negative: AHT-04 capture device not acquired": "REFUSED: BLOCKED_SETUP: stimulus preflight not proven: AHT-04: capture device not acquired with the bound media",
    "negative: AHT-13 media hash differs from the plan": "REFUSED: BLOCKED_SETUP: stimulus preflight not proven: AHT-13: no receipt entry for the bound media",
    "negative: AHT-03 real fixture misaligned": "REFUSED: BLOCKED_SETUP: stimulus preflight not proven: AHT-03: the real fixture is not aligned with its reviewed point windows",
    "negative: AHT-14 entry missing": "REFUSED: BLOCKED_SETUP: stimulus preflight not proven: AHT-14: no receipt entry for the bound media",
    "negative: receipt older than 12 hours": "REFUSED: BLOCKED_SETUP: stimulus preflight not proven: stimulus receipt is stale or from the future",
    "negative: receipt from a different runner code manifest": "REFUSED: BLOCKED_SETUP: stimulus preflight not proven: stimulus receipt was produced by a different runner code manifest",
    "negative: receipt records product traffic": "REFUSED: BLOCKED_SETUP: stimulus preflight not proven: stimulus receipt must record zero product traffic",
    "negative: tampered receipt bytes (sha mismatch)": "REFUSED: BLOCKED_SETUP: bound input bytes changed",
    "negative: runner code manifest in the identity differs": "REFUSED: BLOCKED_SETUP: runIdentity.runner.codeManifestSha256 differs from the runner bundle CODE.sha256 actually loaded",
    "negative: AHT-12 plan entry without media": "REFUSED: BLOCKED_SETUP: AHT-12 presses Start and requires a bound capture device (plan mediaFile/mediaSha256); media-less launch refused",
}
TAP_LINE=re.compile(r'^(not )?ok \d+ - (.*?)(?:\s+#\s*(SKIP|TODO)\b.*)?$',re.I)
SHA256=re.compile(r'^[0-9a-f]{64}$')
NOT_OK=re.compile(r'^\s*not ok\b')
BAIL_OUT=re.compile(r'^\s*Bail out!')

def stream_failures(files):
    """Failures and bail-outs counted from the raw stream, independently of title extraction (Sam 1793380213): an untitled,
    nested or otherwise unparsed 'not ok', and any 'Bail out!', fail the proof."""
    out={'notOk':0,'bailOuts':0}
    for f in files:
        with open(f) as fh:
            for l in fh:
                out['notOk']+=bool(NOT_OK.match(l))
                out['bailOuts']+=bool(BAIL_OUT.match(l))
    return out

def tap(files):
    """Every occurrence is kept: a title passes only if each occurrence is a plain ok; SKIP/TODO is never a pass."""
    seen={}
    for f in files:
        with open(f) as fh:
            for l in fh:
                m=TAP_LINE.match(l.rstrip('\n'))
                if m: seen.setdefault(m.group(2).strip(),[]).append('SKIP' if m.group(3) else 'FAIL' if m.group(1) else 'PASS')
    results={t:('PASS' if set(v)=={'PASS'} else 'SKIP' if set(v)=={'SKIP'} else 'FAIL') for t,v in seen.items()}
    conflicting=sorted(t for t,v in seen.items() if len(set(v))>1)
    duplicated=sorted(t for t,v in seen.items() if len(v)>1)
    return results,conflicting,duplicated

def build(results,conflicting,duplicated,mut,pc,manifest,stream=None):
    rows=[];ok=True;refusals=[]
    for cid,title,pats,ms in CORR:
        tests=[]
        for p in pats:
            hit=[(t,r) for t,r in results.items() if re.search(p,t)]
            if not hit: tests.append({'pattern':p,'title':None,'result':'MISSING'})
            for t,r in hit: tests.append({'title':t[:160],'result':r})
        # type() is int, not isinstance(): JSON true/false are bools, never a count of failing tests.
        muts=[{'control':k,'caught':isinstance(v,dict) and type(v.get('fail')) is int and v['fail']>0,'failingTests':v.get('fail') if isinstance(v,dict) else None}
              for k,v in mut.items() if any(k.startswith(m+'-') for m in ms)]
        missing=[m for m in ms if not any(x['control'].startswith(m+'-') for x in muts)]
        good=bool(tests) and all(t['result']=='PASS' for t in tests) and not missing and all(m['caught'] for m in muts)
        ok&=good
        rows.append({'id':cid,'correction':title,'tests':tests,'mutationControls':muts,'missingControls':missing,'result':'PASS' if good else 'FAIL'})
    pc=pc if isinstance(pc,dict) else {}
    pos=[k for k in pc if k.startswith('positive')];neg=[k for k in pc if k.startswith('negative')]
    mismatched=sorted(k for k in set(pc)|set(PLAN_CONTROLS) if pc.get(k)!=PLAN_CONTROLS.get(k))
    plan={'positiveAccepted':sum(1 for k in pos if pc[k]=='ACCEPTED'),'positive':len(pos),'negativeRefused':sum(1 for k in neg if str(pc[k]).startswith('REFUSED')),'negative':len(neg),
          'mismatched':mismatched}
    if mismatched: refusals.append('plan controls differ from the reviewed inventory or intended outcomes: %d' % len(mismatched))
    failed=sorted(t for t,r in results.items() if r!='PASS')
    if failed: refusals.append('TAP titles not passed: %d' % len(failed))
    if conflicting: refusals.append('conflicting TAP titles: %d' % len(conflicting))
    if duplicated: refusals.append('duplicated TAP titles: %d' % len(duplicated))
    if stream is None: refusals.append('TAP stream not scanned for failures and bail-outs')
    else:
        if stream.get('notOk'): refusals.append('TAP not-ok lines: %d' % stream['notOk'])
        if stream.get('bailOuts'): refusals.append('TAP bail-outs: %d' % stream['bailOuts'])
    if not isinstance(manifest,str) or not SHA256.match(manifest): refusals.append('code manifest is not a sha256')
    ok=ok and not refusals
    return {'schema':'speaksharp.offline-proof.v1','corrections':rows,'distinctTestTitlesPassed':sum(1 for v in results.values() if v=='PASS'),
            'distinctTestTitlesFailed':sum(1 for v in results.values() if v=='FAIL'),'distinctTestTitlesSkipped':sum(1 for v in results.values() if v=='SKIP'),
            'conflictingTitles':conflicting,'duplicatedTitles':duplicated,'planControls':plan,'refusals':refusals,'codeManifestSha256':manifest,'result':'PASS' if ok else 'FAIL'}

def harness_provenance(manifest,config):
    """The manifest must be the checkout's own harness, verified byte-identical against the approved config."""
    _s.path.insert(0,HERE)
    import verify_harness as VH
    from _common import load
    cfg=load(config)
    errs,_=VH.check(cfg,_o.path.abspath(_o.path.join(HERE,'..','..','..')))
    if errs: return 'harness does not verify against the config: %s' % errs[0]
    if cfg['harness']['expectedCodeManifestSha256']!=manifest: return 'requested manifest is not the pinned, verified harness'
    return None

def main():
    _s.path.insert(0,HERE)
    import _netguard  # noqa: F401  (offline control plane; executable path only, so importing build() stays pure)
    a=argparse.ArgumentParser();a.add_argument('--tap',action='append',required=True);a.add_argument('--mutations',required=True);a.add_argument('--plan-controls',required=True)
    a.add_argument('--code-manifest-sha256',required=True);a.add_argument('--config',default=_o.path.join(HERE,'..','config','test-config.v1.json'));a.add_argument('--out',required=True);x=a.parse_args()
    results,conflicting,duplicated=tap(x.tap)
    with open(x.mutations) as fm, open(x.plan_controls) as fp:
        mut,pc=json.load(fm),json.load(fp)
    doc=build(results,conflicting,duplicated,mut,pc,x.code_manifest_sha256,stream=stream_failures(x.tap))
    problem=harness_provenance(x.code_manifest_sha256,x.config) if SHA256.match(x.code_manifest_sha256) else None
    if problem:
        doc['refusals'].append(problem);doc['result']='FAIL'
    doc['tapFiles']=x.tap
    with open(x.out,'w') as fo:
        json.dump(doc,fo,indent=1)
    print(doc['result'],len(doc['corrections']),'corrections;',doc['distinctTestTitlesPassed'],'distinct test titles passed,',doc['distinctTestTitlesFailed'],'failed;',doc['planControls'],*doc['refusals'],sep=' ')
    return 0 if doc['result']=='PASS' else 1

if __name__=='__main__':
    sys.exit(main())
