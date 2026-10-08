"""deadlock.5 acceptance regressions: recovery, lease, asks, review handoffs, refresh_reviews, sharing.

Isolated: temp state DB per test, loopback-only HTTP on an ephemeral port, and a fake GitHub
adapter. No live board, GitHub write, PR lifecycle change or installed-app state is touched.
"""
import json
import hashlib
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock, patch

import unittest

import server
import test_regressions as reg
from guarded_pm import canonical_key, KINDS

HEAD = 'a' * 40
BASE = 'b' * 40
KEY = 'PR-1570-P1'
BRANCH = 'fix/1258-readback-boot-control'


def board(work_item_key='PR-1559'):
    return {'work_items': [{'item_key': work_item_key, 'notes': 'fixture checkpoint'}],
            'players': [{'player_id': 'app_dev', 'status': 'reported', 'work_item_key': '', 'source': 'fixture'}]}


class FakeGitHub:
    """Stateful GitHub double for the executor. Writes mutate PR state like GitHub does."""

    def __init__(self, draft=False, reviews=None, fail_on=None, source_body=None, read_failure=None):
        self.pr = {'number': 1570, 'node_id': 'PR_node', 'state': 'open', 'draft': draft,
                   'head': {'sha': HEAD, 'ref': 'fix/1258-action-binding', 'repo': {'full_name': 'relativityE/speaksharp'}},
                   'base': {'sha': BASE}}
        self.reviews = reviews or []
        self.existing_drafts = []
        self.workflow_runs = []
        self.run = {'id': 321, 'head_sha': HEAD, 'run_attempt': 2}
        self.writes = []
        self.fail_on = fail_on  # mutation name that raises an uncertain transport error once
        self.source_body = source_body or (
            f'{HEAD} {BASE} guarded Draft→Ready refresh\n'
            f'ACTION AUTHORIZATION: kind=refresh_reviews pr=1570 head={HEAD} base={BASE}'
        )
        self.read_failure = read_failure
        self.lock = threading.Lock()

    def request(self, args):
        with self.lock:
            if 'graphql' in args:
                op = 'draft' if 'convertPullRequestToDraft' in str(args) else 'ready'
                if self.fail_on == op:
                    self.fail_on = None
                    raise RuntimeError(f'GitHub operation failed: {op} timed out')
                self.writes.append(op)
                self.pr['draft'] = op == 'draft'
                return {}
            path = args[-1] if args[0] == 'api' else args[1]
            path = path.split('repos/relativityE/speaksharp/')[-1]
            if self.read_failure and self.read_failure in path:
                self.read_failure = None
                raise RuntimeError('simulated transient read failure')
            if path.startswith('issues/comments/'):
                return {'issue_url': 'https://api.github.com/repos/relativityE/speaksharp/issues/1258',
                        'user': {'login': 'relativityE'}, 'body': self.source_body}
            if path == 'branches/main':
                return {'commit': {'sha': BASE}}
            if path.startswith('git/ref/heads/'):
                return {'object': {'sha': HEAD}}
            if path.startswith('pulls?state=open&head='):
                return self.existing_drafts
            if path.startswith('actions/runs/'):
                return self.run
            if 'ci.yml/runs' in path:
                return {'workflow_runs': self.workflow_runs}
            if '/reviews?' in path:
                return list(self.reviews)
            if path == 'pulls/1570':
                return json.loads(json.dumps(self.pr))
            raise AssertionError(path)


def refresh_action(**extra):
    action = {'kind': 'refresh_reviews', 'pr_number': 1570, 'head': HEAD, 'base': BASE, 'source_comment_id': 6048244445,
              'run_id': None, 'run_attempt': None, 'branch': None, 'title': None, 'body': None}
    action.update(extra)
    return action


class Deadlock5Tests(unittest.TestCase):
    setUp = reg.RegressionTests.setUp
    tearDown = reg.RegressionTests.tearDown
    item = reg.RegressionTests.item

    # ---------- helpers ----------
    def q(self):
        aid = server.add_activity('GITHUB', 'App Dev packet', 'pm')
        qid = server.enqueue(aid, 'pm', 'App Dev packet', source_actor='GITHUB')
        return next(x for x in server.list_queue() if x['id'] == qid)

    def assign(self, worktree='/missing/task-worktree', branch=BRANCH, owned_paths=None):
        self.assertTrue(server.apply_board_updates({'work_items': [{
            'item_key': KEY, 'pr_number': 1570, 'title': '#1570 P1', 'state': 'active', 'owner': 'cli_dev',
            'branch': branch, 'worktree': worktree, 'next_action': 'implement', 'owned_paths': owned_paths or []}],
            'players': [{'player_id': 'cli_dev', 'status': 'assigned', 'work_item_key': KEY, 'task': '#1570 P1'}]}))

    def dev_row(self, **fields):
        aid = server.add_activity('PM', 'execute', 'dev')
        qid = server.enqueue(aid, 'dev', 'execute', source_actor='PM', work_item_key=KEY)
        if fields:
            server.update_queue(qid, **fields)
        return next(r for r in server.list_queue() if r['id'] == qid)

    def recoveries(self):
        return [r for r in server.list_queue(500) if r.get('kind') == 'preflight_recovery']

    def test_state_directory_has_one_process_owner(self):
        path = Path(self.tmp.name) / 'state-owner'
        first = server.acquire_state_dir_lock(path)
        try:
            with self.assertRaisesRegex(RuntimeError, 'Another board process owns state directory'):
                server.acquire_state_dir_lock(path)
        finally:
            server.release_state_dir_lock(first)
        second = server.acquire_state_dir_lock(path)
        server.release_state_dir_lock(second)

    def test_repository_lock_blocks_another_board_with_a_different_state_dir(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            first = server.acquire_repository_lock('relativityE/speaksharp', tmp)
            try:
                with self.assertRaisesRegex(RuntimeError, 'Another board process owns repository'):
                    server.acquire_repository_lock('relativityE/speaksharp', tmp)
            finally:
                server.release_state_dir_lock(first)
            second = server.acquire_repository_lock('relativityE/speaksharp', tmp)
            server.release_state_dir_lock(second)

    def http(self):
        http = ThreadingHTTPServer(('127.0.0.1', 0), server.H)
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(lambda: (http.shutdown(), http.server_close(), thread.join(timeout=3)))
        origin = f'http://127.0.0.1:{http.server_port}'

        def post(path, body):
            req = urllib.request.Request(origin + path, data=json.dumps(body).encode(),
                                         headers={'Content-Type': 'application/json', server.CONTROL_TOKEN_HEADER: server.CONTROL_TOKEN})
            try:
                with urllib.request.urlopen(req, timeout=3) as r:
                    return r.status, json.load(r)
            except urllib.error.HTTPError as e:
                return e.code, json.load(e)
        return post

    def run_pm_with(self, route, gh=None):
        q = self.q()
        server.PM_MODE = 'codex'
        patches = [patch.object(server, '_run_pm_codex', return_value=(route, 'thread')),
                   patch.object(server, 'compact_pr_context', return_value='Current #1570 Ready')]
        if gh:
            patches.append(patch.object(server, '_pm_request', side_effect=gh.request))
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        server.run_pm(q)
        return q

    # ---------- 1. pre-invocation recovery ----------
    def test_worker_failure_persists_owed_recovery_and_queues_exactly_one(self):
        self.assign()
        q = self.dev_row()
        with self.assertRaises(RuntimeError) as err:
            server.run_dev(q)
        first = server.fail_delivery('dev', q, err.exception)
        self.assertIsNotNone(first)
        failed = next(r for r in server.list_queue() if r['id'] == q['id'])
        self.assertEqual(failed['delivery_stage'], 'BLOCKED BEFORE DEV INVOCATION')
        self.assertEqual(failed['preflight_recovery_due'], 0)
        self.assertEqual(len(self.recoveries()), 1)
        self.assertEqual(server.recover_failed_dev_preflight(q['id'], 'again'), first)
        self.assertEqual(server.sweep_preflight_recoveries(), [])
        self.assertEqual(len(self.recoveries()), 1)
        self.assertFalse([r for r in server.list_queue() if r['recipient'] == 'dev' and r['id'] != q['id']])

    def test_recovery_survives_handoff_depth_boundary_and_auto_handoff_off(self):
        self.assign()
        q = self.dev_row(handoff_depth=server.MAX_HANDOFF_DEPTH + 3, auto_handoff=0,
                         status='failed', error='Assigned task worktree is missing')
        rid = server.recover_failed_dev_preflight(q['id'], 'Assigned task worktree is missing')
        self.assertIsNotNone(rid)
        rec = next(r for r in server.list_queue() if r['id'] == rid)
        self.assertEqual((rec['recipient'], rec['source_actor'], rec['handoff_depth'], rec['auto_handoff']), ('pm', 'SYSTEM', 0, 1))
        self.assertIn(BRANCH, rec['content'])

    def test_crash_between_failure_and_recovery_is_swept_once_after_restart(self):
        self.assign()
        q = self.dev_row(status='failed', error='worktree missing', preflight_recovery_due=1)
        server.init_db()  # restart path
        swept = server.sweep_preflight_recoveries()
        self.assertEqual(len(swept), 1)
        self.assertEqual(server.sweep_preflight_recoveries(), [])
        self.assertEqual(len(self.recoveries()), 1)
        self.assertEqual(self.recoveries()[0]['parent_queue_id'], q['id'])

    def test_historical_failures_are_not_swept_into_new_recoveries(self):
        self.assign()
        self.dev_row(status='failed', error='Assigned worktree does not match task branch')  # deadlock.4 #34/#36 shape
        self.assertEqual(server.sweep_preflight_recoveries(), [])
        self.assertEqual(self.recoveries(), [])

    def test_repeat_block_on_unchanged_tuple_is_board_blocker_not_second_wake(self):
        self.assign()
        a = self.dev_row(status='failed', error='missing')
        b = self.dev_row(status='failed', error='missing')
        self.assertIsNotNone(server.recover_failed_dev_preflight(a['id'], 'missing'))
        self.assertIsNone(server.recover_failed_dev_preflight(b['id'], 'missing'))
        self.assertEqual(len(self.recoveries()), 1)
        self.assertIn('Repeated pre-invocation block', self.item(KEY)['blocker'])
        self.assertEqual(server.list_player_status()['cli_dev']['status'], 'blocked')

    def test_retry_api_cannot_requeue_dev_after_preflight_block(self):
        self.assign()
        post = self.http()
        q = self.dev_row(status='failed', error='missing')
        code, body = post('/api/retry-delivery', {'id': q['id']})  # before any recovery exists
        self.assertEqual(code, 409)
        self.assertIn('Dev retry is disabled', body['error'])
        rid = server.recover_failed_dev_preflight(q['id'], 'missing')
        code, body = post('/api/retry-delivery', {'id': q['id']})
        self.assertEqual((code, body['recovery_queue_id']), (409, rid))
        self.assertEqual(next(r for r in server.list_queue() if r['id'] == q['id'])['status'], 'failed')
        # c5 (F12): a failure AFTER invocation may have written; the generic retry cannot replay it.
        invoked = self.dev_row(status='failed', started_at=server.now(), attempts=1, error='transport')
        code, body = post('/api/retry-delivery', {'id': invoked['id']})
        self.assertEqual(code, 409)
        self.assertIn('writes are uncertain', body['error'])
        self.assertEqual(next(r for r in server.list_queue() if r['id'] == invoked['id'])['status'], 'failed')
        # A non-Dev (PM) failure stays operator-retryable.
        pm = server.enqueue(server.add_activity('SYSTEM', 'pm turn', 'pm'), 'pm', 'pm turn', source_actor='SYSTEM')
        server.update_queue(pm, status='failed', error='transport')
        self.assertEqual(post('/api/retry-delivery', {'id': pm})[0], 200)

    def test_pm_next_dev_to_unresolvable_tuple_queues_recovery_not_dev_row(self):
        self.assign()
        route = {'message': 'CLI Dev: implement now', 'next': 'dev', 'pm_actions': [], 'board_updates': {
            'work_items': [{'item_key': KEY, 'owner': 'cli_dev', 'state': 'active'}],
            'players': [{'player_id': 'cli_dev', 'status': 'assigned', 'work_item_key': KEY}]}}
        self.run_pm_with(route)
        self.assertFalse([r for r in server.list_queue() if r['recipient'] == 'dev'])
        self.assertEqual(len(self.recoveries()), 1)
        self.assertIn('/missing/task-worktree', self.recoveries()[0]['content'])

    # ---------- 2. lease transfer / bootstrap ----------
    def test_lease_moves_only_to_a_verified_tuple_and_is_preserved_on_rejection(self):
        self.assign(worktree='/old/verified')
        self.assertFalse(server.apply_board_updates({'work_items': [{'item_key': KEY, 'worktree': '/new/never-created'}]}))
        self.assertEqual(self.item(KEY)['worktree'], '/old/verified')
        with self.assertRaisesRegex(ValueError, 'unverified tuple'):
            server.update_work_item(KEY, worktree='/new/never-created')
        ok = {'exists': True, 'is_git': True, 'branch': BRANCH, 'head': 'c' * 40}
        with patch.object(server, 'validate_worktree', return_value=ok):
            self.assertTrue(server.apply_board_updates({'work_items': [{'item_key': KEY, 'worktree': '/new/bootstrapped'}]}))
            self.assertEqual(self.item(KEY)['worktree'], '/new/bootstrapped')
            target = server.resolve_dev_target({'work_item_key': KEY})
        self.assertTrue(target['ok'])
        self.assertEqual(target['path'], '/new/bootstrapped')

    def test_successful_bootstrap_hands_off_to_dev_once(self):
        self.assign(worktree='')
        ok = {'exists': True, 'is_git': True, 'branch': BRANCH, 'head': 'c' * 40}
        route = {'message': 'CLI Dev: bootstrap verified; implement', 'next': 'dev', 'pm_actions': [], 'board_updates': {
            'work_items': [{'item_key': KEY, 'owner': 'cli_dev', 'state': 'active', 'worktree': '/boot/ok'}],
            'players': [{'player_id': 'cli_dev', 'status': 'assigned', 'work_item_key': KEY}]}}
        with patch.object(server, 'validate_worktree', return_value=ok):
            self.run_pm_with(route)
        dev = [r for r in server.list_queue() if r['recipient'] == 'dev']
        self.assertEqual(len(dev), 1)
        self.assertEqual((dev[0]['work_item_key'], dev[0]['target_worktree']), (KEY, '/boot/ok'))
        self.assertEqual(self.recoveries(), [])

    # ---------- 3. independent asks ----------
    MULTI = ('App Dev → CLI PM / Browser PM — #1258 App Dev lane — BLOCKER SUMMARY (3 open asks) — REQUEST: '
             '(1) push-pin disposition for the coaching-text summary, (2) a route for PR 4\'s real-engine evidence, '
             '(3) a Designer copy check\n\nbody')

    def comment(self, cid, body, at='2099-01-01T00:00:00Z'):
        return {'id': cid, 'body': body, 'url': f'https://github.com/c/{cid}', 'at': at}

    def test_multi_ask_post_records_each_ask_and_none_is_not_an_ask(self):
        server.ingest_control_asks([self.comment(101, self.MULTI),
                                    self.comment(102, 'App Dev → CLI PM — #1258 — DONE — REQUEST: none'),
                                    self.comment(103, '<!-- rwt-board-pm:x:1 -->\nREQUEST: pin')])
        asks = server.list_asks('pending')
        self.assertEqual([(a['source_comment_id'], a['ask_index']) for a in asks], [(101, 1), (101, 2), (101, 3)])
        self.assertIn('Designer copy check', asks[2]['request'])
        self.assertEqual(asks[0]['source_actor'], 'App Dev')

    def test_history_before_ledger_start_is_not_replayed(self):
        server.ingest_control_asks([self.comment(90, 'X → PM — REQUEST: pin', at='2000-01-01T00:00:00Z')])
        self.assertEqual(server.list_asks(), [])

    def test_newer_noisy_events_cannot_erase_older_asks_and_repeat_is_deduplicated(self):
        server.ingest_control_asks([self.comment(101, self.MULTI)])
        for n in range(5):
            aid = server.add_activity('GITHUB', f'#1570 CI event {n}', 'pm')
            server._coalesced_github_enqueue(aid, 'pm', f'#1570 CI terminal run {n}')
            server.ingest_control_asks([self.comment(101, self.MULTI), self.comment(200 + n, f'#1570 status {n}')])
        self.assertEqual(len(server.list_asks('pending')), 3)
        with patch.object(server, 'compact_pr_context', return_value='Current #1570'):
            prompt = server.compose_for_pm({'id': 9, 'content': 'latest #1570 event only'})
        self.assertIn('OPEN ASKS', prompt)
        self.assertIn("real-engine evidence", prompt)

    def test_generic_pm_reply_closes_nothing_typed_disposition_closes_one(self):
        server.ingest_control_asks([self.comment(101, self.MULTI)])
        ids = [a['id'] for a in server.list_asks('pending')]
        self.run_pm_with({'message': 'Noted; monitoring.', 'next': 'none', 'pm_actions': [], 'board_updates': board()})
        self.assertEqual(len(server.list_asks('pending')), 3)
        route = {'message': 'Dispositions', 'next': 'none', 'pm_actions': [], 'board_updates': board(), 'ask_dispositions': [
            {'ask_id': ids[0], 'disposition': 'pin', 'evidence': 'pin ' + HEAD, 'owner': None, 'dependency': None},
            {'ask_id': ids[1], 'disposition': 'hold', 'evidence': 'needs Production run', 'owner': None, 'dependency': None},
            {'ask_id': ids[2], 'disposition': 'completed', 'evidence': 'looks fine', 'owner': None, 'dependency': None}]}
        self.run_pm_with(route)
        pending = {a['id'] for a in server.list_asks('pending')}
        self.assertEqual(pending, {ids[1], ids[2]})  # incomplete HOLD and evidence-free completion are rejected
        closed = next(a for a in server.list_asks() if a['id'] == ids[0])
        self.assertEqual(closed['disposition'], 'pin')

    def test_unpublished_reply_does_not_close_asks(self):
        server.ingest_control_asks([self.comment(101, self.MULTI)])
        ids = [a['id'] for a in server.list_asks('pending')]
        route = {'message': 'pin', 'next': 'none', 'pm_actions': [], 'board_updates': board(), 'ask_dispositions': [
            {'ask_id': ids[0], 'disposition': 'pin', 'evidence': HEAD, 'owner': None, 'dependency': None}]}
        with patch.object(server, 'publish_pm_reply', return_value=False):
            self.run_pm_with(route)
        self.assertEqual(len(server.list_asks('pending')), 3)

    def test_external_numbered_disposition_closes_only_named_items(self):
        server.ingest_control_asks([self.comment(101, self.MULTI)])
        server.ingest_control_asks([self.comment(150, 'Browser PM → App Dev — dispositions for consolidated blockers 101\n\n'
                                                       '1. Coaching-summary publication: CONDITIONAL PUSH PIN\n3. Copy check: DONE')])
        self.assertEqual([a['ask_index'] for a in server.list_asks('pending')], [2])

    def test_watchdog_one_bounded_recovery_then_board_blocker(self):
        server.ingest_control_asks([self.comment(101, self.MULTI, at='2099-01-01T00:00:00Z')])
        with server.con() as c:
            c.execute("UPDATE asks SET source_at='2000-01-01T00:00:00+00:00'")
        with patch.object(server, '_has_pending_delivery', return_value=True):
            self.assertIsNone(server.pending_ask_watchdog())  # PM busy: no concurrent mutator
        qid = server.pending_ask_watchdog()
        self.assertIsNotNone(qid)
        wake = next(r for r in server.list_queue() if r['id'] == qid)
        self.assertEqual(wake['kind'], 'ask_recovery')
        self.assertEqual(wake['content'].count('source 101'), 3)
        server.update_queue(qid, status='responded')
        self.assertIsNone(server.pending_ask_watchdog())  # no second wake
        with server.con() as c:
            c.execute("UPDATE asks SET last_recovery_at='2000-01-01T00:00:00+00:00'")
        self.assertIsNone(server.pending_ask_watchdog())
        self.assertIn('3 ask(s) still undispositioned', server.get_setting('pm_ask_blocker'))
        self.assertTrue(all(a['escalated'] for a in server.list_asks('pending')))
        self.assertEqual(len([r for r in server.list_queue() if r.get('kind') == 'ask_recovery']), 1)

    # ---------- 4. review handoff + receipt ----------
    def test_cli_dev_review_handoff_requires_its_own_receipt(self):
        ok = {'exists': True, 'is_git': True, 'branch': BRANCH, 'head': 'c' * 40}
        with patch.object(server, 'validate_worktree', return_value=ok):
            self.assign(worktree='/wt/ok')
            route = {'message': 'Review dispositioned', 'next': 'none', 'pm_actions': [], 'board_updates': board(KEY),
                     'review_handoffs': [{'pr_number': 1570, 'head': HEAD, 'reviewed_ref': 'review 4212726964', 'disposition': 'fix_now',
                                          'owner': 'cli_dev', 'work_item_key': KEY, 'instruction': 'Bind Focus feedback after Analytics reload'}]}
            self.run_pm_with(route)
            self.run_pm_with(route)  # duplicate event/restart: no second delivery
        h = server.list_review_handoffs()
        self.assertEqual(len(h), 1)
        self.assertEqual(h[0]['state'], 'delivered')
        dev = [r for r in server.list_queue() if r['recipient'] == 'dev']
        self.assertEqual([r['kind'] for r in dev], ['review_handoff'])
        self.assertIn('RECEIPT ' + h[0]['token'], dev[0]['content'])
        self.assertEqual(server.record_handoff_receipts(dev_result='ACK, starting now', queue_id=dev[0]['id']), [])
        self.assertEqual(server.record_handoff_receipts(dev_result='RECEIPT ' + h[0]['token'], queue_id=999), [])  # wrong delivery
        self.assertEqual(server.record_handoff_receipts(dev_result='RECEIPT ' + h[0]['token'] + ' started', queue_id=dev[0]['id']), [h[0]['id']])
        self.assertEqual(server.list_review_handoffs()[0]['state'], 'acknowledged')

    def test_app_dev_handoff_is_published_and_acked_only_by_token_comment(self):
        route = {'message': 'Review dispositioned', 'next': 'none', 'pm_actions': [], 'board_updates': board(),
                 'review_handoffs': [{'pr_number': 1570, 'head': HEAD, 'reviewed_ref': 'review 4212726964', 'disposition': 'fix_now',
                                      'owner': 'app_dev', 'work_item_key': None, 'instruction': 'Fix the P1 binding'}]}
        with patch.object(server, 'publish_pm_reply', return_value=True) as publish:
            self.run_pm_with(route)
        token = server.list_review_handoffs()[0]['token']
        self.assertIn('RECEIPT ' + token, publish.call_args[0][1])
        self.assertEqual(server.list_review_handoffs()[0]['state'], 'delivered')
        server.record_handoff_receipts([self.comment(300, 'App Dev → CLI PM — ACK, on it')])
        self.assertEqual(server.list_review_handoffs()[0]['state'], 'delivered')
        server.record_handoff_receipts([self.comment(301, f'App Dev → CLI PM — RECEIPT {token} — started fix')])
        self.assertEqual(server.list_review_handoffs()[0]['state'], 'acknowledged')

    def test_receipt_cannot_be_closed_by_quoted_or_negated_token(self):
        route = {'message': 'Review dispositioned', 'next': 'none', 'pm_actions': [], 'board_updates': board(),
                 'review_handoffs': [{'pr_number': 1570, 'head': HEAD, 'reviewed_ref': 'review 4212726964',
                                      'disposition': 'fix_now', 'owner': 'app_dev',
                                      'instruction': 'Fix the P1 binding'}]}
        with patch.object(server, 'publish_pm_reply', return_value=True):
            self.run_pm_with(route)
        token = server.list_review_handoffs()[0]['token']
        server.record_handoff_receipts([self.comment(301, f'App Dev: NOT DONE; quoting RECEIPT {token} from the request')])
        self.assertEqual(server.list_review_handoffs()[0]['state'], 'delivered')
        self.assertEqual(server.list_asks('open'), [])

    def test_receipt_before_delivery_cannot_acknowledge_recorded_handoff(self):
        _, _, index = server.record_review_handoffs(self.q(), [{'pr_number': 1570, 'head': HEAD,
            'reviewed_ref': 'review 4212726964', 'disposition': 'fix_now', 'owner': 'app_dev',
            'instruction': 'Fix the P1 binding'}])
        row = next(h for h in server.list_review_handoffs() if h['id'] == index[0])
        server.record_handoff_receipts([self.comment(301, f'App Dev → CLI PM — RECEIPT {row["token"]} — started fix')])
        self.assertEqual(server.list_review_handoffs()[0]['state'], 'recorded')

    def test_required_action_hold_blocks_review_and_next_dev_routes(self):
        ok = {'exists': True, 'is_git': True, 'branch': BRANCH, 'head': 'c' * 40}
        with patch.object(server, 'validate_worktree', return_value=ok):
            self.assign(worktree='/wt/ok')
            route = {'message': 'Refresh is blocked; hold Dev work', 'next': 'dev', 'pm_actions': [],
                     'board_updates': board(KEY), 'review_handoffs': [{'pr_number': 1570, 'head': HEAD,
                         'reviewed_ref': 'review 4212726964', 'disposition': 'fix_now', 'owner': 'cli_dev',
                         'work_item_key': KEY, 'instruction': 'Fix the P1 binding'}]}
            with patch.object(server, 'execute_pm_actions', return_value=['HOLD: required review action is pending']), \
                 patch.object(server, 'publish_pm_reply', return_value=True):
                self.run_pm_with(route)
        dev_rows = [r for r in server.list_queue() if r['recipient'] == 'dev']
        self.assertEqual(dev_rows, [])
        self.assertEqual(server.list_review_handoffs()[0]['state'], 'held')
        held_item = next(x for x in server.list_work_items() if x['item_key'] == KEY)
        self.assertTrue(held_item['dispatch_hold'])
        self.assertIsNone(server._wake_cli_dev_for_item(held_item, 'anti-idle test'))
        self.assertEqual([r for r in server.list_queue() if r['recipient'] == 'dev'], [])

    def test_review_handoff_and_next_dev_share_one_delivery(self):
        ok = {'exists': True, 'is_git': True, 'branch': BRANCH, 'head': 'c' * 40}
        with patch.object(server, 'validate_worktree', return_value=ok):
            self.assign(worktree='/wt/ok')
            route = {'message': 'Review and continue assigned work', 'next': 'dev', 'pm_actions': [],
                     'board_updates': board(KEY), 'review_handoffs': [{'pr_number': 1570, 'head': HEAD,
                         'reviewed_ref': 'review 4212726964', 'disposition': 'fix_now', 'owner': 'cli_dev',
                         'work_item_key': KEY, 'instruction': 'Fix the P1 binding'}]}
            with patch.object(server, 'publish_pm_reply', return_value=True):
                self.run_pm_with(route)
        dev_rows = [r for r in server.list_queue() if r['recipient'] == 'dev']
        self.assertEqual(len(dev_rows), 1)
        self.assertIn('RECEIPT ', dev_rows[0]['content'])

    def test_recorded_handoff_has_a_durable_resume_record(self):
        route = {'message': 'Review dispositioned', 'next': 'none', 'pm_actions': [], 'board_updates': board(),
                 'review_handoffs': [{'pr_number': 1570, 'head': HEAD, 'reviewed_ref': 'review 4212726964',
                                      'disposition': 'fix_now', 'owner': 'app_dev',
                                      'instruction': 'Fix the P1 binding'}]}
        with patch.object(server, 'publish_pm_reply', side_effect=RuntimeError('simulated crash after record')):
            with self.assertRaises(RuntimeError):
                self.run_pm_with(route)
        with server.con() as c:
            tables = {r['name'] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertIn('pm_turn_effects', tables)
        with server.con() as c:
            row = c.execute('SELECT phase,plan_json FROM pm_turn_effects ORDER BY queue_id DESC LIMIT 1').fetchone()
        self.assertIsNotNone(row)
        self.assertIn('Fix the P1 binding', row['plan_json'])

    # ---------- 5. refresh_reviews end to end ----------
    def journal(self):
        with server.con() as c:
            return [dict(r) for r in c.execute('SELECT * FROM pm_action_journal')]

    def test_pm_plan_reaches_executor_and_records_execution_not_review_completion(self):
        gh = FakeGitHub()
        raw = json.dumps({'message': 'Refreshing #1570 reviews', 'next': 'none', 'publish': True, 'board_updates': board(),
                          'pm_actions': [refresh_action()], 'ask_dispositions': [], 'review_handoffs': []})
        route = server.parse_pm_route(raw)
        self.assertIsNone(route['parse_error'])
        self.run_pm_with(route, gh)
        self.assertEqual(gh.writes, ['draft', 'ready'])
        j = self.journal()[0]
        self.assertEqual((j['status'], j['phase'], j['review_state']), ('completed', 'ready_confirmed', 'pending'))
        self.assertIn('PENDING', j['result'])
        self.assertNotIn('complete', j['review_state'])

    def test_action_requires_exact_affirmative_source_authorization(self):
        for body in (
            f'{HEAD} {BASE} Draft→Ready refresh is discussed',
            f'{HEAD} {BASE}\n> ACTION AUTHORIZATION: kind=refresh_reviews pr=1570 head={HEAD} base={BASE}',
            f'{HEAD} {BASE}\n```text\nACTION AUTHORIZATION: kind=refresh_reviews pr=1570 head={HEAD} base={BASE}\n```',
            f'{HEAD} {BASE}\nACTION AUTHORIZATION: kind=refresh_reviews pr=1570 head={HEAD} base={BASE}\nHOLD: refresh_reviews',
            f'{HEAD} {BASE}\nACTION AUTHORIZATION: kind=refresh_reviews pr=1570 head={HEAD} base={BASE}\nDO NOT execute PM actions',
        ):
            gh = FakeGitHub(source_body=body)
            with patch.object(server, '_pm_request', side_effect=gh.request):
                result = server.execute_pm_actions({'id': 12}, [refresh_action()])
            self.assertTrue(result[0].startswith('HOLD:'), result)
            self.assertEqual(gh.writes, [])
            with server.con() as c:
                c.execute('DELETE FROM pm_action_journal')

    def test_uncertain_draft_creation_resolves_by_readback_without_replay(self):
        action = {'kind': 'open_draft_pr', 'branch': 'test/1258-packet', 'head': HEAD, 'base': BASE,
                  'source_comment_id': 99, 'title': 'Draft packet', 'body': f'{HEAD} {BASE}'}
        gh = FakeGitHub()
        gh.existing_drafts = [{'number': 999, 'state': 'open', 'head': {'sha': HEAD}, 'base': {'sha': BASE}}]
        key = canonical_key(action)
        with server.con() as c:
            c.execute('INSERT INTO pm_action_journal(action_key,status,result,kind,action_json,updated_at) VALUES(?,?,?,?,?,?)',
                      (key, 'unconfirmed', 'timed out', action['kind'], json.dumps(action), server.now()))
        with patch.object(server, '_pm_request', side_effect=gh.request):
            result = server.execute_pm_actions({'id': 20}, [action])
        self.assertTrue(result[0].startswith('RESOLVED: readback found Draft/PR #999'), result)
        self.assertEqual(gh.writes, [])
        self.assertEqual(self.journal()[0]['status'], 'completed')

    def test_uncertain_ready_and_ci_writes_resolve_by_typed_readback(self):
        actions = [
            {'kind': 'mark_ready', 'pr_number': 1570, 'head': HEAD, 'base': BASE, 'source_comment_id': 99},
            {'kind': 'dispatch_full_ci', 'pr_number': 1570, 'branch': 'fix/1258-action-binding',
             'head': HEAD, 'base': BASE, 'source_comment_id': 99},
            {'kind': 'rerun_failed_jobs', 'pr_number': 1570, 'run_id': 321, 'run_attempt': 1,
             'branch': 'fix/1258-action-binding', 'head': HEAD, 'base': BASE, 'source_comment_id': 99},
        ]
        gh = FakeGitHub()
        gh.workflow_runs = [{'id': 654, 'head_sha': HEAD, 'event': 'workflow_dispatch',
                             'head_branch': 'fix/1258-action-binding', 'status': 'in_progress'}]
        for index, action in enumerate(actions, start=1):
            key = canonical_key(action)
            with server.con() as c:
                c.execute('INSERT INTO pm_action_journal(action_key,status,result,kind,action_json,updated_at) VALUES(?,?,?,?,?,?)',
                          (key, 'unconfirmed', 'write timed out', action['kind'], json.dumps(action), server.now()))
            with patch.object(server, '_pm_request', side_effect=gh.request):
                result = server.execute_pm_actions({'id': 30 + index}, [action])
            self.assertTrue(result[0].startswith('RESOLVED:'), result)
        self.assertEqual(gh.writes, [])
        self.assertEqual({row['status'] for row in self.journal()}, {'completed'})

    def test_candidate_mutation_lease_blocks_a_different_pm_action(self):
        active = {'kind': 'mark_ready', 'pr_number': 1570, 'head': HEAD, 'base': BASE, 'source_comment_id': 99}
        pending = refresh_action()
        with server.con() as c:
            c.execute('INSERT INTO pm_action_journal(action_key,status,result,kind,action_json,pr_number,head,updated_at,lease_scope) '
                      'VALUES(?,?,?,?,?,?,?,?,?)',
                      (canonical_key(active), 'running', 'in progress', active['kind'], json.dumps(active), 1570, HEAD,
                       server.now(), 'pr:1570'))
        with patch.object(server, '_pm_request') as request:
            result = server.execute_pm_actions({'id': 41}, [pending])
        self.assertTrue(result[0].startswith('HOLD: pr:1570 mutation lease'), result)
        request.assert_not_called()
        self.assertEqual(len(self.journal()), 1)

    def test_startup_migration_reconstructs_mutation_scope_for_old_journal_rows(self):
        action = refresh_action()
        with server.con() as c:
            c.execute('INSERT INTO pm_action_journal(action_key,status,result,kind,action_json,pr_number,head,updated_at) '
                      'VALUES(?,?,?,?,?,?,?,?)',
                      (canonical_key(action), 'unconfirmed', 'old pending write', action['kind'], json.dumps(action),
                       1570, HEAD, server.now()))
        server.init_db()
        self.assertEqual(self.journal()[0]['lease_scope'], 'pr:1570')

    def test_duplicate_and_noncanonical_requests_refresh_once(self):
        gh = FakeGitHub()
        with patch.object(server, '_pm_request', side_effect=gh.request):
            server.execute_pm_actions({'id': 1}, [refresh_action()])
            again = server.execute_pm_actions({'id': 2}, [refresh_action(source_comment_id=999, title=None, head=HEAD.upper())])
        self.assertEqual(gh.writes, ['draft', 'ready'])
        self.assertTrue(again[0].startswith('RECORDED: completed'))
        self.assertEqual(canonical_key(refresh_action()), canonical_key({'kind': 'refresh_reviews', 'pr_number': '1570', 'head': HEAD, 'base': BASE}))

    def test_concurrent_requests_execute_once(self):
        gh = FakeGitHub()
        out = []
        with patch.object(server, '_pm_request', side_effect=gh.request):
            threads = [threading.Thread(target=lambda: out.extend(server.execute_pm_actions({'id': 1}, [refresh_action()]))) for _ in range(4)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
        self.assertEqual(gh.writes, ['draft', 'ready'])
        self.assertEqual(sum(1 for r in out if r.startswith('EXECUTED')), 1)

    def test_interrupted_ready_write_resumes_after_restart_without_second_cycle(self):
        gh = FakeGitHub(fail_on='ready')
        with patch.object(server, '_pm_request', side_effect=gh.request):
            first = server.execute_pm_actions({'id': 1}, [refresh_action()])
        self.assertTrue(first[0].startswith('UNCONFIRMED'))
        self.assertTrue(gh.pr['draft'])  # stranded in Draft until resumed
        self.assertEqual(self.journal()[0]['phase'], 'ready_requested')
        server.init_db()  # restart
        with patch.object(server, '_pm_request', side_effect=gh.request):
            resumed = server.resume_interrupted_actions()
            self.assertEqual(server.resume_interrupted_actions(), [])
        self.assertEqual(resumed[0][1], 'completed')
        self.assertEqual(gh.writes, ['draft', 'ready'])  # exactly one Draft conversion overall
        self.assertFalse(gh.pr['draft'])
        self.assertIn('RESUMED', self.journal()[0]['result'])

    def test_transient_refresh_read_keeps_phase_and_retries_without_second_draft(self):
        gh = FakeGitHub(draft=True, read_failure='pulls/1570')
        action = refresh_action()
        key = canonical_key(action)
        with server.con() as c:
            c.execute('INSERT INTO pm_action_journal(action_key,status,result,kind,action_json,phase,pr_number,head,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
                      (key, 'unconfirmed', 'read timed out', 'refresh_reviews', json.dumps(action), 'draft_confirmed', 1570, HEAD, server.now()))
        with patch.object(server, '_pm_request', side_effect=gh.request):
            first = server.execute_pm_actions({'id': 88}, [action])
            self.assertTrue(first[0].startswith('UNCONFIRMED:'), first)
            self.assertEqual(self.journal()[0]['phase'], 'draft_confirmed')
            second = server.execute_pm_actions({'id': 89}, [action])
        self.assertTrue(second[0].startswith('RESUMED:'), second)
        self.assertEqual(gh.writes, ['ready'])

    def test_crash_mid_execution_running_row_becomes_resumable(self):
        gh = FakeGitHub(draft=True)  # Draft write landed, then the process died
        with server.con() as c:
            c.execute("INSERT INTO pm_action_journal(action_key,status,result,kind,action_json,phase,pr_number,head,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                      (canonical_key(refresh_action()), 'running', 'x', 'refresh_reviews', json.dumps(refresh_action()), 'draft_requested', 1570, HEAD, server.now()))
        server.init_db()
        self.assertEqual(self.journal()[0]['status'], 'unconfirmed')
        with patch.object(server, '_pm_request', side_effect=gh.request):
            again = server.execute_pm_actions({'id': 3}, [refresh_action()])  # PM re-emits after restart
        self.assertTrue(again[0].startswith('RESUMED'))
        self.assertEqual(gh.writes, ['ready'])

    def test_lost_draft_write_is_not_reported_as_a_refresh(self):
        gh = FakeGitHub(fail_on='draft')
        with patch.object(server, '_pm_request', side_effect=gh.request):
            server.execute_pm_actions({'id': 1}, [refresh_action()])
            out = server.resume_interrupted_actions()
        self.assertEqual(out[0][1], 'held')
        self.assertEqual(gh.writes, [])
        self.assertIn('no proven Draft→Ready cycle', self.journal()[0]['result'])

    def test_stale_or_conflicting_state_is_hold_without_writes(self):
        for gh in (FakeGitHub(draft=True), FakeGitHub()):
            if not gh.pr['draft']:
                gh.pr['head']['sha'] = 'c' * 40
            with patch.object(server, '_pm_request', side_effect=gh.request):
                result = server.execute_pm_actions({'id': 1}, [refresh_action()])
            self.assertTrue(result[0].startswith('HOLD'), result)
            self.assertEqual(gh.writes, [])
            with server.con() as c:
                c.execute('DELETE FROM pm_action_journal')

    def test_existing_review_is_observed_not_executed(self):
        gh = FakeGitHub(reviews=[{'id': 1, 'commit_id': HEAD, 'user': {'login': 'chatgpt-codex-connector[bot]'}}])
        with patch.object(server, '_pm_request', side_effect=gh.request):
            result = server.execute_pm_actions({'id': 1}, [refresh_action()])
        self.assertTrue(result[0].startswith('OBSERVED'))
        self.assertEqual((self.journal()[0]['status'], self.journal()[0]['review_state']), ('observed', 'code_review_observed'))
        self.assertEqual((self.journal()[0]['security_review_state'], self.journal()[0]['pm_acceptance_state']), ('pending', 'pending'))
        self.assertEqual(gh.writes, [])

    def test_completed_review_routes_one_pm_instruction_wake(self):
        gh = FakeGitHub()
        with patch.object(server, '_pm_request', side_effect=gh.request):
            server.execute_pm_actions({'id': 1}, [refresh_action()])
            self.assertEqual(server.poll_refreshed_reviews(), [])  # still pending
            gh.reviews = [{'id': 4212726964, 'commit_id': HEAD, 'user': {'login': 'chatgpt-codex-connector[bot]'}}]
            woke = server.poll_refreshed_reviews()
            self.assertEqual(server.poll_refreshed_reviews(), [])
        self.assertEqual(len(woke), 1)
        wake = next(r for r in server.list_queue() if r['id'] == woke[0])
        self.assertEqual(wake['kind'], 'review_completed')
        self.assertIn('NOT inferred', wake['content'])
        self.assertEqual(self.journal()[0]['review_state'], 'code_review_observed')

    def test_review_poll_marks_changed_candidate_stale_before_attributing_review(self):
        gh = FakeGitHub()
        with patch.object(server, '_pm_request', side_effect=gh.request):
            server.execute_pm_actions({'id': 1}, [refresh_action()])
            gh.pr['head']['sha'] = 'c' * 40
            gh.reviews = [{'id': 999, 'commit_id': HEAD, 'user': {'login': 'chatgpt-codex-connector[bot]'}}]
            self.assertEqual(server.poll_refreshed_reviews(), [])
        row = self.journal()[0]
        self.assertEqual(row['review_state'], 'stale_candidate')
        self.assertIn('candidate is stale', row['review_error'])
        self.assertTrue(any(x['kind'] == 'review_stale' and 'Do not reuse old-head reviews' in x['content']
                            for x in server.list_queue()))

    def test_unsupported_action_is_named_recoverable_blocker(self):
        route = {'message': 'merge it', 'next': 'dev', 'pm_actions': [dict(refresh_action(), kind='merge_pr')], 'board_updates': board()}
        self.run_pm_with(route)
        blockers = json.loads(server.get_setting('pm_action_blockers'))
        self.assertIn("kind='merge_pr'", blockers[0]['detail'])
        self.assertIn('Recoverable', blockers[0]['detail'])
        self.assertFalse([r for r in server.list_queue() if r['recipient'] == 'dev'])
        self.assertEqual(self.journal(), [])

    def test_instructions_schema_and_prompt_name_every_executor_action(self):
        root = Path(server.__file__).resolve().parent
        text = (root / 'pm-instructions.md').read_text()
        enum = json.loads((root / 'pm-route.schema.json').read_text())['properties']['pm_actions']['items']['properties']['kind']['enum']
        self.assertEqual(set(enum), set(KINDS))
        with patch.object(server, 'compact_pr_context', return_value='x'):
            prompt = server.compose_for_pm({'id': 1, 'content': 'm'})
        for kind in KINDS:
            self.assertIn(kind, text)
            self.assertIn(kind, prompt)
        self.assertNotIn('The only executor actions are mark_ready, open_draft_pr, rerun_failed_jobs and dispatch_full_ci', text)

    # ---------- 6. sharing location ----------
    def test_per_pr_share_location_is_visible_to_agents_and_manifests(self):
        loc = server.handoff_location('PR-1570')
        self.assertEqual(loc['remote_path'], 'handoffs/PR-1570/')
        self.assertTrue(loc['tree_url'].startswith('https://github.com/relativityE/speaksharp/tree/'))
        self.assertNotIn(str(Path.home()), json.dumps(loc))
        with self.assertRaises(ValueError):
            server.handoff_location('../etc')
        with patch.object(server, 'HANDOFFS', Path(self.tmp.name) / 'handoffs'):
            saved = server.save_files([{'name': 'a.patch.txt', 'data': 'aGk='}], 1570, 'orchestration')
        manifest = json.loads(saved[-1][1].read_text())
        self.assertTrue(manifest['remote_share']['path'].startswith('handoffs/PR-1570/orchestration/'))
        with patch.object(server, 'compact_pr_context', return_value='x'):
            self.assertIn('SHARED ARTIFACTS', server.compose_for_pm({'id': 1, 'content': 'm'}))
        self.assertIn('handoffs/PR-N/', server.compose_for_dev({'id': 1, 'content': 'm'}))


    # ---------- c3: Browser PM review 6048387240 ----------
    def verified(self):
        ok = {'exists': True, 'is_git': True, 'branch': BRANCH, 'head': 'c' * 40,
              'tree': 'd' * 40, 'repo_common_dir': server._git_common_dir(server.BASE_REPO),
              'origin': 'https://github.com/relativityE/speaksharp.git',
              'dirty_paths': [], 'dirty_fingerprint': hashlib.sha256(b'').hexdigest()}
        p = patch.object(server, 'validate_worktree', return_value=ok)
        p.start()
        self.addCleanup(p.stop)
        self.assign(worktree='/wt/ok')

    def test_queued_delivery_rejects_head_drift_before_worker_invocation(self):
        self.verified()
        aid = server.add_activity('PM', 'run focused checks', 'dev')
        qid = server.enqueue(aid, 'dev', 'run focused checks', source_actor='PM', work_item_key=KEY)
        queued = next(row for row in server.list_queue() if row['id'] == qid)
        self.assertEqual((queued['target_head'], queued['target_tree']), ('c' * 40, 'd' * 40))
        changed = {'exists': True, 'is_git': True, 'branch': BRANCH, 'head': 'e' * 40,
                   'tree': 'f' * 40, 'repo_common_dir': server._git_common_dir(server.BASE_REPO),
                   'origin': 'https://github.com/relativityE/speaksharp.git',
                   'dirty_paths': [], 'dirty_fingerprint': hashlib.sha256(b'').hexdigest()}
        with patch.object(server, 'validate_worktree', return_value=changed), patch.object(server, '_run_claude_once') as invoke:
            result = server.resolve_dev_target(queued)
            self.assertFalse(result['ok'])
            self.assertIn('HEAD/tree changed after enqueue', result['error'])
            invoke.assert_not_called()

    def test_task_owned_dirty_paths_are_frozen_and_unowned_edits_block(self):
        self.assign(worktree='/wt/ok', owned_paths=['notes/owned.md'])
        frozen = {'exists': True, 'is_git': True, 'branch': BRANCH, 'head': 'c' * 40, 'tree': 'd' * 40,
                  'repo_common_dir': server._git_common_dir(server.BASE_REPO),
                  'origin': 'https://github.com/relativityE/speaksharp.git',
                  'dirty_paths': ['notes/owned.md'], 'dirty_fingerprint': 'owned-snapshot'}
        with patch.object(server, 'validate_worktree', return_value=frozen):
            aid = server.add_activity('PM', 'continue owned edit', 'dev')
            qid = server.enqueue(aid, 'dev', 'continue owned edit', source_actor='PM', work_item_key=KEY)
        queued = next(row for row in server.list_queue() if row['id'] == qid)
        with patch.object(server, 'validate_worktree', return_value=frozen):
            self.assertTrue(server.resolve_dev_target(queued)['ok'])
        changed = dict(frozen, dirty_fingerprint='changed-owned-content')
        with patch.object(server, 'validate_worktree', return_value=changed):
            blocked = server.resolve_dev_target(queued)
        self.assertFalse(blocked['ok'])
        self.assertIn('Task-owned checkout edits changed', blocked['error'])
        unowned = dict(frozen, dirty_paths=['src/unowned.py'])
        with patch.object(server, 'validate_worktree', return_value=unowned):
            aid = server.add_activity('PM', 'unowned dirty checkout', 'dev')
            q2 = server.enqueue(aid, 'dev', 'unowned dirty checkout', source_actor='PM', work_item_key=KEY)
        row = next(r for r in server.list_queue() if r['id'] == q2)
        self.assertEqual(row['target_head'], '')

    def test_task_lease_generation_changes_when_owned_paths_change(self):
        self.assign(worktree='/wt/ok', owned_paths=['notes/owned.md'])
        frozen = {'exists': True, 'is_git': True, 'branch': BRANCH, 'head': 'c' * 40, 'tree': 'd' * 40,
                  'repo_common_dir': server._git_common_dir(server.BASE_REPO),
                  'origin': 'https://github.com/relativityE/speaksharp.git',
                  'dirty_paths': [], 'dirty_fingerprint': hashlib.sha256(b'').hexdigest()}
        with patch.object(server, 'validate_worktree', return_value=frozen):
            aid = server.add_activity('PM', 'work', 'dev')
            qid = server.enqueue(aid, 'dev', 'work', source_actor='PM', work_item_key=KEY)
        queued = next(row for row in server.list_queue() if row['id'] == qid)
        server.update_work_item(KEY, owned_paths=['different/path'])
        with patch.object(server, 'validate_worktree', return_value=frozen):
            blocked = server.resolve_dev_target(queued)
        self.assertFalse(blocked['ok'])
        self.assertIn('lease generation changed', blocked['error'])

    def test_owned_path_manifest_rejects_absolute_and_parent_paths(self):
        self.assign(worktree='/wt/ok')
        for paths in (['../outside'], ['/absolute/path'], ['.']):
            with self.assertRaisesRegex(ValueError, 'safe repository-relative paths'):
                server.update_work_item(KEY, owned_paths=paths)

    def test_queued_delivery_rejects_foreign_repository_identity(self):
        self.verified()
        aid = server.add_activity('PM', 'foreign repo same branch', 'dev')
        qid = server.enqueue(aid, 'dev', 'foreign repo same branch', source_actor='PM', work_item_key=KEY)
        queued = next(row for row in server.list_queue() if row['id'] == qid)
        foreign = {'exists': True, 'is_git': True, 'branch': BRANCH, 'head': 'c' * 40, 'tree': 'd' * 40,
                   'repo_common_dir': server._git_common_dir(server.BASE_REPO),
                   'origin': 'https://github.com/attacker/speaksharp.git',
                   'dirty_paths': [], 'dirty_fingerprint': hashlib.sha256(b'').hexdigest()}
        with patch.object(server, 'validate_worktree', return_value=foreign):
            result = server.resolve_dev_target(queued)
        self.assertFalse(result['ok'])
        self.assertIn('repository identity changed after enqueue', result['error'])

    def test_distinct_source_requests_share_one_operation_and_keep_provenance(self):
        gh = FakeGitHub()
        with patch.object(server, '_pm_request', side_effect=gh.request):
            server.execute_pm_actions({'id': 1}, [refresh_action(source_comment_id=6048244445)])
            again = server.execute_pm_actions({'id': 2}, [refresh_action(source_comment_id=6048289237)])
        self.assertEqual(gh.writes, ['draft', 'ready'])  # second authorized source cannot start another cycle
        self.assertTrue(again[0].startswith('RECORDED: completed'))
        prov = json.loads(self.journal()[0]['provenance'])
        self.assertEqual([x['source_comment_id'] for x in prov], [6048244445, 6048289237])

    def test_restart_after_ready_landed_before_journal_commit_reconciles_without_writes(self):
        gh = FakeGitHub(draft=False)  # Ready write landed; the process died before ready_confirmed
        with server.con() as c:
            c.execute("INSERT INTO pm_action_journal(action_key,status,result,kind,action_json,phase,pr_number,head,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                      (canonical_key(refresh_action()), 'running', 'x', 'refresh_reviews', json.dumps(refresh_action()), 'ready_requested', 1570, HEAD, server.now()))
        server.init_db()
        with patch.object(server, '_pm_request', side_effect=gh.request):
            out = server.execute_pm_actions({'id': 5}, [refresh_action(source_comment_id=777)])
            self.assertTrue(server.execute_pm_actions({'id': 6}, [refresh_action()])[0].startswith('RECORDED: completed'))
        self.assertTrue(out[0].startswith('RESUMED'))
        self.assertEqual(gh.writes, [])
        j = self.journal()[0]
        self.assertEqual((j['status'], j['phase'], j['review_state']), ('completed', 'ready_confirmed', 'pending'))

    def dependent_route(self, actions, depends=True, nxt='dev'):
        return {'message': 'CLI Dev: continue after the action', 'next': nxt, 'pm_actions': actions, 'dev_depends_on_actions': depends,
                'board_updates': {'work_items': [{'item_key': KEY, 'owner': 'cli_dev', 'state': 'active', 'notes': 'n'}],
                                  'players': [{'player_id': 'cli_dev', 'status': 'assigned', 'work_item_key': KEY}]}}

    def dev_rows(self):
        return [r for r in server.list_queue(500) if r['recipient'] == 'dev']

    def test_unsupported_action_holds_dependent_dev_handoff(self):
        self.verified()
        self.run_pm_with(self.dependent_route([dict(refresh_action(), kind='merge_pr')]))
        self.assertEqual(self.dev_rows(), [])
        self.assertTrue(any('Dependent Dev handoff held' in a['message'] for a in server.list_activity()))

    def test_disabled_executor_holds_dependent_dev_handoff_even_for_active_assignment(self):
        self.verified()
        server.set_setting('pm_bounded_actions', '0')
        self.run_pm_with(self.dependent_route([refresh_action()], nxt='none'))  # none→dev auto-correction must not reopen it
        self.assertEqual(self.dev_rows(), [])

    def test_independent_dev_work_proceeds_despite_blocked_action(self):
        self.verified()
        self.run_pm_with(self.dependent_route([dict(refresh_action(), kind='merge_pr')], depends=False))
        self.assertEqual(len(self.dev_rows()), 1)

    def test_dispatched_disposition_requires_a_handoff_of_this_turn(self):
        server.ingest_control_asks([self.comment(101, self.MULTI)])
        ask = server.list_asks('pending')[0]['id']
        route = {'message': 'm', 'next': 'none', 'pm_actions': [], 'board_updates': board(), 'ask_dispositions': [
            {'ask_id': ask, 'disposition': 'dispatched', 'evidence': 'sent', 'owner': None, 'dependency': None, 'review_handoff_index': 0}]}
        self.run_pm_with(route)
        self.assertEqual(next(a for a in server.list_asks() if a['id'] == ask)['state'], 'pending')

    def test_end_to_end_review_to_owner_result_and_pm_completion_without_po_relay(self):
        """Ask → refresh → review → PM handoff (ask dispatched) → Dev invoked (received) → RECEIPT → RESULT → PM-typed completion."""
        self.verified()
        server.ingest_control_asks([self.comment(400, 'Browser PM → CLI PM — #1570 — P1 OPEN — REQUEST: route the P1 fix to the owner')])
        ask = server.list_asks('pending')[0]['id']
        gh = FakeGitHub()
        with patch.object(server, '_pm_request', side_effect=gh.request):
            server.execute_pm_actions({'id': 1}, [refresh_action()])
            gh.reviews = [{'id': 4212726964, 'commit_id': HEAD, 'user': {'login': 'chatgpt-codex-connector[bot]'}}]
            wake = server.poll_refreshed_reviews()[0]
        wake_row = next(r for r in server.list_queue() if r['id'] == wake)
        route = {'message': 'P1 is FIX NOW for CLI Dev', 'next': 'none', 'pm_actions': [], 'board_updates': board(KEY),
                 'review_handoffs': [{'pr_number': 1570, 'head': HEAD, 'reviewed_ref': 'review 4212726964', 'disposition': 'fix_now',
                                      'owner': 'cli_dev', 'work_item_key': KEY, 'instruction': 'Bind Focus feedback after Analytics reload'}],
                 'ask_dispositions': [{'ask_id': ask, 'disposition': 'dispatched', 'evidence': 'review 4212726964 → CLI Dev',
                                       'owner': 'cli_dev', 'dependency': None, 'review_handoff_index': 0}]}
        server.PM_MODE = 'codex'
        with patch.object(server, '_run_pm_codex', return_value=(route, 'thread')), \
             patch.object(server, 'compact_pr_context', return_value='Current #1570'):
            server.run_pm(wake_row)  # the board's own wake, not a PO message
        self.assertEqual(next(a for a in server.list_asks() if a['id'] == ask)['state'], 'dispatched')
        h = server.list_review_handoffs()[0]
        dev = next(r for r in self.dev_rows() if r['kind'] == 'review_handoff')
        seen = {}

        def fake_claude(content, cwd, sid, existing):
            seen['state'] = server.list_review_handoffs()[0]['state']  # Dev invoked = received
            return 0, f"RECEIPT {h['token']} — started the binding fix", sid, None, ''
        with patch.object(server, 'resolved_bin', return_value='/bin/true'), patch.object(server, '_run_claude_once', side_effect=fake_claude):
            server.run_dev(dev)
        self.assertEqual(seen['state'], 'received')
        self.assertEqual(server.list_review_handoffs()[0]['state'], 'acknowledged')
        # A receipt is a stage, not completion: the ask stays open and PM cannot close it yet.
        self.assertEqual(next(a for a in server.list_asks() if a['id'] == ask)['state'], 'dispatched')
        done = [{'ask_id': ask, 'disposition': 'completed', 'owner': 'cli_dev', 'dependency': None,
                 'evidence': f"{h['token']} result reviewed in comment 6049600001"}]
        applied, rejected = server.apply_ask_dispositions({'id': 900}, done, 'https://example.test/c/1')
        self.assertEqual(applied, [])
        self.assertIn('a receipt is not completion', rejected[0])
        server.record_handoff_receipts(dev_result=f"RESULT {h['token']} — binding fixed at {'d' * 40}", queue_id=dev['id'])
        self.assertEqual(server.list_review_handoffs()[0]['state'], 'result_returned')
        self.assertEqual(next(a for a in server.list_asks() if a['id'] == ask)['state'], 'dispatched')
        applied, rejected = server.apply_ask_dispositions({'id': 901}, done, 'https://example.test/c/2')
        self.assertEqual((applied, rejected), ([ask], []))
        closed = next(a for a in server.list_asks() if a['id'] == ask)
        self.assertEqual((closed['state'], closed['disposition']), ('dispositioned', 'completed'))
        for stage in ('receipt dev:', 'result dev:'):
            self.assertIn(stage + str(dev['id']), closed['disposition_ref'])
        self.assertIn('completed https://example.test/c/2', closed['disposition_ref'])
        # Replaying the same completion turn (F01 continuation) is a no-op, not a rejection.
        self.assertEqual(server.apply_ask_dispositions({'id': 901}, done, 'https://example.test/c/2'), ([], []))
        self.assertFalse([r for r in server.list_queue(500) if r['source_actor'] == 'PO'])

    def test_stalled_handoff_gets_one_recovery_then_blocker(self):
        route = {'message': 'm', 'next': 'none', 'pm_actions': [], 'board_updates': board(),
                 'review_handoffs': [{'pr_number': 1570, 'head': HEAD, 'reviewed_ref': 'r1', 'disposition': 'fix_now',
                                      'owner': 'app_dev', 'work_item_key': None, 'instruction': 'fix'}]}
        self.run_pm_with(route)
        with server.con() as c:
            c.execute("UPDATE review_handoffs SET delivered_at='2000-01-01T00:00:00+00:00'")
        qid = server.pending_handoff_watchdog()
        self.assertEqual(next(r for r in server.list_queue() if r['id'] == qid)['kind'], 'handoff_recovery')
        server.update_queue(qid, status='responded')
        self.assertIsNone(server.pending_handoff_watchdog())
        with server.con() as c:
            c.execute("UPDATE review_handoffs SET last_recovery_at='2000-01-01T00:00:00+00:00'")
        self.assertIsNone(server.pending_handoff_watchdog())
        self.assertIn('without owner receipt', server.get_setting('pm_handoff_blocker'))
        self.assertEqual(len([r for r in server.list_queue() if r.get('kind') == 'handoff_recovery']), 1)

    def test_remote_packet_readback_is_exact_commit_and_hash_verified(self):
        import hashlib
        base = 'handoffs/PR-1258/orchestration/deadlock5/pkt'
        files = {f'{base}/a.patch.txt': b'diff', f'{base}/b.zip': b'PK\x03\x04'}
        files[f'{base}/manifest.json'] = json.dumps({'packet_files_sha256': {
            'a.patch.txt': hashlib.sha256(b'diff').hexdigest(), 'b.zip': hashlib.sha256(b'PK\x03\x04').hexdigest()}}).encode()
        def fetch(path, ref):
            self.assertEqual(ref, 'f' * 40)
            if path not in files:
                raise FileNotFoundError(path)
            return files[path]
        ok = server.verify_remote_packet(1258, base, 'f' * 40, fetch)
        self.assertTrue(ok['ok'])
        self.assertEqual(ok['verified'], ['a.patch.txt', 'b.zip'])
        files[f'{base}/b.zip'] = b'tampered'
        bad = server.verify_remote_packet(1258, base, 'f' * 40, fetch)
        self.assertEqual((bad['ok'], bad['mismatched']), (False, ['b.zip']))
        files[f'{base}/manifest.json'] = json.dumps({'changed_files': {'x': 'y'}}).encode()
        self.assertIn('no per-file SHA-256', server.verify_remote_packet(1258, base, 'f' * 40, fetch)['error'])
        with self.assertRaisesRegex(ValueError, 'not a branch'):
            server.verify_remote_packet(1258, base, 'docs/1258-orchestration-deadlock5-20261007', fetch)
        with self.assertRaisesRegex(ValueError, 'inside handoffs/PR-1258/'):
            server.verify_remote_packet(1258, 'handoffs/PR-1570/x', 'f' * 40, fetch)
        with self.assertRaises(ValueError):
            server.verify_remote_packet(1258, 'handoffs/PR-1258/../../etc', 'f' * 40, fetch)
        with patch.object(server, 'compact_pr_context', return_value='x'):
            self.assertIn('/api/handoff-verify', server.compose_for_pm({'id': 1, 'content': 'm'}))

    def test_remote_packet_fetches_manifest_once_and_preserves_transient_error(self):
        base = 'handoffs/PR-1258/orchestration/deadlock5/pkt'
        payload = json.dumps({'packet_files_sha256': {}}).encode()
        calls = []
        def fetch(path, ref):
            calls.append(path)
            if path.endswith('/manifest.json'):
                return payload
            raise FileNotFoundError(path)
        result = server.verify_remote_packet(1258, base, 'f' * 40, fetch)
        self.assertIn('no per-file SHA-256', result['error'])
        self.assertEqual(calls, [f'{base}/manifest.json'])

        def unavailable(path, ref):
            raise server.GithubReadError('rate_limited', 'retry after reset')
        with self.assertRaisesRegex(server.GithubReadError, 'retry after reset'):
            server.verify_remote_packet(1258, base, 'f' * 40, unavailable)

    def test_transient_packet_read_is_durable_and_retried_once_after_backoff(self):
        base = 'handoffs/PR-1258/orchestration/deadlock5/retry-packet'
        def unavailable(path, ref):
            raise server.GithubReadError('timeout', 'temporary read timeout')
        with self.assertRaisesRegex(server.GithubReadError, 'temporary read timeout'):
            server.verify_remote_packet(1258, base, 'f' * 40, unavailable)
        row = server.list_packet_verifications()[0]
        self.assertEqual((row['status'], row['attempts'], row['ref']), ('pending', 1, 'f' * 40))
        self.assertIn('temporary read timeout', row['last_error'])
        self.assertGreater(row['next_attempt_at'], 0)
        with server.con() as c:
            c.execute('UPDATE packet_verifications SET next_attempt_at=0 WHERE request_key=?', (row['request_key'],))
        def success(pr, path, ref):
            return server._record_packet_verification(pr, path, ref, result={'ok': True, 'verified': ['source.patch']})
        with patch.object(server, 'github_backoff_until', return_value=0):
            self.assertEqual(server.recover_pending_packet_verifications(verifier=success), 1)
        row = server.list_packet_verifications()[0]
        self.assertEqual((row['status'], row['attempts'], row['result']['verified']), ('verified', 2, ['source.patch']))
        notices = [q for q in server.list_queue(500) if q.get('kind') == 'packet_read']
        self.assertEqual(len(notices), 1)
        with patch.object(server, 'github_backoff_until', return_value=0):
            self.assertEqual(server.recover_pending_packet_verifications(verifier=success), 0)

    def test_terminal_packet_read_failure_routes_one_deduplicated_pm_task(self):
        base = 'handoffs/PR-1258/orchestration/deadlock5/bad-packet'
        def invalid_manifest(path, ref):
            if path.endswith('/manifest.json'):
                return json.dumps({'changed_files': {'x': 'y'}}).encode()
            raise AssertionError('a manifest without hashes must not fetch files')
        first = server.verify_remote_packet(1258, base, 'f' * 40, invalid_manifest)
        second = server.verify_remote_packet(1258, base, 'f' * 40, invalid_manifest)
        self.assertIn('no per-file SHA-256', first['error'])
        self.assertFalse(second['ok'])
        row = server.list_packet_verifications()[0]
        self.assertEqual((row['status'], row['attempts']), ('blocked', 2))
        notices = [q for q in server.list_queue(500) if q.get('kind') == 'packet_read']
        self.assertEqual(len(notices), 1)
        self.assertIn('bad-packet', notices[0]['content'])

    def test_remote_packet_rejects_oversized_manifest_inventory(self):
        base = 'handoffs/PR-1258/orchestration/deadlock5/pkt'
        manifest = {'packet_files_sha256': {f'{n}.txt': 'a' * 64 for n in range(server.MAX_PACKET_FILES + 1)}}
        def fetch(path, ref):
            if path.endswith('/manifest.json'):
                return json.dumps(manifest).encode()
            raise AssertionError('must reject manifest before reading files')
        result = server.verify_remote_packet(1258, base, 'f' * 40, fetch)
        self.assertIn('100-file limit', result['error'])

    def test_remote_packet_enforces_total_read_time_budget(self):
        base = 'handoffs/PR-1258/orchestration/deadlock5/pkt'
        fetch = Mock(side_effect=AssertionError('must not read after deadline'))
        with patch.object(server.time, 'monotonic', side_effect=[0, server.PACKET_VERIFY_TIMEOUT_SECONDS + 1]):
            result = server.verify_remote_packet(1258, base, 'f' * 40, fetch)
        self.assertIn('time budget', result['error'])
        fetch.assert_not_called()


    # ---------- c4: PM disposition (delivery 91) ----------
    def unconfirmed_draft_row(self):
        with server.con() as c:
            c.execute("INSERT INTO pm_action_journal(action_key,status,result,kind,action_json,phase,pr_number,head,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                      (canonical_key(refresh_action()), 'unconfirmed', 'x', 'refresh_reviews', json.dumps(refresh_action()), 'draft_confirmed', 1570, HEAD, server.now()))

    def test_resume_loser_between_read_and_claim_never_executes(self):
        """Another process claims the unconfirmed row after our SELECT, before our conditional UPDATE."""
        import sqlite3
        self.unconfirmed_draft_row()
        gh = FakeGitHub(draft=True)
        real_con = server.con
        key = canonical_key(refresh_action())

        class Interleaving:
            def __init__(self, c):
                self.c = c
            def __getattr__(self, name):
                return getattr(self.c, name)
            def execute(self, sql, args=()):
                cur = self.c.execute(sql, args)
                if sql.startswith('SELECT * FROM pm_action_journal WHERE action_key=?'):
                    other = sqlite3.connect(server.DB, timeout=0.1)  # a second board process
                    try:
                        self.c.commit()  # release our read snapshot so the other writer can commit
                        other.execute("UPDATE pm_action_journal SET status='running' WHERE action_key=? AND status='unconfirmed'", (key,))
                        other.commit()
                    finally:
                        other.close()
                return cur

        from contextlib import contextmanager

        @contextmanager
        def con():
            with real_con() as c:
                yield Interleaving(c)
        with patch.object(server, 'con', con), patch.object(server, '_pm_request', side_effect=gh.request):
            out = server.execute_pm_actions({'id': 7}, [refresh_action(source_comment_id=888)])
        self.assertTrue(out[0].startswith('RECORDED: running'), out)
        self.assertEqual(gh.writes, [])
        self.assertTrue(gh.pr['draft'])  # the winner (the other process) owns the resume

    def test_two_requests_racing_one_unconfirmed_candidate_resume_once(self):
        self.unconfirmed_draft_row()
        gh = FakeGitHub(draft=True)
        out, barrier = [], threading.Barrier(2)

        def go(src):
            barrier.wait()
            out.extend(server.execute_pm_actions({'id': src}, [refresh_action(source_comment_id=src)]))
        with patch.object(server, '_pm_request', side_effect=gh.request):
            threads = [threading.Thread(target=go, args=(s,)) for s in (901, 902)]
            for th in threads:
                th.start()
            for th in threads:
                th.join()
        self.assertEqual(gh.writes, ['ready'])
        self.assertEqual(sum(1 for r in out if r.startswith('RESUMED')), 1)
        self.assertEqual(sum(1 for r in out if r.startswith('RECORDED')), 1)


if __name__ == '__main__':
    unittest.main()
