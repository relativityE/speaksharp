"""Prepare only artifacts/ trees from already available exact Git objects and installed dependencies.
No fetch, install, provider operation, shared checkout edit or shared dependency mutation.
"""
import pathlib,subprocess,shutil,json,hashlib,tarfile,io
ROOT=pathlib.Path.cwd();HERE=pathlib.Path(__file__).resolve().parent
MAIN='c9d46b2d4ffef7530cb0cccaa533b5818d200320'
PINS={'97638983':'97638983ab03f5d36f7f40d32f0f8cafc96860cb','b6fa965e':'b6fa965e9c3c1f90e40383af8995a7a1ef631f58','f3f8704':'f3f8704257c523bb44dfdc305e697e18f5f8e769'}
for sha in [MAIN,*PINS.values()]:
 if subprocess.run(['git','cat-file','-e',sha+'^{commit}'],capture_output=True).returncode:
  raise SystemExit('Missing exact Git object '+sha+'; obtain it through the authorized source connector before replay. No alternative pin selected.')
deps=(ROOT/'node_modules').resolve()
if not (deps/'vitest/vitest.mjs').is_file():raise SystemExit('Existing locked Vitest dependencies missing; no installation attempted.')
base=ROOT/'artifacts/pm-mvp-closeout-main-c9';base.mkdir(parents=True,exist_ok=True)
paths=['frontend/src','tests','test-support','scripts','backend','product_release']
for directory in ['', 'frontend']:
 ls=subprocess.check_output(['git','ls-tree','--name-only',MAIN+(':'+directory if directory else '')],text=True).splitlines()
 for name in ls:
  if pathlib.Path(name).suffix in {'.json','.js','.mjs','.cjs','.ts'}:paths.append(str(pathlib.Path(directory)/name))
raw=subprocess.check_output(['git','archive',MAIN,*paths])
with tarfile.open(fileobj=io.BytesIO(raw)) as tar:tar.extractall(base,filter='data')
if not (base/'node_modules').exists():(base/'node_modules').symlink_to(deps,target_is_directory=True)
inventory=json.loads((HERE/'prepared-main-blobs.json').read_text())
for key,sha in PINS.items():
 for row in inventory[key]:
  data=subprocess.check_output(['git','show',sha+':'+row['path']]);blob=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
  if blob!=row['preparedBlob']:raise ValueError('Prepared blob mismatch '+row['path'])
  dest=ROOT/'artifacts/pm-mvp-prepared'/key/row['path'];dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
for key in ['97638983','b6fa965e']:
 dest=ROOT/('artifacts/pm-mvp-receiving-'+key);shutil.copytree(base,dest,symlinks=True,dirs_exist_ok=True,ignore=shutil.ignore_patterns('node_modules'))
 if not (dest/'node_modules').exists():(dest/'node_modules').symlink_to(deps,target_is_directory=True)
 for row in inventory[key]:
  target=dest/row['path'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/'artifacts/pm-mvp-prepared'/key/row['path'],target)
print('Prepared pinned isolated main/copy/parity/doc inputs; no tests executed.')
