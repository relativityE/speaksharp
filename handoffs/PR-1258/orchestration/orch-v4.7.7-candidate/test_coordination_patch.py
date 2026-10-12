import subprocess
from unittest.mock import patch
from test_comms import CommsTests
import server


class CoordinationPatchTests(CommsTests):
    def test_waiting_and_blocked_owned_prs_remain_in_review_registry(self):
        server.apply_board_updates({'work_items': [
            {'item_key': 'PR-1701', 'pr_number': 1701, 'state': 'waiting', 'owner': 'cli_dev', 'branch': 'test/1701'},
            {'item_key': 'PR-1702', 'pr_number': 1702, 'state': 'blocked', 'owner': 'app_dev', 'branch': 'fix/1702'},
            {'item_key': 'PR-1703', 'pr_number': 1703, 'state': 'done', 'owner': 'app_dev', 'branch': 'fix/1703'},
        ]})
        targets = server.affected_review_targets()
        self.assertIn(1701, targets)
        self.assertIn(1702, targets)
        self.assertNotIn(1703, targets)

    def test_budget_denial_is_retryable_without_uncertain_post(self):
        self.enable_real_publication()
        q = self.q()
        with patch.object(server, 'repo_slug', return_value='relativityE/speaksharp'), \
             patch.object(server, 'reserve_github_request_budget', return_value=(False, {'used': 60, 'limit': 60, 'reset_at': 'later'})), \
             patch.object(server.subprocess, 'run') as run:
            self.assertFalse(server.publish_pm_reply(q, 'Start assigned task'))
            run.assert_not_called()
        with server.con() as c:
            self.assertEqual(c.execute('SELECT status FROM pm_outbox WHERE queue_id=?', (q['id'],)).fetchone()['status'], 'deferred')
        with patch.object(server, 'repo_slug', return_value='relativityE/speaksharp'), \
             patch.object(server, 'reserve_github_request_budget', return_value=(True, {})), \
             patch.object(server.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '{"id":99}', '')) as run:
            self.assertTrue(server.publish_pm_reply(q, 'Start assigned task'))
            self.assertTrue(server.publish_pm_reply(q, 'Start assigned task'))
            self.assertEqual(run.call_count, 1)
            self.assertIn('POST', run.call_args.args[0])

    def test_real_transport_timeout_still_never_replays(self):
        self.enable_real_publication()
        q = self.q()
        with patch.object(server, 'repo_slug', return_value='relativityE/speaksharp'), \
             patch.object(server, 'reserve_github_request_budget', return_value=(True, {})), \
             patch.object(server.subprocess, 'run', side_effect=subprocess.TimeoutExpired('gh', 20)) as run:
            self.assertFalse(server.publish_pm_reply(q, 'Start assigned task'))
        with server.con() as c:
            self.assertEqual(c.execute('SELECT status FROM pm_outbox WHERE queue_id=?', (q['id'],)).fetchone()['status'], 'unconfirmed')
        with patch.object(server, 'repo_slug', return_value='relativityE/speaksharp'), \
             patch.object(server, 'fetch_watch_comments', return_value=([], None, None)):
            self.assertFalse(server.publish_pm_reply(q, 'Start assigned task'))
        self.assertEqual(run.call_count, 1)

    def test_deferred_turn_recovers_without_remote_snapshot_and_dispatches_once(self):
        self.enable_real_publication()
        q = self.q()
        server.PM_MODE = 'codex'
        route = {'message': 'Start the Focus repair', 'next': 'dev', 'pm_actions': [],
                 'board_updates': {'work_items': [{'item_key': 'FOCUS', 'owner': 'cli_dev', 'state': 'active',
                                                   'branch': 'test/focus', 'worktree': '/wt/focus', 'next_action': 'Fix case-insensitive stale text'}],
                                   'players': [{'player_id': 'cli_dev', 'work_item_key': 'FOCUS', 'status': 'assigned'}]}}
        with patch.object(server, 'repo_slug', return_value='relativityE/speaksharp'), \
             patch.object(server, '_run_pm_codex', return_value=(route, 'thread')), \
             patch.object(server, 'resolve_dev_target', return_value={'ok': True}), \
             patch.object(server, 'reserve_github_request_budget', return_value=(False, {'used': 60, 'limit': 60, 'reset_at': 'later'})), \
             patch.object(server.subprocess, 'run') as run:
            server.run_pm(q)
            run.assert_not_called()
        self.assertFalse([x for x in server.list_queue() if x['recipient'] == 'dev'])
        self.assertEqual(server.get_agent('pm')['status'], 'error')
        with patch.object(server, 'repo_slug', return_value='relativityE/speaksharp'), \
             patch.object(server, 'resolve_dev_target', return_value={'ok': True}), \
             patch.object(server, 'validate_worktree', return_value={'exists': True, 'is_git': True, 'branch': 'test/focus', 'head': 'a'*40, 'tree': 'b'*40}), \
             patch.object(server, 'reserve_github_request_budget', return_value=(True, {})), \
             patch.object(server.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '{"id":99}', '')) as run:
            self.assertEqual(server.resume_deferred_pm_publication(), 'applied')
            self.assertIsNone(server.resume_deferred_pm_publication())
            server.resume_owed_pm_turns()
            self.assertEqual(run.call_count, 1)
        self.assertEqual(len([x for x in server.list_queue() if x['recipient'] == 'dev']), 1)
        self.assertEqual(server.get_agent('pm')['status'], 'idle')
        self.assertEqual(next(x for x in server.list_queue() if x['id'] == q['id'])['status'], 'responded')

    def test_affected_pr_ci_completion_wakes_pm(self):
        old = {'head': 'a'*40, 'base': 'b'*40, 'code_review_ids': [], 'inline_comment_fingerprint': 'same',
               'check_fingerprint': 'pending'}
        new = dict(old, check_fingerprint='complete', checks=[{'name': 'report', 'status': 'COMPLETED', 'conclusion': 'SUCCESS'}])
        events = server.github_watch_events({'affected_reviews': {'1578': old}}, {'affected_reviews': {'1578': new}}, {'pm_github_ci': True})
        self.assertTrue(any('1578' in e and 'CI' in e for e in events))
        self.assertEqual(server.github_watch_events({'affected_reviews': {'1578': new}}, {'affected_reviews': {'1578': new}}, {'pm_github_ci': True}), [])

    def test_affected_pr_snapshot_contains_checks_without_extra_requests(self):
        server.apply_board_updates({'work_items': [{'item_key': 'PR-1578', 'pr_number': 1578, 'state': 'review', 'owner': 'cli_dev', 'branch': 'test/focus'}]})
        pr = {'headRefOid': 'a'*40, 'baseRefOid': 'b'*40, 'state': 'OPEN', 'statusCheckRollup': [
            {'name': 'report', 'status': 'COMPLETED', 'conclusion': 'SUCCESS', 'detailsUrl': 'run/1'}]}
        with patch.object(server, 'gh_json', side_effect=[(pr, None), ([], None), ([], None)]) as gh:
            snap = server.affected_review_snapshot('relativityE/speaksharp')
        self.assertEqual(gh.call_count, 3)
        self.assertIn('statusCheckRollup', gh.call_args_list[0].args[0][-1])
        self.assertEqual(snap['1578']['checks'][0]['conclusion'], 'SUCCESS')
        self.assertTrue(snap['1578']['check_fingerprint'])

    def test_security_only_conversation_change_wakes_pm(self):
        old = {'head': 'a'*40, 'base': 'b'*40, 'code_review_ids': [], 'inline_comment_fingerprint': 'same',
               'discussion_fingerprint': 'before'}
        new = dict(old, discussion_fingerprint='security-completed')
        events = server.github_watch_events({'affected_reviews': {'1578': old}}, {'affected_reviews': {'1578': new}}, {'pm_github_review': True})
        self.assertTrue(any('1578' in e and 'Security' in e for e in events))
        self.assertEqual(server.github_watch_events({'affected_reviews': {'1578': new}}, {'affected_reviews': {'1578': new}}, {'pm_github_review': True}), [])

    def test_local_publication_recovery_respects_pause_backoff_and_budget(self):
        server.set_agent('pm', paused=1)
        with patch.object(server, 'continue_pm_turn') as resume:
            self.assertIsNone(server.resume_deferred_pm_publication())
            resume.assert_not_called()

    def test_marker_recovery_releases_pm_error_without_reposting(self):
        self.enable_real_publication()
        q = self.q()
        plan = {'message': 'Reviewed packet', 'next': 'none', 'route_next': 'none', 'publish': True,
                'results': [], 'assigned_item': '', 'dependent_hold': False, 'blocking': [],
                'dispositions': [], 'review_handoffs': [], 'session_id': None}
        server._save_turn_plan(q['id'], plan, 'recording')
        with patch.object(server, 'repo_slug', return_value='relativityE/speaksharp'), \
             patch.object(server, 'gh_json', return_value=(None, 'timeout')):
            self.assertEqual(server.continue_pm_turn(q['id']), 'planned')
        self.assertEqual(server.get_agent('pm')['status'], 'error')
        marker = 'rwt-board-pm:' + server.get_setting('board_instance_id') + ':' + str(q['id'])
        server.recover_pm_outbox([{'id': 99, 'body': marker}])
        with patch.object(server, 'gh_json') as gh:
            self.assertEqual(server.resume_owed_pm_turns()[q['id']], 'applied')
            gh.assert_not_called()
        self.assertEqual(server.get_agent('pm')['status'], 'idle')

    def test_marker_recovery_preserves_unrelated_error_and_pause(self):
        self.enable_real_publication()
        q = self.q()
        plan = {'message': 'Reviewed packet', 'next': 'none', 'route_next': 'none', 'publish': True,
                'results': [], 'assigned_item': '', 'dependent_hold': False, 'blocking': [],
                'dispositions': [], 'review_handoffs': [], 'session_id': None}
        server._save_turn_plan(q['id'], plan, 'recording')
        with patch.object(server, 'repo_slug', return_value='relativityE/speaksharp'), \
             patch.object(server, 'gh_json', return_value=(None, 'timeout')):
            server.continue_pm_turn(q['id'])
        marker = 'rwt-board-pm:' + server.get_setting('board_instance_id') + ':' + str(q['id'])
        server.recover_pm_outbox([{'id': 99, 'body': marker}])
        server.set_agent('pm', paused=1)
        server.update_player_status('cli_pm', status='blocked', blocker='Authentication failed', source='auth')
        with patch.object(server, 'gh_json') as gh:
            self.assertEqual(server.continue_pm_turn(q['id']), 'applied')
            gh.assert_not_called()
        self.assertEqual(server.get_agent('pm')['status'], 'error')
        self.assertEqual(server.get_agent('pm')['paused'], 1)

    def test_marker_recovery_preserves_another_publication_blocker(self):
        self.enable_real_publication()
        q = self.q()
        other = self.q()
        server.update_queue(other['id'], status='responded_unpublished', error='another uncertain POST')
        plan = {'message': 'Reviewed packet', 'next': 'none', 'route_next': 'none', 'publish': True,
                'results': [], 'assigned_item': '', 'dependent_hold': False, 'blocking': [],
                'dispositions': [], 'review_handoffs': [], 'session_id': None}
        server._save_turn_plan(q['id'], plan, 'recording')
        with patch.object(server, 'repo_slug', return_value='relativityE/speaksharp'), \
             patch.object(server, 'gh_json', return_value=(None, 'timeout')):
            server.continue_pm_turn(q['id'])
        marker = 'rwt-board-pm:' + server.get_setting('board_instance_id') + ':' + str(q['id'])
        server.recover_pm_outbox([{'id': 99, 'body': marker}])
        with patch.object(server, 'gh_json') as gh:
            self.assertEqual(server.continue_pm_turn(q['id']), 'applied')
            gh.assert_not_called()
        self.assertEqual(server.get_agent('pm')['status'], 'error')

    def test_deferred_recovery_respects_backoff_and_budget(self):
        server.set_agent('pm', paused=0)
        with patch.object(server, 'github_backoff_until', return_value=10**12), \
             patch.object(server, 'continue_pm_turn') as resume:
            self.assertIsNone(server.resume_deferred_pm_publication())
            resume.assert_not_called()
        with patch.object(server, 'github_backoff_until', return_value=0), \
             patch.object(server, 'github_request_budget_state', return_value={'remaining': 0}), \
             patch.object(server, 'continue_pm_turn') as resume:
            self.assertIsNone(server.resume_deferred_pm_publication())
            resume.assert_not_called()

    def test_affected_conversation_ignores_automatic_pm_posts_but_tracks_security_summary_edits(self):
        server.apply_board_updates({'work_items': [{'item_key': 'PR-1578', 'pr_number': 1578, 'state': 'review', 'owner': 'cli_dev', 'branch': 'test/focus'}]})
        pr = {'headRefOid': 'a'*40, 'baseRefOid': 'b'*40, 'state': 'OPEN', 'comments': [{'id': 'summary', 'body': 'Security pending'}]}
        def read():
            server.set_setting('affected_review_cache', '{}')
            with patch.object(server, 'gh_json', side_effect=[(pr, None), ([], None), ([], None)]):
                return server.affected_review_snapshot('relativityE/speaksharp')['1578']['discussion_fingerprint']
        first = read()
        pr['comments'].append({'id': 'local', 'body': '<!-- rwt-board-pm:old-instance:99 --> Status unchanged'})
        self.assertEqual(read(), first)
        pr['comments'][0]['body'] = 'Security completed'
        self.assertNotEqual(read(), first)
