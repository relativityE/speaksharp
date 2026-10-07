"""Review probes: assert that the reported failure is reproducible in c4.
These passing probes confirm defects; they are NOT app acceptance tests.
No live GitHub, agent process, installed board or product state is used.
"""
import sys, os, json, time, subprocess, unittest
from pathlib import Path
from unittest.mock import patch, Mock
sys.path.insert(0, os.environ.get('C4_SOURCE', str(Path(__file__).parent / 'source/rwt-pr-handoff-v4.6.16')))
import server
import test_regressions as reg
from test_deadlock5 import FakeGitHub, refresh_action, HEAD, BASE, KEY, BRANCH, board
from guarded_pm import Hold, canonical_key

class C4GapProbes(unittest.TestCase):
    setUp = reg.RegressionTests.setUp
    tearDown = reg.RegressionTests.tearDown

    def assign(self):
        self.assertTrue(server.apply_board_updates({'work_items':[{'item_key':KEY,'owner':'cli_dev','state':'active','branch':BRANCH,'worktree':'/fixture/wt','next_action':'dependent repair'}], 'players':[{'player_id':'cli_dev','work_item_key':KEY,'status':'assigned'}]}))

    def handoff(self, owner='cli_dev'):
        return {'pr_number':1570,'head':HEAD,'reviewed_ref':'review 12345678','disposition':'fix_now','owner':owner,'work_item_key':KEY if owner=='cli_dev' else None,'instruction':'implement findings'}

    def route(self, **kw):
        r={'message':'directive','next':'none','publish':True,'pm_actions':[],'board_updates':board(KEY),'review_handoffs':[],'ask_dispositions':[],'dev_depends_on_actions':True}
        r.update(kw); return r

    def run_pm(self, route):
        server.PM_MODE='codex'
        aid=server.add_activity('GITHUB','fixture','pm')
        qid=server.enqueue(aid,'pm','fixture',source_actor='GITHUB')
        q=next(r for r in server.list_queue() if r['id']==qid)
        with patch.object(server,'_run_pm_codex',return_value=(route,'fixture')), patch.object(server,'compact_pr_context',return_value='fixture'):
            server.run_pm(q)

    def dev_rows(self):
        return [r for r in server.list_queue() if r['recipient']=='dev']

    def comment(self, ident, body):
        return {'id':ident,'body':body,'url':f'https://github.com/fixture#issuecomment-{ident}','at':'2099-01-01T00:00:00Z'}

    def test_01_recorded_handoff_not_resumed(self):
        server.record_review_handoffs({'id':1},[self.handoff('app_dev')])
        rows, blocks, _=server.record_review_handoffs({'id':2},[self.handoff('app_dev')])
        self.assertEqual((rows,blocks),([],[]))
        self.assertEqual(server.list_review_handoffs()[0]['state'],'recorded')
        self.assertIsNone(server.pending_handoff_watchdog())

    def test_02_explicit_handoff_bypasses_required_action_hold(self):
        with patch.object(server,'validate_worktree',return_value={'exists':True,'is_git':True,'branch':BRANCH,'head':HEAD}):
            self.assign()
            self.run_pm(self.route(pm_actions=[{'kind':'unsupported'}],review_handoffs=[self.handoff()]))
        self.assertEqual(len(self.dev_rows()),1)
        self.assertEqual(self.dev_rows()[0]['kind'],'review_handoff')

    def test_03_external_not_done_closes_ask(self):
        server.ingest_control_asks([self.comment(101,'App Dev → CLI PM — REQUEST: review packet')])
        server.ingest_control_asks([self.comment(102,'CLI Dev → CLI PM — source 101 is NOT DONE')])
        self.assertEqual(server.list_asks('open'),[])

    def test_04_other_actor_quoted_receipt_acks_undelivered_handoff(self):
        server.record_review_handoffs({'id':1},[self.handoff('app_dev')])
        h=server.list_review_handoffs()[0]
        server.record_handoff_receipts([self.comment(102,f'Browser PM → CLI PM — missing owner response; quoted `RECEIPT {h["token"]}`')])
        self.assertEqual(server.list_review_handoffs()[0]['state'],'acknowledged')

    def test_05_hold_retires_dependency_followup(self):
        server.ingest_control_asks([self.comment(101,'App Dev → CLI PM — REQUEST: review packet')])
        a=server.list_asks()[0]
        server.apply_ask_dispositions({'id':1},[{'ask_id':a['id'],'disposition':'hold','owner':'cli_pm','dependency':'CI terminal','evidence':'waiting for CI'}],'comment 102')
        self.assertEqual(server.list_asks('open'),[])

    def test_06_parser_drops_second_request_line(self):
        self.assertEqual(len(server.parse_asks('App Dev → CLI PM\nREQUEST: push pin\nREQUEST: independent design review')),1)
        self.assertEqual(server.parse_asks('PO → CLI PM — add packet read recovery'),[])

    def test_07_review_and_next_dev_double_enqueue(self):
        with patch.object(server,'validate_worktree',return_value={'exists':True,'is_git':True,'branch':BRANCH,'head':HEAD}):
            self.assign()
            self.run_pm(self.route(next='dev',review_handoffs=[self.handoff()]))
        self.assertEqual(len(self.dev_rows()),2)

    def test_08_anti_idle_bypasses_persisted_action_hold(self):
        with patch.object(server,'validate_worktree',return_value={'exists':True,'is_git':True,'branch':BRANCH,'head':HEAD}):
            self.assign()
            self.run_pm(self.route(pm_actions=[{'kind':'unsupported'}],board_updates={'work_items':[{'item_key':KEY,'owner':'cli_dev','state':'active'}],'players':[{'player_id':'cli_dev','status':'assigned','work_item_key':KEY}]}))
            self.assertEqual(self.dev_rows(),[])
            stop=Mock(); stop.is_set.side_effect=[False,True]
            with patch.object(server,'STOP',stop): server.anti_idle_reconciler()
        self.assertEqual(len(self.dev_rows()),1)

    def test_09_initial_comment_read_has_no_since(self):
        with patch.object(server,'gh_json',return_value=([[]],None)) as gh:
            server.fetch_watch_comments('relativityE/speaksharp',1258)
        self.assertNotIn('since=',gh.call_args.args[0][-1])
        self.assertIn('--paginate',gh.call_args.args[0])

    def test_10_packet_reader_ignores_shared_backoff(self):
        with patch.object(server,'GH_BACKOFF_UNTIL',time.time()+3600), patch.object(server.subprocess,'run',return_value=subprocess.CompletedProcess([],0,b'bytes',b'')) as run:
            self.assertEqual(server._gh_raw('handoffs/PR-1258/p/file',HEAD),b'bytes')
        run.assert_called_once()

    def test_11_transient_resume_read_turns_into_unrecoverable_draft_hold(self):
        gh=FakeGitHub(fail_on='ready')
        with patch.object(server,'_pm_request',side_effect=gh.request): server.execute_pm_actions({'id':1},[refresh_action()])
        with patch.object(server,'_pm_request',side_effect=Hold('GitHub read transient/backoff')): server.resume_interrupted_actions()
        with patch.object(server,'_pm_request',side_effect=gh.request): result=server.execute_pm_actions({'id':2},[refresh_action()])
        self.assertTrue(gh.pr['draft'])
        self.assertTrue(result[0].startswith('HOLD:'))
        self.assertEqual(gh.writes,['draft'])

    def test_12_command_adapter_loses_structured_handoffs(self):
        route=self.route(review_handoffs=[self.handoff('app_dev')],ask_dispositions=[{'ask_id':1}],dev_depends_on_actions=False)
        process=Mock(); process.communicate.return_value=(json.dumps(route),''); process.returncode=0
        with patch.object(server,'PM_COMMAND','fixture'), patch.object(server.subprocess,'Popen',return_value=process):
            parsed,_=server._run_pm_command('fixture',None)
        self.assertEqual(parsed['review_handoffs'],[])
        self.assertEqual(parsed['ask_dispositions'],[])
        self.assertTrue(parsed['dev_depends_on_actions'])

    def test_13_enqueue_does_not_freeze_candidate_head(self):
        with patch.object(server,'validate_worktree',return_value={'exists':True,'is_git':True,'branch':BRANCH,'head':HEAD}): self.assign()
        qid=server.enqueue(server.add_activity('PM','directive','dev'),'dev','directive',work_item_key=KEY)
        q=next(x for x in server.list_queue() if x['id']==qid)
        self.assertEqual(q['target_head'],'')
        with patch.object(server,'validate_worktree',return_value={'exists':True,'is_git':True,'branch':BRANCH,'head':'c'*40,'clean':False}):
            self.assertTrue(server.resolve_dev_target(q)['ok'])

    def test_14_second_database_init_reclassifies_running_claim(self):
        with server.con() as c:
            c.execute('INSERT INTO pm_action_journal(action_key,status,result,kind,phase) VALUES(?,?,?,?,?)',(canonical_key(refresh_action()),'running','active first worker','refresh_reviews','draft_requested'))
        server.init_db()
        with server.con() as c: status=c.execute('SELECT status FROM pm_action_journal').fetchone()['status']
        self.assertEqual(status,'unconfirmed')

    def test_15_non_authorizing_source_text_can_trigger_refresh(self):
        gh=FakeGitHub()
        def request(args):
            if 'issues/comments/' in args[-1]:
                return {'issue_url':'https://api.github.com/repos/relativityE/speaksharp/issues/1258','user':{'login':'relativityE'},'body':f'{HEAD} {BASE} Do NOT execute Draft→Ready; it is not authorized.'}
            return gh.request(args)
        with patch.object(server,'_pm_request',side_effect=request): server.execute_pm_actions({'id':1},[refresh_action()])
        self.assertEqual(gh.writes,['draft','ready'])

    def test_16_train_auto_selection_overrides_explicit_selected_pr(self):
        server.set_setting('current_pr','1570')
        self.assertEqual(server._auto_select_current_pr([{'number':1559},{'number':1570}])['number'],1559)
        self.assertEqual(server.get_setting('current_pr'),'1559')

if __name__=='__main__': unittest.main(verbosity=2)
