from unittest.mock import patch
from datetime import datetime, timedelta, timezone
from test_comms import CommsTests
import server

class DeadlockTests(CommsTests):
    def test_future_track_packet_is_ingested_without_relay(self):
        def gh(args):
            if '/issues/1304/' in args[-1]:
                return [[{'id':42,'body':'CLI Dev packet on #1304','html_url':'https://github.com/issue/1304#42'}]], None
            return [[]], None
        with patch.object(server,'WATCH_ISSUES','1304'), patch.object(server,'gh_json',side_effect=gh), patch.object(server,'repo_slug',return_value='relativityE/speaksharp'):
            snap, err=server.github_watch_snapshot()
        self.assertIsNone(err)
        self.assertEqual(snap['control_updates'][0]['id'],42)

    def test_partial_poll_failure_does_not_return_advanced_snapshot(self):
        def gh(args):
            if '/issues/1304/' in args[-1]:
                return None,'rate limited'
            return [[{'id':99,'body':'new packet'}]],None
        with patch.object(server,'WATCH_ISSUES','1304'), patch.object(server,'gh_json',side_effect=gh), patch.object(server,'repo_slug',return_value='relativityE/speaksharp'):
            snap,err=server.github_watch_snapshot()
        self.assertIsNone(snap)
        self.assertIn('rate limited',err)

    def timeout(self, q):
        server.PM_MODE='codex'
        with patch.object(server,'_run_pm_codex',side_effect=server.PMTransportTimeout('timed out')), patch.object(server,'execute_pm_actions') as actions, patch.object(server,'publish_pm_reply') as publish:
            server.run_pm(q)
            actions.assert_not_called()
            publish.assert_not_called()

    def test_timeout_preserves_event_and_schedules_retry(self):
        q=self.q(); self.timeout(q)
        row=server.list_queue()[0]
        self.assertEqual(row['status'],'queued')
        self.assertEqual(row['content'],q['content'])
        self.assertEqual(row['created_at'],q['created_at'])
        self.assertEqual(row['attempts'],1)
        self.assertIsNone(server.next_queue('pm'))
        with patch.object(server.time,'time',return_value=row['available_after']+1):
            self.assertEqual(server.next_queue('pm')['id'],q['id'])

    def test_timeout_does_not_block_newer_packet(self):
        q=self.q(); self.timeout(q)
        second=self.q()
        self.assertEqual(server.next_queue('pm')['id'],second['id'])

    def test_old_github_request_ages_past_newer_priority_events(self):
        aid=server.add_activity('GITHUB','old exact request','pm')
        old=server.enqueue(aid,'pm','old exact request',source_actor='GITHUB')
        server.update_queue(old,created_at=(datetime.now(timezone.utc)-timedelta(seconds=240)).isoformat())
        for i in range(6):
            aid=server.add_activity('PO',f'newer event {i}','pm')
            server.enqueue(aid,'pm',f'newer event {i}',source_actor='PO')
        self.assertEqual(server.next_queue('pm')['id'],old)

    def test_three_timeouts_stop_with_visible_error(self):
        q=self.q()
        for _ in range(3):
            self.timeout(q); q=server.list_queue()[0]
        self.assertEqual(q['status'],'failed')
        self.assertEqual(q['attempts'],3)
        self.assertEqual(server.get_agent('pm')['status'],'error')

    def test_auth_error_is_not_automatically_retried(self):
        q=self.q(); server.PM_MODE='codex'
        with patch.object(server,'_run_pm_codex',side_effect=RuntimeError('not signed in')):
            server.run_pm(q)
        self.assertEqual(server.list_queue()[0]['status'],'failed')
        self.assertEqual(server.get_agent('pm')['status'],'auth_required')

    def test_missing_checkpoint_gets_one_recovery_only(self):
        q=self.q(); server.PM_MODE='codex'
        route={'message':'ack','next':'none','pm_actions':[]}
        with patch.object(server,'_run_pm_codex',return_value=(route,'thread')):
            server.run_pm(q)
            rows=server.list_queue()
            recovery=rows[-1]
            self.assertEqual(recovery['parent_queue_id'],q['id'])
            self.assertIn(q['content'],recovery['content'])
            server.run_pm(recovery)
        self.assertEqual(len(server.list_queue()),2)

    def test_uncertain_publication_prevents_recovery_replay(self):
        q=self.q(); server.PM_MODE='codex'
        with server.con() as c:
            c.execute('INSERT INTO pm_outbox VALUES(?,?,?,?)',(q['id'],'unconfirmed',None,'body'))
        with patch.object(server,'_run_pm_codex',return_value=({'message':'ack','next':'none'},'thread')):
            server.run_pm(q)
        self.assertEqual(len(server.list_queue()),1)

    def test_dev_result_at_limit_reaches_pm_once_without_writer_continuation(self):
        aid = server.add_activity('Dev', 'tests complete', 'pm')
        qid = server.enqueue(aid, 'dev', 'run tests', source_actor='PM',
                             handoff_depth=server.MAX_HANDOFF_DEPTH, auto_handoff=True)
        q = next(x for x in server.list_queue() if x['id'] == qid)
        first = server.maybe_handoff(aid, 'Dev', 'pm', 'tests complete', q)
        self.assertEqual(first, server.maybe_handoff(aid, 'Dev', 'pm', 'tests complete', q))
        notices = [x for x in server.list_queue() if x['parent_queue_id'] == qid]
        self.assertEqual(len(notices), 1)
        self.assertEqual(notices[0]['recipient'], 'pm')
        self.assertFalse(notices[0]['auto_handoff'])
        self.assertIn('tests complete', notices[0]['content'])
        before = len(server.list_queue())
        server.maybe_handoff(aid, 'PM', 'dev', 'more work', notices[0])
        self.assertEqual(len(server.list_queue()), before)

    def test_explicit_task_binding_wins_over_ambient_assignment(self):
        q = self.q()
        q['auto_handoff'] = True
        with patch.object(server, 'dev_assignment', side_effect=lambda key='': {'item_key':key or 'WRONG', 'branch':'fix/test', 'worktree':''}):
            qid = server.maybe_handoff(q['activity_id'], 'PM', 'dev', 'assigned task', q,
                                      work_item_key='CORRECT')
        self.assertEqual(next(x for x in server.list_queue() if x['id'] == qid)['work_item_key'], 'CORRECT')

    def test_pm_writer_dispatch_remains_capped(self):
        q = self.q()
        q.update(auto_handoff=True, handoff_depth=server.MAX_HANDOFF_DEPTH)
        before = len(server.list_queue())
        self.assertIsNone(server.maybe_handoff(q['activity_id'], 'PM', 'dev', 'more work', q))
        self.assertEqual(len(server.list_queue()), before)

    def test_system_recovery_reaches_pm_once_even_when_handoff_depth_is_exhausted(self):
        aid=server.add_activity('PM','deep assigned repair','dev')
        qid=server.enqueue(aid,'dev','deep assigned repair',source_actor='PM',work_item_key='PR-1570-P1',
                           handoff_depth=server.MAX_HANDOFF_DEPTH,auto_handoff=True)
        q=next(row for row in server.list_queue() if row['id']==qid)
        server.update_queue(qid,status='failed',error='preflight blocked',finished_at=server.now())
        first=server.recover_failed_dev_delivery(qid,'preflight blocked')
        second=server.recover_failed_dev_delivery(qid,'preflight blocked')
        self.assertEqual(first,second)
        recovery=next(row for row in server.list_queue() if row['id']==first)
        self.assertEqual(recovery['recipient'],'pm')
        self.assertFalse(recovery['auto_handoff'])
        self.assertIn('depth limit reached',recovery['content'])
        self.assertFalse(any(row['recipient']=='dev' and row['id']!=qid for row in server.list_queue()))
