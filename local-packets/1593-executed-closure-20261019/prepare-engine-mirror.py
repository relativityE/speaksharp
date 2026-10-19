"""Reproduce only the isolated source fixture; no install, live action, shared edit or test dispatch."""
import argparse,io,os,pathlib,subprocess,tarfile
ap=argparse.ArgumentParser();ap.add_argument('--out',required=True);ap.add_argument('--parent-controls',action='store_true');args=ap.parse_args()
repo=pathlib.Path.cwd();out=(repo/args.out).resolve();allowed=(repo/'artifacts/pm-closure-private').resolve()
if not out.is_relative_to(allowed) or out.exists():raise SystemExit('Choose a NEW directory under artifacts/pm-closure-private; existing evidence is preserved')
head='9ce170db5113d45980908ee4bea334b48eb019a6'
paths=['frontend/src','frontend/tests','frontend/vitest.config.mjs','frontend/tsconfig.json','frontend/tsconfig.node.json','scripts','backend/supabase/functions/_shared','vitest.config.mjs','package.json','tsconfig.json']
b=subprocess.check_output(['git','archive',head,*paths]);out.mkdir(parents=True)
with tarfile.open(fileobj=io.BytesIO(b)) as archive:
 for member in archive:
  target=(out/member.name).resolve()
  if not target.is_relative_to(out):raise SystemExit('Archive escaped isolated root')
  if member.isdir():target.mkdir(parents=True,exist_ok=True)
  elif member.isfile():target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(archive.extractfile(member).read())
(out/'node_modules').symlink_to(os.path.relpath(repo/'node_modules',out))
if args.parent_controls:
 for p in ['frontend/src/services/SpeechRuntimeController.ts','frontend/src/services/transcription/TranscriptionService.ts']:
  (out/p).write_bytes(subprocess.check_output(['git','show','77780845ce2ff9550f0920eb2f1eb37fe2ff01a9:'+p]))
print(args.out)
