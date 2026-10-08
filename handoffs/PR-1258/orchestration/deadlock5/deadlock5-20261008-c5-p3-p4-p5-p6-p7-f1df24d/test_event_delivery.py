import json
from unittest.mock import patch
from test_comms import CommsTests
import server

class EventDeliveryTests(CommsTests):
    def assign_dev_task(self, worktree='/missing/task-worktree'):
        key='PR-1570-P1'
        ok=server.apply_board_updates({'work_items':[{
            'item_key':key,'pr_number':1570,'title':'#1570 P1','state':'active','owner':'cli_dev',
            'branch':'fix/1258-readback-boot-control','worktree':worktree,
            'next_action':'bootstrap, then implement the reviewed fix'}],
            'players':[{'player_id':'cli_dev','status':'assigned','work_item_key':key,'task':'#1570 P1'}]})
        self.assertTrue(ok)
        aid=server.add_activity('PM','execute assigned task','dev')
        qid=server.enqueue(aid,'dev','execute assigned task',source_actor='PM',work_item_key=key)
        return next(row for row in server.list_queue() if row['id']==qid)

    def test_burst_preserves_every_comment_including_addressed_directive(self):
        prev={'latest_control_comment_id':10}
        cur={'latest_control_comment_id':12,'control_updates':[
          {'id':11,'body':'Browser PM to CLI PM: pin the packet','url':'https://github.com/comment/11'},
          {'id':12,'body':'App Dev: host free','url':'https://github.com/comment/12'}]}
        events=server.github_watch_events(prev,cur,{'pm_github_control':True})
        self.assertEqual(len(events),2)
        self.assertIn('pin the packet',events[0])
        self.assertIn('host free',events[1])

    def test_busy_recipient_accumulates_pending_events_without_resetting_age(self):
        aid=server.add_activity('GITHUB','first','pm')
        first=server._coalesced_github_enqueue(aid,'pm','packet101 requires pin')
        original=server.list_queue()[0]['created_at']
        second=server._coalesced_github_enqueue(aid,'pm','directive102 prioritizes packet101')
        self.assertEqual(first,second)
        row=server.list_queue()[0]
        self.assertIn('packet101 requires pin',row['content'])
        self.assertIn('directive102',row['content'])
        self.assertEqual(row['created_at'],original)
        server._coalesced_github_enqueue(aid,'pm','directive102 prioritizes packet101')
        self.assertEqual(server.list_queue()[0]['content'].count('directive102'),1)

    def test_inflight_payload_not_changed_by_new_event(self):
        q=self.q();server.update_queue(q['id'],status='delivering')
        aid=server.add_activity('GITHUB','next','pm')
        second=server._coalesced_github_enqueue(aid,'pm','new packet')
        self.assertNotEqual(second,q['id'])
        old=next(x for x in server.list_queue() if x['id']==q['id'])
        self.assertEqual(old['content'],q['content'])

    def test_returned_reply_and_published_comment_never_claim_task_completion(self):
        q=self.q();server.update_queue(q['id'],status='responded')
        self.assertIn('unverified',server.list_queue()[0]['delivery_label'])
        with server.con() as c:
            c.execute('INSERT INTO pm_outbox VALUES(?,?,?,?)',(q['id'],'published',777,'reply'))
        row=server.list_queue()[0]
        self.assertEqual(row['github_comment_id'],777)
        self.assertIn('action unverified',row['delivery_label'])

    def test_reconciled_same_assignment_cannot_spawn_second_writer(self):
        server.apply_board_updates({'work_items':[{'item_key':'R2-CAUSAL-FIX','state':'active','owner':'cli_dev','branch':'fix/causal','next_action':'return packet'}]})
        item=next(x for x in server.list_work_items() if x['item_key']=='R2-CAUSAL-FIX')
        signature=json.dumps([item.get(k) for k in ('item_key','branch','worktree','next_action')],sort_keys=True)
        server.set_setting('last_executable_assignment',signature)
        update={'work_items':[{'item_key':item['item_key'],'owner':'cli_dev','state':'active'}]}
        with patch.object(server,'resolve_dev_target',return_value={'ok':True}):
            self.assertIsNone(server._actionable_cli_dev_assignment(update))

    def test_missing_board_patch_does_not_swallow_valid_reply(self):
        q=self.q();server.PM_MODE='codex'
        route={'message':'App Dev: publish the terminal packet now','next':'dev','pm_actions':[]}
        with patch.object(server,'_run_pm_codex',return_value=(route,'thread')), patch.object(server,'publish_pm_reply',return_value=True) as publish:
            server.run_pm(q)
        publish.assert_called_once_with(q,route['message'])
        self.assertFalse(any(x['recipient']=='dev' for x in server.list_queue()))

    def test_assigned_dev_delivery_displays_each_execution_boundary(self):
        q=self.assign_dev_task()
        queued=next(row for row in server.list_queue() if row['id']==q['id'])
        self.assertIn('ASSIGNED → QUEUED',queued['delivery_stage'])
        self.assertIn('Dev not invoked',queued['delivery_stage'])

        # c5 (F12): launch and process start are separately recorded stages.
        server.update_queue(q['id'],status='delivering',started_at=server.now(),launch_attempted_at=server.now(),attempts=1)
        launched=next(row for row in server.list_queue() if row['id']==q['id'])
        self.assertIn('LAUNCH ATTEMPTED',launched['delivery_stage'])
        self.assertIn('process not yet confirmed',launched['delivery_stage'])

        server.update_queue(q['id'],process_started_at=server.now(),process_pid=4242)
        invoked=next(row for row in server.list_queue() if row['id']==q['id'])
        self.assertIn('DEV PROCESS STARTED (pid 4242)',invoked['delivery_stage'])

        server.update_queue(q['id'],status='responded',finished_at=server.now())
        returned=next(row for row in server.list_queue() if row['id']==q['id'])
        self.assertIn('DEV REPLY RETURNED',returned['delivery_stage'])
        self.assertIn('PM review pending',returned['delivery_stage'])

    def test_preflight_failure_reports_expected_tuple_and_queues_one_pm_recovery(self):
        q=self.assign_dev_task()
        target=server.resolve_dev_target(q)
        self.assertFalse(target['ok'])
        self.assertIn('worktree is missing',target['error'])
        self.assertIn('fix/1258-readback-boot-control',target['error'])
        self.assertIn('/missing/task-worktree',target['error'])

        server.update_queue(q['id'],status='failed',error=target['error'],finished_at=server.now())
        first=server.recover_failed_dev_preflight(q['id'],target['error'])
        second=server.recover_failed_dev_preflight(q['id'],target['error'])
        self.assertEqual(first,second)
        rows=server.list_queue()
        child=[row for row in rows if row['parent_queue_id']==q['id'] and row['recipient']=='pm']
        self.assertEqual(len(child),1)
        self.assertIn('bootstrap',child[0]['content'])
        self.assertIn('Do not retry',child[0]['content'])
        self.assertFalse(any(row['id']!=q['id'] and row['recipient']=='dev' for row in rows))
        failed=next(row for row in rows if row['id']==q['id'])
        self.assertEqual(failed['delivery_stage'],'BLOCKED BEFORE DEV INVOCATION')
        self.assertIn('PM recovery queued',failed['recovery_action'])

    def test_failure_after_dev_invocation_does_not_queue_preflight_recovery(self):
        q=self.assign_dev_task()
        server.update_queue(q['id'],status='failed',started_at=server.now(),attempts=1)
        self.assertIsNone(server.recover_failed_dev_preflight(q['id'],'worker failed'))
        self.assertFalse(any(row['recipient']=='pm' for row in server.list_queue()))
