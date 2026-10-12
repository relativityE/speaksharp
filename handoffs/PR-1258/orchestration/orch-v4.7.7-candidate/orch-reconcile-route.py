#!/usr/bin/env python3
"""Preview or retire checkpointed, broken CLI Dev legacy route through the board API."""
import argparse
import json
import re
import uuid
from pathlib import Path
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--session', required=True)
    parser.add_argument('--port', type=int, default=4317)
    parser.add_argument('--retire-queue', type=int, action='append', default=[])
    parser.add_argument('--retire-notification', action='append', default=[])
    parser.add_argument('--retire-plan', type=Path, help='JSON with explicit queue_ids and notification_ids; never infer which actions to retire')
    parser.add_argument('--checkpoint', default='')
    parser.add_argument('--evidence', default='')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--pair-worker', help='save this new worker UUID through normal pairing only after successful retirement')
    args = parser.parse_args()
    if args.retire_plan:
        if args.retire_queue or args.retire_notification:
            parser.error('--retire-plan cannot be combined with individual action IDs')
        plan = json.loads(args.retire_plan.read_text())
        if not isinstance(plan, dict) or set(plan) != {'queue_ids', 'notification_ids'}:
            parser.error('retirement plan requires exactly queue_ids and notification_ids')
        args.retire_queue = plan['queue_ids']
        args.retire_notification = plan['notification_ids']
    if args.pair_worker:
        if not args.apply:
            parser.error('--pair-worker requires --apply')
        try:
            args.pair_worker = str(uuid.UUID(args.pair_worker))
        except ValueError:
            parser.error('--pair-worker must be a UUID')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *unused):
            return None
    http = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    base = f'http://127.0.0.1:{args.port}'
    with http.open(base + '/', timeout=10) as response:
        page = response.read().decode()
    match = re.search(r"const CONTROL_TOKEN='([A-Za-z0-9_-]+)'", page)
    if not match:
        raise SystemExit('Board control token not found')
    def call(body, endpoint='/api/agent-route-retire'):
        request = urllib.request.Request(base + endpoint,
            data=json.dumps(body).encode(), headers={'Content-Type': 'application/json',
                'X-RWT-Control-Token': match.group(1)}, method='POST')
        try:
            with http.open(request, timeout=10) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise SystemExit('Recovery rejected: ' + error.read().decode()) from error
    body = {'actor_id': 'cli_dev', 'session_id': args.session, 'mode': 'preview'}
    preview = call(body)
    print(json.dumps(preview, indent=2))
    if args.apply:
        result = call({**body, 'mode': 'retire', 'snapshot_sha256': preview['snapshot_sha256'],
            'retire_queue_ids': args.retire_queue, 'retire_notification_ids': args.retire_notification,
            'checkpoint': args.checkpoint, 'evidence': args.evidence})
        print(json.dumps(result, indent=2))
        if args.pair_worker:
            paired = call({'actor_id': 'cli_dev', 'provider': 'local_inbox',
                'session_id': args.pair_worker}, '/api/agent-pair')
            print('Pairing saved: ' + json.dumps(paired))
    else:
        print('READ ONLY: no retirement applied; inspect exact IDs before --apply')


if __name__ == '__main__':
    main()
