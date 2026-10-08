import json
from unittest.mock import patch
from test_comms import CommsTests
import server

class PacketWatchdogTests(CommsTests):
    def packet(self):
        return {'id':101,'at':'2026-10-05T00:00:00Z','body':'App Dev COMPLETE packet. REQUEST: PM push pin. head '+('a'*40)}

    def context(self, rows):
        server.set_setting('control_checkpoint_context',json.dumps(rows))
        server.set_agent('pm', status='idle')

    def test_overdue_packet_wakes_only_once_without_repeating_actions(self):
        self.context([self.packet()])
        with patch.object(server,'age_seconds',return_value=180):
            qid=server.pending_pin_watchdog()
            self.assertIsNotNone(qid)
            server.update_queue(qid,status='responded')
            self.assertIsNone(server.pending_pin_watchdog())
        self.assertIn('reconciliation only',server.list_queue()[-1]['content'])

    def test_browser_pin_closes_request(self):
        self.context([self.packet(),{'id':102,'body':'PUSH PIN packet101 accepted'}])
        with patch.object(server,'age_seconds',return_value=180):
            self.assertIsNone(server.pending_pin_watchdog())
        self.assertEqual(server.get_setting('pm_pending_packet'),'')

    def test_generic_ack_does_not_close_complete_request(self):
        self.context([self.packet(),{'id':102,'body':'ACK101 monitoring'}])
        with patch.object(server,'age_seconds',return_value=180):
            self.assertIsNotNone(server.pending_pin_watchdog())

    def test_uncertain_outbox_blocks_reconciliation_replay(self):
        self.context([self.packet()])
        with server.con() as c:
            c.execute('INSERT INTO pm_outbox VALUES(?,?,?,?)',(42,'unconfirmed',None,'body'))
        with patch.object(server,'age_seconds',return_value=180):
            self.assertIsNone(server.pending_pin_watchdog())

    def test_running_paused_or_unreadable_age_is_not_reawakened(self):
        self.context([self.packet()])
        server.set_agent('pm',status='running')
        with patch.object(server,'age_seconds',return_value=180):
            self.assertIsNone(server.pending_pin_watchdog())
        server.set_agent('pm',status='idle',paused=1)
        with patch.object(server,'age_seconds',return_value=180):
            self.assertIsNone(server.pending_pin_watchdog())
        server.set_agent('pm',paused=0)
        with patch.object(server,'age_seconds',return_value=None):
            self.assertIsNone(server.pending_pin_watchdog())

    def test_publication_error_preserved_for_runtime_health(self):
        self.enable_real_publication()
        with patch.object(server,'repo_slug',return_value='relativityE/speaksharp'),patch.object(server,'gh_json',return_value=(None,'HTTP403: permission denied')):
            self.assertFalse(server.publish_pm_reply(self.q(),'ACK'))
        self.assertIn('403',server.get_setting('pm_outbox_error'))
