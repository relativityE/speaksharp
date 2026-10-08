import json
from pathlib import Path
from unittest.mock import patch
import server
import unittest
import test_regressions as _reg

class ReconciliationTests(unittest.TestCase):
    setUp = _reg.RegressionTests.setUp
    tearDown = _reg.RegressionTests.tearDown
    item = _reg.RegressionTests.item
    def delivery(self):
        aid=server.add_activity('GITHUB','App Dev packet','pm')
        qid=server.enqueue(aid,'pm','App Dev packet',source_actor='GITHUB')
        return next(q for q in server.list_queue() if q['id']==qid)

    def test_prose_only_response_is_visible_partial_and_never_dispatches(self):
        q=self.delivery();server.PM_MODE='codex'
        with patch.object(server,'_run_pm_codex',return_value=({'message':'Dev restacked; await packet','next':'dev','board_updates':None},'thread')):
            server.run_pm(q)
        rows=server.list_queue()
        self.assertEqual(rows[0]['status'],'responded_unreconciled')
        self.assertFalse(any(q['recipient']=='dev' for q in rows))
        self.assertIn('without task AND player',server.get_setting('pm_reconciliation_status'))
        self.assertEqual(self.item('PR-1554')['owner'],'unassigned')
        self.assertTrue(any(a['message']=='Dev restacked; await packet' for a in server.list_activity()))

    def test_complete_packet_reconciles_owner_task_and_original_freshness(self):
        q=self.delivery();server.PM_MODE='codex'
        stamp='2026-10-05T18:44:00+00:00'
        routed={'message':'Received exact-head packet','next':'none','board_updates':{
            'work_items':[{'item_key':'PR-1554','owner':'app_dev','state':'waiting','notes':'Local4cd18e371/tree24614bc9; remoteeb61710','blocker':'Await pinned push','next_action':'Push with pin6000973718'}],
            'players':[{'player_id':'app_dev','work_item_key':'PR-1554','status':'reported','task':'PDF packet received','source':'https://github.com/relativityE/speaksharp/issues/1258#issuecomment-6000842567','checkpoint_at':stamp}]}}
        with patch.object(server,'_run_pm_codex',return_value=(routed,'thread')):
            server.run_pm(q)
        self.assertEqual(self.item('PR-1554')['owner'],'app_dev')
        self.assertIn('4cd18e371',self.item('PR-1554')['notes'])
        self.assertEqual(server.list_player_status()['app_dev']['updated_at'],stamp)
        self.assertEqual(server.list_queue()[0]['status'],'responded')

    def test_unreadable_or_old_checkpoint_does_not_become_fresh(self):
        self.assertTrue(server.apply_board_updates({'players':[{'player_id':'app_dev','status':'reported','source':'old receipt','checkpoint_at':'2000-01-01T00:00:00Z'}]}))
        snap={'current':None,'active':[],'recent_completed':[]}
        with patch.object(server,'pr_snapshot',return_value=snap):
            d=server.dashboard_snapshot()
        self.assertEqual(d['players']['app_dev']['status'],'unknown')

    def test_future_timestamp_rejects_entire_patch(self):
        self.assertFalse(server.apply_board_updates({'work_items':[{'item_key':'PR-1554','owner':'app_dev'}], 'players':[{'player_id':'app_dev','checkpoint_at':'2099-01-01T00:00:00Z'}]}))
        self.assertEqual(self.item('PR-1554')['owner'],'unassigned')

    def test_train_first_newest_order_is_explicit_not_update_order(self):
        prs=[{'number':1488,'updatedAt':'2099'},{'number':1559,'updatedAt':'2020'},{'number':1560,'updatedAt':'2021'},{'number':1554,'updatedAt':'2020'},{'number':1557}]
        self.assertEqual([p['number'] for p in server.priority_prs(prs,prs[3])],[1554,1559,1560,1557])

    def test_pre_pr_work_and_conflicted_navigation_remain_in_queue(self):
        with patch.object(server,'pr_snapshot',return_value={'current':None,'active':[],'recent_completed':[]}):
            d=server.dashboard_snapshot()
        keys={w['item_key'] for w in d['priority_queue']}
        self.assertTrue({'FEEDBACK-FIX','PR-1561','PR-1560'}.issubset(keys))
        self.assertEqual(self.item('PR-1561')['pr_number'],None)

    def test_prompt_contains_full_packet_board_and_read_only_capability(self):
        server.set_setting('control_checkpoint_context','packet source 6000947740 exact head4cd18e371')
        with patch.object(server,'compact_pr_context',return_value='Draft remoteeb61710'):
            prompt=server.compose_for_pm({'id':1,'content':'new packet'})
        for expected in ('RECORDED BOARD','players','6000947740','4cd18e371','READ-ONLY'):
            self.assertIn(expected,prompt)

    def test_schema_cannot_accept_null_reconciliation(self):
        schema=json.loads(server.PM_ROUTE_SCHEMA.read_text())
        updates=schema['properties']['board_updates']
        self.assertEqual(updates['type'],'object')
        for key in ('players','work_items'):
            self.assertEqual(updates['properties'][key]['minItems'],1)
        self.assertIn('checkpoint_at',updates['properties']['players']['items']['required'])
