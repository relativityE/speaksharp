import json
import os
import sqlite3
import subprocess
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch
from http.server import ThreadingHTTPServer

import server
from migrate_state import migrate_state


class RegressionTests(unittest.TestCase):
    def setUp(self):
        self.pub_patch = patch.object(server, 'publish_pm_reply', return_value=True)
        self.pub_patch.start()
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db = server.DB
        self.old_uploads = server.UPLOADS
        self.old_mode = server.PM_MODE
        self.old_auth = server.CODEX_AUTH_OK
        server.DB = Path(self.tmp.name) / 'state.db'
        server.UPLOADS = Path(self.tmp.name) / 'uploads'
        server.init_db()

    def tearDown(self):
        self.pub_patch.stop()
        server.DB = self.old_db
        server.UPLOADS = self.old_uploads
        server.PM_MODE = self.old_mode
        server.CODEX_AUTH_OK = self.old_auth
        self.tmp.cleanup()

    def item(self, key):
        return next(x for x in server.list_work_items() if x['item_key'] == key)

    def assign(self, key='NAV', owner='cli_dev', branch='fix/navigation', worktree=''):
        self.assertTrue(server.apply_board_updates({'work_items': [
            {'item_key': key, 'state': 'active', 'owner': owner, 'branch': branch, 'worktree': worktree}
        ]}))

    def test_restart_requires_fresh_assignment_checkpoint(self):
        self.assign()
        server.reset_ephemeral_control_state_on_start()
        self.assertFalse(server.resolve_dev_target({'work_item_key':'NAV'})['ok'])
        self.assertEqual(self.item('NAV')['owner'], 'cli_dev')
        self.assign()
        self.assertEqual(server.get_setting('dev_assignment_reconciled'), '1')

    def test_unbound_historical_delivery_cannot_execute(self):
        self.assign()
        with self.assertRaisesRegex(RuntimeError, 'Unbound historical delivery'):
            server.run_dev({'id':123})

    def test_opening_coaching_cannot_jump_queue(self):
        prs = [{'number':1559, 'updatedAt':'2099'}, {'number':1558,'updatedAt':'2098'},
               {'number':1555,'updatedAt':'2020'}]
        self.assertEqual(server._auto_select_current_pr(prs)['number'], 1555)
        self.assertEqual(server._auto_select_current_pr(list(reversed(prs)))['number'], 1555)

    def test_explicit_current_pr_selection_beats_train_order(self):
        server.set_setting('current_pr_explicit', '1')
        server.set_setting('current_pr', '1559')
        open_prs = [{'number': 1555, 'title': 'first train item'}, {'number': 1559, 'title': 'explicit item'}]
        calls = []
        def gh(args):
            calls.append(args)
            if args[:2] == ['pr', 'list'] and '--state' in args and args[args.index('--state')+1] == 'open':
                return open_prs, None
            if args[:2] == ['pr', 'list']:
                return [], None
            if args[:2] == ['pr', 'view']:
                return {'number': 1559, 'state': 'OPEN', 'title': 'explicit item'}, None
            raise AssertionError(args)
        with patch.object(server, 'gh_json', side_effect=gh):
            snapshot = server.pr_snapshot()
        self.assertEqual(snapshot['current']['number'], 1559)
        self.assertEqual(server.get_setting('current_pr'), '1559')

    def test_queue_advances_after_merge(self):
        self.assertEqual(server._auto_select_current_pr([{'number':1559},{'number':1554},{'number':1558}])['number'],1558)
        self.assertEqual(server._auto_select_current_pr([{'number':1559},{'number':1554}])['number'],1554)

    def test_unrelated_pr_is_never_auto_selected(self):
        self.assertIsNone(server._auto_select_current_pr([{'number':999,'title':'#1258 newer'}]))

    def test_new_task_cannot_duplicate_writer(self):
        self.assign()
        before = server.list_work_items()
        self.assertFalse(server.apply_board_updates({'work_items':[{'item_key':'OTHER','state':'active','owner':'cli_dev','branch':'other'}]}))
        self.assertEqual(server.list_work_items(),before)

    def test_new_task_cannot_duplicate_branch_across_devs(self):
        self.assign()
        self.assertFalse(server.apply_board_updates({'work_items':[{'item_key':'APP','state':'active','owner':'app_dev','branch':'fix/navigation'}]}))
        self.assertFalse(any(x['item_key']=='APP' for x in server.list_work_items()))

    def test_rejected_patch_rolls_back_other_task_and_player(self):
        self.assign()
        before_items = server.list_work_items()
        before_players = server.list_player_status()
        self.assertFalse(server.apply_board_updates({
            'work_items':[{'item_key':'PR-1559','notes':'must roll back'},
                          {'item_key':'PR-1558','state':'active','owner':'app_dev','branch':'fix/navigation'}],
            'players':[{'player_id':'app_dev','status':'active','task':'must roll back','work_item_key':'PR-1558'}]
        }))
        self.assertEqual(server.list_work_items(),before_items)
        self.assertEqual(server.list_player_status(),before_players)

    def test_atomic_checkpoint_release_then_acquire_is_order_independent(self):
        self.assign(owner='app_dev')
        self.assertTrue(server.apply_board_updates({'work_items':[
            {'item_key':'PR-1555','state':'active','owner':'app_dev','branch':'new'},
            {'item_key':'NAV','state':'waiting','notes':'Verified checkpoint release'}
        ],'players':[{'player_id':'app_dev','work_item_key':'PR-1555','status':'active'}]}))
        self.assertEqual(self.item('NAV')['state'],'waiting')
        self.assertEqual(server.list_player_status()['app_dev']['work_item_key'],'PR-1555')

    def test_task_player_mismatch_rolls_back(self):
        before=server.list_player_status()
        self.assertFalse(server.apply_board_updates({'players':[{'player_id':'cli_dev','work_item_key':'PR-1555','status':'active'}]}))
        self.assertEqual(server.list_player_status(),before)

    def test_startup_preserves_writer_but_marks_external_activity_unknown(self):
        self.assign(owner='app_dev')
        server.update_player_status('app_dev',status='active',work_item_key='NAV',source='pm')
        server.reset_ephemeral_control_state_on_start()
        self.assertEqual(self.item('NAV')['owner'],'app_dev')
        self.assertEqual(self.item('NAV')['state'],'active')
        self.assertEqual(server.list_player_status()['app_dev']['status'],'unknown')

    def test_independent_task_uses_own_worktree(self):
        self.assign(worktree='/independent/nav')
        server.set_setting('current_pr','1555')
        with patch.object(server,'validate_worktree',return_value={'exists':True,'is_git':True,'branch':'fix/navigation','head':'nav-head'}) as valid:
            target=server.resolve_dev_target({'work_item_key':'NAV'})
        self.assertTrue(target['ok'])
        self.assertEqual(target['path'],'/independent/nav')
        valid.assert_called_once_with('/independent/nav')

    def test_existing_wrong_worktree_cannot_launch_dev(self):
        self.assign(worktree='/wrong')
        with patch.object(server,'validate_worktree',return_value={'exists':True,'is_git':True,'branch':'app-dev-branch','head':'x'}), \
             patch.object(server,'_run_claude_once') as cli:
            with self.assertRaisesRegex(RuntimeError,'branch mismatch'):
                server.run_dev({'id':1,'work_item_key':'NAV','content':'work'})
            cli.assert_not_called()

    def test_delivery_freezes_task_branch(self):
        self.assign()
        aid=server.add_activity('PM','work','dev')
        qid=server.enqueue(aid,'dev','work',work_item_key='NAV')
        q=next(r for r in server.list_queue() if r['id']==qid)
        self.assertEqual(q['target_branch'],'fix/navigation')
        server.update_work_item('NAV',branch='new-branch')
        self.assertFalse(server.resolve_dev_target(q)['ok'])

    def test_external_seed_is_unknown_not_working(self):
        snap={'current':None,'active':[],'recent_completed':[],'error':None}
        with patch.object(server,'pr_snapshot',return_value=snap):
            d=server.dashboard_snapshot()
        self.assertEqual(d['players']['app_dev']['status'],'unknown')
        self.assertEqual(d['players']['browser_pm']['status'],'unknown')

    def test_stale_external_checkpoint_is_unknown(self):
        server.update_player_status('app_dev',status='active',source='pm')
        with server.con() as c:
            c.execute("UPDATE player_status SET updated_at='2020-01-01T00:00:00Z' WHERE player_id='app_dev'")
        with patch.object(server,'pr_snapshot',return_value={'current':None,'error':None}):
            d=server.dashboard_snapshot()
        self.assertEqual(d['players']['app_dev']['status'],'unknown')

    def test_completed_pr_releases_only_its_assignment(self):
        self.assign(owner='app_dev')
        server.update_work_item('PR-1555',owner='app_dev',state='waiting')
        server.update_player_status('app_dev',work_item_key='PR-1555')
        server.reconcile_release_items([], [{'number':1555,'state':'MERGED','mergedAt':'2026'}])
        self.assertEqual(self.item('PR-1555')['state'],'merged')
        self.assertEqual(self.item('NAV')['state'],'active')

    def test_paginated_control_issue_reads_latest_page(self):
        with patch.object(server,'gh_json',return_value=([[{'id':1,'body':'old'}],[{'id':999,'body':'new'}]],None)):
            snap,err=server.github_watch_snapshot()
        self.assertIsNone(err)
        self.assertEqual(snap['latest_control_comment_id'],999)
        self.assertEqual(snap['latest_control_comment']['body'],'new')

    def test_watcher_keeps_overlapping_runs_visible(self):
        server.set_setting('current_pr','1555')
        pr={'number':1555,'headRefOid':'sha','headRefName':'branch'}
        runs=[{'databaseId':1,'workflowName':'CI - Test Audit','headSha':'sha','status':'in_progress'},
              {'databaseId':2,'workflowName':'CI - Test Audit','headSha':'sha','status':'completed','conclusion':'cancelled'}]
        with patch.object(server,'gh_json',side_effect=[([],None),([],None),([],None),(pr,None),([],None),([],None),(runs,None)]):
            snap,_=server.github_watch_snapshot()
        self.assertEqual(len(snap['runs']),2)

    def test_cancelled_check_from_another_suite_is_not_hidden(self):
        p={'statusCheckRollup':[
            {'name':'report','status':'COMPLETED','conclusion':'SUCCESS','detailsUrl':'run1'},
            {'name':'report','status':'COMPLETED','conclusion':'CANCELLED','detailsUrl':'run2'}]}
        self.assertEqual(server._pr_gate_summary(p)['failed'],1)

    def test_skipped_check_is_terminal_not_running(self):
        self.assertEqual(server._pr_gate_summary({'statusCheckRollup':[{'name':'optional','status':'COMPLETED','conclusion':'SKIPPED'}]})['running'],0)

    def test_github_read_failure_is_visible(self):
        with patch.object(server,'pr_snapshot',return_value={'error':'GitHub unavailable','current':None}):
            d=server.dashboard_snapshot()
        self.assertEqual(d['blocker']['text'],'GitHub status unavailable')

    def test_unknown_auth_never_reports_ready(self):
        server.PM_MODE='codex'; server.CODEX_AUTH_OK=None
        with patch.object(server,'resolved_bin',return_value='/fake/codex'):
            self.assertFalse(server.transport_status()['pm_configured'])

    def test_invalid_board_patch_prevents_pm_dev_handoff(self):
        self.assign()
        aid=server.add_activity('PO','work','pm')
        qid=server.enqueue(aid,'pm','work')
        q=next(x for x in server.list_queue() if x['id']==qid)
        routed={'message':'invalid assignment','next':'dev','board_updates':{'work_items':[
            {'item_key':'OTHER','owner':'cli_dev','branch':'other','state':'active'}]}}
        server.PM_MODE='codex'
        with patch.object(server,'_run_pm_codex',return_value=(routed,'thread')):
            server.run_pm(q)
        self.assertFalse(any(x['recipient']=='dev' for x in server.list_queue()))

    def test_sqlite_migration_imports_v468_including_wal(self):
        base=Path(self.tmp.name)
        old=base/'rwt-pr-handoff-v4.6.8'/'.agent-work'/'state.db'
        old.parent.mkdir(parents=True)
        src=sqlite3.connect(old)
        src.execute('PRAGMA journal_mode=WAL')
        src.execute('CREATE TABLE sentinel(value TEXT)')
        src.execute("INSERT INTO sentinel VALUES('recent history')");src.commit()
        target=base/'rwt-pr-handoff-v4.6.16'
        source=migrate_state(target)
        self.assertEqual(source,old)
        with sqlite3.connect(target/'.agent-work'/'state.db') as c:
            self.assertEqual(c.execute('SELECT value FROM sentinel').fetchone()[0],'recent history')
        src.close()
        self.assertIsNone(migrate_state(target))

    def test_migration_preserves_handoffs_uploads_and_rebases_attachment_paths(self):
        base = Path(self.tmp.name)
        old_app = base/'rwt-pr-handoff-v4.6.8'
        old = old_app/'.agent-work'/'state.db'
        old.parent.mkdir(parents=True)
        old_app.joinpath('uploads').mkdir()
        old_app.joinpath('handoffs/PR-1258/pkt').mkdir(parents=True)
        (old_app/'uploads'/'packet.zip').write_bytes(b'upload')
        (old_app/'handoffs/PR-1258/pkt'/'source.txt').write_text('review packet')
        with sqlite3.connect(old) as c:
            c.execute('CREATE TABLE attachments(id INTEGER PRIMARY KEY, filename TEXT, path TEXT, size_bytes INTEGER, created_at TEXT)')
            c.execute('INSERT INTO attachments VALUES(1,?,?,?,?)',
                      ('packet.zip', str(old_app/'uploads'/'packet.zip'), 6, '2026-10-07'))
            c.execute('INSERT INTO attachments VALUES(2,?,?,?,?)',
                      ('source.txt', str(old_app/'handoffs/PR-1258/pkt'/'source.txt'), 13, '2026-10-07'))
        target = base/'rwt-pr-handoff-v4.6.16'
        self.assertEqual(migrate_state(target), old)
        self.assertEqual((target/'uploads'/'packet.zip').read_bytes(), b'upload')
        self.assertEqual((target/'handoffs/PR-1258/pkt/source.txt').read_text(), 'review packet')
        with sqlite3.connect(target/'.agent-work'/'state.db') as c:
            paths = [x[0] for x in c.execute('SELECT path FROM attachments ORDER BY id')]
        self.assertEqual(paths, [str(target/'uploads'/'packet.zip'), str(target/'handoffs/PR-1258/pkt/source.txt')])
        self.assertTrue((target/'.agent-work'/'migration-manifest.json').exists())
        self.assertEqual((old_app/'uploads'/'packet.zip').read_bytes(), b'upload')

    def test_migration_requires_explicit_source_when_multiple_siblings_exist(self):
        base = Path(self.tmp.name)
        candidates = []
        for version in ('v4.6.8', 'v4.6.12'):
            db = base/f'rwt-pr-handoff-{version}'/'.agent-work'/'state.db'
            db.parent.mkdir(parents=True)
            with sqlite3.connect(db) as c:
                c.execute('CREATE TABLE sentinel(value TEXT)')
                c.execute('INSERT INTO sentinel VALUES(?)', (version,))
            candidates.append(db)
        target = base/'rwt-pr-handoff-v4.6.16'
        with self.assertRaisesRegex(RuntimeError, 'Multiple prior board states'):
            migrate_state(target)
        self.assertEqual(migrate_state(target, source=candidates[0]), candidates[0])

    def test_version_labels_match(self):
        root=Path(server.__file__).parent
        self.assertEqual(server.BOARD_VERSION,'4.6.17')
        for file in ['static/index.html','start-rwt-handoff.sh','README.md']:
            text=(root/file).read_text()
            self.assertIn('v4.6.17',text)
        self.assertIn(server.BOARD_BUILD, (root/'start-rwt-handoff.sh').read_text())
        self.assertIn(server.BOARD_BUILD, (root/'README.md').read_text())
        html=(root/'static/index.html').read_text()
        self.assertNotIn('Board v4.6.8',html)

    def test_dashboard_keeps_assigned_dispatch_hold_visible_as_blocked(self):
        server.apply_board_updates({'work_items': [{'item_key': 'HELD', 'state': 'active', 'owner': 'cli_dev',
                                                     'branch': 'fix/held'}],
                                    'players': [{'player_id': 'cli_dev', 'status': 'blocked', 'work_item_key': 'HELD'}]})
        with server.con() as c:
            c.execute("UPDATE work_items SET dispatch_hold='waiting for prerequisite',dispatch_hold_release='Gate 4 passes' WHERE item_key='HELD'")
        with patch.object(server, 'display_pr_snapshot', return_value={'current': None, 'active': [], 'recent_completed': []}):
            snapshot = server.dashboard_snapshot()
        self.assertEqual(snapshot['players']['cli_dev']['status'], 'blocked')
        self.assertEqual(snapshot['players']['cli_dev']['blocker'], 'waiting for prerequisite')

    def test_http_dispatch_worktree_and_conflict_endpoints(self):
        http = ThreadingHTTPServer(('127.0.0.1',0),server.H)
        thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
        origin=f'http://127.0.0.1:{http.server_port}'
        def post(path,body):
            req=urllib.request.Request(origin+path,data=json.dumps(body).encode(),
                                       headers={'Content-Type':'application/json',server.CONTROL_TOKEN_HEADER:server.CONTROL_TOKEN})
            try:
                with urllib.request.urlopen(req,timeout=3) as r:
                    return r.status,json.load(r)
            except urllib.error.HTTPError as e:
                return e.code,json.load(e)
        try:
            with patch.object(server,'pr_snapshot',return_value={'current':None,'active':[],'error':None}), \
                 patch.object(server,'transport_status',return_value={'pm_configured':True,'dev_configured':True}):
                with urllib.request.urlopen(origin+'/',timeout=3) as r:
                    self.assertIn('Board v4.6.16',r.read().decode())
                code,_=post('/api/work-item',{'item_key':'NAV','state':'active','owner':'cli_dev',
                                             'branch':'fix/navigation','worktree':'/nav'})
                self.assertEqual(code,200)
                code,_=post('/api/player-status',{'player_id':'app_dev','work_item_key':'NAV','status':'active'})
                self.assertEqual(code,409)
                with patch.object(server,'validate_worktree',return_value={'exists':True,'is_git':True,'branch':'fix/navigation','head':'x'}):
                    code,result=post('/api/send',{'actor':'PO','route':'dev','message':'check','files':[]})
                self.assertEqual(code,202)
                q=next(x for x in server.list_queue() if x['id']==result['delivery_ids'][0])
                self.assertEqual(q['work_item_key'],'NAV')
                self.assertEqual(q['target_worktree'],'/nav')
                with patch.object(server,'transport_status',return_value={'pm_configured':False,'dev_configured':True,'pm_auth_detail':'sign in'}):
                    code,_=post('/api/send',{'actor':'PO','route':'pm','message':'check'})
                self.assertEqual(code,409)
        finally:
            http.shutdown();http.server_close();thread.join(timeout=3)

    def test_command_adapter_preserves_board_updates(self):
        script=Path(self.tmp.name)/'adapter.py'
        script.write_text("import json,sys\njson.load(sys.stdin)\nprint(json.dumps({'message':'checked','next':'none','board_updates':{'work_items':[{'item_key':'PR-1559','notes':'adapter receipt'}]}}))\n")
        with patch.object(server,'PM_COMMAND',f'python3 {script}'):
            routed,_=server._run_pm_command('input',None)
        self.assertEqual(routed['board_updates']['work_items'][0]['notes'],'adapter receipt')

    def test_pm_dev_pm_roundtrip_through_real_adapter_subprocesses(self):
        # Real local subprocess pipes, JSON and DB handoffs; no installed account or API is used.
        root=Path(self.tmp.name)
        wt=root/'worktree';wt.mkdir()
        subprocess.run(['git','init','-q','-b','fix/navigation',str(wt)],check=True)
        subprocess.run(['git','-C',str(wt),'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-qm','initial'],check=True)
        subprocess.run(['git','-C',str(wt),'remote','add','origin','https://github.com/relativityE/speaksharp.git'],check=True)
        self.assign(worktree=str(wt))
        pm=root/'fake_pm.py'
        pm.write_text("import json,sys\np=json.load(sys.stdin)\nprint(json.dumps({'message':'Run bounded navigation check','next':'none' if 'DONE' in p['content'] else 'dev','session_id':'pm-session','board_updates':{'work_items':[{'item_key':'NAV','state':'done' if 'DONE' in p['content'] else 'active','notes':'adapter checkpoint'}],'players':[{'player_id':'cli_dev','work_item_key':'NAV','status':'done' if 'DONE' in p['content'] else 'active'}]}}))\n")
        dev=root/'fake_claude'
        dev.write_text("#!/usr/bin/env python3\nimport json,sys\nprint(json.dumps({'result':'DONE bounded check','session_id':'dev-session'}))\n")
        dev.chmod(0o755)
        aid=server.add_activity('PO','Please run bounded check','pm')
        qid=server.enqueue(aid,'pm','Please run bounded check')
        q=next(x for x in server.list_queue() if x['id']==qid)
        server.PM_MODE='command'
        with patch.object(server,'PM_COMMAND',f'python3 {pm}'),patch.object(server,'CLAUDE_BIN',str(dev)), \
             patch.object(server,'BASE_REPO',str(wt)), \
             patch.object(server,'compact_pr_context',return_value='Current release: #1555; independent task NAV'):
            server.run_pm(q)
            devq=server.next_queue('dev')
            self.assertEqual(devq['target_branch'],'fix/navigation')
            server.run_dev(devq)
            pmq=server.next_queue('pm')
            self.assertIn('DONE',pmq['content'])
            server.run_pm(pmq)
        rows=server.list_queue()
        self.assertEqual([x['status'] for x in rows],['responded']*3)
        self.assertEqual([x['recipient'] for x in rows],['pm','dev','pm'])
        self.assertEqual(rows[1]['target_worktree'],str(wt))


if __name__ == '__main__':
    unittest.main()
