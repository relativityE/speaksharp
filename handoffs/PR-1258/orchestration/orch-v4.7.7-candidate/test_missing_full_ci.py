import copy
from test_comms import CommsTests
import server


class MissingFullCITests(CommsTests):
    def snapshot(self):
        return {'pr': 1581, 'state': 'OPEN', 'draft': False, 'head': 'a'*40, 'base': 'b'*40,
                'runs': {'r': {'id': 123, 'workflow_id': 77, 'name': 'CI - Test Audit',
                               'status': 'completed', 'attempt': 1, 'jobs_attempt': 1,
                               'headSha': 'a'*40, 'jobs_head_sha': 'a'*40,
                               'jobs': [{'name': 'draft-checks', 'conclusion': 'success'},
                                        {'name': 'full-evidence', 'conclusion': 'skipped'}]}}}

    def test_ready_draft_only_run_queues_once_across_restart_without_granting_authority(self):
        snap = self.snapshot()
        first = server.queue_missing_full_ci_followup(snap)
        self.assertIsNotNone(first)
        server.init_db()
        self.assertEqual(server.queue_missing_full_ci_followup(snap), first)
        row = next(q for q in server.list_queue() if q['id'] == first)
        self.assertEqual(row['recipient'], 'pm')
        self.assertIn('only if an exact source authorization exists', row['content'])

    def test_draft_inflight_full_lane_or_unbound_jobs_do_not_trigger(self):
        snap = self.snapshot()
        variants = []
        a = copy.deepcopy(snap); a['draft'] = True; variants.append(a)
        a = copy.deepcopy(snap); a['runs']['r']['status'] = 'in_progress'; variants.append(a)
        a = copy.deepcopy(snap); a['runs']['r']['jobs'][1]['conclusion'] = 'success'; variants.append(a)
        a = copy.deepcopy(snap); a['runs']['r']['jobs_head_sha'] = 'c'*40; variants.append(a)
        a = copy.deepcopy(snap); a['runs']['r']['jobs_attempt'] = 2; variants.append(a)
        for value in variants:
            self.assertIsNone(server.queue_missing_full_ci_followup(value))

    def test_newer_full_run_prevents_old_draft_run_from_triggering(self):
        snap = self.snapshot()
        snap['runs']['r']['createdAt'] = '2026-10-10T10:00:00Z'
        newer = copy.deepcopy(snap['runs']['r'])
        newer.update(id=124, createdAt='2026-10-10T11:00:00Z', status='in_progress')
        snap['runs']['newer'] = newer
        self.assertIsNone(server.queue_missing_full_ci_followup(snap))
