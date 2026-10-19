"""New synthetic control data only; no model/audio acquisition or evaluator implementation."""
import hashlib, json, pathlib, struct, subprocess
HERE = pathlib.Path(__file__).resolve().parent
SOURCE = '6185f14cd05b2aa985aa539e8221282c2237e200'
def sha(b): return hashlib.sha256(b).hexdigest()
def write(name, value):
    p=HERE/name; p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
stt = [
 {'id':'identical','reference':'hello world','hypothesis':'hello world','slices':['clear'],'expected':'zero lexical delta; integrity only'},
 {'id':'word-error','reference':'hello world','hypothesis':'hello earth','slices':['clear'],'expected':'one substitution, WER 0.5'},
 {'id':'speech-empty','reference':'hello world','hypothesis':'','slices':['clear'],'expected':'retain unsuccessful output; arm unscoreable in legacy scorer; proposed deletion denominator not implemented'},
 {'id':'silence-empty','reference':'','hypothesis':'','slices':['silence'],'expected':'lexical WER unavailable; separate hallucination measure absent'},
 {'id':'silence-hallucination','reference':'','hypothesis':'hello','slices':['silence'],'expected':'not zero WER; separate hallucination failure remains unimplemented'},
 {'id':'filler-omission','reference':'um hello uh world','hypothesis':'hello world','slices':['filler'],'expected':'Track-A tie; raw coachable filler count 2 versus 0; no acoustic claim'},
 {'id':'focus-omission','reference':'budget deadline Friday','hypothesis':'budget','slices':['focus'],'expected':'two deletions; actual Focus coverage must separately lose evidence'},
 {'id':'critical-polarity','reference':'do not approve payment','hypothesis':'do approve payment','slices':['critical'],'expected':'one deletion; critical meaning failure not licensed by pooled WER'},
 {'id':'weak-slice','reference':'deadline Friday','hypothesis':'','slices':['weak'],'expected':'cannot hide missing/failed slice in pooled success'},
]
coaching=[]
for product,version in [('open_mic','gemini_coaching_v1'),('focus_points','gemini_coaching_focus_v1')]:
 good={'version':version,'what_worked':'You named Friday as the deadline.','what_to_try_next':'Next take, open with “The deadline is Friday,” then give the budget.'}
 for kind,payload,expected in [
  ('grounded',good,'shape accepted; human usefulness UNEXECUTED'),
  ('identical',good,'same pair; integrity only'),
  ('wrong-version',{**good,'version':'unknown_v9'},'shape rejected'),
  ('wrong-product',{**good,'version':'gemini_coaching_focus_v1' if product=='open_mic' else 'gemini_coaching_v1'},'shape rejected'),
  ('extra-key',{**good,'tokenCost':0},'shape rejected'),
  ('missing-suggestion',{'version':version,'what_worked':'Friday.'},'shape rejected'),
  ('generic',{**good,'what_worked':'Good job.','what_to_try_next':'Keep practicing.'},'shape accepted; generic advice is rubric failure, semantic validator absent'),
  ('metric-recital',{**good,'what_worked':'You spoke 120 words per minute.','what_to_try_next':'You used two fillers.'},'shape accepted; no usable next action; rubric failure'),
  ('unsupported',{**good,'what_worked':'Your audience applauded the million-dollar deal.'},'shape accepted; unsupported claim; rubric critical flag'),
  ('timeout',None,'no output, never an accepted pair'),
  ('failure',{'error':'provider unavailable'},'shape rejected; retain failed attempt')]:
  coaching.append({'id':product+'-'+kind,'product':product,'context':{'transcript':'The budget deadline is Friday.','focusTargets':['budget','deadline Friday'] if product=='focus_points' else []},'payload':payload,'expected':expected})
write('frozen-controls.json',{'schema':'pm-1565-controls-v1','implementationSource':SOURCE,'origin':'newly authored synthetic text and generated zero-valued PCM, not model observations','rubricSource':'e98da8f8c19a32857c4144697295e0d951bae268','stt':stt,'coaching':coaching,'humanRatings':None,'numericalPolicyApproved':False})
identity={'engine':'offline-control','modelId':'no-model','revision':None,'assetDigest':'a'*64,'runtime':'deterministic-test-double','backend':'wasm'}
for name,options in [('baseline',{}),('candidate',{}),('decode-failure',{'decodeFailure':True,'disposeFailure':True}),('wrong-backend',{'observedBackend':'cpu'}),('init-failure',{'initFailure':True})]:
 write('inputs/'+name+'.json',{'version':1,'identity':identity,'adapterModule':'./tests/evidence/fixtures/model-evaluator/offline-control-adapter.ts','adapterOptions':options})
pcm=bytes(640); wav=b'RIFF'+struct.pack('<I',36+len(pcm))+b'WAVEfmt '+struct.pack('<IHHIIHH',16,1,1,16000,32000,2,16)+b'data'+struct.pack('<I',len(pcm))+pcm
(HERE/'inputs/control.wav').write_bytes(wav)
write('inputs/corpus.json',{'version':1,'trials':2,'clips':[{'id':x,'clusterId':'synthetic-'+x,'reference':'hello world','slices':['integrity'],'path':'control.wav','wavSha256':sha(wav),'sha256':sha(bytes(1280))} for x in ['a','b','c']]})
write('inputs/device.json',{'version':1,'baseUrl':'http://unused.invalid','label':'offline integrity only, no device measurement','backend':'wasm'})
pins={}
for p in ['tests/evidence/fixtures/model-evaluator/baseline-v2-smoke.json','tests/evidence/fixtures/model-evaluator/candidate-v4-base-q4-4.3.0.json','tests/evidence/fixtures/model-evaluator/device-local-wasm.json']:
 b=subprocess.check_output(['git','show',SOURCE+':'+p]);pins[p]={'sha256':sha(b),'manifest':json.loads(b)}
write('target-pins.json',{'source':SOURCE,'realTargets':pins,'executedTarget':'offline-control/no-model; no actual v2/v4 inference in this run','missing':'download-response hashes, immutable revisions, supported devices and full audio admission remain unverified'})
manifest={str(p.relative_to(HERE)):sha(p.read_bytes()) for p in HERE.rglob('*') if p.is_file() and p.name not in ['INPUT_HASHES.json']}
write('INPUT_HASHES.json',manifest)
print(json.dumps({'textSTTControls':len(stt),'coachingControls':len(coaching),'targets':'v2 BASE / v4 BASE q4 WASM','audio':'generated 20ms zeros; no speech-quality evidence'}))
