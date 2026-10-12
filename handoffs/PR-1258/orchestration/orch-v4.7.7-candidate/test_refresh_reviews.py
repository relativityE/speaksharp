import unittest
from guarded_pm import Executor, Hold

class ReviewRefreshTests(unittest.TestCase):
    def setup_executor(self, existing=False, drift=False):
        self.head='a'*40; self.base='b'*40; self.writes=[]
        pr={'number':1559,'node_id':'PR_node','state':'open','draft':False,'head':{'sha':self.head,'ref':'fix/1258-coaching-failure-reason','repo':{'full_name':'relativityE/speaksharp'}},'base':{'sha':self.base}}
        def request(args):
            if 'graphql' in args:
                self.writes.append(args)
                if 'convertPullRequestToDraft' in str(args):
                    pr['draft']=True
                    if drift: pr['head']['sha']='c'*40
                if 'markPullRequestReadyForReview' in str(args):
                    pr['draft']=False  # GitHub's real effect; deadlock.5 reads it back
                return {}
            path=args[1]
            if 'issues/comments/' in path:return {'issue_url':'https://api.github.com/repos/relativityE/speaksharp/issues/1258','user':{'login':'relativityE'},'body':self.head+' '+self.base+' Draft→Ready\nACTION AUTHORIZATION: kind=refresh_reviews pr=1559 head='+self.head+' base='+self.base}
            if path.endswith('branches/main'):return {'commit':{'sha':self.base}}
            if 'ci.yml/runs' in path:return {'workflow_runs':[]}
            if '/reviews?' in path:return [{'commit_id':self.head,'user':{'login':'chatgpt-codex-connector[bot]'}}] if existing else []
            if path.endswith('pulls/1559'):return pr
            raise AssertionError(path)
        self.action={'kind':'refresh_reviews','source_comment_id':123,'pr_number':1559,'head':self.head,'base':self.base}
        return Executor(request,lambda *_:None)

    def test_new_head_cycles_with_fresh_read(self):
        ex=self.setup_executor();result=ex.execute(self.action);self.assertIn('EXECUTED',result);self.assertIn('PENDING',result);self.assertEqual(len(self.writes),2)

    def test_existing_codex_review_is_observed(self):
        ex=self.setup_executor(existing=True);result=ex.execute(self.action);self.assertTrue(result.startswith('OBSERVED:'));self.assertIn('already exists',result);self.assertEqual(self.writes,[])

    def test_drift_between_transitions_never_marks_ready(self):
        ex=self.setup_executor(drift=True)
        with self.assertRaises(Hold):ex.execute(self.action)
        self.assertEqual(len(self.writes),1)
