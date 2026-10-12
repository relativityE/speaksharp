import copy
import json
import unittest
from unittest.mock import patch
import server
import test_regressions as reg
from guarded_pm import Executor, Hold

HEAD='a'*40
BASE='b'*40

class CommsTests(unittest.TestCase):
    setUp=reg.RegressionTests.setUp
    tearDown=reg.RegressionTests.tearDown
    item=reg.RegressionTests.item

    def enable_real_publication(self):
        self.pub_patch.stop()

    def q(self):
        aid=server.add_activity('GITHUB','App Dev packet','pm')
        qid=server.enqueue(aid,'pm','App Dev packet',source_actor='GITHUB')
        return next(x for x in server.list_queue() if x['id']==qid)

    def test_dev_post_wakes_pm_when_review_toggle_is_off(self):
        old={'latest_control_comment_id':10}
        cur={'latest_control_comment_id':11,'latest_control_comment':{'body':'App Dev packet'}}
        events=server.github_watch_events(old,cur,{'pm_github_review':False,'pm_github_control':True})
        self.assertEqual(len(events),1)
        qids=server.emit_github_event(events,cur,{'pm_github_control':True})
        self.assertEqual(server.list_queue()[0]['recipient'],'pm')
        self.assertTrue(qids)

    def test_worker_response_is_published_and_deduplicated(self):
        self.enable_real_publication();q=self.q();server.PM_MODE='codex'
        route={'message':'App Dev: packet accepted; next is Ready','next':'none','pm_actions':[],'board_updates':{
            'work_items':[{'item_key':'PR-1554','owner':'app_dev','state':'waiting','next_action':'Ready'}],
            'players':[{'player_id':'app_dev','status':'reported','work_item_key':'PR-1554','source':'fixture checkpoint'}]}}
        with patch.object(server,'repo_slug',return_value='relativityE/speaksharp'),patch.object(server,'gh_json',return_value=({'id':99},None)) as gh,patch.object(server,'_run_pm_codex',return_value=(route,'thread')),patch.object(server,'compact_pr_context',return_value='Current #1554 Draft'):
            server.run_pm(q)
            self.assertEqual(self.item('PR-1554')['owner'],'app_dev')
            self.assertTrue(server.publish_pm_reply(q,'same response'))
            self.assertEqual(gh.call_count,1)
            self.assertIn('App Dev: packet accepted',gh.call_args[0][0][-1])
            self.assertIn('awaiting recipient ACK',server.get_setting('pm_outbox_status'))

    def test_own_reply_does_not_self_wake_but_later_dev_post_does(self):
        inst=server.get_setting('board_instance_id')
        own={'id':20,'body':f'<!-- rwt-board-pm:{inst}:1 --> local PM reply'}
        dev={'id':21,'body':'App Dev ACK and packet'}
        with patch.object(server,'repo_slug',return_value='relativityE/speaksharp'),patch.object(server,'gh_json',return_value=([[own]],None)):
            snap,_=server.github_watch_snapshot()
            self.assertEqual(snap['latest_control_comment_id'],0)
        with patch.object(server,'repo_slug',return_value='relativityE/speaksharp'),patch.object(server,'gh_json',return_value=([[own,dev]],None)):
            snap,_=server.github_watch_snapshot()
            self.assertEqual(snap['latest_control_comment_id'],21)

    def test_uncertain_publication_is_not_blindly_repeated(self):
        self.enable_real_publication();q=self.q()
        with patch.object(server,'repo_slug',return_value='relativityE/speaksharp'),patch.object(server,'gh_json',return_value=(None,'timeout')) as gh:
            self.assertFalse(server.publish_pm_reply(q,'response'))
            self.assertFalse(server.publish_pm_reply(q,'response'))
            self.assertEqual(sum('-X' in c.args[0] for c in gh.call_args_list),1)

    def test_marker_recovers_completed_post_after_restart(self):
        self.enable_real_publication();q=self.q()
        with server.con() as c:
            c.execute('INSERT INTO pm_outbox VALUES(?,?,?,?)',(q['id'],'unconfirmed',None,'body'))
        marker='rwt-board-pm:'+server.get_setting('board_instance_id')+':'+str(q['id'])
        with patch.object(server,'repo_slug',return_value='relativityE/speaksharp'),patch.object(server,'gh_json',return_value=([[{'id':77,'body':marker}]],None)) as gh:
            self.assertTrue(server.publish_pm_reply(q,'response'))
            self.assertNotIn('-X',gh.call_args.args[0])

    def test_failed_outbox_never_claims_completed_delivery(self):
        self.enable_real_publication();q=self.q();server.PM_MODE='codex'
        route={'message':'ACK','next':'none','board_updates':{'work_items':[{'item_key':'PR-1554','notes':'received'}],'players':[{'player_id':'cli_pm','task':'packet'}]}}
        with patch.object(server,'publish_pm_reply',return_value=False),patch.object(server,'_run_pm_codex',return_value=(route,'thread')),patch.object(server,'compact_pr_context',return_value='Current #1554 Draft'):
            server.run_pm(q)
        self.assertEqual(server.list_queue()[0]['status'],'responded_unpublished')

    def test_parser_retains_typed_actions(self):
        action={'kind':'mark_ready','head':HEAD,'base':BASE,'pr_number':1554,'source_comment_id':12}
        out=server.parse_pm_route(json.dumps({'message':'Ready','next':'none','board_updates':{},'pm_actions':[action]}))
        self.assertEqual(out['pm_actions'],[action])

    def test_watcher_recovers_timed_out_post_without_another_write(self):
        q=self.q()
        with server.con() as c:
            c.execute('INSERT INTO pm_outbox VALUES(?,?,?,?)',(q['id'],'unconfirmed',None,'body'))
        marker='rwt-board-pm:'+server.get_setting('board_instance_id')+':'+str(q['id'])
        server.update_queue(q['id'],status='responded_unpublished')
        with patch.object(server,'repo_slug',return_value='relativityE/speaksharp'),patch.object(server,'gh_json',return_value=([[{'id':91,'body':marker}]],None)) as gh:
            server.github_watch_snapshot()
            self.assertNotIn('-X',gh.call_args.args[0])
        self.assertEqual(server.list_queue()[0]['status'],'responded')
        self.assertIn('awaiting recipient ACK',server.get_setting('pm_outbox_status'))

class ExecutorTests(unittest.TestCase):
    def setUp(self):
        self.calls=[];self.qualified=[]
        self.pr={'number':1554,'node_id':'PR_NODE','state':'open','draft':True,'head':{'sha':HEAD,'ref':'fix/1258-pdf','repo':{'full_name':'relativityE/speaksharp'}},'base':{'sha':BASE}}
        self.runs=[];self.source={'user':{'login':'relativityE'},'issue_url':'https://api.github.com/repos/relativityE/speaksharp/issues/1258','body':HEAD+' '+BASE}
        self.run={'id':22,'name':'CI - Test Audit','head_sha':HEAD,'head_branch':'fix/1258-pdf','status':'completed','conclusion':'failure','run_attempt':1}
        self.jobs={'total_count':1,'jobs':[{'name':'full-evidence','conclusion':'success'}]}
        self.e=Executor(self.request,lambda n,h:self.qualified.append((n,h)))

    def request(self,args):
        self.calls.append(args)
        if '-X' in args or 'graphql' in args:
            return {'number':1562}
        path=args[-1]
        if '/issues/comments/' in path:return copy.deepcopy(self.source)
        if path.endswith('branches/main'):return {'commit':{'sha':BASE}}
        if '/pulls/1554' in path:return copy.deepcopy(self.pr)
        if '/actions/workflows/' in path:return {'workflow_runs':copy.deepcopy(self.runs)}
        if '/jobs?' in path:return copy.deepcopy(self.jobs)
        if path.endswith('/actions/runs/22'):return copy.deepcopy(self.run)
        if '/git/ref/' in path:return {'object':{'sha':HEAD}}
        if '/pulls?' in path:return []
        raise AssertionError(path)

    def action(self,kind='mark_ready',**kw):
        action={'kind':kind,'pr_number':1554,'head':HEAD,'base':BASE,'source_comment_id':12,**kw}
        fields=[f'kind={kind}']
        if kind!='open_draft_pr':fields.append('pr=1554')
        if action.get('branch'):fields.append(f"branch={action['branch']}")
        fields.extend((f'head={HEAD}',f'base={BASE}'))
        if kind=='rerun_failed_jobs':fields.extend((f"run_id={action['run_id']}",f"run_attempt={action['run_attempt']}"))
        self.source['body']=HEAD+' '+BASE+'\nACTION AUTHORIZATION: '+' '.join(fields)
        return action

    def writes(self):return [c for c in self.calls if '-X' in c or 'graphql' in c]

    def test_ready_exact_candidate_mutates_once(self):
        self.assertIn('Marked',self.e.execute(self.action()))
        self.assertEqual(len(self.writes()),1)
        self.assertIn('markPullRequestReadyForReview',self.writes()[0][3])

    def test_already_ready_is_noop(self):
        self.pr['draft']=False
        self.e.execute(self.action())
        self.assertEqual(self.writes(),[])

    def test_head_drift_rejects(self):
        self.pr['head']['sha']='c'*40
        with self.assertRaises(Hold):self.e.execute(self.action())
        self.assertEqual(self.writes(),[])

    def test_unrelated_scope_and_merge_are_never_executable(self):
        for kind in ('merge','deploy','production','shell'):
            with self.assertRaises(Hold):self.e.execute(self.action(kind))
        self.pr['head']['ref']='fix/unrelated'
        with self.assertRaises(Hold):self.e.execute(self.action())
        self.assertEqual(self.writes(),[])

    def test_source_cannot_nominate_different_candidate(self):
        action=self.action()
        self.source['body']='another candidate'
        with self.assertRaises(Hold):self.e.execute(action)
        self.assertEqual(self.writes(),[])

    def test_active_same_branch_other_head_blocks_dispatch(self):
        self.pr['draft']=False
        self.runs=[{'name':'CI - Test Audit','head_branch':'fix/1258-pdf','head_sha':'c'*40,'status':'in_progress'}]
        with self.assertRaises(Hold):self.e.execute(self.action('dispatch_full_ci'))
        self.assertEqual(self.writes(),[])

    def test_draft_lane_cannot_be_recovered_as_full_evidence(self):
        self.pr['draft']=False;self.jobs['jobs'][0]['conclusion']='skipped'
        with self.assertRaises(Hold):self.e.execute(self.action('rerun_failed_jobs',run_id=22,run_attempt=1))
        self.assertEqual(self.writes(),[])

    def test_failed_recovery_checks_current_attempt_and_qualifier(self):
        self.pr['draft']=False
        self.e.execute(self.action('rerun_failed_jobs',run_id=22,run_attempt=1))
        self.assertEqual(len(self.writes()),1)
        self.assertTrue(self.qualified)
        self.run['run_attempt']=2
        with self.assertRaises(Hold):self.e.execute(self.action('rerun_failed_jobs',run_id=22,run_attempt=1))
        self.assertEqual(len(self.writes()),1)

    def test_full_dispatch_once_uses_correct_branch_and_force_full(self):
        self.pr['draft']=False
        self.e.execute(self.action('dispatch_full_ci'))
        self.assertIn('inputs[force_full]=true',self.writes()[0])
        self.runs=[{'name':'CI - Test Audit','head_branch':'fix/1258-pdf','head_sha':HEAD,'status':'completed','event':'workflow_dispatch'}]
        with self.assertRaises(Hold):self.e.execute(self.action('dispatch_full_ci'))
        self.assertEqual(len(self.writes()),1)

    def test_nonqualifying_review_prevents_recovery(self):
        self.pr['draft']=False
        def deny(*args):raise Hold('qualifier failed')
        self.e.qualify=deny
        with self.assertRaises(Hold):self.e.execute(self.action('dispatch_full_ci'))
        self.assertEqual(self.writes(),[])

    def test_draft_creation_uses_remote_packet_and_no_merge(self):
        self.e.execute(self.action('open_draft_pr',branch='fix/1258-feedback',title='Feedback fix',body=HEAD+' '+BASE))
        self.assertEqual(len(self.writes()),1)
        self.assertIn('draft=true',self.writes()[0])

    def test_source_authorized_combined_design_branch_is_allowed_exactly(self):
        branch='feat/1258-design-rev2-combined'
        action=self.action('open_draft_pr',branch=branch,title='Combined Rev 2',body=HEAD+' '+BASE)
        _,_,accepted=self.e.guard(action)
        self.assertEqual(accepted,branch)
        outside='feat/1258-design-rev3-combined'
        action=self.action('open_draft_pr',branch=outside,title='Unapproved combined branch',body=HEAD+' '+BASE)
        with self.assertRaisesRegex(Hold,'Branch outside RWT scope'):
            self.e.guard(action)
        self.assertEqual(self.writes(),[])

    def test_final_live_read_catches_drift_before_ready_write(self):
        original=self.request;reads=[0]
        def drift(args):
            if args[-1].endswith('/pulls/1554'):
                reads[0]+=1
                if reads[0]>1:self.pr['head']['sha']='c'*40
            return original(args)
        self.e.request=drift
        with self.assertRaises(Hold):self.e.execute(self.action())
        self.assertEqual(self.writes(),[])

    def test_unapproved_comment_author_cannot_request_mutation(self):
        self.source['user']['login']='untrusted-commenter'
        with self.assertRaises(Hold):self.e.execute(self.action())
        self.assertEqual(self.writes(),[])

    def test_failed_attempt_changed_during_guard_is_not_rerun(self):
        self.pr['draft']=False
        original=self.request;reads=[0]
        def drift(args):
            if args[-1].endswith('/actions/runs/22'):
                reads[0]+=1
                if reads[0]>1:self.run['run_attempt']=2
            return original(args)
        self.e.request=drift
        with self.assertRaises(Hold):self.e.execute(self.action('rerun_failed_jobs',run_id=22,run_attempt=1))
        self.assertEqual(self.writes(),[])
