"""Materialize existing tracked source only, without changing a checkout or downloading dependencies."""
import pathlib, subprocess, tarfile, io, sys, json, hashlib
root=pathlib.Path(sys.argv[1]).resolve()
if root.exists() and any(root.iterdir()): raise SystemExit('Use a fresh empty source directory')
root.mkdir(parents=True,exist_ok=True)
pin='6185f14cd05b2aa985aa539e8221282c2237e200'
archive=subprocess.check_output(['git','archive',pin])
hashes={}
with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
 for m in tar.getmembers():
  if not m.isfile():continue
  keep=m.name.startswith(('scripts/','tests/evidence/','frontend/src/')) or m.name in ['package.json','pnpm-lock.yaml','tsconfig.json','tests/fixtures/hf-asset-pins.json']
  if not keep:continue
  b=tar.extractfile(m).read();out=root/m.name;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(b)
  hashes[m.name]=hashlib.sha256(b).hexdigest()
dependencies=pathlib.Path('node_modules').resolve()
if not dependencies.is_dir():raise SystemExit('Existing supported dependency tree missing; do not install automatically')
(root/'node_modules').symlink_to(dependencies,target_is_directory=True)
(root/'PM_SOURCE_HASHES.json').write_text(json.dumps(hashes,indent=2)+'\n')
print(json.dumps({'source':pin,'files':len(hashes),'dependencies':'existing tree linked; no install'}))
