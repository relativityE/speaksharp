#!/usr/bin/env python3
"""Prepare reference metadata/annotation worksheets, never inference or an evaluator."""
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
MANIFEST = 'tests/fixtures/corpus-manifest.json'
EXPECTED = '706b61053c3c4aa9976099d8eb490f64e6d8b0e2ff86529f59b9982abd59453b'

def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args]).decode().strip()

def write_json(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')

def main():
    head = git('rev-parse', 'HEAD')
    raw = (ROOT / MANIFEST).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == EXPECTED, 'source_manifest_digest_mismatch'
    blob = hashlib.sha1(b'blob ' + str(len(raw)).encode() + bytes([0]) + raw).hexdigest()
    assert git('rev-parse', f'HEAD:{MANIFEST}') == blob, 'uncommitted_manifest_bytes'
    source = json.loads(raw)
    rows = []
    for partition, entries in source['subsets'].items():
        for entry in entries:
            speaker, chapter, _ = entry['id'].split('-')
            tokens = re.findall(r"[a-z]+(?:'[a-z]+)?", entry['reference'].lower())
            candidates = [{'tokenIndex0': i, 'key': t, 'contextLabel': None}
                          for i, t in enumerate(tokens)
                          if t in {'um', 'uh', 'ah', 'like', 'so', 'well', 'actually', 'basically', 'literally'}]
            bucket = int(hashlib.sha256(('speaksharp-1565-speaker-review-v1:' + speaker).encode()).hexdigest(), 16) % 5
            rows.append({
                'clipId': entry['id'], 'partition': partition, 'speakerId': speaker,
                'chapterProxy': speaker + '-' + chapter,
                'proposedReviewFold': 'held_out' if bucket == 0 else 'development',
                'audioPath': entry['audio']['path'], 'declaredAudioSha256': entry['audio']['sha256'],
                'referencePointer': MANIFEST + '#subsets/' + partition + '/' + entry['id'],
                'referenceSha256Utf8': hashlib.sha256(entry['reference'].encode()).hexdigest(),
                'referenceTokenCountWhitespace': len(entry['reference'].split()),
                'referenceMarkerCandidatesTextOnly': candidates,
                'acousticAnnotationId': None, 'annotatorId': None, 'adjudicatorId': None,
                'audioVerifiedThisPreparation': False,
                'speechCondition': None, 'noiseSnrDb': None, 'accentSelfDescription': None,
                'contextualFillerSpans': None, 'lexicalNegativeSpans': None, 'pauseIntervals': None,
                'openingTailAlignment': None, 'focusTargets': None,
                'admission': 'PENDING_AUDIO_AND_REQUIRED_ANNOTATION',
            })
    assert len(rows) == 600 and len({r['clipId'] for r in rows}) == 600
    assert len({r['speakerId'] for r in rows}) == 73
    assert all(r['referenceTokenCountWhitespace'] > 0 for r in rows)
    assert sum(c['key'] in {'um', 'uh'} for r in rows for c in r['referenceMarkerCandidatesTextOnly']) == 0
    assert git('rev-parse', 'HEAD') == head, 'head_changed'
    write_json('reference-annotation-ledger.json', {
        'version': 'pm-1565-preparation-v1', 'status': 'PREPARATION_NOT_ACOUSTIC_ANNOTATION',
        'observedSourceHead': head, 'sourceManifestSha256': EXPECTED, 'sourceManifestGitBlob': blob,
        'rules': {'partitionIsNotNoiseOrAccent': True, 'markerCandidatesAreNotContextualLabels': True,
                  'nullMeansNotObservedNotAbsent': True, 'noAudioDownloadedOrDecoded': True,
                  'referenceHashEncoding': 'exact UTF-8 reference field, no added newline',
                  'tokenIndexRule': "lowercase [a-z]+(?:'[a-z]+)?; preparation only, not WER normalization"},
        'rows': rows,
    })
    supplemental = []
    for group, count in [('natural', 120), ('controlled-noise', 30), ('long', 30), ('silence', 60)]:
        for i in range(count):
            supplemental.append({'reservationId': f'{group}-{i+1:03}', 'group': group,
                                 'audioSha256': None, 'referenceSha256': None,
                                 'speakerOrEnvironmentId': None, 'consentOrLicence': None,
                                 'status': 'RESERVED_NOT_A_RECORDING'})
    write_json('supplemental-admission-reservations.json', {
        'status': 'PROPOSED_NOT_FROZEN_NOT_ACCEPTED_POLICY', 'existingRequiredRows': 600,
        'proposedSupplementalRows': len(supplemental), 'proposedTotalRows': 840,
        'note': 'Reservations cannot enter an observed result manifest. Real bytes, references, rights and annotations must replace them before freeze.',
        'rows': supplemental,
    })
    smoke = json.loads((ROOT / 'tests/evidence/fixtures/corpus/manifest.json').read_text())
    f = next(x for x in smoke['fixtures'] if x['fixtureId'] == 'fixture-003')
    tokens = f['referenceText'].lower().split()
    spans = [{'tokenIndex0': i, 'key': token, 'acousticStartSeconds': None, 'acousticEndSeconds': None}
             for i, token in enumerate(tokens) if token in {'um', 'uh'}]
    assert [(x['tokenIndex0'], x['key']) for x in spans] == [(1, 'um'), (4, 'uh'), (7, 'um')]
    write_json('diagnostic-reference-annotation.json', {
        'fixtureId': f['fixtureId'], 'audioSha256': f['fixtureSha256'],
        'referenceSha256': f['referenceTextSha256'], 'origin': 'synthetic macOS Samantha script',
        'referenceScriptFillerSpans': spans, 'scriptCoachableCount': 3,
        'acousticRealizationVerified': False, 'humanAnnotator': None,
        'discourseMarker': {'tokenIndex0': 0, 'key': 'so', 'defaultCoachable': False,
                            'contextLabel': None},
        'status': 'SCRIPT_ANNOTATED_ACOUSTIC_TRUTH_PENDING',
    })
    cases = []
    kinds = ['tie', 'noncritical_word', 'critical_number', 'critical_polarity', 'opening_tail',
             'invented_repeat', 'true_filler_omission', 'lexical_negative', 'focus_target',
             'unsupported_coaching', 'silence_hallucination', 'empty_speech_output']
    for kind in kinds:
        for replicate in range(2):
            cases.append({'itemId': f'DEV-{len(cases)+1:02}', 'control': kind,
                          'variant': replicate, 'recordingOrReferenceBinding': None,
                          'armLabels': None, 'assessor1': None, 'assessor2': None,
                          'ratingsLocked': False, 'adjudication': None,
                          'status': 'PREPARED_CONTROL_SPEC_NOT_RATED'})
    write_json('calibration-control-register.json', {'version': 'blind-rubric-v1',
               'developmentOnly': True, 'calibratedAssessors': 0, 'cases': cases})
    with (OUT / 'blind-rating-worksheet.csv').open('w', newline='') as out:
        writer = csv.writer(out)
        writer.writerow(['item_id','assessor_id','opaque_arm_label','clip_sha256','rubric_version',
                         'lexical_0_3','boundary_0_3','contextual_fillers_0_3','focus_usefulness_0_3',
                         'critical_flags','na_source_reason','reason','locked_at_utc'])
        for c in cases:
            for assessor in ('assessor_1_pending','assessor_2_pending'):
                writer.writerow([c['itemId'],assessor,'','','blind-rubric-v1'] + [''] * 8)
    summary = {'manifestRows': len(rows), 'uniqueSpeakers': len({r['speakerId'] for r in rows}),
               'referenceWordsWhitespace': sum(r['referenceTokenCountWhitespace'] for r in rows),
               'literalUmUhReferenceTokens': 0, 'referenceMarkerCandidatesNotHumanLabels': sum(len(r['referenceMarkerCandidatesTextOnly']) for r in rows),
               'acousticAnnotationsCompleted': 0, 'supplementalReservationsNotRecordings': len(supplemental),
               'developmentControlSpecifications': len(cases), 'blankAssessorRows': len(cases)*2,
               'headStable': True, 'modelRuns': 0, 'downloads': 0}
    write_json('preparation-validation.json', summary)
    print(json.dumps(summary))

if __name__ == '__main__':
    main()
