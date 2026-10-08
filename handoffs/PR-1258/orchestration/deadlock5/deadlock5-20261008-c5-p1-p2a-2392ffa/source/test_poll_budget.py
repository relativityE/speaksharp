import json
import subprocess
import time
import unittest
from unittest.mock import patch
import server
import test_regressions as reg


class PollBudgetTests(unittest.TestCase):
    setUp = reg.RegressionTests.setUp
    tearDown = reg.RegressionTests.tearDown

    def test_comment_cursor_is_incremental_and_staged_until_enqueue(self):
        row = {'id': 123, 'body': 'Dev packet', 'updated_at': '2026-10-07T19:00:00Z'}
        with patch.object(server, 'gh_json', return_value=([[row]], None)) as gh:
            rows, error, cursor = server.fetch_watch_comments('relativityE/speaksharp', 1258)
            self.assertIsNone(error)
            self.assertNotIn('since=', gh.call_args.args[0][-1])
            self.assertEqual(server.get_setting(cursor[0], ''), '')
            server.commit_watch_comment_cursors({'_pending_comment_cursors': [cursor]})
            rows, error, _ = server.fetch_watch_comments('relativityE/speaksharp', 1258)
            self.assertIn('since=2026-10-07T18%3A59%3A59', gh.call_args.args[0][-1])
            self.assertEqual([r['id'] for r in rows], [123])

    def test_burst_is_not_truncated_by_context_cache_and_cursor_survives_failure(self):
        rows = [{'id': i, 'body': 'packet', 'updated_at': '2026-10-07T19:00:00Z'} for i in range(1, 302)]
        with patch.object(server, 'gh_json', return_value=([rows], None)):
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

    def test_automatic_pm_posts_from_old_instances_do_not_wake_pm(self):
        rows = [{'id': 5, 'body': '<!-- rwt-board-pm:old-instance:8 --> status'},
                {'id': 6, 'body': 'App Dev: complete packet'}]
        with patch.object(server, 'WATCH_ISSUES', ''), patch.object(server, 'repo_slug', return_value='repo'), patch.object(server, 'gh_json', return_value=([rows], None)):
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
