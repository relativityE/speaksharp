import unittest
from unittest.mock import patch
import server
import test_regressions as reg

class SequencingStatusTests(unittest.TestCase):
    setUp = reg.RegressionTests.setUp
    tearDown = reg.RegressionTests.tearDown
    item = reg.RegressionTests.item

    def test_dependency_blocks_write_then_releases_for_fresh_handoff(self):
        self.assertTrue(server.apply_board_updates({'work_items': [
            {'item_key':'HELPER','state':'review','owner':'cli_dev'},
            {'item_key':'INTEGRATE','state':'ready','owner':'app_dev','depends_on':['HELPER']}]}))
        self.assertFalse(server.apply_board_updates({'work_items': [{'item_key':'INTEGRATE','state':'active'}]}))
        self.assertEqual(self.item('INTEGRATE')['state'], 'ready')
        server.update_work_item('HELPER', state='done')
        self.assertTrue(server.apply_board_updates({'work_items': [{'item_key':'INTEGRATE','state':'active'}]}))

    def test_unknown_and_cycle_roll_back_entire_patch(self):
        self.assertFalse(server.apply_board_updates({'work_items':[{'item_key':'NEW','depends_on':['ABSENT']}]}))
        self.assertNotIn('NEW', [x['item_key'] for x in server.list_work_items()])
        self.assertFalse(server.apply_board_updates({'work_items':[
            {'item_key':'A','depends_on':['B']}, {'item_key':'B','depends_on':['A']}]}))
        self.assertNotIn('A', [x['item_key'] for x in server.list_work_items()])

    def test_work_item_endpoint_cannot_bypass_dependency(self):
        server.apply_board_updates({'work_items':[
            {'item_key':'A','state':'waiting'}, {'item_key':'B','state':'ready','owner':'cli_dev','depends_on':['A']} ]})
        with self.assertRaisesRegex(ValueError, 'prerequisite'):
            server.update_work_item('B', state='active')
        self.assertEqual(self.item('B')['state'], 'ready')

    def test_dispatch_rechecks_dependency_before_checkout(self):
        server.set_setting('dev_assignment_reconciled','1')
        item={'item_key':'B','branch':'test/b','depends_on':'["NAV"]'}
        with patch.object(server,'_delivery_assignment',return_value=item), patch.object(server,'validate_worktree') as validate:
            result=server.resolve_dev_target({'work_item_key':'B'})
        self.assertFalse(result['ok'])
        self.assertIn('prerequisite',result['error'])
        validate.assert_not_called()

    def test_process_timestamp_does_not_refresh_task_checkpoint(self):
        old='2026-01-01T00:00:00+00:00'
        with server.con() as c:
            c.execute("UPDATE player_status SET updated_at=?,checkpoint_at=? WHERE player_id='cli_pm'",(old,old))
            c.execute("UPDATE agents SET updated_at=?,status='running' WHERE agent_id='pm'",(server.now(),))
        with patch.object(server,'display_pr_snapshot',return_value={'current':None,'active':[]}):
            d=server.dashboard_snapshot()
        p=d['players']['cli_pm']
        self.assertTrue(p['checkpoint_stale'])
        self.assertEqual(p['checkpoint_at'],old)
        self.assertEqual(p['status'],'active')
        self.assertGreater(p['age_seconds'],1800)
