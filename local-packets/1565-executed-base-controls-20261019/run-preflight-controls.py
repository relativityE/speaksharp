"""Real accepted command preflights and lifecycle trace; no evaluator behavior replaced."""
import pathlib, subprocess, json, sys, shutil, hashlib
HERE=pathlib.Path(__file__).resolve().parent;SOURCE=pathlib.Path(sys.argv[1]).resolve();DEST=SOURCE/'local-packets/pm-1565-controls'
records=[]
def run(name,manifests):
 folder=DEST/name;folder.mkdir(exist_ok=True);shutil.copyfile(HERE/'inputs/control.wav',folder/'control.wav')
 args=['node','--import','tsx','scripts/model-evaluator/run.mts']
 for k,v in manifests.items():
  p=folder/(k+'.json');p.write_text(json.dumps(v)+'\n');args+=['--'+k,str(p.relative_to(SOURCE))]
 out=SOURCE/'artifacts'/('preflight-'+name+'.json');args+=['--out',str(out.relative_to(SOURCE))]
 if out.exists():raise SystemExit('Refusing overwrite '+out.name)
 r=subprocess.run(args,cwd=SOURCE,text=True,capture_output=True,timeout=30)
 rec={'name':name,'argv':args,'exit':r.returncode,'stdout':r.stdout.replace(str(SOURCE),'<isolated-source>'),'stderr':r.stderr.replace(str(SOURCE),'<isolated-source>'),'reportWritten':out.exists()}
 if out.exists():
  report=json.loads(out.read_text());rec['acceptance']=report['acceptance'];rec['sha256']=hashlib.sha256(out.read_bytes()).hexdigest()
 records.append(rec)
base={k:json.loads((HERE/'inputs'/v).read_text()) for k,v in [('baseline','baseline.json'),('candidate','candidate.json'),('corpus','corpus.json'),('device','device.json')]}
for name in ['wrong-wav','wrong-pcm','wrong-device','wrong-schema']:
 m=json.loads(json.dumps(base))
 if name=='wrong-wav':m['corpus']['clips'][0]['wavSha256']='0'*64
 if name=='wrong-pcm':m['corpus']['clips'][0]['sha256']='0'*64
 if name=='wrong-device':m['device']['backend']='cpu'
 if name=='wrong-schema':m['candidate']['version']=9
 run(name,m)
shutil.copyfile(HERE/'trace-adapter.ts',DEST/'trace-adapter.ts')
m=json.loads(json.dumps(base))
for arm in ['baseline','candidate']:
 m[arm]['adapterModule']='./local-packets/pm-1565-controls/trace-adapter.ts';m[arm]['adapterOptions']={'arm':arm}
run('trace',m)
trace=[json.loads(s) for s in (SOURCE/'artifacts/pm-1565-adapter-trace.jsonl').read_text().splitlines()]
assert [r['phase'] for r in trace[:2]]==['initialized','initialized']
assert all(len(r['logicalResident'])==2 for r in trace if r['phase']=='decode')
assert all(r['exit']==1 and not r['reportWritten'] for r in records[:4])
assert records[-1]['exit']==2 and records[-1]['acceptance']['verdict']=='HOLD'
(HERE/'preflight-and-trace-results.json').write_text(json.dumps({'source':'6185f14cd05b2aa985aa539e8221282c2237e200','cases':records,'trace':trace,'meaning':'Logical adapter lifetime, not physical device memory or real one-arm cold/warm evidence'},indent=2)+'\n')
print(json.dumps({'preflightRejections':4,'traceExit':records[-1]['exit'],'decodeEventsWithBothLogicalArms':sum(r['phase']=='decode' for r in trace)}))
