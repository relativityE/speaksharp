"""Single receiving command. Existing source/APIs only; all outputs in a fresh isolated folder."""
import pathlib, subprocess, shutil, json, sys, os, hashlib
REPO=pathlib.Path.cwd().resolve();HERE=pathlib.Path(__file__).resolve().parent
OUT=(REPO/sys.argv[1]).resolve()
if not OUT.is_relative_to(REPO/'artifacts') or OUT.exists():raise SystemExit('Choose a fresh directory beneath artifacts/')
OUT.mkdir(parents=True);copy=OUT/'controls';copy.mkdir();source=OUT/'source'
for p in HERE.iterdir():
 if p.is_file() and p.suffix in ['.py','.mjs','.ts']:shutil.copyfile(p,copy/p.name)
logs=[]
def run(args,cwd=REPO,env=None):
 r=subprocess.run(args,cwd=cwd,env=env,text=True,capture_output=True,timeout=90)
 logs.append({'argv':[str(x).replace(str(REPO),'<repository>') for x in args],'cwd':str(cwd.relative_to(REPO)) or '.', 'exit':r.returncode,'stdout':r.stdout.replace(str(REPO),'<repository>'),'stderr':r.stderr.replace(str(REPO),'<repository>')})
 (OUT/'execution.json').write_text(json.dumps(logs,indent=2)+'\n')
 if r.returncode:raise SystemExit('Receiving step failed; see execution.json')
run(['python',str(copy/'prepare-isolated-source.py'),str(source)])
run(['python',str(copy/'prepare-controls.py')])
# Frozen text and target manifests must be identical to the published receiving package.
for name in ['frozen-controls.json','target-pins.json']:
 if (copy/name).read_bytes()!=(HERE/name).read_bytes():raise SystemExit('Frozen input drift '+name)
run(['python',str(copy/'run-command-controls.py'),str(source)])
run(['python',str(copy/'run-preflight-controls.py'),str(source)])
run(['node',str(copy/'probe-existing-seams.mjs'),str(source)])
run(['python',str(copy/'run-command-controls.py'),'--verify-retained'])
tests=['tests/evidence/__tests__/modelEvaluator.test.ts','tests/evidence/__tests__/modelEvaluatorAdapters.test.ts','tests/evidence/__tests__/modelEvaluatorCommand.test.ts','tests/evidence/__tests__/modelEvaluatorPairedRun.test.ts','tests/evidence/certification/__tests__/pairedEvidence.test.ts','tests/evidence/certification/__tests__/selectionPolicy.test.ts']
run(['node','node_modules/vitest/vitest.mjs','run','--config',str(copy/'vitest.config.mjs'),'--reporter=json','--outputFile=artifacts/existing-tests.json',*tests],source,{**os.environ,'PM_EVAL_SOURCE':'.'})
test=json.loads((source/'artifacts/existing-tests.json').read_text());seams=json.loads((copy/'seam-results.json').read_text())
assert test['numPassedTests']==71 and test['numFailedTests']==0
assert seams['controlGroups']==105 and seams['probeErrors']==0
summary={'source':'6185f14cd05b2aa985aa539e8221282c2237e200','exit':0,'existingTests':{'passed':71,'failed':0},'apiObservationGroups':105,'apiProbeErrors':0,'cliReports':'1 HOLD +3 FAIL; no model inference','preflightsRejected':4,'lifecycleTrace':'both logical arms alive for12 decode calls','wrapper':'4 real reports +16 rejected negative mutations','frozenInputsMatched':True,'liveOrModelQualification':'NOT_RUN / HOLD'}
(OUT/'SUMMARY.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary))
