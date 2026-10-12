"""Evidenced retirement of a checkpointed, broken legacy recipient route.

Administrative cancellation is never a task receipt/result or successful delivery.
"""
import hashlib
import json
from datetime import datetime, timezone
import agent_transport


def pending_snapshot(db, actor, session):
    queues = [dict(r) for r in db.execute("SELECT id,task_action_id,status,attempts,target_transport,target_session_id,error FROM queue WHERE target_actor_id=? AND target_session_id<>'' AND status NOT IN ('responded','failed','cancelled') ORDER BY id", (actor,))]
    notices = [dict(r) for r in db.execute("SELECT action_id,task_id,status,attempts,target_transport,target_session_id,accepted_at,receipt_at,result_at,error FROM agent_notifications WHERE actor_id=? AND target_session_id<>'' AND status NOT IN ('responded','cancelled') ORDER BY action_id", (actor,))]
    for row in queues + notices:
        if row['target_transport'] != 'codex_app_server' or row['target_session_id'] != session:
            raise agent_transport.RouteError('pending action belongs to a different route; no retirement applied')
    value = {'queue': queues, 'notifications': notices}
    encoded = json.dumps(value, sort_keys=True, separators=(',', ':'))
    return value, hashlib.sha256(encoded.encode()).hexdigest()


def reconcile(db, routes, payload):
    actor, session = payload.get('actor_id'), payload.get('session_id')
    if actor != 'cli_dev' or not isinstance(session, str):
        raise agent_transport.RouteError('recovery supports only the checkpointed CLI Dev legacy route')
    route = routes.get(actor, {})
    if route.get('provider') != 'codex_app_server' or route.get('session_id') != session:
        raise agent_transport.RouteError('current route does not match the frozen legacy route')
    snapshot, digest = pending_snapshot(db, actor, session)
    if payload.get('mode') == 'preview':
        return {'snapshot': snapshot, 'snapshot_sha256': digest, 'changed': False}
    if payload.get('mode') != 'retire':
        raise agent_transport.RouteError('mode must be preview or retire')
    checkpoint = payload.get('checkpoint', '')
    evidence = payload.get('evidence', '')
    if not isinstance(checkpoint, str) or len(checkpoint.strip()) < 30 or not isinstance(evidence, str) or not evidence.startswith('https://github.com/relativityE/speaksharp/'):
        raise agent_transport.RouteError('retirement requires the owning runtime checkpoint and source evidence')
    if payload.get('snapshot_sha256') != digest:
        raise agent_transport.RouteError('pending actions changed since preview; inspect again, no retirement applied')
    ids = payload.get('retire_queue_ids')
    if not isinstance(ids, list) or any(type(i) is not int for i in ids) or len(set(ids)) != len(ids) or set(ids) != {r['id'] for r in snapshot['queue']}:
        raise agent_transport.RouteError('explicit obsolete queue IDs must match the entire frozen-route preview')
    notice_ids = payload.get('retire_notification_ids')
    if (not isinstance(notice_ids, list) or any(not isinstance(i, str) for i in notice_ids)
            or len(set(notice_ids)) != len(notice_ids)
            or set(notice_ids) != {r['action_id'] for r in snapshot['notifications']}):
        raise agent_transport.RouteError('explicit notification IDs must match the entire frozen-route preview')
    for row in snapshot['queue']:
        if row['status'] != 'queued' or row['attempts'] != 0:
            raise agent_transport.RouteError('queue delivery may have started; no retirement applied')
    for row in snapshot['notifications']:
        if (row['task_id'] not in ('wake-probe', 'event-observation') or row['status'] != 'blocked_transport'
                or row['attempts'] != 1 or 'invalid Codex frame length' not in (row['error'] or '')
                or row['accepted_at'] or row['receipt_at'] or row['result_at']):
            raise agent_transport.RouteError('notification has a different or accepted delivery boundary; no retirement applied')
    if not ids and not snapshot['notifications']:
        return {'changed': False, 'retired_queue_ids': [], 'retired_notifications': []}
    stamp = datetime.now(timezone.utc).isoformat()
    audit = json.dumps({'before': snapshot, 'checkpoint': checkpoint, 'evidence': evidence}, sort_keys=True)
    db.execute('CREATE TABLE IF NOT EXISTS route_retirements(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id TEXT NOT NULL,session_id TEXT NOT NULL,snapshot_sha256 TEXT NOT NULL,evidence_json TEXT NOT NULL,created_at TEXT NOT NULL)')
    db.execute('INSERT INTO route_retirements(actor_id,session_id,snapshot_sha256,evidence_json,created_at) VALUES(?,?,?,?,?)', (actor, session, digest, audit, stamp))
    for row in snapshot['queue']:
        db.execute("UPDATE queue SET status='cancelled',error=?,finished_at=? WHERE id=?", ('Administrative retirement: obsolete unsent assignment; ' + evidence, stamp, row['id']))
    for row in snapshot['notifications']:
        db.execute("UPDATE agent_notifications SET status='cancelled',error=?,updated_at=? WHERE action_id=?", ((row['error'] or '') + '; administrative retirement after owning runtime checkpoint; NOT delivered; ' + evidence, stamp, row['action_id']))
    return {'changed': True, 'snapshot_sha256': digest, 'retired_queue_ids': ids,
            'retired_notifications': [r['action_id'] for r in snapshot['notifications']],
            'delivery_proven': False, 'route_changed': False}
