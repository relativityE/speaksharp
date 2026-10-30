#!/usr/bin/env python3
"""Builds the private campaign inputs (plan, admission config, policy, approvals, case configs) for one Cloud test run from a validated run request.
Derived from the reviewed prep builder (build_private_r15_prep.py); every session-specific value is now an explicit input, never an embedded string:

  BP_PACKET      the vendored, verified harness directory (bundle/, draft-adapters/)           BP_CHECKOUT   a clean checkout at the tested source SHA
  BP_PRIVATE     NEW private directory for the generated files (0700)                           BP_SOURCE_SHA the tested (served) 40-hex SHA
  BP_FACTS       reviewed facts JSON (owner approval reference, probe receipts, reviewer, ...)  BP_ACCOUNT_ID_FILE file holding the throwaway account id (not a secret)
  BP_TASK_ID / BP_SOURCE_REFERENCE / BP_ENV_ID   the Claude task-environment receipt the harness admission requires (the only runtime it accepts)
  BP_CAMPAIGN BP_T0 BP_T1 BP_TOTAL BP_CLEANUP BP_IDENT BP_SELECT BP_GATES BP_EST BP_COACHING_CAP BP_SELECT_REF BP_SELECT_REASON BP_BACKEND_*  (from scripts/run_env.py)
  BP_PDFJS_DIR / BP_PDFJS_SHA  optional: where the pinned pdfjs-dist is (default: the checkout's node_modules) and its pinned pdf.mjs sha256
  BP_MODE        minimal (partial run) | breadth | full (full coverage). Required: there is no default, so a run can never silently become the minimal sample.
  VITE_SUPABASE_ANON_KEY  (phase1 only: the publishable key written into the private case configs)

Phase 1: everything that does not depend on the window having opened. Phase 2: attestation -> admission config -> plan. A missing required input is a hard
failure (BLOCKED_SETUP). Account id and publishable key are written only to 0600 private files; no credential value is ever printed."""
import json, os, sys, hashlib, subprocess, time, stat

def need(name):
    v = os.environ.get(name)
    if not v:
        print('BLOCKED_SETUP: required input %s is not set' % name, file=sys.stderr)
        sys.exit(78)
    return v

MODE = os.environ.get('BP_MODE')
RUNTIME = os.environ.get('BP_RUNTIME', 'Claude SpeakSharp R4')
if RUNTIME not in ('Claude SpeakSharp R4', 'GitHub Actions SpeakSharp'):
    raise ValueError('BLOCKED_SETUP: unsupported execution runtime')
if MODE not in ('minimal', 'breadth', 'full'):
    print('BLOCKED_SETUP: BP_MODE must be minimal, breadth or full (no default; it is passed from the request)', file=sys.stderr); sys.exit(78)
PACKET = need('BP_PACKET')
CHECKOUT = need('BP_CHECKOUT')
PRIVATE = need('BP_PRIVATE')
MEDIA_PARENT = os.environ.get('BP_MEDIA_PARENT', '/var/tmp/ss-media-cloud-test')
B = need('BP_SOURCE_SHA')
assert len(B) == 40 and all(c in '0123456789abcdef' for c in B), 'BP_SOURCE_SHA must be a full lowercase SHA'
def _git(*a):
    r = subprocess.run(['git', '-C', CHECKOUT] + list(a), capture_output=True, text=True)
    if r.returncode:
        print('BLOCKED_SETUP: git %s failed in the checkout' % ' '.join(a), file=sys.stderr); sys.exit(78)
    return r.stdout.strip()
TREE = _git('rev-parse', B + '^{tree}')
QUAL_MS, CLEANUP_MS = 1200000, 120000
SEL = [int(x) for x in os.environ.get('BP_CASES', ','.join(str(i) for i in range(1, 16))).split(',')]
SELECTED = [int(x) for x in os.environ['BP_SELECT'].split(',')] if os.environ.get('BP_SELECT') else SEL
IDENT_CAP = int(os.environ.get('BP_IDENT', '32'))
CAMPAIGN = need('BP_CAMPAIGN')
T0 = need('BP_T0')
T1 = need('BP_T1')
FACTS = json.load(open(need('BP_FACTS')))
for _k in ('ownerApprovalReference', 'approvedBy', 'reviewer', 'receipts'):
    if not FACTS.get(_k):
        print('BLOCKED_SETUP: facts file lacks %s' % _k, file=sys.stderr); sys.exit(78)
for _k in ('pre', 'rls', 'analytics', 'disp', 'fence', 'review'):
    if not FACTS['receipts'].get(_k):
        print('BLOCKED_SETUP: facts.receipts lacks %s' % _k, file=sys.stderr); sys.exit(78)
OWNER_REF = FACTS['ownerApprovalReference']
APPROVED_BY = FACTS['approvedBy']
REVIEWER = FACTS['reviewer']
CAPS = {'total': 5200, 'navigations': 150, 'public': 2400, 'preflight': 1500, 'auth': 200, 'signed-in': 2400,
        'coaching': 40, 'account-closure': 0, 'model': 400}
MAXMS = {1: 1500000, 2: 2400000, 3: 1500000, 4: 1200000, 5: 900000, 6: 900000, 7: 1200000, 8: 300000,
         9: 900000, 10: 900000, 11: 900000, 12: 1500000, 13: 900000, 14: 900000, 15: 420000}
PRESS_EXTRA = {int(k): int(v) for k, v in (x.split(':') for x in os.environ.get('BP_PRESS_EXTRA', '').split(',') if x)}
TAKES = {1: 4, 2: 7, 3: 4, 4: 1, 5: 2, 6: 2, 7: 2, 8: 0, 9: 2, 10: 2, 11: 2, 12: 1, 13: 1, 14: 1, 15: 0}
PRESS = {1: 4, 2: 7, 3: 4, 4: 2, 5: 2, 6: 2, 7: 2, 8: 0, 9: 3, 10: 3, 11: 4, 12: 3, 13: 2, 14: 2, 15: 0}
for _k, _v in PRESS_EXTRA.items(): PRESS[_k] = _v
BREADTH = MODE == 'breadth'
MINIMAL = MODE == 'minimal'
FULL = MODE == 'full'
MIN_TAKES = {1: 2, 2: 1, 3: 1, 4: 0, 5: 1, 6: 1, 7: 1, 8: 0, 9: 1, 10: 1, 11: 1, 12: 0, 13: 0, 14: 0, 15: 0}
MIN_PRESS = {1: 2, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 0, 9: 1, 10: 1, 11: 3, 12: 1, 13: 1, 14: 1, 15: 0}
MIN_EST = {1: 350, 2: 190, 3: 170, 4: 90, 5: 160, 6: 160, 7: 150, 8: 90, 9: 190, 10: 120, 11: 170, 12: 100, 13: 115, 14: 125, 15: 125}
if MINIMAL:
    TAKES.update(MIN_TAKES); PRESS.update(MIN_PRESS)
BREADTH_EST = {1: 520, 2: 270, 3: 250, 4: 160, 5: 330, 6: 320, 7: 420, 8: 110, 9: 330, 10: 320, 11: 430, 12: 260, 13: 270, 14: 330, 15: 130}
BREADTH_SKIP = [int(x) for x in os.environ.get('BP_SKIP', '').split(',') if x]
BP_CLEANUP = int(os.environ.get('BP_CLEANUP', '50'))
if BREADTH:
    for _n in (2, 3): TAKES[_n] = 1; PRESS[_n] = 1; MAXMS[_n] = 900000
BP_EST = {int(k): int(v) for k, v in (x.split(':') for x in os.environ.get('BP_EST', '').split(',') if x)}
for _k, _v in BP_EST.items(): MIN_EST[_k] = _v   # partial (minimal) mode only; full mode uses BP_EST directly
CAPS['total'] = int(need('BP_TOTAL'))
if os.environ.get('BP_COACHING_CAP') not in (None, ''):
    CAPS['coaching'] = int(os.environ['BP_COACHING_CAP'])
HOST_APP = os.environ.get('BP_HOST_APP', 'speaksharp-public.vercel.app')
HOST_DB = os.environ.get('BP_HOST_DB', 'yxlapjuovrsvjswkwnrk.supabase.co')
PROJECT_REF = HOST_DB.split('.')[0]
UID_FILE = need('BP_ACCOUNT_ID_FILE')

def sha(b): return hashlib.sha256(b).hexdigest()
def shaf(p): return sha(open(p, 'rb').read())
def jload(p): return json.load(open(p))
def put(path, obj, mode=0o600):
    data = (json.dumps(obj, indent=2) + '\n').encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(fd, 'wb') as f: f.write(data)
    return sha(data)
def now(): return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

phase = sys.argv[1]
os.makedirs(PRIVATE, mode=0o700, exist_ok=True)
assert os.path.realpath(PRIVATE) == PRIVATE, 'PRIVATE must be canonical'
assert (os.stat(PRIVATE).st_mode & 0o777) == 0o700

if phase == 'phase1':
    for d in ('cases', 'cfg'): os.makedirs(f'{PRIVATE}/{d}', mode=0o700, exist_ok=False)
    UID = open(UID_FILE).read().strip()
    ANON = need('VITE_SUPABASE_ANON_KEY')
    contracts = {c['caseId']: c for c in jload(f'{PACKET}/draft-adapters/contracts.json')['cases']} \
        if isinstance(jload(f'{PACKET}/draft-adapters/contracts.json'), dict) and 'cases' in jload(f'{PACKET}/draft-adapters/contracts.json') \
        else {c['caseId']: c for c in jload(f'{PACKET}/draft-adapters/contracts.json')}
    fx = jload(f'{PACKET}/draft-adapters/oracles/pure/fixture-manifest.json')['fixtures']
    oracle_sha = shaf(f'{PACKET}/draft-adapters/oracles/index.cjs')
    producer_mode = os.environ.get('BP_PRODUCER_MODE', 'unavailable')
    if producer_mode not in ('unavailable', 'same-github-job'):
        raise ValueError('BLOCKED_SETUP: unknown producer mode')
    same_job = producer_mode == 'same-github-job'
    assert not same_job or RUNTIME == 'GitHub Actions SpeakSharp', 'same-job producer requires explicit GitHub runtime'
    assert RUNTIME != 'GitHub Actions SpeakSharp' or same_job, 'GitHub runtime requires actual same-job evidence selection'
    receiver_rel = 'draft-adapters/receivers/' + ('github-job-evidence-reader.cjs' if same_job else 'unavailable-evidence-reader.cjs')
    receiver_path = f'{PACKET}/{receiver_rel}'
    receiver_sha = shaf(receiver_path)
    descriptor = None
    if same_job:
        descriptor_file = need('BP_PRODUCER_DESCRIPTOR')
        assert shaf(descriptor_file) == need('BP_PRODUCER_DESCRIPTOR_SHA256'), 'producer descriptor bytes differ'
        descriptor = jload(descriptor_file)
        assert os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('GITHUB_REPOSITORY') == 'relativityE/speaksharp', 'same GitHub job required'
        run_id, attempt = need('GITHUB_RUN_ID'), need('GITHUB_RUN_ATTEMPT')
        assert run_id.isdecimal() and attempt.isdecimal(), 'actual GitHub run/attempt required'
        job_id = need('GITHUB_JOB')
        assert descriptor['producerIdentity'] == f'github-actions:relativityE/speaksharp:{run_id}:{attempt}:{job_id}' and descriptor['jobId'] == job_id, 'producer belongs to another job'
        assert descriptor['producerCodeSha256'] == shaf(f'{PACKET}/bundle/harness/authenticated-job-producer.cjs'), 'producer bytes differ'
        assert descriptor['receiverSourceSha256'] == receiver_sha and descriptor['receiverRelativePath'] == receiver_rel, 'receiver bytes/path differ'
        assert descriptor['workflowSourceSha'] == need('GITHUB_SHA'), 'producer workflow source differs'
        assert descriptor['reviewReference'] == FACTS.get('producerReviewReference') and descriptor['reviewReference'], 'independent producer review binding missing'
    # schema digest: defined here as sha256 over sorted "path:blob" of backend/supabase/migrations at the pinned source
    mig = subprocess.run(['git', '-C', CHECKOUT, 'ls-tree', '-r', B, '--', 'backend/supabase/migrations'], capture_output=True, text=True).stdout.strip().splitlines()
    schema_sha = sha('\n'.join(sorted(f"{l.split()[3]}:{l.split()[2]}" for l in mig)).encode())
    _pdf = os.path.join(os.environ.get('BP_PDFJS_DIR') or f'{CHECKOUT}/node_modules/pdfjs-dist', 'legacy/build/pdf.mjs')
    pdf_sha = shaf(_pdf) if os.path.exists(_pdf) else None
    if os.environ.get('BP_PDFJS_SHA') and pdf_sha is not None and pdf_sha != os.environ['BP_PDFJS_SHA']:
        print('BLOCKED_SETUP: pdfjs-dist pdf.mjs differs from the pinned sha256 (config tools.pdfjs)', file=sys.stderr); sys.exit(78)
    if pdf_sha is None and 1 in SELECTED:
        print('BLOCKED_SETUP: AHT-01 is in the plan but the pinned pdfjs-dist is not installed (run install_pdfjs.py)', file=sys.stderr); sys.exit(78)
    R = dict(FACTS['receipts'])
    R['obs'] = 'A6-qualification-of-this-campaign:admission/qualification/qualification-receipt.json (forward reference, produced by this run)'
    R['perm'] = 'A6-qualification-of-this-campaign:S12.mic-deny,S12.mic-allow (forward reference, produced by this run)'
    R['dl'] = 'A6-qualification-of-this-campaign:S14.* (forward reference, produced by this run)'
    def producer(role, kind, inputs):
        return {'scope': 'existing-authenticated-producer-receiving-capability',
                'producerIdentity': descriptor['producerIdentity'] if descriptor else 'NONE-AVAILABLE:fail-closed-stand-in:no-authorized-evidence-reader-in-this-session',
                'producerCodeSha256': descriptor['producerCodeSha256'] if descriptor else sha(b'NONE-AVAILABLE:no-producer-exists'),
                'receiverSourceSha256': receiver_sha,
                'reviewReference': descriptor['reviewReference'] if descriptor else FACTS.get('producerReviewReference', 'evidence-reader-unavailable;server-evidence-NOT_RUN;no-passing-receiver'),
                'deliveryKind': 'reviewed-authenticated-workflow-artifact' if same_job else kind, 'allowedObservationInputs': inputs}
    PROD = {'coaching-authority': producer('coaching-authority', 'reviewed-authenticated-workflow-artifact', ['startedAt', 'sessionIds']),
            'feedback-association': producer('feedback-association', 'reviewed-authenticated-workflow-artifact', ['startedAt', 'idempotencyKey']),
            'feedback-received': producer('feedback-received', 'authenticated-connector-artifact', ['startedAt', 'journeyId', 'bootId'])}
    FIX = {'open': 'open_mic_tts', 'focus': 'focus_points_tts', 'partial': 'focus_points_partial_tts'}
    def fixture(name):
        e = fx[name]; return {'name': name, 'sha256': e['sha256'], 'launchSha256': e['sha256'], 'speechDurationMs': int(round(e['speechSeconds'] * 1000))}, e
    cases, plan_rows, media_of = {}, [], {}
    for n in range(1, 16):
        cid = f'AHT-{n:02d}'
        t = jload(f'{PACKET}/bundle/config/cases/{cid}.TEMPLATE.json')
        c = {k: v for k, v in t.items() if not k.startswith('_')}
        c.update({'campaignId': CAMPAIGN, 'sourceSha': B, 'servedSha': B, 'targetUrl': f'https://{HOST_APP}',
                  'takeCap': TAKES[n], 'startPressCap': PRESS[n]})
        if BREADTH and n in (2, 3): c['sampleMode'] = 'breadth'
        if MINIMAL: c['sampleMode'] = 'minimal'
        c['account'] = {'id': UID, 'mode': 'maintained-read-only' if n == 15 else 'existing-disposable',
                        'preprovisionReceipt': R['pre'], 'analyticsExclusionReceipt': R['analytics'],
                        'dispositionReceipt': R['disp'], 'effectiveFeatureAccessApproved': True}
        c['readback'] = {'origin': f'https://{HOST_DB}', 'projectRef': PROJECT_REF, 'anonKey': ANON,
                         'schemaSha256': schema_sha, 'ownerReadApproved': True, 'rlsReadQualificationReceipt': R['rls']}
        if n in (9, 10): c['readback']['immutableFenceMigrationQualificationReceipt'] = R['fence']
        c['observerSourceReviewed'] = True; c['observerQualificationReceipt'] = R['obs']
        for name, ob in (c.get('oracleBindings') or {}).items():
            ob['sha256'] = oracle_sha; ob['reviewReceipt'] = R['review']
        key = 'focus' if n == 2 else ('partial' if n == 3 else 'open')
        if TAKES[n] > 0 or PRESS[n] > 0:
            c['fixture'], e = fixture(FIX[key]); media_of[cid] = e['file']
        if n in (2, 3):
            e = fx[FIX[key]]; pts = e['points']; exp = e['expectedFinal']
            c['focus'] = {'topic': e['topic'], 'points': pts, 'expectedFinal': exp, 'speechWindows': e['pointAudioWindows'],
                          'expectsLive': [x in ('covered', 'partial') for x in exp]}
            if n == 2:
                idx = [i for i, x in enumerate(exp) if x == 'covered'][:3]
                c['focus']['newPoints'] = [pts[idx[0]], pts[idx[1]], 'A closing promise we never make']
                c['focus']['editedPoints'] = [pts[i] for i in idx]
        if n == 1: c['pdfParser'] = {'package': 'pdfjs-dist', 'version': '4.10.38', 'sha256': pdf_sha or 'NOT-INSTALLED-AHT-01-NOT-SELECTED'}
        if n in (1, 2, 3): c['privateEvidenceProducers'] = {'coaching-authority': PROD['coaching-authority']}
        if n in (7, 8): c['privateEvidenceProducers'] = {'feedback-association': PROD['feedback-association'], 'feedback-received': PROD['feedback-received']}
        if n == 7: c['feedbackAttemptCap'] = 7; c['feedbackNewReportCap'] = 4
        if n == 12: c['permissionQualification'] = {'denialThenGrantSameContext': True, 'receipt': R['perm']}
        if n in (13, 14):
            c['downloadFault'] = {'id': f'{cid}-model-asset', 'mode': 'download-fails' if n == 13 else 'offline-mid-download',
                                  'url': f'https://{HOST_APP}/models/whisper-base.en/onnx/encoder_model_quantized.onnx',
                                  **({'afterBytes': 8388608, 'qualificationReceipt': R['dl']} if n == 14 else {})}
        if n in (4, 13, 14): c['coldModelRequired'] = True
        p = f'{PRIVATE}/cases/{cid}.json'; h = put(p, c)
        cases[cid] = (p, h)
    json.dump({'media_of': media_of, 'receiver_sha': receiver_sha, 'oracle_sha': oracle_sha, 'schema_sha': schema_sha,
               'pdf_sha': pdf_sha, 'uid_sha256': sha(UID.encode())}, open(f'{PRIVATE}/cfg/phase1-facts.json', 'w'), indent=2)
    # policy (campaign copy of the reviewed template; disclosed tightenings)
    pol = jload(f'{PACKET}/bundle/config/policy.production.TEMPLATE.json')
    pol = {k: v for k, v in pol.items() if not k.startswith('_')}
    pol['sourceSha'] = B; pol['deadlineAt'] = T1; pol['caps'] = dict(CAPS); pol['requestTimeoutMs'] = 180000
    for h_, cfg in pol['hosts'].items():
        keep = []
        for r in cfg['rules']:
            r = {k: v for k, v in r.items() if not k.startswith('_')}
            r['review'] = False; r['reviewedSourceSha'] = B
            if r['id'] == 'fn-account-closure': continue                      # defense in depth: no account closure
            if r['id'] == 'auth-user': r['methods'] = ['GET']                  # no credential change (PUT removed)
            if r['id'] == 'rest-write': r['methods'] = ['POST', 'PATCH']       # no destructive DELETE
            if r['id'] == 'rest-read' and os.environ.get('BP_LEASE_READ') == '1':   # GET-only read of the account's own active lease (the app calls it on leave/return)
                r['path'] = r['path'].replace('|objective_source_recording)$', '|objective_source_recording|active_recording_lease)$'); assert 'active_recording_lease' in r['path']
            if r['id'] == 'rpc' and os.environ.get('BP_LEASE_RPCS') == '1':    # #1476 recording lease + read-only obligations RPC the app calls at 2b48eabc
                r['path'] = r['path'].replace('|complete_session_v2)$', '|complete_session_v2|acquire_recording_lease|heartbeat_recording_lease|release_recording_lease|get_progress_obligations)$'); assert 'acquire_recording_lease' in r['path']
            keep.append(r)
        cfg['rules'] = keep
    pol_sha = put(f'{PRIVATE}/cfg/policy.json', pol)
    # security approval
    sa = {'version': 1, 'runtime': RUNTIME, 'action': 'ephemeral-browser-spki-exception', 'ownerApprovalReference': OWNER_REF,
          'approvedBy': APPROVED_BY, 'approvalSource': 'explicit-user-message', 'reviewedCodeManifestSha256': shaf(f'{PACKET}/bundle/CODE.sha256'),
          'notBefore': T0, 'expiresAt': T1, 'allowedHosts': [HOST_APP, HOST_DB, 'a.test', 'c.test', 'd.test'],
          'installTrustRoot': False, 'globalCertificateBypass': False, 'environmentSecurityChanges': False,
          'capabilities': {'lighthouse': {'selected': False, 'ownerApprovalReference': OWNER_REF}}}
    sa_sha = put(f'{PRIVATE}/cfg/security-approval.json', sa)
    # provider contract evidence
    pe = {'kind': 'reviewed-provider-attempt-zero-cost-scope-evidence', 'sourceSha': B, 'ownerScopeReference': OWNER_REF,
          'reviewer': REVIEWER, 'reviewedAt': now(),
          'evidenceReferences': FACTS.get('providerEvidenceReferences', ['owner-directive:$0-paid-actions;no-payments']),
          'measuredProviderAttempts': 'UNKNOWN', 'measuredProviderCostUsd': 'UNKNOWN', 'costCeilingUsd': 0,
          'zeroCostAdmissibility': 'NOT_ESTABLISHED: $0 is an owner-set ceiling on paid actions; deployed provider attempts and cost are unmeasured; coaching category cap %d' % CAPS['coaching']}
    pe_sha = put(f'{PRIVATE}/cfg/provider-contract-evidence.json', pe)
    # reviewed step manifest (campaign) = packaged static graph + the fail-closed receiver, reviewer bound
    m = jload(f'{PACKET}/bundle/config/reviewed-steps.EXAMPLE.json'); m = {k: v for k, v in m.items() if not k.startswith('_')}
    m['reviewer'] = REVIEWER + ' (drivers, oracle factory, durable oracle, fail-closed receiver inspected)'
    m['reviewedAt'] = now()
    receiver_deps = ['bundle/harness/existing-runner-receiver.cjs', 'bundle/harness/existing-runner-projection.cjs',
                     'draft-adapters/oracles/pure/rwtCoachingEvidence.cjs', 'draft-adapters/oracles/pure/coaching-contract.json',
                     'draft-adapters/oracles/pure/fixture-manifest.json'] if same_job else []
    m['steps'].append({'path': receiver_rel, 'sha256': receiver_sha,
                       'dependencies': [{'path': p, 'sha256': shaf(f'{PACKET}/{p}')} for p in receiver_deps]})
    steps_sha = put(f'{PRIVATE}/cfg/reviewed-steps.json', m)
    q = jload(f'{PACKET}/bundle/qualification/reviewed-steps.TEMPLATE.json'); q = {k: v for k, v in q.items() if not k.startswith('_')}
    q['reviewer'] = REVIEWER + ' (qualification helper steps inspected)'; q['reviewedAt'] = now()
    qsteps_sha = put(f'{PRIVATE}/cfg/qualification-steps.json', q)
    # save-oracle configs (AHT-05/06) bound to the reviewed manifest
    for n in (5, 6):
        so = {'manifestFile': f'{PRIVATE}/cfg/reviewed-steps.json', 'expectedManifestSha256': steps_sha, 'stepRoot': PACKET,
              'oracleFile': f'{PACKET}/draft-adapters/durable-save-oracle.cjs', 'sourceId': f'{CAMPAIGN}-AHT-{n:02d}',
              'dynamicSessionBinding': {'host': HOST_DB, 'ownerId': UID, 'sourceSha': B}}
        put(f'{PRIVATE}/cfg/save-oracle-AHT-{n:02d}.json', so)
    # plan rows file (finished in phase 2 once hashes of everything exist)
    json.dump({'cases': {k: {'config': v[0], 'configSha256': v[1]} for k, v in cases.items()}, 'policySha256': pol_sha,
               'securityApprovalSha256': sa_sha, 'providerEvidenceSha256': pe_sha, 'stepsSha256': steps_sha, 'qualStepsSha256': qsteps_sha,
               'producerReceiverRelativePath': receiver_rel},
              open(f'{PRIVATE}/cfg/phase1-index.json', 'w'), indent=2)
    print('phase1 OK', json.dumps({'cases': len(cases), 'policy': pol_sha[:12], 'approval': sa_sha[:12], 'steps': steps_sha[:12]}))

elif phase == 'phase2':
    idx = jload(f'{PRIVATE}/cfg/phase1-index.json'); facts = jload(f'{PRIVATE}/cfg/phase1-facts.json')
    UID = open(UID_FILE).read().strip()
    # runtime attestation: actual platform observation, written only after the window opened
    assert now() >= T0, 'window not open yet'
    if RUNTIME == 'GitHub Actions SpeakSharp':
        assert os.environ.get('GITHUB_ACTIONS') == 'true' and need('GITHUB_REPOSITORY') == 'relativityE/speaksharp', 'actual selected GitHub job required'
        run_id, attempt, job_id = need('GITHUB_RUN_ID'), need('GITHUB_RUN_ATTEMPT'), need('GITHUB_JOB')
        assert run_id.isdecimal() and attempt.isdecimal(), 'actual GitHub run/attempt required'
        workflow_sha = need('GITHUB_SHA')
        assert len(workflow_sha) == 40 and all(c in '0123456789abcdef' for c in workflow_sha), 'workflow source identity missing'
        att = {'kind': 'github-actions-job-environment-receipt', 'platformUrl': 'https://github.com', 'runtime': RUNTIME,
               'repository': 'relativityE/speaksharp', 'runId': run_id, 'runAttempt': attempt, 'jobId': job_id,
               'workflowSourceSha': workflow_sha, 'observedAt': now(),
               'sourceReference': f'https://github.com/relativityE/speaksharp/actions/runs/{run_id}',
               'immutableEnvironmentId': f'relativityE/speaksharp/{run_id}/{attempt}/{job_id}'}
    else:
        att = {'kind': 'authoritative-claude-task-environment-receipt', 'platformUrl': 'https://claude.ai/code',
               'environmentSelector': 'SpeakSharp R4', 'runtime': RUNTIME,
               'taskId': need('BP_TASK_ID'), 'sourceReference': need('BP_SOURCE_REFERENCE'), 'observedAt': now(),
               'immutableEnvironmentId': need('BP_ENV_ID')}
    att_sha = put(f'{PRIVATE}/cfg/runtime-attestation.json', att)
    tmpl = jload(f'{PACKET}/bundle/config/admission.TEMPLATE.json'); adm = {k: v for k, v in tmpl.items() if not k.startswith('_')}
    adm.update({'runtime': RUNTIME, 'sourceSha': B, 'sourceTree': TREE, 'lockSha256': shaf(f'{CHECKOUT}/pnpm-lock.yaml'), 'checkoutDir': CHECKOUT,
                'lighthouseCli': None, 'lighthouseSelection': 'not-selected', 'expectedServedSha': B, 'identityCap': IDENT_CAP,
                'identityLedger': f'{PRIVATE}/ledgers/identity-ledger.json', 'campaignLedger': f'{PRIVATE}/ledgers/campaign-ledger.json',
                'securityApprovalFile': f'{PRIVATE}/cfg/security-approval.json', 'securityApprovalSha256': idx['securityApprovalSha256'],
                'reviewedStepManifest': f'{PRIVATE}/cfg/reviewed-steps.json', 'reviewedStepManifestSha256': idx['stepsSha256'],
                'reviewedStepRoot': PACKET, 'qualificationStepManifest': f'{PRIVATE}/cfg/qualification-steps.json',
                'qualificationStepManifestSha256': idx['qualStepsSha256'], 'approvedStartAt': T0, 'approvedDeadlineAt': T1,
                'policyFile': f'{PRIVATE}/cfg/policy.json', 'policySha256': idx['policySha256'], 'accountSelection': 'throwaway',
                'providerAttemptContractEvidence': {'file': f'{PRIVATE}/cfg/provider-contract-evidence.json', 'sha256': idx['providerEvidenceSha256']},
                'campaignId': CAMPAIGN, 'privateMediaParent': MEDIA_PARENT, 'runtimeAttestationFile': f'{PRIVATE}/cfg/runtime-attestation.json',
                'runtimeAttestationSha256': att_sha, 'ownerApprovalReference': OWNER_REF, 'qualificationMaxMs': QUAL_MS,
                'cleanupReserveMs': CLEANUP_MS, 'runtimeEnvironmentId': att['immutableEnvironmentId']})
    if RUNTIME == 'GitHub Actions SpeakSharp':
        adm['runtimeWorkflowSourceSha'] = att['workflowSourceSha']
    os.makedirs(f'{PRIVATE}/ledgers', mode=0o700, exist_ok=True)
    adm_sha = put(f'{PRIVATE}/cfg/admission.json', adm)
    rows = []
    prod_cases = {1, 2, 3, 7, 8}
    oracle_cases = {1, 2, 3, 7, 8, 9, 10, 11}
    for n in SEL:
        cid = f'AHT-{n:02d}'; drv = f'{PACKET}/draft-adapters/{cid}.cjs'
        r = {'id': cid, 'driverFile': drv, 'driverSha256': shaf(drv), 'configFile': idx['cases'][cid]['config'],
             'configSha256': idx['cases'][cid]['configSha256'], 'maxMs': MAXMS[n]}
        if TAKES[n] > 0 or PRESS[n] > 0:
            wav = f"{CHECKOUT}/tests/fixtures/rwt/{facts['media_of'][cid]}"; r['mediaFile'] = wav; r['mediaSha256'] = shaf(wav)
        if n in (5, 6):
            of = f'{PRIVATE}/cfg/save-oracle-{cid}.json'; r['oracleConfigFile'] = of; r['oracleConfigSha256'] = shaf(of)
        if n in oracle_cases: r['caseOracleFile'] = f'{PACKET}/draft-adapters/oracles/index.cjs'
        if n in prod_cases: r['producerReceiverFile'] = f"{PACKET}/{idx['producerReceiverRelativePath']}"
        rows.append(r)
    plan = {'version': 1, 'campaignId': CAMPAIGN, 'runtime': RUNTIME, 'targetUrl': f'https://{HOST_APP}/', 'costCeilingUsd': 0,
            'sourceSha': B, 'servedSha': B, 'admissionConfigFile': f'{PRIVATE}/cfg/admission.json', 'admissionConfigSha256': adm_sha,
            'stepRoot': PACKET, 'stepManifestFile': f'{PRIVATE}/cfg/reviewed-steps.json', 'stepManifestSha256': idx['stepsSha256'],
            'campaignLedger': adm['campaignLedger'], 'identityLedger': adm['identityLedger'], 'runRoot': f'{PRIVATE}/run',
            'identityCap': IDENT_CAP, 'deadlineAt': T1, 'cleanupReserveMs': CLEANUP_MS, 'requirementMappings': [], 'cases': rows}
    if MINIMAL:
        plan['requestBudget'] = {'runCap': CAPS['total'], 'cleanupReserve': BP_CLEANUP,
                                 'estimates': {f'AHT-{k:02d}': v for k, v in MIN_EST.items()},
                                 'ceilings': {f'AHT-{k:02d}': ((v * 125 + 99) // 100 + 9) // 10 * 10 for k, v in MIN_EST.items()}}
    if FULL:
        # full coverage: every case, every required assertion; the harness's own per-case caps (TAKES/PRESS) stay at the contract minimums
        if sorted(BP_EST) != list(range(1, 16)) or SELECTED != list(range(1, 16)):
            print('BLOCKED_SETUP: full mode needs all 15 cases selected in order and a request estimate for each', file=sys.stderr); sys.exit(78)
        plan['requestBudget'] = {'runCap': CAPS['total'], 'cleanupReserve': BP_CLEANUP,
                                 'estimates': {f'AHT-{k:02d}': v for k, v in BP_EST.items()},
                                 'ceilings': {f'AHT-{k:02d}': ((v * 125 + 99) // 100 + 9) // 10 * 10 for k, v in BP_EST.items()}}
    if BREADTH:
        plan['requestBudget'] = {'runCap': CAPS['total'], 'cleanupReserve': BP_CLEANUP,
                                 'estimates': {f'AHT-{k:02d}': v for k, v in BREADTH_EST.items()},
                                 'ceilings': {f'AHT-{k:02d}': ((v * 125 + 99) // 100 + 9) // 10 * 10 for k, v in BREADTH_EST.items()}}
        if BREADTH_SKIP: plan['requestBudget']['skip'] = [f'AHT-{k:02d}' for k in BREADTH_SKIP]
    # r15: explicit case selection (ordered), stimulus gates, run identity binding, stimulus preflight receipt
    sel_env = os.environ.get('BP_SELECT', '')
    if sel_env:
        order = [f'AHT-{int(x):02d}' for x in sel_env.split(',')]
        plan['selection'] = {'ids': list(order), 'order': list(order), 'ownerApprovalReference': need('BP_SELECT_REF'),
                             'reason': need('BP_SELECT_REASON')}
        gates = []
        for g in [x for x in os.environ.get('BP_GATES', '').split(',') if x]:
            case, req_case, req_row = g.split(':')
            gates.append({'caseId': f'AHT-{int(case):02d}', 'requires': [{'caseId': f'AHT-{int(req_case):02d}', 'row': req_row, 'result': 'PASS'}]})
        if gates: plan['gates'] = gates
    FBE = FACTS.get('backend') or {}
    for _k in ('manifestRef', 'generation', 'completion', 'migration129'):
        if _k not in FBE:
            print('BLOCKED_SETUP: facts.backend lacks %s' % _k, file=sys.stderr); sys.exit(78)
    plan['runIdentity'] = {'frontend': {'sourceSha': B, 'servedSha': B},
                           'runner': {'codeManifestSha256': shaf(f'{PACKET}/bundle/CODE.sha256'), 'packetManifestSha256': shaf(f'{PACKET}/PACKET-MANIFEST.sha256')},
                           'backend': {'manifestRef': FBE['manifestRef'], 'source': os.environ.get('BP_BACKEND_SOURCE') or FBE.get('source', 'owner-stated'),
                                       'generation': int(FBE['generation']), 'completion': FBE['completion'],
                                       'facts': [{'name': 'migration-129', 'state': FBE['migration129']}],
                                       'verifiedAtUtc': os.environ.get('BP_BACKEND_VERIFIED') or None}}
    if os.environ.get('BP_STIM'):
        plan['stimulusPreflight'] = {'file': os.environ['BP_STIM'], 'sha256': shaf(os.environ['BP_STIM'])}
    plan_sha = put(f'{PRIVATE}/cfg/campaign-plan.json', plan)
    print('phase2 OK', json.dumps({'attestation': att_sha[:12], 'admission': adm_sha[:12], 'plan': plan_sha[:12]}))
