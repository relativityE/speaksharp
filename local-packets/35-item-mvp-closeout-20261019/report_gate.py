"""Strict evidence validation; import has no execution or filesystem side effects."""
import collections
import pathlib


def validate_report(report, manifest, returncode):
    assertions = [a for f in report.get('testResults', []) for a in f.get('assertionResults', [])]
    names = [a.get('fullName') for a in assertions]
    if len(names) != len(set(names)):
        raise ValueError('Duplicate assertion identity')
    actual = {a.get('fullName'): a.get('status') for a in assertions}
    expected = manifest['assertions']
    if actual != expected:
        raise ValueError('Exact assertion identity/status mismatch')
    counts = collections.Counter(actual.values())
    if set(counts) - {'passed', 'failed'}:
        raise ValueError('Skipped/pending assertions cannot qualify')
    for key, wanted in [('numTotalTests', len(expected)), ('numPassedTests', counts['passed']), ('numFailedTests', counts['failed'])]:
        if report.get(key) != wanted:
            raise ValueError('Reported totals disagree with named assertions: ' + key)
    if returncode != manifest['expectedExit']:
        raise ValueError('Unexpected process exit')
    if report.get('numRuntimeErrorTestSuites', 0) or report.get('unhandledErrors'):
        raise ValueError('Runtime/unhandled collection error')
    if report.get('success') is not (counts['failed'] == 0):
        raise ValueError('Success flag disagrees with named outcomes')
    # Every expected failing assertion must carry an actual diagnostic.
    if any(a['status'] == 'failed' and not a.get('failureMessages') for a in assertions):
        raise ValueError('Missing expected-failure diagnostic')
    return {'total': len(expected), 'passed': counts['passed'], 'failed': counts['failed']}


def require_fresh_report(path, started_ns):
    path = pathlib.Path(path)
    if not path.is_file() or path.stat().st_mtime_ns < started_ns:
        raise ValueError('Missing/stale report; never consume previous output')
    return path.read_bytes()
