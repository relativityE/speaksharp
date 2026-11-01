#!/usr/bin/env python3
"""Validate all private binding inputs before emitting this phase's files.

Expected input failures return a closed code and 78. Write-stage failures are
outside that handler and must never masquerade as a pre-effect refusal.
"""
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time


def sha(data):
    return hashlib.sha256(data).hexdigest()


def now():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def read_binding_inputs(env, argv):
    # -I deliberately ignores PYTHONPATH; resolve the reviewed sibling explicitly.
    script_dir = Path(__file__).resolve().parents[1] / 'scripts'
    sys.path.insert(0, str(script_dir))
    caps_module = importlib.import_module('case_start_caps')
    if Path(caps_module.__file__).resolve() != script_dir / 'case_start_caps.py':
        raise ValueError('parser-location')
    InputValidationError = caps_module.InputValidationError
    require, obj = caps_module.require, caps_module.obj
    bind_inputs, verified_contracts = caps_module.bind_inputs, caps_module.verified_contracts
    require(len(argv) == 1 and argv[0] in ('phase1', 'phase2'), 'phase')
    require(type(env) is dict, 'environment')
    files, directories = {}, set()

    def need(name):
        return caps_module.text(env.get(name), 'required-environment')

    def shaf(path):
        return sha(Path(path).read_bytes())

    def jload(path):
        return json.loads(Path(path).read_text(encoding='utf-8'))

    def put(path, value, mode=0o600):
        require(path not in files and not os.path.lexists(path), 'fresh-output')
        data = (json.dumps(value, indent=2) + '\n').encode()
        files[path] = (data, mode)
        directories.add(str(Path(path).parent))
        return sha(data)

    MODE = env.get('BP_MODE')
    RUNTIME = env.get('BP_RUNTIME', 'Claude SpeakSharp R4')
    if RUNTIME not in ('Claude SpeakSharp R4', 'GitHub Actions SpeakSharp'):
        raise ValueError('BLOCKED_SETUP: unsupported execution runtime')
    if MODE not in ('minimal', 'full', 'selected-full'):
        raise InputValidationError('input-binding')
    PACKET = need('BP_PACKET')
    CHECKOUT = need('BP_CHECKOUT')
    PRIVATE = need('BP_PRIVATE')
    MEDIA_PARENT = env.get('BP_MEDIA_PARENT', '/var/tmp/ss-media-cloud-test')
    B = need('BP_SOURCE_SHA')
    require(len(B) == 40 and all(c in '0123456789abcdef' for c in B), 'input-binding')
    def _git(*a):
        r = subprocess.run(['git', '-C', CHECKOUT] + list(a), capture_output=True, text=True)
        if r.returncode:
            raise InputValidationError('input-binding')
        return r.stdout.strip()
    TREE = _git('rev-parse', B + '^{tree}')
    QUAL_MS, CLEANUP_MS = 1200000, 120000
    SEL = [int(x) for x in env.get('BP_CASES', ','.join(str(i) for i in range(1, 16))).split(',')]
    SELECTED = [int(x) for x in env['BP_SELECT'].split(',')] if env.get('BP_SELECT') else SEL
    for values in (SEL, SELECTED):
        require(values and len(values) == len(set(values)) and set(values).issubset(range(1, 16)), 'case-tokens')
    IDENT_CAP = int(env.get('BP_IDENT', '32'))
    CAMPAIGN = need('BP_CAMPAIGN')
    T0 = need('BP_T0')
    T1 = need('BP_T1')
    FACTS = jload(need('BP_FACTS'))
    facts_sha = shaf(env['BP_FACTS'])
    obj(FACTS, 'facts-object')
    obj(FACTS.get('receipts'), 'facts-receipts')
    for _key in ('backend',):
        if _key in FACTS: obj(FACTS[_key], 'facts-' + _key)
    for _k in ('ownerApprovalReference', 'approvedBy', 'reviewer', 'receipts'):
        if not FACTS.get(_k):
            raise InputValidationError('input-binding')
    for _k in ('pre', 'rls', 'analytics', 'disp', 'fence', 'review'):
        caps_module.text(FACTS['receipts'].get(_k), 'facts-reference')
    for _k in ('ownerApprovalReference', 'approvedBy', 'reviewer'):
        caps_module.text(FACTS[_k], 'facts-reference')
    OWNER_REF = FACTS['ownerApprovalReference']
    APPROVED_BY = FACTS['approvedBy']
    REVIEWER = FACTS['reviewer']
    CAPS = {'total': 5200, 'navigations': 150, 'public': 2400, 'preflight': 1500, 'auth': 200, 'signed-in': 2400,
            'coaching': 40, 'account-closure': 0, 'model': 400}
    MAXMS = {1: 1500000, 2: 2400000, 3: 1500000, 4: 1200000, 5: 900000, 6: 900000, 7: 1200000, 8: 300000,
             9: 900000, 10: 900000, 11: 900000, 12: 1500000, 13: 900000, 14: 900000, 15: 420000}
    require(not env.get('BP_PRESS_EXTRA'), 'press-extra-forbidden')
    TAKES = {1: 4, 2: 7, 3: 4, 4: 1, 5: 2, 6: 2, 7: 2, 8: 0, 9: 2, 10: 2, 11: 2, 12: 1, 13: 1, 14: 1, 15: 0}
    # Inactive rows retain their old defaults. Only a selected, bound allocation
    # can fund the three-action recovery path; generating a row grants nothing.
    PRESS = {1: 4, 2: 7, 3: 4, 4: 2, 5: 2, 6: 2, 7: 2, 8: 0, 9: 3, 10: 3, 11: 4, 12: 3, 13: 2, 14: 2, 15: 0}
    MINIMAL = MODE == 'minimal'
    FULL = MODE == 'full'
    SELECTED_FULL = MODE == 'selected-full'
    MIN_TAKES = {1: 2, 2: 1, 3: 1, 4: 0, 5: 1, 6: 1, 7: 1, 8: 0, 9: 1, 10: 1, 11: 1, 12: 0, 13: 0, 14: 0, 15: 0}
    MIN_PRESS = {1: 2, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 0, 9: 1, 10: 1, 11: 3, 12: 1, 13: 1, 14: 1, 15: 0}
    MIN_EST = {1: 350, 2: 190, 3: 170, 4: 90, 5: 160, 6: 160, 7: 150, 8: 90, 9: 190, 10: 120, 11: 170, 12: 100, 13: 115, 14: 125, 15: 125}
    if MINIMAL:
        TAKES.update(MIN_TAKES); PRESS.update(MIN_PRESS)
    require(not env.get('BP_SKIP'), 'skip-forbidden')
    BP_CLEANUP = int(env.get('BP_CLEANUP', '50'))
    pairs = [x.split(':') for x in env.get('BP_EST', '').split(',') if x]
    require(all(len(p) == 2 and all(t.isdecimal() for t in p) for p in pairs), 'estimate-tokens')
    require(len({p[0] for p in pairs}) == len(pairs), 'duplicate-estimate')
    BP_EST = {int(k): int(v) for k, v in pairs}
    for _k, _v in BP_EST.items(): MIN_EST[_k] = _v   # partial (minimal) mode only; full mode uses BP_EST directly
    CAPS['total'] = int(need('BP_TOTAL'))
    if env.get('BP_COACHING_CAP') not in (None, ''):
        CAPS['coaching'] = int(env['BP_COACHING_CAP'])
    HOST_APP = env.get('BP_HOST_APP', 'speaksharp-public.vercel.app')
    HOST_DB = env.get('BP_HOST_DB', 'yxlapjuovrsvjswkwnrk.supabase.co')
    PROJECT_REF = HOST_DB.split('.')[0]
    ACCOUNT_BINDINGS_FILE = need('BP_ACCOUNT_BINDINGS_FILE')
    ACCOUNT_BUNDLE_SHA256 = need('BP_LIVE_ACCOUNTS_SHA256')
    uuid_v4 = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    sha256 = re.compile(r'^[0-9a-f]{64}$')

    def account_bindings():
        path = Path(ACCOUNT_BINDINGS_FILE)
        info = path.lstat()
        require(path.is_absolute() and path.resolve() == path and stat.S_ISREG(info.st_mode)
                and not path.is_symlink() and info.st_nlink == 1
                and stat.S_IMODE(info.st_mode) == 0o600, 'account-bindings-file')
        value = obj(jload(path), 'account-bindings')
        require(set(value) == {'schema', 'projectRef', 'projectOrigin', 'sourceBundleSha256', 'roles', 'campaignId'},
                'account-bindings-shape')
        require(value['schema'] == 'speaksharp.cloud-test.live-account-bindings.v1'
                and value['campaignId'] == CAMPAIGN, 'account-bindings-campaign')
        require(value['projectRef'] == PROJECT_REF
                and value['projectOrigin'] == f'https://{HOST_DB}', 'account-bindings-project')
        require(sha256.fullmatch(ACCOUNT_BUNDLE_SHA256) is not None
                and value['sourceBundleSha256'] == ACCOUNT_BUNDLE_SHA256, 'account-bindings-source')
        expected = {
            'existing-disposable': {'email': 'THROWAWAY_TEST_EMAIL', 'password': 'THROWAWAY_TEST_PASSWORD'},
            'maintained-read-only': {'email': 'FREE_TEST_EMAIL', 'password': 'FREE_TEST_PASSWORD'},
        }
        roles = obj(value.get('roles'), 'account-binding-roles')
        require(set(roles) == set(expected), 'account-binding-roles')
        ids = []
        for role, credential_vars in expected.items():
            row = obj(roles[role], 'account-binding-role')
            require(set(row) == {'accountId', 'credentialVars'}
                    and row['credentialVars'] == credential_vars, 'account-binding-role')
            uid = row['accountId']
            require(type(uid) is str and uuid_v4.fullmatch(uid) is not None, 'account-binding-id')
            ids.append(uid)
        require(len(set(ids)) == len(ids), 'account-binding-distinct')
        return value

    phase = argv[0]
    require(os.path.realpath(PRIVATE) == PRIVATE, 'private-canonical')
    require(not os.path.exists(PRIVATE) or (os.path.isdir(PRIVATE) and (os.stat(PRIVATE).st_mode & 0o777) == 0o700), 'private-mode')
    binding = bind_inputs(env, FACTS)
    require(MODE == binding['mode'], 'mode-binding')
    request = binding['request']
    require(BP_EST == {int(row['case'][-2:]): row['plannedRequests'] for row in request['selection']}, 'estimate-binding')
    require(IDENT_CAP == caps_module.integer(request['estimate'].get('identityReads'), 'identity-estimate'), 'identity-binding')
    require(BP_CLEANUP == caps_module.integer(request['estimate']['requests'].get('cleanupReserve'), 'cleanup-estimate'), 'cleanup-binding')
    require(CAPS['total'] == caps_module.integer(request['approvedLimits'].get('runCapRequests'), 'request-cap'), 'request-cap-binding')
    require(CAPS['coaching'] == caps_module.integer(request['estimate']['providerBillableRequests'].get('coachingCap'), 'coaching-cap'), 'coaching-binding')
    require(not (FULL or SELECTED_FULL) or SEL == list(range(1, 16)), 'full-denominator')
    gate_rows = []
    expected_gates = []
    for row in request['selection']:
        if row.get('gate'):
            require(type(row['gate']) is str, 'request-gate')
            previous, label = row['gate'].split(':')
            require(previous in binding['caps'] and list(binding['caps']).index(previous) < list(binding['caps']).index(row['case']) and label, 'request-gate')
            expected_gates.append('%d:%d:%s' % (int(row['case'][-2:]), int(previous[-2:]), label))
    require(env.get('BP_GATES', '') == ','.join(expected_gates), 'gate-binding')
    for token in expected_gates:
        case, previous, label = token.split(':')
        gate_rows.append({'caseId': 'AHT-%02d' % int(case), 'requires': [{'caseId': 'AHT-%02d' % int(previous), 'row': label, 'result': 'PASS'}]})
    contracts = verified_contracts(jload(f'{PACKET}/draft-adapters/contracts.json'))
    configuration = obj(jload(script_dir.parent / 'config/test-config.v1.json'), 'package-config')
    full_mode = obj(obj(configuration.get('modes'), 'package-modes').get('full'), 'package-full-mode')
    catalog_pin = obj(full_mode.get('assertionCatalog'), 'catalog-pin')
    require(catalog_pin.get('file') == 'config/assertion-catalog.json', 'catalog-path')
    catalog_path = script_dir.parent / catalog_pin['file']
    require(shaf(catalog_path) == catalog_pin.get('sha256'), 'catalog-digest')
    catalog = obj(jload(catalog_path), 'catalog')
    require(catalog.get('contractsSha256') == shaf(f'{PACKET}/draft-adapters/contracts.json'), 'catalog-contract-digest')
    catalog_cases = obj(catalog.get('cases'), 'catalog-cases')
    require(set(catalog_cases) == set(contracts), 'catalog-cases')
    for cid, contract in contracts.items():
        row = obj(catalog_cases[cid], 'catalog-case')
        require(type(row.get('minimumStarts')) is int and row['minimumStarts'] == contract['requiredStartPressCap'], 'catalog-starts')
        require(row.get('requiredAssertions') == contract['requiredAssertions'], 'catalog-assertions')
        require(type(row.get('minimumTakes')) is int and row['minimumTakes'] == contract['minimumAuthorizedTakes'], 'catalog-takes')
    require(catalog.get('minimumStarts') == 42 and catalog.get('minimumTakes') == 31 and catalog.get('totalAssertions') == 204, 'catalog-totals')
    PRESS.update({int(cid[-2:]): cap for cid, cap in binding['caps'].items()})

    if phase == 'phase1':
        ACCOUNT_BINDINGS = account_bindings()
        ACCOUNT_BINDINGS_SHA = shaf(ACCOUNT_BINDINGS_FILE)
        DISPOSABLE_UID = ACCOUNT_BINDINGS['roles']['existing-disposable']['accountId']
        ANON = need('VITE_SUPABASE_ANON_KEY')
        fx = obj(obj(jload(f'{PACKET}/draft-adapters/oracles/pure/fixture-manifest.json'), 'fixture-manifest')['fixtures'], 'fixtures')
        oracle_sha = shaf(f'{PACKET}/draft-adapters/oracles/index.cjs')
        producer_mode = env.get('BP_PRODUCER_MODE', 'unavailable')
        if producer_mode not in ('unavailable', 'same-github-job'):
            raise InputValidationError('producer-mode')
        same_job = producer_mode == 'same-github-job'
        require(not same_job or RUNTIME == 'GitHub Actions SpeakSharp', 'input-binding')
        # The execution platform is independent of whether these exact selected cases
        # need a privileged evidence producer. AHT04/15 must not acquire service keys
        # merely to run in GitHub. Evidence-dependent cases still refuse before build.
        producer_cases_selected = set(SELECTED).intersection({1, 2, 3, 7, 8})
        require(RUNTIME != 'GitHub Actions SpeakSharp' or same_job or not producer_cases_selected, 'input-binding')
        receiver_rel = 'draft-adapters/receivers/' + ('github-job-evidence-reader.cjs' if same_job else 'unavailable-evidence-reader.cjs')
        receiver_path = f'{PACKET}/{receiver_rel}'
        receiver_sha = shaf(receiver_path)
        descriptor = None
        if same_job:
            descriptor_file = need('BP_PRODUCER_DESCRIPTOR')
            require(shaf(descriptor_file) == need('BP_PRODUCER_DESCRIPTOR_SHA256'), 'input-binding')
            descriptor = obj(jload(descriptor_file), 'producer-descriptor')
            require(env.get('GITHUB_ACTIONS') == 'true' and env.get('GITHUB_REPOSITORY') == 'relativityE/speaksharp', 'input-binding')
            run_id, attempt = need('GITHUB_RUN_ID'), need('GITHUB_RUN_ATTEMPT')
            require(run_id.isdecimal() and attempt == '1', 'input-binding')
            job_id = need('GITHUB_JOB')
            require(descriptor['producerIdentity'] == f'github-actions:relativityE/speaksharp:{run_id}:{attempt}:{job_id}' and descriptor['jobId'] == job_id, 'input-binding')
            require(descriptor['producerCodeSha256'] == shaf(f'{PACKET}/bundle/harness/authenticated-job-producer.cjs'), 'input-binding')
            require(descriptor['receiverSourceSha256'] == receiver_sha and descriptor['receiverRelativePath'] == receiver_rel, 'input-binding')
            require(descriptor['workflowSourceSha'] == need('GITHUB_SHA'), 'input-binding')
            require(descriptor['reviewReference'] == FACTS.get('producerReviewReference') and descriptor['reviewReference'], 'input-binding')
        # schema digest: defined here as sha256 over sorted "path:blob" of backend/supabase/migrations at the pinned source
        mig = _git('ls-tree', '-r', B, '--', 'backend/supabase/migrations').splitlines()
        schema_sha = sha('\n'.join(sorted(f"{l.split()[3]}:{l.split()[2]}" for l in mig)).encode())
        _pdf = os.path.join(env.get('BP_PDFJS_DIR') or f'{CHECKOUT}/node_modules/pdfjs-dist', 'legacy/build/pdf.mjs')
        pdf_sha = shaf(_pdf) if os.path.exists(_pdf) else None
        if env.get('BP_PDFJS_SHA') and pdf_sha is not None and pdf_sha != env['BP_PDFJS_SHA']:
            raise InputValidationError('input-binding')
        if pdf_sha is None and 1 in SELECTED:
            raise InputValidationError('input-binding')
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
                'feedback-received': producer('feedback-received', 'authenticated-connector-artifact', ['startedAt', 'journeyId', 'bootId', 'trafficType'])}
        FIX = {'open': 'open_mic_tts', 'focus': 'focus_points_tts', 'partial': 'focus_points_partial_tts'}
        def fixture(name):
            e = obj(fx[name], 'fixture'); return {'name': name, 'sha256': e['sha256'], 'launchSha256': e['sha256'], 'speechDurationMs': int(round(e['speechSeconds'] * 1000))}, e
        cases, plan_rows, media_of = {}, [], {}
        for n in range(1, 16):
            cid = f'AHT-{n:02d}'
            t = obj(jload(f'{PACKET}/bundle/config/cases/{cid}.TEMPLATE.json'), 'case-template')
            require(t.get('_minimumStartPressCap') == contracts[cid]['requiredStartPressCap'], 'template-minimum')
            c = {k: v for k, v in t.items() if not k.startswith('_')}
            c.update({'campaignId': CAMPAIGN, 'sourceSha': B, 'servedSha': B, 'targetUrl': f'https://{HOST_APP}',
                      'takeCap': TAKES[n], 'startPressCap': PRESS[n]})
            if MINIMAL: c['sampleMode'] = 'minimal'
            if n in SELECTED:
                c['startPressApproval'] = {'caseId': cid, 'cap': PRESS[n],
                    'requestSha256': binding['requestSha256'], 'reconciliationSha256': binding['reconciliationSha256'],
                    'approvalRef': binding['approval']['approvalRef'], 'selectionApprovalRef': binding['approval']['selectionApprovalRef']}
            account_role = 'maintained-read-only' if n == 15 else 'existing-disposable'
            account_binding = ACCOUNT_BINDINGS['roles'][account_role]
            c['account'] = {'id': account_binding['accountId'], 'mode': account_role,
                            'bindingReceiptSha256': ACCOUNT_BINDINGS_SHA,
                            'preprovisionReceipt': R['pre'], 'analyticsExclusionReceipt': R['analytics'],
                            'dispositionReceipt': R['disp'], 'effectiveFeatureAccessApproved': True}
            c['credentialVars'] = dict(account_binding['credentialVars'])
            c['readback'] = {'origin': f'https://{HOST_DB}', 'projectRef': PROJECT_REF, 'anonKey': ANON,
                             'schemaSha256': schema_sha, 'ownerReadApproved': True, 'rlsReadQualificationReceipt': R['rls']}
            if n in (9, 10): c['readback']['immutableFenceMigrationQualificationReceipt'] = R['fence']
            c['observerSourceReviewed'] = True; c['observerQualificationReceipt'] = R['obs']
            for name, ob in obj(c.get('oracleBindings', {}), 'oracle-bindings').items():
                obj(ob, 'oracle-binding')
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
            if n == 7:
                c['privateEvidenceProducers'] = {'coaching-authority': PROD['coaching-authority'],
                                                 'feedback-association': PROD['feedback-association'],
                                                 'feedback-received': PROD['feedback-received']}
            if n == 8: c['privateEvidenceProducers'] = {'feedback-association': PROD['feedback-association'], 'feedback-received': PROD['feedback-received']}
            if n == 7: c['feedbackAttemptCap'] = 7; c['feedbackNewReportCap'] = 4
            if n == 12: c['permissionQualification'] = {'denialThenGrantSameContext': True, 'receipt': R['perm']}
            if n in (13, 14):
                c['downloadFault'] = {'id': f'{cid}-model-asset', 'mode': 'download-fails' if n == 13 else 'offline-mid-download',
                                      'url': f'https://{HOST_APP}/models/whisper-base.en/onnx/encoder_model_quantized.onnx',
                                      **({'afterBytes': 8388608, 'qualificationReceipt': R['dl']} if n == 14 else {})}
            if n in (4, 13, 14): c['coldModelRequired'] = True
            p = f'{PRIVATE}/cases/{cid}.json'; h = put(p, c)
            cases[cid] = (p, h)
        put(f'{PRIVATE}/cfg/phase1-facts.json', {'media_of': media_of, 'receiver_sha': receiver_sha, 'oracle_sha': oracle_sha, 'schema_sha': schema_sha,
                   'pdf_sha': pdf_sha, 'account_bindings_sha256': ACCOUNT_BINDINGS_SHA,
                   'account_uid_sha256': {role: sha(row['accountId'].encode()) for role, row in ACCOUNT_BINDINGS['roles'].items()}})
        # policy (campaign copy of the reviewed template; disclosed tightenings)
        pol = obj(jload(f'{PACKET}/bundle/config/policy.production.TEMPLATE.json'), 'policy')
        pol = {k: v for k, v in pol.items() if not k.startswith('_')}
        pol['sourceSha'] = B; pol['deadlineAt'] = T1; pol['caps'] = dict(CAPS); pol['requestTimeoutMs'] = 180000
        for h_, cfg in obj(pol.get('hosts'), 'policy-hosts').items():
            obj(cfg, 'policy-host')
            require(type(cfg.get('rules')) is list, 'policy-rules')
            keep = []
            for r in cfg['rules']:
                obj(r, 'policy-rule')
                r = {k: v for k, v in r.items() if not k.startswith('_')}
                r['review'] = False; r['reviewedSourceSha'] = B
                if r['id'] == 'fn-account-closure': continue                      # defense in depth: no account closure
                if r['id'] == 'auth-user': r['methods'] = ['GET']                  # no credential change (PUT removed)
                if r['id'] == 'rest-write': r['methods'] = ['POST', 'PATCH']       # no destructive DELETE
                if r['id'] == 'rest-read' and env.get('BP_LEASE_READ') == '1':   # GET-only read of the account's own active lease (the app calls it on leave/return)
                    r['path'] = r['path'].replace('|objective_source_recording)$', '|objective_source_recording|active_recording_lease)$')
                    require('active_recording_lease' in r['path'], 'lease-rule')
                if r['id'] == 'rpc' and env.get('BP_LEASE_RPCS') == '1':    # #1476 recording lease + read-only obligations RPC the app calls at 2b48eabc
                    r['path'] = r['path'].replace('|complete_session_v2)$', '|complete_session_v2|acquire_recording_lease|heartbeat_recording_lease|release_recording_lease|get_progress_obligations)$')
                    require('acquire_recording_lease' in r['path'], 'lease-rule')
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
        m = obj(jload(f'{PACKET}/bundle/config/reviewed-steps.EXAMPLE.json'), 'steps'); m = {k: v for k, v in m.items() if not k.startswith('_')}
        m['reviewer'] = REVIEWER + ' (drivers, oracle factory, durable oracle, fail-closed receiver inspected)'
        m['reviewedAt'] = now()
        receiver_deps = ['bundle/harness/existing-runner-receiver.cjs', 'bundle/harness/existing-runner-projection.cjs',
                         'draft-adapters/oracles/pure/rwtCoachingEvidence.cjs', 'draft-adapters/oracles/pure/coaching-contract.json',
                         'draft-adapters/oracles/pure/fixture-manifest.json'] if same_job else []
        require(type(m.get('steps')) is list, 'reviewed-steps')
        m['steps'].append({'path': receiver_rel, 'sha256': receiver_sha,
                           'dependencies': [{'path': p, 'sha256': shaf(f'{PACKET}/{p}')} for p in receiver_deps]})
        steps_sha = put(f'{PRIVATE}/cfg/reviewed-steps.json', m)
        q = obj(jload(f'{PACKET}/bundle/qualification/reviewed-steps.TEMPLATE.json'), 'qualification'); q = {k: v for k, v in q.items() if not k.startswith('_')}
        q['reviewer'] = REVIEWER + ' (qualification helper steps inspected)'; q['reviewedAt'] = now()
        qsteps_sha = put(f'{PRIVATE}/cfg/qualification-steps.json', q)
        # save-oracle configs (AHT-05/06) bound to the reviewed manifest
        for n in (5, 6):
            so = {'manifestFile': f'{PRIVATE}/cfg/reviewed-steps.json', 'expectedManifestSha256': steps_sha, 'stepRoot': PACKET,
                  'oracleFile': f'{PACKET}/draft-adapters/durable-save-oracle.cjs', 'sourceId': f'{CAMPAIGN}-AHT-{n:02d}',
                  'dynamicSessionBinding': {'host': HOST_DB, 'ownerId': DISPOSABLE_UID, 'sourceSha': B}}
            put(f'{PRIVATE}/cfg/save-oracle-AHT-{n:02d}.json', so)
        # plan rows file (finished in phase 2 once hashes of everything exist)
        put(f'{PRIVATE}/cfg/phase1-index.json', {'cases': {k: {'config': v[0], 'configSha256': v[1]} for k, v in cases.items()}, 'policySha256': pol_sha,
                   'securityApprovalSha256': sa_sha, 'providerEvidenceSha256': pe_sha, 'stepsSha256': steps_sha, 'qualStepsSha256': qsteps_sha,
                   'producerReceiverRelativePath': receiver_rel, 'binding': {
                       'requestSha256': binding['requestSha256'], 'reconciliationSha256': binding['reconciliationSha256'],
                       'factsSha256': facts_sha, 'runtime': RUNTIME, 'producerMode': producer_mode,
                       'descriptorSha256': env.get('BP_PRODUCER_DESCRIPTOR_SHA256')}})

    elif phase == 'phase2':
        idx = obj(jload(f'{PRIVATE}/cfg/phase1-index.json'), 'phase1-index')
        facts = obj(jload(f'{PRIVATE}/cfg/phase1-facts.json'), 'phase1-facts')
        require(obj(idx.get('binding'), 'phase1-binding') == {
            'requestSha256': binding['requestSha256'], 'reconciliationSha256': binding['reconciliationSha256'],
            'factsSha256': facts_sha, 'runtime': RUNTIME, 'producerMode': env.get('BP_PRODUCER_MODE', 'unavailable'),
            'descriptorSha256': env.get('BP_PRODUCER_DESCRIPTOR_SHA256')}, 'phase1-binding-differs')
        if env.get('BP_PRODUCER_MODE') == 'same-github-job':
            require(shaf(need('BP_PRODUCER_DESCRIPTOR')) == need('BP_PRODUCER_DESCRIPTOR_SHA256'), 'phase2-descriptor')
        obj(facts.get('media_of'), 'phase1-media')
        stored_cases = obj(idx.get('cases'), 'phase1-cases')
        require(set(stored_cases) == set(caps_module.CASE_IDS), 'phase1-cases')
        for cid, item in stored_cases.items():
            obj(item, 'phase1-case')
            require(item.get('config') == f'{PRIVATE}/cases/{cid}.json', 'phase1-path')
            require(shaf(item['config']) == item.get('configSha256'), 'phase1-case-digest')
        for filename, key in (('policy.json', 'policySha256'), ('security-approval.json', 'securityApprovalSha256'),
                              ('provider-contract-evidence.json', 'providerEvidenceSha256'), ('reviewed-steps.json', 'stepsSha256'),
                              ('qualification-steps.json', 'qualStepsSha256')):
            require(shaf(f'{PRIVATE}/cfg/{filename}') == idx.get(key), 'phase1-config-digest')
        require(idx.get('producerReceiverRelativePath') in ('draft-adapters/receivers/github-job-evidence-reader.cjs',
                'draft-adapters/receivers/unavailable-evidence-reader.cjs'), 'phase1-receiver')
        ACCOUNT_BINDINGS = account_bindings()
        require(shaf(ACCOUNT_BINDINGS_FILE) == facts.get('account_bindings_sha256'),
                'account-bindings-phase-differs')
        require({role: sha(row['accountId'].encode()) for role, row in ACCOUNT_BINDINGS['roles'].items()}
                == facts.get('account_uid_sha256'), 'account-ids-phase-differ')
        browser_identity_file = need('BP_BROWSER_IDENTITY')
        browser_identity = obj(jload(browser_identity_file), 'browser-identity')
        require(browser_identity.get('schema') in ('speaksharp.cloud-test.existing-browser.v1',
                'speaksharp.cloud-test.installed-browser.v1'), 'browser-identity-schema')
        browser_path = browser_identity.get('path')
        browser_sha = browser_identity.get('observedBinarySha256')
        require(type(browser_path) is str and os.path.isabs(browser_path)
                and os.path.realpath(browser_path) == browser_path
                and type(browser_sha) is str and sha256.fullmatch(browser_sha) is not None
                and os.path.isfile(browser_path) and not os.path.islink(browser_path)
                and shaf(browser_path) == browser_sha, 'browser-identity-binding')
        # runtime attestation: actual platform observation, written only after the window opened
        require(T0 <= now() < T1, 'window-not-open')
        if RUNTIME == 'GitHub Actions SpeakSharp':
            require(env.get('GITHUB_ACTIONS') == 'true' and need('GITHUB_REPOSITORY') == 'relativityE/speaksharp', 'input-binding')
            run_id, attempt, job_id = need('GITHUB_RUN_ID'), need('GITHUB_RUN_ATTEMPT'), need('GITHUB_JOB')
            require(run_id.isdecimal() and attempt == '1', 'input-binding')
            workflow_sha = need('GITHUB_SHA')
            require(len(workflow_sha) == 40 and all(c in '0123456789abcdef' for c in workflow_sha), 'input-binding')
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
        tmpl = obj(jload(f'{PACKET}/bundle/config/admission.TEMPLATE.json'), 'admission'); adm = {k: v for k, v in tmpl.items() if not k.startswith('_')}
        adm.update({'runtime': RUNTIME, 'sourceSha': B, 'sourceTree': TREE, 'lockSha256': shaf(f'{CHECKOUT}/pnpm-lock.yaml'), 'checkoutDir': CHECKOUT,
                    'lighthouseCli': None, 'lighthouseSelection': 'not-selected', 'expectedServedSha': B, 'identityCap': IDENT_CAP,
                    'identityLedger': f'{PRIVATE}/ledgers/identity-ledger.json', 'campaignLedger': f'{PRIVATE}/ledgers/campaign-ledger.json',
                    'securityApprovalFile': f'{PRIVATE}/cfg/security-approval.json', 'securityApprovalSha256': idx['securityApprovalSha256'],
                    'reviewedStepManifest': f'{PRIVATE}/cfg/reviewed-steps.json', 'reviewedStepManifestSha256': idx['stepsSha256'],
                    'reviewedStepRoot': PACKET, 'qualificationStepManifest': f'{PRIVATE}/cfg/qualification-steps.json',
                    'qualificationStepManifestSha256': idx['qualStepsSha256'], 'approvedStartAt': T0, 'approvedDeadlineAt': T1,
                    'policyFile': f'{PRIVATE}/cfg/policy.json', 'policySha256': idx['policySha256'], 'accountSelection': 'throwaway',
                    'providerAttemptContractEvidence': {'file': f'{PRIVATE}/cfg/provider-contract-evidence.json', 'sha256': idx['providerEvidenceSha256']},
                    'browserIdentityFile': browser_identity_file, 'browserIdentitySha256': shaf(browser_identity_file),
                    'campaignId': CAMPAIGN, 'privateMediaParent': MEDIA_PARENT, 'runtimeAttestationFile': f'{PRIVATE}/cfg/runtime-attestation.json',
                    'runtimeAttestationSha256': att_sha, 'ownerApprovalReference': OWNER_REF, 'qualificationMaxMs': QUAL_MS,
                    'cleanupReserveMs': CLEANUP_MS, 'runtimeEnvironmentId': att['immutableEnvironmentId']})
        if RUNTIME == 'GitHub Actions SpeakSharp':
            adm['runtimeWorkflowSourceSha'] = att['workflowSourceSha']
        directories.add(f'{PRIVATE}/ledgers')
        adm_sha = put(f'{PRIVATE}/cfg/admission.json', adm)
        rows = []
        prod_cases = {1, 2, 3, 7, 8}
        oracle_cases = {1, 2, 3, 7, 8, 9, 10, 11}
        for n in (range(1, 16) if SELECTED_FULL else SEL):
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
        execution_run_id = att.get('runId') or att.get('taskId')
        plan = {'version': 1, 'campaignId': CAMPAIGN, 'requestSha256': binding['requestSha256'],
                'executionIdentity': {'runId': execution_run_id, 'attempt': 1},
                'runtime': RUNTIME, 'targetUrl': f'https://{HOST_APP}/', 'costCeilingUsd': 0,
                'sourceSha': B, 'servedSha': B, 'admissionConfigFile': f'{PRIVATE}/cfg/admission.json', 'admissionConfigSha256': adm_sha,
                'stepRoot': PACKET, 'stepManifestFile': f'{PRIVATE}/cfg/reviewed-steps.json', 'stepManifestSha256': idx['stepsSha256'],
                'campaignLedger': adm['campaignLedger'], 'identityLedger': adm['identityLedger'], 'runRoot': f'{PRIVATE}/run',
                'identityCap': IDENT_CAP, 'deadlineAt': T1, 'cleanupReserveMs': CLEANUP_MS, 'requirementMappings': [], 'cases': rows}
        if MINIMAL:
            plan['requestBudget'] = {'runCap': CAPS['total'], 'cleanupReserve': BP_CLEANUP,
                                     'estimates': {f'AHT-{k:02d}': v for k, v in MIN_EST.items()},
                                     'ceilings': {f'AHT-{k:02d}': ((v * 125 + 99) // 100 + 9) // 10 * 10 for k, v in MIN_EST.items()}}
        if FULL or SELECTED_FULL:
            # full coverage: every case, every required assertion; the harness's own per-case caps (TAKES/PRESS) stay at the contract minimums
            if FULL and (sorted(BP_EST) != list(range(1, 16)) or SELECTED != list(range(1, 16))):
                raise InputValidationError('input-binding')
            if SELECTED_FULL:
                if not 1 <= len(SELECTED) <= 6 or len(set(SELECTED)) != len(SELECTED) or not set(SELECTED).issubset(range(1, 16)) or sorted(BP_EST) != sorted(SELECTED):
                    raise InputValidationError('input-binding')
                plan['coverageMode'] = 'partial'
                plan['assertionDepth'] = 'full'
            budget_estimates = {k: BP_EST.get(k, 0) for k in range(1, 16)} if SELECTED_FULL else BP_EST
            plan['requestBudget'] = {'runCap': CAPS['total'], 'cleanupReserve': BP_CLEANUP,
                                     'estimates': {f'AHT-{k:02d}': v for k, v in budget_estimates.items()},
                                     'ceilings': {f'AHT-{k:02d}': ((v * 125 + 99) // 100 + 9) // 10 * 10 for k, v in budget_estimates.items()}}
        # r15: explicit case selection (ordered), stimulus gates, run identity binding, stimulus preflight receipt
        sel_env = env.get('BP_SELECT', '')
        if sel_env:
            order = [f'AHT-{int(x):02d}' for x in sel_env.split(',')]
            plan['selection'] = {'ids': list(order), 'order': list(order), 'ownerApprovalReference': need('BP_SELECT_REF'),
                                 'reason': need('BP_SELECT_REASON')}
            if gate_rows: plan['gates'] = gate_rows
        FBE = obj(FACTS.get('backend'), 'facts-backend')
        for _k in ('manifestRef', 'generation', 'completion', 'migration129'):
            if _k not in FBE:
                raise InputValidationError('input-binding')
        plan['runIdentity'] = {'frontend': {'sourceSha': B, 'servedSha': B},
                               'runner': {'codeManifestSha256': shaf(f'{PACKET}/bundle/CODE.sha256'), 'packetManifestSha256': shaf(f'{PACKET}/PACKET-MANIFEST.sha256')},
                               'backend': {'manifestRef': FBE['manifestRef'], 'source': env.get('BP_BACKEND_SOURCE') or FBE.get('source', 'owner-stated'),
                                           'generation': caps_module.integer(FBE['generation'], 'backend-generation'), 'completion': FBE['completion'],
                                           'facts': [{'name': 'migration-129', 'state': FBE['migration129']}],
                                           'verifiedAtUtc': env.get('BP_BACKEND_VERIFIED') or None}}
        if env.get('BP_STIM'):
            plan['stimulusPreflight'] = {'file': env['BP_STIM'], 'sha256': shaf(env['BP_STIM'])}
        plan_sha = put(f'{PRIVATE}/cfg/campaign-plan.json', plan)
        put(f'{PRIVATE}/cfg/build-plan-consumption.json', {
            'schema': 'speaksharp.cloud-test.build-plan-consumption.v1',
            'consumer': 'build-plan', 'campaignId': CAMPAIGN,
            'runId': execution_run_id, 'attempt': 1,
            'requestSha256': binding['requestSha256'], 'planSha256': plan_sha,
            'admissionConfigSha256': adm_sha, 'sourceSha': B, 'servedSha': B,
            'consumedAtUtc': now(),
        })

    return {'private': PRIVATE, 'files': files, 'directories': directories, 'phase': phase}


def emit_verified_inputs(verified):
    # No loading, parsing, assertions or input error translation in this stage.
    os.makedirs(verified['private'], mode=0o700, exist_ok=True)
    for directory in sorted(verified['directories'], key=lambda p: (len(Path(p).parts), p)):
        os.makedirs(directory, mode=0o700, exist_ok=True)
    for path, (data, mode) in verified['files'].items():
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
        with os.fdopen(fd, 'wb') as target:
            target.write(data)
    print(verified['phase'] + ' OK')


def main():
    try:
        verified = read_binding_inputs(dict(os.environ), sys.argv[1:])
    except (OSError, UnicodeError, ImportError, KeyError, TypeError, ValueError, subprocess.SubprocessError):
        print('BLOCKED_SETUP: INVALID_BINDING_INPUT', file=sys.stderr)
        return 78
    emit_verified_inputs(verified)
    return 0


if __name__ == '__main__':
    sys.exit(main())
