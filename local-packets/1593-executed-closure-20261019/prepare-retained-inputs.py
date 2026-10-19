"""Small read-only adapter for fixed GitHub logs/archive into existing parser inputs. No alternative schema."""
import hashlib,io,json,pathlib,subprocess,zipfile
root=pathlib.Path('artifacts/pm-closure-private');root.mkdir(parents=True,exist_ok=True)
runs=[(39179969048,117830434231),(39180361522,117831608915),(39180659914,117832503703),(39179780974,117829875427),(39179810724,117829964834),(39180125712,117830911973),(39180129880,117830923753),(39179784510,117829885363),(39179788446,117829896871),(39179792398,117829911186),(39179796291,117829919835),(39167876945,117794561218),(39179799844,117829930866),(39179803528,117829942794),(39179807441,117829954812)]
def read(endpoint):
 p=subprocess.run(['gh','api','repos/relativityE/speaksharp/'+endpoint,'--method','GET'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode:raise SystemExit('Authorized GitHub read failed for '+endpoint+'; stop, do not substitute another account/tool to bypass a denial')
 return p.stdout
rows=[]
for case,(run,job) in enumerate(runs,1):
 metadata=json.loads(read('actions/jobs/'+str(job)))
 if metadata['run_id']!=run:raise SystemExit('Job/run binding mismatch')
 raw=read('actions/jobs/'+str(job)+'/logs');receipt=None
 for line in raw.decode().splitlines():
  marker=line.find('RWT_RECEIPT ')
  if marker>=0:
   try:receipt=json.loads(line[marker+12:])
   except json.JSONDecodeError:pass
 rows.append({'case':case,'run':run,'job':job,'receipt':receipt,'decoded_log_sha256':hashlib.sha256(raw).hexdigest()})
(root/'retained-receipts.json').write_text(json.dumps(rows,indent=2)+'\n')
archive=read('actions/artifacts/12155732985/zip')
expected='fabadee44005509c7bcc10c40ee80c20dead843922b06120a90b731d834a1a0e'
if hashlib.sha256(archive).hexdigest()!=expected:raise SystemExit('Archive digest mismatch')
folder=root/'case08';folder.mkdir(exist_ok=True)
with zipfile.ZipFile(io.BytesIO(archive)) as z:
 for item in z.infolist():
  dest=(folder/item.filename).resolve()
  if not dest.is_relative_to(folder.resolve()):raise SystemExit('Unsafe archive member')
  if item.is_dir():dest.mkdir(parents=True,exist_ok=True)
  else:dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(z.read(item))
print(json.dumps({'actual_log_inputs':len(rows),'actual_receipts':sum(r['receipt'] is not None for r in rows),'case8_archive_sha256':expected}))
