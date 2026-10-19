"""Produce an isolated receiving patch; never edit shared canonical documents."""
import pathlib,shutil,difflib,json,hashlib,re
ROOT=pathlib.Path.cwd();HERE=pathlib.Path(__file__).resolve().parent;main=ROOT/'artifacts/pm-mvp-closeout-main-c9';prepared=ROOT/'artifacts/pm-mvp-prepared/f3f8704';stage=ROOT/'artifacts/pm-mvp-docs-currentized'
shutil.copytree(main,stage,symlinks=True,dirs_exist_ok=True,ignore=shutil.ignore_patterns('node_modules'))
if not (stage/'node_modules').exists():(stage/'node_modules').symlink_to((main/'node_modules').resolve(),target_is_directory=True)
phase='**Model evaluation and current release boundaries.** Private v2 may complete MVP. The current coordination record selects the near-term #1565 evaluator and #1304 model/fallback work; do not treat an older post-MVP label as permission to stop that assigned work. Reuse preserved #1567/#1568 source through the sole CLI integration lane. Evaluation is not promotion: v4 and any fallback configuration require comparable real evidence and explicit Product Owner selection. One producer remains locked for a take; full useful Open Mic/Focus and applicable device acceptance remain required for the selected customer configuration. This document grants no model acquisition, live execution or activation authority.'
phase+=' A fallback is not "second-lowest WER"; it must be dependable across more devices and fail differently from the primary.'
account='''## Account-exit policy boundary

Routine deletion is account-scoped, as confirmed in [#1643 policy6251767298](https://github.com/relativityE/speaksharp/issues/1643#issuecomment-6251767298). Page navigation or email issuance is not destructive confirmation. Verified explicit confirmation records durable pending intent for that account, prevents new admission, and allows already accepted saves, coaching and billing work to finish and reconcile. Unknown outcomes remain pending: neither elapsed timeout nor an accepted request establishes settlement or deletion. Only verified DB/storage/Auth final state supports a deleted result. Other users continue normally; routine deletion requires no global shutdown.

Cancellation is distinct: preserve account/login/history and verified remaining access while stopping renewal under the actual provider outcome. Cancellation alone schedules no deletion. Existing runtime generation/configuration and operational guards remain implementation prerequisites until a reviewed replacement is integrated; this policy does not remove them or invent global worker termination. The bounded legacy direct-checkout cutover still needs its own reconciliation. Backend staging or202 pending is not a completed customer journey, and source preparation authorizes no account/provider operation.

'''
paths=[]
for f in (prepared/'product_release').glob('*.md'):
 p=f.relative_to(prepared);text=f.read_text();lines=[]
 for line in text.splitlines():
  if '**Current model phase' in line:
   lines.append(('> ' if line.startswith('>') else '')+phase)
  else:
   line=line.replace('authorized post-MVP model phase','separately authorized model evaluation phase').replace('for the post-MVP model phase','for the separately authorized model evaluation phase')
   if line.startswith('Private v2, Private v4, and Moonshine are registered comparison candidates.'):
    line='Private v2, Private v4, and Moonshine remain registered candidates. Evaluation follows the selected #1565/#1304 queue and preserved source, without creating a current v2 MVP comparison gate. Moonshine activation remains unqualified; its preserved source and failure evidence feed #1304. Candidate control is operator-only, applies between settled takes, and never creates a customer selector, entitlement or silent fallback.'
   line=line.replace('Reuse the prepared #1567 evaluator and #1568 primary/fallback policy in their future authorized phase.','Reuse preserved #1567 evaluator and #1568 primary/fallback source through the selected current integration lane; the preserved branches are not shipped behavior.').replace('Moonshine evaluation remains deferred','Moonshine activation remains deferred pending qualification')
   lines.append(line)
 text='\n'.join(lines)+'\n'
 if p.name=='ARCHITECTURE.md':text=account+text
 out=stage/p;out.parent.mkdir(parents=True,exist_ok=True);out.write_text(text);paths.append(p)
for name in ['ENTITLEMENTS_AND_BILLING.md','OPERATIONS_AND_SECURITY.md']:
 p=pathlib.Path('product_release')/name;(stage/p).write_text(account+(main/p).read_text());paths.append(p)

# Four remaining protected canonical paths: bounded source correction, not final release claims.
for name in ['README.md','ROADMAP.md','RELEASE_STATUS.md','TESTER_GUIDE.md']:
 p=pathlib.Path('product_release')/name;text=(main/p).read_text()
 if name=='README.md':
  text=text.replace('reference for the deferred Private v4 disposition.','preserved historical source for the separately selected current model-evaluation queue; not shipped behavior or an automatic release gate.')
 if name=='ROADMAP.md':
  text=text.replace('authoritative global legacy drain/settlement','account-scoped admission and settlement under policy6251767298 (legacy cutover remains separately evidenced)')
  line=next((line for line in text.splitlines() if line.startswith('**Current post-MVP model lane:**')),None)
  if line:text=text.replace(line,'')
  text=text.replace('## Later — explicitly post-MVP','## Current parallel model work\n\n'+phase+'\n\n## Later — explicitly post-MVP')
  text=text.replace('# SpeakSharp Roadmap','# SpeakSharp Roadmap\n\n**19 October receiving correction.** The [35-item owner/closure directive](https://app.slack.com/archives/C0C9RE8KNHG/p1792432639622239) supersedes older queue assignments: App owns11, CLI15, Browser PM3 and Sam6. RWT/Alpha and MVP/Beta overlap but remain separate milestones. Prepared source must pass integration, deployment and matching acceptance; a final human sitting cannot close branch-only or unapplied work. Routine account exit follows [account-scoped policy6251767298](https://github.com/relativityE/speaksharp/issues/1643#issuecomment-6251767298); elapsed timeout or request acceptance is not deletion. This is routing, not release or operational approval. Dynamic source/deployment facts remain in RELEASE_STATUS.')
 if name=='RELEASE_STATUS.md':
  old=next((line for line in text.splitlines() if line.startswith('Retention activation/copy and model evaluation/promotion')),None)
  if old:text=text.replace(old,phase)
  snapshot='''## 19 October 2026 bounded source/coordination addendum

This addendum supersedes earlier present-tense queue and model-phase instructions, while retaining every historical outcome. GitHub main was independently read as c9d46b2d4ffef7530cb0cccaa533b5818d200320;24issues and11PRs were open in this reconciliation. App/CLI/Browser PM have personally acknowledged their assigned queues. The [35-item directive](https://app.slack.com/archives/C0C9RE8KNHG/p1792432639622239) and [current coordinator](https://github.com/relativityE/speaksharp/issues/1593) own later moving dispositions; these counts/pins are dated, not evergreen assignments.

The exact main commit's Vercel status was FAILURE at2026-10-19T14:20:06Z: “Deployment rate limited — retry in24hours.” This status text is not a promised recovery time. No fresh served frontend SHA or new production canary was observed by this documentation correction. Source-main identity is not served identity. Full useful Open Mic/Focus, received telemetry and human/device acceptance remain HOLD/unexecuted where not evidenced.

The1662/1666/1667/1668 release queue and case10 correction remain separate qualification/integration boundaries. Copy1254's current receiver aac368a7 is source-accepted; Analytics1472's receiver ee9c9c42 has independently executed64-control client/PGlite parity evidence, not hosted migration/application or deployed proof. Neither patch is claimed shipped. Canonical-target continuity1548 and customer-exit1643 remain open beyond narrow landed1636 labels and1611 backend staging.

Routine account deletion follows [PO policy6251767298](https://github.com/relativityE/speaksharp/issues/1643#issuecomment-6251767298): durable pending for the verified confirmed account, no new admission, settlement of accepted saves/coaching/billing, then verified DB/storage/Auth final state. Other users continue; global shutdown/termination is not the routine contract. Historical global-drain claims below do not override this policy. Existing operational configuration/legacy-cutover guards remain until a reviewed successor replaces them.202 pending and timeout are not deleted; cancellation remains distinct. No migration, runtime/provider/account mutation or activation is authorized here.

'''
  text=snapshot+text
 if name=='TESTER_GUIDE.md':
  text=text.replace('3. If this is your first session, allow the one-time Private transcription setup. Wait until the session says “Ready — speak now.”','3. Press the mic once. If this is your first session, allow the one-time Private transcription setup. Recording begins from that press when setup finishes; wait until the session says “Ready — speak now.”')
  text=text.replace('4. Start recording when you are ready, speak for approximately 1–2 minutes, then stop.','4. When the session says “Ready — speak now,” speak for approximately 1–2 minutes, then stop. Do not press the mic a second time to start after setup.')
  text=text.replace('- Was it clear where to begin and that recording would not start automatically?','- Was it clear where to begin, that nothing records before you press the mic, and that the same press continues into recording after setup?')
 (stage/p).write_text(text);paths.append(p)

patch=[];records=[];missing=[]
for p in paths:
 old=(main/p).read_text();new=(stage/p).read_text();patch.extend(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+str(p),tofile='b/'+str(p)))
 for link in re.findall(r'\]\(([^)]+)\)',new):
  if link.startswith(('https:','http:','#','mailto:')):continue
  target=link.split('#')[0]
  if target and not (stage/p.parent/target).exists():missing.append({'source':str(p),'target':target})
 records.append({'path':str(p),'mainSha256':hashlib.sha256(old.encode()).hexdigest(),'preparedReceivingSha256':hashlib.sha256(new.encode()).hexdigest()})
(HERE/'1318-currentized-receiving.patch').write_text(''.join(patch))
# Missing local links are inventoried, not silently marked passing or deleted.
(HERE/'documentation-receiving.json').write_text(json.dumps({'main':'c9d46b2d4ffef7530cb0cccaa533b5818d200320','prepared':'f3f8704257c523bb44dfdc305e697e18f5f8e769','paths':records,'missingRelativeTargets':missing,'archiveChanges':0,'sourceOnly':True,'scope':'All14 protected canonical receiving paths; whole nonarchive inventory/final shipped facts remain open. No shared files edited.'},indent=2)+'\n')
print(json.dumps({'paths':len(paths),'missingRelativeTargets':len(missing),'archiveChanges':0}))
