#!/usr/bin/env python3
"""Recipient-invoked receipt/result for an existing paired local-inbox task.

No permission edits, retries, task dispatch, or automatic acknowledgements.
The credential stays in the private inbox and never appears in arguments/output.
"""
import argparse
import json
import re
import urllib.request
from urllib.parse import urlsplit
import actor_channels


def request_for(actor, session, action, stage, evidence):
    if stage not in ('receipt', 'result') or not 1 <= len(evidence.strip()) <= 4000:
        raise ValueError('stage/evidence invalid')
    config = actor_channels.read_config()['routes'].get(actor, {})
    if config.get('provider') not in ('local_inbox', 'codex_app_server') or config.get('session_id') != session:
        raise ValueError('actor/session is not the currently paired recipient')
    with actor_channels.LOCK, actor_channels.db() as c:
        row = c.execute('SELECT body FROM messages WHERE action_id=? AND actor=? AND session=?',
                        (action, actor, session)).fetchone()
    if row is None:
        raise ValueError('no delivered task matches this actor/session/action')
    body = row['body']
    if not body.startswith('RWT-BOARD TASK ' + action + '\n'):
        raise ValueError('invalid task identity')
    url = re.search(r'^Callback URL: (\S+)\s*$', body, re.M)
    token = re.search(r'^Send the token as Authorization: Bearer (\S+)\.\s*$', body, re.M)
    if not url or not token:
        raise ValueError('delivered task lacks callback credentials')
    target = urlsplit(url[1])
    if (target.scheme != 'http' or target.hostname != '127.0.0.1' or target.port != 4317
            or target.path != '/api/agent-task' or target.query or target.fragment
            or target.username or target.password):
        raise ValueError('callback must be the local Orch task endpoint')
    payload = {'actor_id': actor, 'session_id': session, 'action_id': action,
               'stage': stage, 'evidence': evidence.strip()}
    return urllib.request.Request(url[1], data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token[1]}, method='POST')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--actor', required=True, choices=actor_channels.ACTORS)
    parser.add_argument('--session', required=True)
    parser.add_argument('--action', required=True)
    parser.add_argument('--stage', required=True, choices=('receipt', 'result'))
    parser.add_argument('--evidence', required=True)
    args = parser.parse_args()
    try:
        request = request_for(args.actor, args.session, args.action, args.stage, args.evidence)
        # No redirects: callback credentials must never leave the local endpoint.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *unused):
                return None
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(request, timeout=10) as response:
            json.load(response)
        print('Orch ' + args.stage + ' accepted for ' + args.action)
    except (OSError, ValueError):
        raise SystemExit('Callback not confirmed; inspect this same action on Orch before any retry.')


if __name__ == '__main__':
    main()
