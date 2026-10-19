"""Run unchanged prepared tests against isolated current-main receiving and negative-control trees."""
import pathlib,subprocess,json,shutil,hashlib,sys
REPO=pathlib.Path.cwd();HERE=pathlib.Path(__file__).resolve().parent
base=REPO/'artifacts/pm-mvp-closeout-main-c9';copy=REPO/'artifacts/pm-mvp-receiving-97638983';parity=REPO/'artifacts/pm-mvp-receiving-b6fa965e'
baseline=REPO/'artifacts/pm-mvp-baseline-1254';shutil.copytree(base,baseline,symlinks=True,dirs_exist_ok=True,ignore=shutil.ignore_patterns('node_modules')); (baseline/'node_modules').symlink_to((base/'node_modules').resolve(),target_is_directory=True) if not (baseline/'node_modules').exists() else None
copyTests=['frontend/src/services/progress/__tests__/loadSessionProgress.test.ts','frontend/src/services/progress/__tests__/progressPresentation.test.ts']
for p in copyTests:shutil.copyfile(copy/p,baseline/p)
parityTests=['frontend/src/lib/__tests__/analyticsUtils.test.ts','frontend/src/lib/__tests__/analyticsEvidenceValidity.test.ts','tests/db/analytics-summary-rpc.integration.test.ts']
mixed=REPO/'artifacts/pm-mvp-mixed-rpc-1472';shutil.copytree(parity,mixed,symlinks=True,dirs_exist_ok=True,ignore=shutil.ignore_patterns('node_modules')); (mixed/'node_modules').symlink_to((parity/'node_modules').resolve(),target_is_directory=True) if not (mixed/'node_modules').exists() else None
# Deliberately substitute the old RPC body at the NEW test migration input to demonstrate
# the frontend-new/server-old rollout. Both SQL bodies are verbatim existing source.
shutil.copyfile(base/'backend/supabase/migrations/20260817140000_repoint_analytics_summary_flat_1306.sql',mixed/'backend/supabase/migrations/20261018090000_analytics_summary_observed_filler_rate_1472.sql')
out=[]
for name,root,tests,expected in [('1254-received-on-main',copy,copyTests,0),('1254-current-main-negative',baseline,copyTests,1),('1472-client-rpc-received-on-main',parity,parityTests,0),('1472-new-client-old-rpc-negative',mixed,['tests/db/analytics-summary-rpc.integration.test.ts'],1)]:
 report=root/'artifacts'/('pm-'+name+'.json');report.parent.mkdir(exist_ok=True)
 args=['node','node_modules/vitest/vitest.mjs','run','--config','frontend/vitest.config.mjs','--coverage.enabled=false','--maxWorkers=1','--reporter=json','--outputFile',str(report),*tests]
 p=subprocess.run(args,cwd=root,text=True,capture_output=True,timeout=180)
 if not report.exists():
  out.append({'name':name,'exit':p.returncode,'error':p.stderr.replace(str(REPO),'<repository>'),'stdout':p.stdout.replace(str(REPO),'<repository>')});continue
 j=json.loads(report.read_text());r={'name':name,'argv':[x.replace(str(REPO),'<repository>') for x in args],'exit':p.returncode,'expectedExit':expected,'total':j['numTotalTests'],'passed':j['numPassedTests'],'failed':j['numFailedTests'],'rawReportSha256':hashlib.sha256(report.read_bytes()).hexdigest(),'files':[{'path':f['name'].split('/frontend/',1)[-1] if '/frontend/' in f['name'] else f['name'].split('/tests/',1)[-1],'status':f['status'],'assertions':[{'name':a['fullName'],'status':a['status'],'failure':[s.split('\n    at ')[0].replace(str(REPO),'<repository>') for s in a.get('failureMessages',[])]} for a in f['assertionResults']]} for f in j['testResults']]}
 out.append(r);(HERE/'executed-controls.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({k:r[k] for k in ['name','exit','total','passed','failed']}),flush=True)
assert len(out)==4 and all(r.get('exit')==r.get('expectedExit') and r.get('total',0)>0 for r in out), 'Unexpected execution; inspect actual output, do not relabel it'
