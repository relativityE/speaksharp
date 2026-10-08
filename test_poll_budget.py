import json
import os
import subprocess
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import server
import test_regressions as reg


class PollBudgetTests(unittest.TestCase):
    setUp = reg.RegressionTests.setUp
    tearDown = reg.RegressionTests.tearDown

    def test_comment_cursor_is_incremental_and_staged_until_enqueue(self):
        row = {'id': 123, 'body': 'Dev packet', 'updated_at': '2026-10-07T19:00:00Z'}
        with patch.object(server, 'gh_json', return_value=([row], None)) as gh:
            rows, error, cursor = server.fetch_watch_comments('relativityE/speaksharp', 1258)
            self.assertIsNone(error)
            self.assertIn('since=', gh.call_args.args[0][-1])
            self.assertIn('page=1', gh.call_args.args[0][-1])
            self.assertEqual([r['id'] for r in rows], [123])
            self.assertEqual(server.get_setting(cursor[0], ''), '')
            server.commit_watch_comment_cursors({'_pending_comment_cursors': [cursor]})
            rows, error, _ = server.fetch_watch_comments('relativityE/speaksharp', 1258)
            self.assertIn('since=2026-10-07T18%3A59%3A59', gh.call_args.args[0][-1])
            self.assertEqual([r['id'] for r in rows], [123])

    def test_burst_is_not_truncated_by_context_cache_and_cursor_survives_failure(self):
        all_rows = [{'id': i, 'body': 'packet', 'updated_at': '2026-10-07T19:00:00Z'} for i in range(1, 302)]
        pages = [all_rows[i:i+100] for i in range(0, len(all_rows), 100)] + [[]]
        with patch.object(server, 'gh_json', side_effect=[(page, None) for page in pages]):
            returned, _, cursor = server.fetch_watch_comments('repo', 1258)
        self.assertEqual(len(returned), 301)
        self.assertEqual(len(cursor[1]['comments']), 200)
        server.commit_watch_comment_cursors({'_pending_comment_cursors': [cursor]})
        old = server.get_setting(cursor[0])
        with patch.object(server, 'gh_json', return_value=(None, 'rate limited')):
            returned, error, cursor2 = server.fetch_watch_comments('repo', 1258)
        self.assertIsNone(returned)
        self.assertIsNone(cursor2)
        self.assertEqual(server.get_setting(cursor[0]), old)

    def test_recent_edit_to_old_comment_survives_bounded_id_cache(self):
        old = '2026-10-07T10:00:00Z'
        comments = [{'id': i, 'body': f'comment {i}', 'created_at': old, 'updated_at': old}
                    for i in range(1, 201)]
        server.set_setting('github_comments:repo:1258', json.dumps({'since': old, 'comments': comments}))
        edited = {'id': 1, 'body': 'updated authorization', 'created_at': old,
                  'updated_at': '2026-10-08T10:00:00Z'}
        with patch.object(server, 'gh_json', side_effect=[([edited], None), ([], None)]):
            rows, error, cursor = server.fetch_watch_comments('repo', 1258)
        self.assertIsNone(error)
        self.assertEqual(next(r['body'] for r in rows if r['id'] == 1), 'updated authorization')
        self.assertIn(1, {r['id'] for r in cursor[1]['comments']})

    def test_edit_to_existing_control_comment_generates_new_wake(self):
        prev = {'pr': 1570, 'latest_control_comment_id': 42,
                'control_updates': [{'id': 42, 'body': 'old instructions', 'updated_at': '2026-10-07T10:00:00Z'}]}
        cur = {'pr': 1570, 'latest_control_comment_id': 42,
               'control_updates': [{'id': 42, 'body': 'corrected instructions', 'updated_at': '2026-10-08T10:00:00Z'}]}
        events = server.github_watch_events(prev, cur, {'pm_github_control': True})
        self.assertEqual(len(events), 1)
        self.assertIn('comment 42', events[0])
        self.assertIn('corrected instructions', events[0])

    def test_automatic_pm_posts_from_old_instances_do_not_wake_pm(self):
        rows = [{'id': 5, 'body': '<!-- rwt-board-pm:old-instance:8 --> status'},
                {'id': 6, 'body': 'App Dev: complete packet'}]
        with patch.object(server, 'WATCH_ISSUES', ''), patch.object(server, 'repo_slug', return_value='repo'), \
             patch.object(server, 'gh_json', side_effect=lambda args: (rows if 'page=1' in args[-1] else [], None)):
            snap, error = server.github_watch_snapshot()
        self.assertIsNone(error)
        self.assertEqual([x['id'] for x in snap['control_updates']], [6])

    def test_dashboard_read_cache_is_shared_and_selection_change_invalidates_it(self):
        with patch.object(server, 'PR_DISPLAY_CACHE', {}), patch.object(server, 'pr_snapshot', return_value={'current': None}) as read:
            a = server.display_pr_snapshot()
            a['current'] = 'tampered'
            b = server.display_pr_snapshot()
            self.assertIsNone(b['current'])
            read.assert_called_once()
            server.set_setting('current_pr', '1570')
            server.display_pr_snapshot()
            self.assertEqual(read.call_count, 2)
            server.pr_snapshot()  # Action/read path is never routed through the cache.
            self.assertEqual(read.call_count, 3)

    def test_rate_limit_stops_all_board_requests_until_reset_without_replaying_write(self):
        reset = time.time() + 120
        failed = subprocess.CompletedProcess([], 1, '', 'API rate limit exceeded')
        rate = subprocess.CompletedProcess([], 0, json.dumps({'resources': {'core': {'remaining': 0, 'reset': reset}}}), '')
        with patch.object(server, 'GH_BACKOFF_UNTIL', 0), patch.object(server.subprocess, 'run', side_effect=[failed, rate]) as run:
            _, error = server.gh_json(['api', '-X', 'POST', 'repos/repo/issues/1258/comments'])
            self.assertIn('rate limit', error)
            self.assertGreaterEqual(server.GH_BACKOFF_UNTIL, reset)
            _, held = server.gh_json(['pr', 'list'])
            self.assertIn('backoff', held)
            self.assertEqual(run.call_count, 2)
            self.assertEqual(run.call_args_list[1].args[0], ['gh', 'api', 'rate_limit'])

    def test_page_budget_exhaustion_keeps_cursor_uncommitted(self):
        full = [{'id': i, 'body': 'burst', 'updated_at': '2026-10-07T19:00:00Z'} for i in range(100)]
        with patch.object(server, 'gh_json', return_value=(full, None)) as gh:
            rows, error, cursor = server.fetch_watch_comments('repo', 1258)
        self.assertIsNone(rows)
        self.assertIn('bounded 5-page read', error)
        self.assertIsNone(cursor)
        self.assertEqual(gh.call_count, server.MAX_COMMENT_PAGES)

    def test_separate_watchers_share_one_atomic_request_budget(self):
        barrier = threading.Barrier(8)
        outcomes = []
        lock = threading.Lock()
        def reserve_from_watcher(_index):
            barrier.wait()
            result = server.reserve_github_request_budget()
            with lock:
                outcomes.append(result)
        with patch.object(server, 'GH_REQUEST_BUDGET_PER_WINDOW', 4):
            threads = [threading.Thread(target=reserve_from_watcher, args=(i,)) for i in range(8)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=10)
            self.assertTrue(all(not thread.is_alive() for thread in threads))
            self.assertEqual(sum(1 for ok, _ in outcomes if ok), 4)
            self.assertEqual(server.github_request_budget_state()['used'], 4)
            ok, blocked = server.reserve_github_request_budget()
            self.assertFalse(ok)
            self.assertEqual((blocked['used'], blocked['limit']), (4, 4))

    def test_separate_processes_share_the_persisted_request_budget(self):
        script = ("import json,sys; from pathlib import Path; import server; "
                  "server.DB=Path(sys.argv[1]); print(json.dumps(server.reserve_github_request_budget()))")
        with patch.object(server, 'GH_REQUEST_BUDGET_PER_WINDOW', 3), \
             patch.dict(os.environ, {'RWT_GH_REQUEST_BUDGET_PER_MINUTE': '3'}):
            children = [subprocess.Popen([sys.executable, '-c', script, str(server.DB)], cwd=Path(__file__).parent,
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                        for _ in range(7)]
            results = []
            for child in children:
                stdout, stderr = child.communicate(timeout=20)
                self.assertEqual(child.returncode, 0, stderr)
                results.append(json.loads(stdout.strip()))
            self.assertEqual(sum(1 for ok, _state in results if ok), 3)
            self.assertEqual(server.github_request_budget_state()['used'], 3)

    def test_api_and_packet_readers_consume_the_same_budget(self):
        success = subprocess.CompletedProcess(['gh'], 0, stdout='{}', stderr='')
        with patch.object(server, 'GH_REQUEST_BUDGET_PER_WINDOW', 1), \
             patch.object(server, 'GH_BACKOFF_UNTIL', 0), \
             patch.object(server.subprocess, 'run', return_value=success) as run:
            value, error = server.gh_json(['api', 'repos/example'])
            self.assertEqual((value, error), ({}, None))
            with self.assertRaisesRegex(server.GithubReadError, 'Shared GitHub request budget exhausted'):
                server._gh_raw('handoffs/PR-1258/packet/manifest.json', 'f' * 40)
            denied, detail = server.gh_json(['pr', 'list'])
            self.assertIsNone(denied)
            self.assertIn('Shared GitHub request budget exhausted', detail)
            self.assertEqual(run.call_count, 1)

    def test_corrupt_persisted_budget_fails_closed(self):
        server.set_setting('github_request_budget', 'not-json')
        with patch.object(server, 'GH_REQUEST_BUDGET_PER_WINDOW', 2), patch.object(server.subprocess, 'run') as run:
            result, detail = server.gh_json(['api', 'repos/example'])
            self.assertIsNone(result)
            self.assertIn('2/2', detail)
            self.assertEqual(server.github_request_budget_state()['used'], 2)
            run.assert_not_called()

    def test_packet_raw_reader_obeys_persisted_rate_backoff(self):
        server.set_setting('github_backoff_until', str(time.time() + 60))
        with patch.object(server.subprocess, 'run') as run:
            with self.assertRaises(server.GithubReadError) as raised:
                server._gh_raw('handoffs/PR-1258/packet/manifest.json', 'f' * 40)
        self.assertEqual(raised.exception.kind, 'rate_limited')
        run.assert_not_called()

    def test_pm_executor_preserves_retryable_read_backoff_as_unconfirmed(self):
        with patch.object(server, 'gh_json', return_value=(None, 'GitHub rate-limit backoff until reset')):
            with self.assertRaises(server.GithubReadError) as raised:
                server._pm_request(['api', 'repos/relativityE/speaksharp/pulls/1570'])
        self.assertEqual(raised.exception.kind, 'rate_limited')
        with patch.object(server, 'gh_json', return_value=(None, 'HTTP 404 Not Found')):
            with self.assertRaisesRegex(server.Hold, 'HTTP 404'):
                server._pm_request(['api', 'repos/relativityE/speaksharp/pulls/9999'])

    def test_exact_head_qualifier_obeys_shared_backoff_without_starting_child(self):
        until = time.time() + 90
        with patch.object(server, 'github_backoff_until', return_value=until), patch.object(server.subprocess, 'run') as run:
            with self.assertRaisesRegex(server.Hold, 'shared GitHub backoff'):
                server._pm_qualify(1570, 'a' * 40)
        run.assert_not_called()

    def test_exact_head_qualifier_records_rate_limit_for_shared_backoff(self):
        responses = [subprocess.CompletedProcess(['gh'], 0, stdout='credential', stderr=''),
                     subprocess.CompletedProcess(['node'], 1, stdout='', stderr='API rate limit exceeded')]
        with patch.object(server, 'github_backoff_until', return_value=0), \
             patch.object(server.subprocess, 'run', side_effect=responses), \
             patch.object(server, '_record_github_rate_limit') as record:
            with self.assertRaisesRegex(server.Hold, 'qualifier did not pass'):
                server._pm_qualify(1570, 'a' * 40)
        record.assert_called_once_with()

    def test_affected_review_registry_observes_nonselected_pr_and_keeps_security_separate(self):
        server.apply_board_updates({'work_items': [{'item_key': 'PR-1600', 'pr_number': 1600, 'state': 'active',
                                                     'owner': 'app_dev', 'branch': 'fix/1600'}]})
        review = {'id': 81, 'commit_id': 'a' * 40, 'user': {'login': 'chatgpt-codex-connector[bot]'}}
        comment = {'id': 91, 'commit_id': 'a' * 40, 'updated_at': '2026-10-07T19:00:00Z',
                   'body': 'Please fix this', 'path': 'src/a.ts', 'position': 4}
        def gh(args):
            if args[0] == 'pr':
                return {'number': 1600, 'state': 'OPEN', 'headRefOid': 'a' * 40, 'baseRefOid': 'b' * 40,
                        'headRefName': 'fix/1600', 'baseRefName': 'main'}, None
            if '/reviews?' in args[-1]:
                return [review], None
            if '/comments?' in args[-1]:
                return [comment], None
            return [], None
        with patch.object(server, 'repo_slug', return_value='relativityE/speaksharp'), patch.object(server, 'gh_json', side_effect=gh):
            snap, error = server.github_watch_snapshot()
        self.assertIsNone(error)
        target = snap['affected_reviews']['1600']
        self.assertEqual(target['head'], 'a' * 40)
        self.assertEqual(target['code_review_ids'], [81])
        self.assertEqual(target['security_review_state'], 'NOT INFERRED')
        self.assertEqual(target['inline_comment_count'], 1)

    def test_affected_review_refresh_is_fair_bounded_and_cached_across_polls(self):
        server.apply_board_updates({'work_items': [
            {'item_key': f'PR-{n}', 'pr_number': n, 'state': 'review', 'owner': 'app_dev', 'branch': f'fix/{n}' }
            for n in (1600, 1601, 1602)
        ]})
        calls = []
        def gh(args):
            calls.append(args)
            path = args[-1]
            if args[0] == 'pr':
                n = int(args[2])
                return {'number': n, 'state': 'OPEN', 'headRefOid': f'{n:040x}', 'baseRefOid': 'b' * 40,
                        'headRefName': f'fix/{n}', 'baseRefName': 'main'}, None
            if '/reviews?' in path or '/comments?' in path:
                return [], None
            raise AssertionError(args)
        with patch.object(server, 'repo_slug', return_value='relativityE/speaksharp'), patch.object(server, 'gh_json', side_effect=gh):
            first = server.affected_review_snapshot('relativityE/speaksharp')
            self.assertEqual(sum(1 for row in first.values() if row.get('head')), 2)
            self.assertEqual(sum(1 for row in first.values() if row.get('refresh_pending')), 1)
            self.assertEqual(len(calls), 6)
            second = server.affected_review_snapshot('relativityE/speaksharp')
            self.assertEqual(sum(1 for row in second.values() if row.get('head')), 3)
            self.assertEqual(len(calls), 9)
            server.affected_review_snapshot('relativityE/speaksharp')
            self.assertEqual(len(calls), 9)  # fresh shared cache does not reread on every watcher tick

    def test_review_registry_cursor_does_not_starve_candidates_after_first_25(self):
        server.apply_board_updates({'work_items': [
            {'item_key': f'PR-{n}', 'pr_number': n, 'state': 'review', 'owner': 'app_dev', 'branch': f'fix/{n}'}
            for n in range(1600, 1626)
        ]})
        server.set_setting('affected_review_cursor', '1624')
        calls = []
        def gh(args):
            calls.append(args)
            if args[0] == 'pr':
                n = int(args[2])
                return {'number': n, 'state': 'OPEN', 'headRefOid': f'{n:040x}', 'baseRefOid': 'b' * 40,
                        'headRefName': f'fix/{n}', 'baseRefName': 'main'}, None
            return [], None
        with patch.object(server, 'repo_slug', return_value='relativityE/speaksharp'), patch.object(server, 'gh_json', side_effect=gh):
            snapshot = server.affected_review_snapshot('relativityE/speaksharp')
        self.assertEqual(len(snapshot), 26)
        self.assertEqual(snapshot['1625']['head'], f'{1625:040x}')
        self.assertEqual(sum(1 for row in snapshot.values() if row.get('head')), 2)
        self.assertEqual([int(call[2]) for call in calls if call[0] == 'pr'], [1625, 1600])

    def test_corrupt_review_cache_is_rebuilt_from_fresh_reads(self):
        server.apply_board_updates({'work_items': [{'item_key': 'PR-1603', 'pr_number': 1603, 'state': 'review',
                                                     'owner': 'app_dev', 'branch': 'fix/1603'}]})
        server.set_setting('affected_review_cache', '{')
        def gh(args):
            if args[0] == 'pr':
                return {'number': 1603, 'state': 'OPEN', 'headRefOid': 'c' * 40, 'baseRefOid': 'b' * 40,
                        'headRefName': 'fix/1603', 'baseRefName': 'main'}, None
            return [], None
        with patch.object(server, 'gh_json', side_effect=gh):
            result = server.affected_review_snapshot('relativityE/speaksharp')
        self.assertEqual(result['1603']['head'], 'c' * 40)
        self.assertEqual(result['1603']['cache_age_seconds'], 0)

    def test_affected_review_events_surface_nonselected_candidate_changes(self):
        previous = {'pr': None, 'affected_reviews': {'1600': {'head': 'a' * 40, 'base': 'b' * 40,
                                                               'code_review_ids': [1], 'inline_comment_fingerprint': 'old'}}}
        current = {'pr': None, 'affected_reviews': {'1600': {'head': 'a' * 40, 'base': 'b' * 40,
                                                              'code_review_ids': [1, 2], 'inline_comment_fingerprint': 'new'}}}
        events = server.github_watch_events(previous, current, {})
        self.assertTrue(any('Affected PR #1600 exact-head review evidence changed' in e for e in events))

    def test_quiet_reconciliation_updates_board_without_github_post(self):
        aid = server.add_activity('GITHUB', 'unchanged status', 'pm')
        qid = server.enqueue(aid, 'pm', 'unchanged status', source_actor='GITHUB')
        q = next(x for x in server.list_queue() if x['id'] == qid)
        route = {'message': 'No new actionable change', 'next': 'none', 'publish': False, 'pm_actions': [],
                 'board_updates': {'work_items': [{'item_key': 'RWT-OBSERVE', 'owner': 'cli_pm', 'state': 'waiting', 'next_action': 'Await changed evidence'}],
                                   'players': [{'player_id': 'cli_pm', 'status': 'waiting', 'work_item_key': 'RWT-OBSERVE'}]}}
        server.PM_MODE = 'codex'
        with patch.object(server, '_run_pm_codex', return_value=(route, 'session')), patch.object(server, 'publish_pm_reply') as publish:
            server.run_pm(q)
        publish.assert_not_called()
        self.assertTrue(any(x['item_key'] == 'RWT-OBSERVE' for x in server.list_work_items()))
        self.assertIn('RECONCILED LOCALLY', next(x for x in server.list_queue() if x['id'] == qid)['delivery_label'])

    def test_quiet_flag_cannot_hide_a_po_decision(self):
        aid = server.add_activity('GITHUB', 'new blocker', 'pm')
        qid = server.enqueue(aid, 'pm', 'new blocker', source_actor='GITHUB')
        q = next(x for x in server.list_queue() if x['id'] == qid)
        route = {'message': 'Scope decision required', 'next': 'po', 'publish': False, 'pm_actions': [],
                 'board_updates': {'work_items': [{'item_key': 'RWT-DECIDE', 'owner': 'po', 'state': 'blocked'}],
                                   'players': [{'player_id': 'po', 'status': 'action-needed', 'work_item_key': 'RWT-DECIDE'}]}}
        server.PM_MODE = 'codex'
        with patch.object(server, '_run_pm_codex', return_value=(route, 'session')), patch.object(server, 'publish_pm_reply', return_value=True) as publish:
            server.run_pm(q)
        publish.assert_called_once()

    def test_route_parser_preserves_quiet_flag_and_rejects_non_boolean(self):
        self.assertFalse(server.parse_pm_route(json.dumps({'message': 'No change', 'next': 'none', 'publish': False}))['publish'])
        self.assertTrue(server.parse_pm_route(json.dumps({'message': 'Pin', 'next': 'dev'}))['publish'])
        self.assertIsNotNone(server.parse_pm_route(json.dumps({'message': 'No change', 'next': 'none', 'publish': 'false'}))['parse_error'])


class DesignerBranchScopeTests(unittest.TestCase):
    def test_only_rwt_designer_feature_branches_are_in_scope(self):
        from guarded_pm import BRANCH
        self.assertIsNotNone(BRANCH.fullmatch('feat/1258-design-pr1-copy-nav'))
        self.assertIsNotNone(BRANCH.fullmatch('feat/1258-design-pr5-progress'))
        self.assertIsNone(BRANCH.fullmatch('feat/1304-v4-primary-v2-fallback'))
        self.assertIsNone(BRANCH.fullmatch('feat/1258-design-pr6-unapproved'))
