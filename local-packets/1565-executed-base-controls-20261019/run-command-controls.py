"""Invoke the unmodified accepted CLI, never a replacement evaluator."""
import pathlib, shutil, subprocess, json, hashlib, sys
HERE=pathlib.Path(__file__).resolve().parent
def verify_report(case, status, report):
 expectedExit=2 if case=='identical' else 1
 assert status==expectedExit, 'unexpected_exit'
 assert isinstance(report,dict), 'report_required'
 assert report.get('schemaVersion')==1 and report.get('lane')=='model_only_corpus', 'report_schema'
 assert report.get('productPath')=='NOT_RUN', 'product_scope'
 assert report.get('pairedEvidence',{}).get('status')=='COMPLETE', 'paired_status'
 assert report['pairedEvidence'].get('expectedRows')==6 and report['pairedEvidence'].get('validatedPairs')==6, 'six_pairs_required'
 assert all(len(report.get(a,{}).get('results',[]))==6 for a in ['baseline','candidate']), 'rows_required'
 expectedVerdict='HOLD' if case=='identical' else 'FAIL'
 assert report.get('acceptance',{}).get('verdict')==expectedVerdict, 'acceptance_verdict'
 assert report.get('comparison',{}).get('verdict')==('HOLD' if case=='identical' else 'FAIL'), 'comparison_verdict'
 reasons=report['acceptance'].get('reasons',[])
 if case=='identical':
  assert 'product_path_and_required_metrics_not_run' in reasons, 'hold_reason'
  assert not report.get('inputFailures'), 'clean_control'
  assert all(r.get('transcript')=='hello world' and not r.get('error') for a in ['baseline','candidate'] for r in report[a]['results']), 'identical_output'
 elif case=='decode-and-dispose-failure':
  assert all(r.get('transcript') is None and 'offline_decode_failure' in r.get('error','') for r in report['candidate']['results']), 'decode_failure_required'
  assert any('candidate_dispose:' in x and 'offline_dispose_failure' in x for x in report.get('inputFailures',[])), 'disposal_failure_required'
 elif case=='wrong-backend':
  assert report['candidate'].get('observed',{}).get('backend')=='cpu' and report['candidate']['manifest']['backend']=='wasm', 'observed_backend_required'
  assert 'candidate_identity_mismatch_or_fallback' in reasons, 'backend_reason'
 elif case=='initialization-failure':
  assert report['candidate'].get('observed') is None, 'no_initialized_identity'
  assert all(r.get('error')=='adapter_initialization_failed' for r in report['candidate']['results']), 'init_rows_required'
  assert any('candidate_init:' in x and 'offline_init_failure' in x for x in report.get('inputFailures',[])), 'init_failure_required'

if sys.argv[1]=='--verify-retained':
 records=[]
 for case in ['identical','decode-and-dispose-failure','wrong-backend','initialization-failure']:
  report=json.loads((HERE/'reports'/('pm-1565-'+case+'.json')).read_text());status=2 if case=='identical' else 1
  verify_report(case,status,report);records.append({'case':case,'accepted':True})
  for name in ['no-report','wrong-verdict','missing-pair','wrong-cause']:
   r=json.loads(json.dumps(report))
   if name=='no-report':r=None
   elif name=='wrong-verdict':r['acceptance']['verdict']='PASS'
   elif name=='missing-pair':r['pairedEvidence']['validatedPairs']=5
   elif name=='wrong-cause':
    if case=='identical':r['inputFailures']=['unrelated failure']
    elif case=='decode-and-dispose-failure':r['inputFailures']=[]
    elif case=='wrong-backend':r['candidate']['observed']['backend']='wasm'
    else:r['inputFailures']=[]
   try:verify_report(case,status,r)
   except AssertionError as e:records.append({'case':case,'negative':name,'rejected':str(e)})
   else:raise AssertionError('False wrapper acceptance '+case+' '+name)
 (HERE/'wrapper-verification.json').write_text(json.dumps({'controls':records,'positiveReports':4,'negativeMutationsRejected':16},indent=2)+'\n')
 print(json.dumps({'positiveReports':4,'negativeMutationsRejected':16,'exit':0}));sys.exit(0)
SOURCE=pathlib.Path(sys.argv[1]).resolve()
DEST=SOURCE/'local-packets/pm-1565-controls'
shutil.copytree(HERE/'inputs',DEST/'inputs',dirs_exist_ok=True)
results=[]
for case,candidate in [('identical','candidate'),('decode-and-dispose-failure','decode-failure'),('wrong-backend','wrong-backend'),('initialization-failure','init-failure')]:
 out=SOURCE/'artifacts'/('pm-1565-'+case+'.json')
 if out.exists():raise SystemExit('Refusing to overwrite prior command report: '+out.name)
 args=['node','--import','tsx','scripts/model-evaluator/run.mts']
 for key,value in [('baseline','baseline'),('candidate',candidate),('corpus','corpus'),('device','device')]:
  args += ['--'+key,'local-packets/pm-1565-controls/inputs/'+value+'.json']
 args += ['--out','artifacts/'+out.name]
 proc=subprocess.run(args,cwd=SOURCE,text=True,capture_output=True,timeout=40)
 report=json.loads(out.read_text()) if out.exists() else None
 if report:
  (HERE/'reports').mkdir(exist_ok=True)
  shutil.copyfile(out,HERE/'reports'/out.name)
 expectedExit=2 if case=='identical' else 1
 verify_report(case,proc.returncode,report)
 results.append({'case':case,'argv':args,'exit':proc.returncode,'expectedExit':expectedExit,'report':('reports/'+out.name) if report else None,'reportSha256':hashlib.sha256(out.read_bytes()).hexdigest() if report else None,'stdout':proc.stdout.replace(str(SOURCE),'<isolated-source>'),'stderr':proc.stderr.replace(str(SOURCE),'<isolated-source>'),'acceptance':report.get('acceptance') if report else None,'pairedEvidence':report.get('pairedEvidence') if report else None,'productPath':report.get('productPath') if report else None})
 # Expected outcomes belong to the existing command's current contract.
 if proc.returncode!=expectedExit: print('Unexpected command outcome',case,file=sys.stderr)
(HERE/'command-results.json').write_text(json.dumps({'source':'6185f14cd05b2aa985aa539e8221282c2237e200','node':subprocess.check_output(['node','--version'],text=True).strip(),'cases':results},indent=2)+'\n')
print(json.dumps([{'case':r['case'],'exit':r['exit'],'verdict':(r['acceptance']or{}).get('verdict')} for r in results]))
sys.exit(0 if all(r['exit']==r['expectedExit'] for r in results) else 1)
