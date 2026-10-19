"""Run unchanged prepared tests against isolated current-main receiving and negative-control trees."""
import pathlib,subprocess,json,shutil,hashlib,sys,time
from report_gate import validate_report,require_fresh_report
REPO=pathlib.Path.cwd();HERE=pathlib.Path(__file__).resolve().parent
base=REPO/'artifacts/pm-mvp-closeout-main-c9';copy=REPO/'artifacts/pm-mvp-receiving-97638983';parity=REPO/'artifacts/pm-mvp-receiving-b6fa965e'
# Restore/verify the exact old receiving pin before replay; current ee9 evidence is separate.
for key,root in [('97638983',copy),('b6fa965e',parity)]:
 for row in json.loads((HERE/'prepared-main-blobs.json').read_text())[key]:
  data=(REPO/'artifacts/pm-mvp-prepared'/key/row['path']).read_bytes()
  if hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()!=row['preparedBlob']:raise ValueError('Input blob mismatch')
  target=root/row['path'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
baseline=REPO/'artifacts/pm-mvp-baseline-1254';shutil.copytree(base,baseline,symlinks=True,dirs_exist_ok=True,ignore=shutil.ignore_patterns('node_modules')); (baseline/'node_modules').symlink_to((base/'node_modules').resolve(),target_is_directory=True) if not (baseline/'node_modules').exists() else None
copyTests=['frontend/src/services/progress/__tests__/loadSessionProgress.test.ts','frontend/src/services/progress/__tests__/progressPresentation.test.ts']
for p in copyTests:shutil.copyfile(copy/p,baseline/p)
parityTests=['frontend/src/lib/__tests__/analyticsUtils.test.ts','frontend/src/lib/__tests__/analyticsEvidenceValidity.test.ts','tests/db/analytics-summary-rpc.integration.test.ts']
mixed=REPO/'artifacts/pm-mvp-mixed-rpc-1472';shutil.copytree(parity,mixed,symlinks=True,dirs_exist_ok=True,ignore=shutil.ignore_patterns('node_modules')); (mixed/'node_modules').symlink_to((parity/'node_modules').resolve(),target_is_directory=True) if not (mixed/'node_modules').exists() else None
# Deliberately substitute the old RPC body at the NEW test migration input to demonstrate
# the frontend-new/server-old rollout. Both SQL bodies are verbatim existing source.
shutil.copyfile(base/'backend/supabase/migrations/20260817140000_repoint_analytics_summary_flat_1306.sql',mixed/'backend/supabase/migrations/20261018090000_analytics_summary_observed_filler_rate_1472.sql')
out=[]
manifest=json.loads((HERE/'expected-control-assertions.json').read_text())
for name,root,tests,expected in [('1254-received-on-main',copy,copyTests,0),('1254-current-main-negative',baseline,copyTests,1),('1472-client-rpc-received-on-main',parity,parityTests,0),('1472-new-client-old-rpc-negative',mixed,['tests/db/analytics-summary-rpc.integration.test.ts'],1)]:
 report=root/'artifacts'/('pm-'+name+'.json');report.parent.mkdir(exist_ok=True)
 report.unlink(missing_ok=True)  # Previous accepted output cannot satisfy this run.
 started_ns=time.time_ns()
 args=['node','node_modules/vitest/vitest.mjs','run','--config','frontend/vitest.config.mjs','--coverage.enabled=false','--maxWorkers=1','--reporter=json','--outputFile',str(report),*tests]
 p=subprocess.run(args,cwd=root,text=True,capture_output=True,timeout=180)
 if not report.exists():
  out.append({'name':name,'exit':p.returncode,'error':p.stderr.replace(str(REPO),'<repository>'),'stdout':p.stdout.replace(str(REPO),'<repository>')});continue
 raw=require_fresh_report(report,started_ns)
 j=json.loads(raw);validate_report(j,manifest[name],p.returncode)
 r={'name':name,'argv':[x.replace(str(REPO),'<repository>') for x in args],'exit':p.returncode,'expectedExit':expected,'total':j['numTotalTests'],'passed':j['numPassedTests'],'failed':j['numFailedTests'],'rawReportSha256':hashlib.sha256(report.read_bytes()).hexdigest(),'files':[{'path':f['name'].split('/frontend/',1)[-1] if '/frontend/' in f['name'] else f['name'].split('/tests/',1)[-1],'status':f['status'],'assertions':[{'name':a['fullName'],'status':a['status'],'failure':[s.split('\n    at ')[0].replace(str(REPO),'<repository>') for s in a.get('failureMessages',[])]} for a in f['assertionResults']]} for f in j['testResults']]}
 out.append(r);(HERE/'executed-controls.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({k:r[k] for k in ['name','exit','total','passed','failed']}),flush=True)
assert len(out)==4 and all(r.get('exit')==manifest[r['name']]['expectedExit'] and r.get('total')==len(manifest[r['name']]['assertions']) for r in out), 'Unexpected execution; inspect actual output, do not relabel it'
