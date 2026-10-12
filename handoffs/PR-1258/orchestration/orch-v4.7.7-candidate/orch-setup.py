#!/usr/bin/env python3
"""One setup entry point. Preserve existing actors; never invent routes or reset work."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import webbrowser
import package_integrity


def running_board(port):
    # Loopback only, no proxy/redirect or implicit credential forwarding.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None
    http = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with http.open(f'http://127.0.0.1:{port}/api/live', timeout=2) as response:
            value = json.load(response)
        return value if isinstance(value, dict) and 'transport' in value else None
    except (OSError, ValueError):
        return None


def prerequisites(env, which=shutil.which, run=subprocess.run):
    issues = []
    if sys.version_info < (3, 10):
        issues.append('Python 3.10+ required')
    for name in ('gh', 'codex'):
        binary = env.get('CODEX_BIN') if name == 'codex' else None
        binary = binary or which(name)
        if not binary:
            issues.append(name + ' executable unavailable; local operator installs it once')
            continue
        command = [binary, 'login', 'status'] if name == 'codex' else [binary, 'auth', 'status']
        clean = {k: v for k, v in env.items() if k not in ('OPENAI_API_KEY', 'OPENAI_ADMIN_KEY', 'CODEX_API_KEY')}
        try:
            result = run(command, env=clean, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            if result.returncode:
                issues.append(name + ' login unavailable; existing account login required once')
        except (OSError, subprocess.TimeoutExpired):
            issues.append(name + ' login check failed; local operator inspects it')
    return issues


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Read-only health; starts no board or agent')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    port = int(os.environ.get('RWT_PORT', '4317'))
    live = running_board(port)
    if live:
        # Keep existing installation and its work/leases; never create a second PM executor.
        health = live['transport'].get('coordination', {})
        print(json.dumps({'existing_board': True, 'coordination': health,
                          'next': 'CLI PM handles listed route/recovery work; no task-text relay through PO.'}))
        if not args.check:
            webbrowser.open(f'http://127.0.0.1:{port}/')
        return 0
    issues = package_integrity.verify(root)
    if issues:
        print(json.dumps({'ready': False, 'owner': 'cli_pm', 'issues': issues}))
        return 1
    issues = prerequisites(dict(os.environ))
    if issues:
        print(json.dumps({'ready': False, 'owner': 'cli_pm', 'issues': issues}))
        return 1
    if args.check:
        print(json.dumps({'ready': True, 'board_running': False, 'next': 'Start Orch.command'}))
        return 0
    # Existing launcher owns verified migration, singleton locks and retained settings.
    return subprocess.call(['bash', str(root / 'start-rwt-handoff.sh')], cwd=root)


if __name__ == '__main__':
    raise SystemExit(main())
