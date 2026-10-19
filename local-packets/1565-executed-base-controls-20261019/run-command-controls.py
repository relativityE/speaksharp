"""Invoke the unmodified accepted CLI, never a replacement evaluator."""
import pathlib, shutil, subprocess, json, hashlib, sys
HERE=pathlib.Path(__file__).resolve().parent
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
 results.append({'case':case,'argv':args,'exit':proc.returncode,'expectedExit':expectedExit,'report':('reports/'+out.name) if report else None,'reportSha256':hashlib.sha256(out.read_bytes()).hexdigest() if report else None,'stdout':proc.stdout.replace(str(SOURCE),'<isolated-source>'),'stderr':proc.stderr.replace(str(SOURCE),'<isolated-source>'),'acceptance':report.get('acceptance') if report else None,'pairedEvidence':report.get('pairedEvidence') if report else None,'productPath':report.get('productPath') if report else None})
 # Expected outcomes belong to the existing command's current contract.
 if proc.returncode!=expectedExit: print('Unexpected command outcome',case,file=sys.stderr)
(HERE/'command-results.json').write_text(json.dumps({'source':'6185f14cd05b2aa985aa539e8221282c2237e200','node':subprocess.check_output(['node','--version'],text=True).strip(),'cases':results},indent=2)+'\n')
print(json.dumps([{'case':r['case'],'exit':r['exit'],'verdict':(r['acceptance']or{}).get('verdict')} for r in results]))
sys.exit(0 if all(r['exit']==r['expectedExit'] for r in results) else 1)
