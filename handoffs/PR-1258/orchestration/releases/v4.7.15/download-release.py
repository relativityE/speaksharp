#!/usr/bin/env python3
"""Fetch the pinned Orch package with existing gh login; never stops or starts agents."""
import argparse,base64,hashlib,io,json,re,subprocess,zipfile
from pathlib import Path
PIN='5a95e3802138b3156086024db8a0ec240438421bfe3cbab2a40072d8aa3a9c72'
BASE='handoffs/PR-1258/orchestration/releases/v4.7.15/'
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--ref',required=True)
p.add_argument('--extract-to',required=True,type=Path)
a=p.parse_args()
if not re.fullmatch('[0-9a-f]{40}',a.ref):p.error('an immutable full commit SHA is required')
def read(name):
    v=json.loads(subprocess.check_output(['gh','api','repos/relativityE/speaksharp/contents/'+BASE+name+'?ref='+a.ref],text=True,timeout=30))
    if v.get('encoding')!='base64':raise RuntimeError('unexpected GitHub file encoding')
    return base64.b64decode(v['content'])
meta=json.loads(read('release.json'))
if meta['sha256']!=PIN or meta['version']!='4.7.15':raise RuntimeError('release identity mismatch')
data=base64.b64decode(b''.join(read('bundle.b64.'+str(i).zfill(2)).strip() for i in range(12)),validate=True)
if hashlib.sha256(data).hexdigest()!=PIN or len(data)!=meta['bytes']:raise RuntimeError('package identity mismatch')
target=a.extract_to.expanduser().resolve()/'rwt-pr-handoff-v4.7.15'
if target.exists():raise RuntimeError('destination already exists; old installation preserved')
with zipfile.ZipFile(io.BytesIO(data)) as z:
    if sum(i.file_size for i in z.infolist())>10*1024*1024:raise RuntimeError('oversized package')
    for i in z.infolist():
        q=Path(i.filename)
        if q.is_absolute() or '..' in q.parts or not q.parts or q.parts[0]!=target.name or ((i.external_attr>>16)&0o170000)==0o120000:raise RuntimeError('unsafe package entry')
    z.extractall(a.extract_to.expanduser().resolve())
for q in target.rglob('*'):
    if q.is_file() and q.suffix in ('.sh','.command'):q.chmod(0o755)
subprocess.run(['python3','-c','from pathlib import Path;import package_integrity;assert not package_integrity.verify(Path.cwd())'],cwd=target,check=True)
print(json.dumps({'extracted':str(target),'sha256':PIN,'started':False,'next':'CLI PM performs the verified idle upgrade in RELEASE-v4.7.15.md; preserve the old installation and journal.'}))
