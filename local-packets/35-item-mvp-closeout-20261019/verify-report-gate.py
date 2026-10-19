import copy,json,pathlib,tempfile,os,time
from report_gate import validate_report,require_fresh_report
H=pathlib.Path(__file__).resolve().parent
rows=json.loads((H/'executed-controls.json').read_text());m=json.loads((H/'expected-control-assertions.json').read_text());out=[]
def check(name,fn,reject=False):
 try:fn()
 except ValueError:
  if not reject:raise
 else:
  if reject:raise AssertionError('False acceptance: '+name)
 out.append({'name':name,'passed':True,'expectedRejection':reject})
fixtures=[]
for r in rows:
 j={'numTotalTests':r['total'],'numPassedTests':r['passed'],'numFailedTests':r['failed'],'success':r['failed']==0,'testResults':[{'assertionResults':[{'fullName':a['name'],'status':a['status'],'failureMessages':a.get('failure',[])} for a in f['assertions']]} for f in r['files']]}
 fixtures.append((r,j));check('historical accepted named fixture '+r['name'],lambda r=r,j=j:validate_report(j,m[r['name']],r['exit']))
r,j=fixtures[1];manifest=m[r['name']]
bad=copy.deepcopy(j);next(a for f in bad['testResults'] for a in f['assertionResults'] if a['status']=='failed')['fullName']='unrelated failed assertion'
check('unrelated failure rejected',lambda:validate_report(bad,manifest,1),True)
bad2=copy.deepcopy(j);bad2['testResults'][0]['assertionResults'].pop();check('missing test rejected',lambda:validate_report(bad2,manifest,1),True)
bad3=copy.deepcopy(j);bad3['testResults'][0]['assertionResults'].append({'fullName':'unexpected test','status':'passed'});check('extra test rejected',lambda:validate_report(bad3,manifest,1),True)
bad4=copy.deepcopy(j);bad4['testResults'][0]['assertionResults'][0]['status']='pending';check('pending test rejected',lambda:validate_report(bad4,manifest,1),True)
check('wrong exit rejected',lambda:validate_report(j,manifest,0),True)
bad5=copy.deepcopy(j);bad5['numTotalTests']+=1;check('false total rejected',lambda:validate_report(bad5,manifest,1),True)
bad6=copy.deepcopy(j);bad6['numRuntimeErrorTestSuites']=1;check('runtime error rejected',lambda:validate_report(bad6,manifest,1),True)
bad7=copy.deepcopy(j);bad7['testResults'][0]['assertionResults'].append(copy.deepcopy(bad7['testResults'][0]['assertionResults'][0]));check('duplicate test rejected',lambda:validate_report(bad7,manifest,1),True)
with tempfile.TemporaryDirectory() as t:
 p=pathlib.Path(t)/'r.json';p.write_text('{}');os.utime(p,ns=(1,1));start=time.time_ns()
 check('stale report rejected',lambda:require_fresh_report(p,start),True);p.unlink();check('missing report rejected',lambda:require_fresh_report(p,start),True);p.write_text('{}');check('fresh report accepted',lambda:require_fresh_report(p,start))
(H/'report-gate-controls.json').write_text(json.dumps({'passed':len(out),'failed':0,'results':out,'scope':'Gate controls only; original production control batches not rerun.'},indent=2)+'\n');print(len(out),'PASS')
