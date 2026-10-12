"""Truthful, read-only coordination diagnosis; never pairs, restarts or acknowledges."""

ACTORS = ('cli_dev', 'app_dev', 'browser_pm', 'cli_pm')


def summarize(transport, agents, automation, cleanup_hold=None):
    by_id = agents if isinstance(agents, dict) else {a['agent_id']: a for a in agents}
    issues = []
    pm = by_id.get('pm', {})
    if cleanup_hold:
        issues.append({'actor': 'cli_pm', 'code': 'cleanup_unverified',
                       'action': 'Verify the recorded PM process group is gone before resuming; do not replay a sent action.'})
    elif not transport.get('pm_configured'):
        issues.append({'actor': 'cli_pm', 'code': 'executor_unavailable',
                       'action': 'Local operator checks the existing CLI login/adapter; no second PM worker.'})
    elif pm.get('paused') or pm.get('status') in ('error', 'auth_required'):
        issues.append({'actor': 'cli_pm', 'code': 'executor_paused' if pm.get('paused') else 'executor_error',
                       'action': 'CLI PM reconciles the current failed action and lease; queued reviews are not being invoked.'})
    for event in ('pm_github_control', 'pm_github_review', 'pm_github_ci', 'pm_github_head', 'pm_github_deploy'):
        if not automation.get(event):
            issues.append({'actor': 'cli_pm', 'code': event + '_disabled',
                           'action': 'Enable this event class in coordination settings if selected by the owning PM.'})
    routes = transport.get('agent_routes', {})
    support = []
    for actor in ACTORS:
        route = routes.get(actor, {})
        if actor == 'cli_pm':
            # The board executor is the PM writer. An optional role-observation route is not another writer.
            support.append({'actor': actor, 'state': 'executor' if transport.get('pm_configured') else 'blocked',
                            'detail': 'Board PM executor handles GitHub events; separate inbox is observation-only.'})
            continue
        code = None
        if not route.get('configured'):
            code = 'route_unavailable'
        elif route.get('transport') == 'local_inbox' and not route.get('listener_recent'):
            code = 'listener_' + str(route.get('listener_state') or 'not_observed')
        elif not route.get('live_delivery_proven'):
            code = 'wake_unproven'
        state = 'blocked' if code else 'verified'
        support.append({'actor': actor, 'state': state,
                        'detail': code or 'Automatic probe receipt/result recorded and listener currently available.'})
        if code:
            issues.append({'actor': actor, 'code': code,
                           'action': 'CLI PM connects/rearms the existing recipient and verifies receipt/result; publication is not wake proof.'})
    core = [i for i in issues if i['actor'] != 'browser_pm']
    return {'core_ready': not core, 'all_routes_verified': not issues,
            'owner': 'cli_pm', 'issues': issues, 'support': support,
            'browser_pm_note': 'A browser conversation needs its own supported inbound integration. Local PM execution does not wake that conversation.',
            'setup_steps': ['Open Start Orch.command once.',
                            'Local operator connects each existing Dev recipient with Connect + test; pairing is retained.',
                            'Verify actual receipt/result and current listener health; never relay routine task text through PO.']}
