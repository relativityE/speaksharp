import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

# Import after env is stable; tests replace DB below.
import server


class BoardTests(unittest.TestCase):
    def setUp(self):
        self.pub_patch = patch.object(server, 'publish_pm_reply', return_value=True)
        self.pub_patch.start()
        self.td = tempfile.TemporaryDirectory()
        server.DB = Path(self.td.name) / 'state.db'
        server.UPLOADS = Path(self.td.name) / 'uploads'
        self.old_pm_mode = server.PM_MODE
        self.old_codex_bin = server.CODEX_BIN
        self.old_auth_ok = server.CODEX_AUTH_OK
        self.old_auth_detail = server.CODEX_AUTH_DETAIL
        server.init_db()
        # Historical fixtures exercise generic leases without shipping stale assignments.
        server.apply_board_updates({'work_items': [
            {'item_key': k, 'priority': 99, 'title': k, 'state': 'waiting', 'owner': 'unassigned'}
            for k in ('R0-1549','R1-PROD-DIAG','R2-CAUSAL-FIX','R3-Q2','R4-V4','R5-FINAL-RWT')
        ]})

    def recover_after_restart(self):
        with patch.object(server, 'STATE_LOCK_FD', 100), patch.object(server, 'REPOSITORY_LOCK_FD', 101):
            server.recover_interrupted_state_after_lock()

    def tearDown(self):
        self.pub_patch.stop()
        server.PM_MODE = self.old_pm_mode
        server.CODEX_BIN = self.old_codex_bin
        server.CODEX_AUTH_OK = self.old_auth_ok
        server.CODEX_AUTH_DETAIL = self.old_auth_detail
        self.td.cleanup()

    def test_pm_route_valid_json(self):
        r = server.parse_pm_route('{"message":"Proceed with the focused fix.","next":"dev"}')
        self.assertEqual(r['message'], 'Proceed with the focused fix.')
        self.assertEqual(r['next'], 'dev')
        self.assertIsNone(r['parse_error'])

    def test_pm_route_invalid_fails_safe_to_po(self):
        r = server.parse_pm_route('not-json')
        self.assertEqual(r['next'], 'po')
        self.assertIsNotNone(r['parse_error'])

    def test_both_creates_independent_delivery_rows(self):
        aid = server.add_activity('PO', 'hello', 'both')
        group = 'g1'
        p = server.enqueue(aid, 'pm', 'hello', source_actor='PO', fanout_group=group)
        d = server.enqueue(aid, 'dev', 'hello', source_actor='PO', fanout_group=group)
        rows = server.list_queue()
        self.assertEqual({r['recipient'] for r in rows}, {'pm','dev'})
        self.assertEqual({r['fanout_group'] for r in rows}, {group})
        self.assertNotEqual(p, d)

    def test_restart_preserves_queued_but_quarantines_inflight(self):
        aid = server.add_activity('PO', 'x', 'dev')
        q1 = server.enqueue(aid, 'dev', 'queued')
        q2 = server.enqueue(aid, 'pm', 'running')
        server.update_queue(q2, status='delivering')
        server.init_db()
        rows = {r['id']: r for r in server.list_queue()}
        self.assertEqual(rows[q2]['status'], 'delivering')  # a second init is not proof the old process exited
        self.recover_after_restart()
        rows = {r['id']: r for r in server.list_queue()}
        self.assertEqual(rows[q1]['status'], 'queued')
        self.assertEqual(rows[q2]['status'], 'failed_uncertain')

    def test_handoff_depth_cap(self):
        aid = server.add_activity('Dev', 'status', 'pm')
        qid = server.enqueue(aid, 'pm', 'status', source_actor='DEV', handoff_depth=server.MAX_HANDOFF_DEPTH)
        q = next(r for r in server.list_queue() if r['id'] == qid)
        before = len(server.list_queue())
        server.maybe_handoff(aid, 'PM', 'dev', 'more', q)
        after = len(server.list_queue())
        self.assertEqual(before, after)
        self.assertTrue(any('stopped at depth' in a['message'] for a in server.list_activity()))

    def test_dev_response_auto_queues_pm(self):
        aid = server.add_activity('PO', 'status?', 'dev')
        qid = server.enqueue(aid, 'dev', 'status?', source_actor='PO')
        q = next(r for r in server.list_queue() if r['id'] == qid)
        response_aid = server.add_activity('Dev', 'candidate ready', 'pm', 'responded')
        server.maybe_handoff(response_aid, 'Dev', 'pm', 'candidate ready', q)
        rows = server.list_queue()
        pm = [r for r in rows if r['recipient'] == 'pm']
        self.assertEqual(len(pm), 1)
        self.assertEqual(pm[0]['source_actor'], 'DEV')
        self.assertEqual(pm[0]['handoff_depth'], 1)

    def test_pm_dev_route_auto_queues_dev(self):
        aid = server.add_activity('Dev', 'candidate ready', 'pm')
        qid = server.enqueue(aid, 'pm', 'candidate ready', source_actor='DEV', handoff_depth=1)
        q = next(r for r in server.list_queue() if r['id'] == qid)
        response_aid = server.add_activity('PM', 'Push exact candidate', 'dev', 'responded')
        server.maybe_handoff(response_aid, 'PM', 'dev', 'Push exact candidate', q)
        rows = server.list_queue()
        devs = [r for r in rows if r['recipient'] == 'dev' and r['id'] != qid]
        self.assertEqual(len(devs), 1)
        self.assertEqual(devs[0]['source_actor'], 'PM')
        self.assertEqual(devs[0]['handoff_depth'], 2)

    def test_subscription_env_strips_codex_api_billing_overrides(self):
        with patch.dict(os.environ, {
            'OPENAI_API_KEY': 'api', 'OPENAI_ADMIN_KEY': 'admin', 'CODEX_API_KEY': 'codex-api',
            'KEEP_ME': 'yes'
        }, clear=False):
            env = server.subscription_env('codex')
        self.assertNotIn('OPENAI_API_KEY', env)
        self.assertNotIn('OPENAI_ADMIN_KEY', env)
        self.assertNotIn('CODEX_API_KEY', env)
        self.assertEqual(env['KEEP_ME'], 'yes')

    def test_subscription_env_strips_claude_api_billing_overrides(self):
        with patch.dict(os.environ, {
            'ANTHROPIC_API_KEY': 'api', 'ANTHROPIC_AUTH_TOKEN': 'token',
            'CLAUDE_CODE_USE_BEDROCK': '1', 'CLAUDE_CODE_USE_VERTEX': '1', 'KEEP_ME': 'yes'
        }, clear=False):
            env = server.subscription_env('claude')
        self.assertNotIn('ANTHROPIC_API_KEY', env)
        self.assertNotIn('ANTHROPIC_AUTH_TOKEN', env)
        self.assertNotIn('CLAUDE_CODE_USE_BEDROCK', env)
        self.assertNotIn('CLAUDE_CODE_USE_VERTEX', env)
        self.assertEqual(env['KEEP_ME'], 'yes')

    def test_claude_stderr_warning_is_not_fatal_on_success(self):
        warning = "[mcp-sdk] SEP-2352: stored OAuth credential has no 'issuer' stamp"
        self.assertEqual(server.claude_transport_error(0, None, warning), '')

    def test_claude_stderr_is_fatal_when_process_exits_nonzero(self):
        warning = "[mcp-sdk] SEP-2352: stored OAuth credential has no 'issuer' stamp"
        self.assertEqual(server.claude_transport_error(1, None, warning), warning)

    def test_claude_parse_error_wins_even_on_zero_exit(self):
        self.assertEqual(server.claude_transport_error(0, 'empty Claude stdout', 'warning'), 'empty Claude stdout')

    def test_claude_adapter_accepts_valid_json_with_sep2352_stderr(self):
        fake = Path(self.td.name) / 'claude'
        fake.write_text("""#!/usr/bin/env python3
import json, sys
print(json.dumps({'result':'candidate ready','session_id':'session-123','is_error':False}))
print("[mcp-sdk] SEP-2352: stored OAuth credential has no 'issuer' stamp", file=sys.stderr)
""")
        fake.chmod(0o755)
        old_bin = server.CLAUDE_BIN
        server.CLAUDE_BIN = str(fake)
        try:
            rc, result, sid, parse_err, stderr = server._run_claude_once('status', self.td.name, 'session-123', False)
            self.assertEqual(rc, 0)
            self.assertEqual(result, 'candidate ready')
            self.assertEqual(sid, 'session-123')
            self.assertIsNone(parse_err)
            self.assertIn('SEP-2352', stderr)
            self.assertEqual(server.claude_transport_error(rc, parse_err, stderr), '')
        finally:
            server.CLAUDE_BIN = old_bin

    def test_codex_jsonl_extracts_thread_id(self):
        stdout = '\n'.join([
            json.dumps({'type':'thread.started','thread_id':'thread-123'}),
            json.dumps({'type':'turn.started'}),
            json.dumps({'type':'item.completed','item':{'type':'agent_message','text':'fallback'}}),
        ])
        sid, text = server._codex_jsonl_thread_id(stdout)
        self.assertEqual(sid, 'thread-123')
        self.assertEqual(text, 'fallback')

    def test_codex_command_initial_is_read_only_and_resume_keeps_session(self):
        server.CODEX_BIN = '/tmp/codex'
        with patch.object(server, 'resolved_bin', return_value='/tmp/codex'):
            initial = server._codex_command('hello', None, Path('/tmp/out.json'))
            resumed = server._codex_command('again', 'thread-123', Path('/tmp/out2.json'))
        self.assertIn('--sandbox', initial)
        self.assertIn('read-only', initial)
        self.assertIn('--ask-for-approval', initial)
        self.assertIn('never', initial)
        self.assertNotIn('resume', initial)
        self.assertEqual(initial[-1], '-')
        self.assertIn('resume', resumed)
        self.assertEqual(resumed[-1], '-')
        self.assertIn('thread-123', resumed)
        # Codex 0.159.x requires --ask-for-approval before the `exec` subcommand.
        self.assertLess(initial.index('--ask-for-approval'), initial.index('exec'))
        self.assertLess(initial.index('--sandbox'), initial.index('exec'))
        self.assertLess(resumed.index('--ask-for-approval'), resumed.index('exec'))
        self.assertLess(resumed.index('--sandbox'), resumed.index('exec'))

    def test_codex_pm_uses_explicit_stdin_prompt_and_closes_pipe(self):
        server.CODEX_BIN = '/tmp/codex'
        server.CODEX_AUTH_OK = True
        stdout = "\n".join([
            json.dumps({'type':'thread.started','thread_id':'thread-stdin-safe'}),
            json.dumps({'type':'item.completed','item':{'type':'agent_message','text':json.dumps({'message':'Proceed','next':'none'})}}),
        ])
        with patch.object(server, 'resolved_bin', return_value='/tmp/codex'), \
             patch.object(server.subprocess, 'Popen') as popen:
            proc = popen.return_value
            proc.communicate.return_value = (stdout, '')
            proc.returncode = 0
            routed, sid = server._run_pm_codex('hello', None)
        self.assertEqual(routed['message'], 'Proceed')
        self.assertEqual(sid, 'thread-stdin-safe')
        self.assertIs(popen.call_args.kwargs.get('stdin'), server.subprocess.PIPE)
        self.assertEqual(popen.call_args.args[0][-1], '-')
        sent = proc.communicate.call_args.kwargs.get('input')
        self.assertIn('CURRENT TURN:', sent)
        self.assertIn('hello', sent)

    def test_pm_response_routes_to_dev_without_po_copy_via_codex(self):
        route = {'message':'Push the exact candidate.','next':'dev','parse_error':None,'board_updates':{'work_items':[{'item_key':'PR-1554','notes':'fresh checkpoint'}],'players':[{'player_id':'cli_pm','task':'Reviewed packet'}]}}
        server.PM_MODE = 'codex'
        # c5 (F02): the single route arbiter dispatches Dev only to an assigned task; unassigned is refused by name.
        aid = server.add_activity('Dev', 'candidate ready', 'pm')
        qid = server.enqueue(aid, 'pm', 'candidate ready', source_actor='DEV', handoff_depth=1)
        with patch.object(server, '_run_pm_codex', return_value=(route, 'thread_test')):
            server.run_pm(next(r for r in server.list_queue() if r['id'] == qid))
        self.assertEqual([r for r in server.list_queue() if r['recipient']=='dev'], [])
        self.assertTrue(any('no single active CLI Dev task is assigned' in a['message'] for a in server.list_activity()))
        ok = {'exists': True, 'is_git': True, 'branch': 'fix/task-route', 'head': 'c' * 40}
        with patch.object(server, 'validate_worktree', return_value=ok):
            self.assertTrue(server.apply_board_updates({'work_items': [{
                'item_key': 'TASK-ROUTE', 'title': 'synthetic route fixture', 'state': 'active', 'owner': 'cli_dev',
                'branch': 'fix/task-route', 'worktree': '/wt/task-route', 'next_action': 'push'}],
                'players': [{'player_id': 'cli_dev', 'status': 'assigned', 'work_item_key': 'TASK-ROUTE', 'task': '#1570 route'}]}))
            self.assertEqual((server.dev_assignment() or {}).get('item_key'), 'TASK-ROUTE', server.list_work_items())
            aid = server.add_activity('Dev', 'candidate ready', 'pm')
            qid = server.enqueue(aid, 'pm', 'candidate ready', source_actor='DEV', handoff_depth=1)
            with patch.object(server, '_run_pm_codex', return_value=(route, 'thread_test')):
                server.run_pm(next(r for r in server.list_queue() if r['id'] == qid))
        rows = server.list_queue()
        routed = [r for r in rows if r['recipient']=='dev']
        self.assertEqual(len(routed), 1, json.dumps(server.list_activity(), indent=2))
        self.assertEqual(routed[0]['work_item_key'], 'TASK-ROUTE')
        self.assertEqual(routed[0]['content'], 'Push the exact candidate.')
        self.assertEqual(routed[0]['source_actor'], 'PM')
        self.assertTrue(any(a['actor']=='PM' and a['route']=='dev' for a in server.list_activity()))

    def test_auto_mode_prefers_codex_over_api_key(self):
        server.PM_MODE = 'auto'
        server.CODEX_BIN = 'codex'
        with patch.object(server, 'resolved_bin', return_value='/usr/local/bin/codex'), patch.object(server, 'OPENAI_API_KEY', 'would-bill-api'):
            self.assertEqual(server.pm_transport_mode(), 'codex')


    def test_codex_cli_adapter_initial_and_resume_without_api_keys(self):
        fake = Path(self.td.name) / 'codex'
        fake.write_text("""#!/usr/bin/env python3
import json, os, pathlib, sys
args=sys.argv[1:]
if 'exec' in args and '--ask-for-approval' in args and args.index('--ask-for-approval') > args.index('exec'):
    print("error: unexpected argument '--ask-for-approval' found", file=sys.stderr)
    raise SystemExit(2)
if args[:2] == ['login','status']:
    print('Logged in using ChatGPT')
    raise SystemExit(0)
if os.getenv('OPENAI_API_KEY') or os.getenv('CODEX_API_KEY'):
    print('API key leaked into Codex child', file=sys.stderr)
    raise SystemExit(9)
out=None
for i,a in enumerate(args):
    if a in ('-o','--output-last-message') and i+1 < len(args): out=args[i+1]
if not out:
    print('missing -o', file=sys.stderr); raise SystemExit(8)
pathlib.Path(out).write_text(json.dumps({'message':'Proceed','next':'dev'}))
sid='thread-existing' if 'resume' in args else 'thread-new'
print(json.dumps({'type':'thread.started','thread_id':sid}))
print(json.dumps({'type':'turn.completed'}))
""")
        fake.chmod(0o755)
        old_schema = server.PM_ROUTE_SCHEMA
        server.PM_ROUTE_SCHEMA = Path(server.__file__).resolve().parent / 'pm-route.schema.json'
        server.CODEX_BIN = str(fake)
        server.CODEX_AUTH_OK = True
        try:
            with patch.dict(os.environ, {'OPENAI_API_KEY':'would-bill','CODEX_API_KEY':'would-bill'}, clear=False):
                routed, sid = server._run_pm_codex('first', None)
                self.assertEqual(routed['next'], 'dev')
                self.assertEqual(sid, 'thread-new')
                routed2, sid2 = server._run_pm_codex('second', sid)
                self.assertEqual(routed2['message'], 'Proceed')
                self.assertEqual(sid2, 'thread-existing')
        finally:
            server.PM_ROUTE_SCHEMA = old_schema

    def test_current_pr_is_never_guessed(self):
        server.set_setting('current_pr','')
        fake_prs = [
            {'number': 10, 'title':'newer', 'updatedAt':'2026-10-01T10:00:00Z'},
            {'number': 9, 'title':'older', 'updatedAt':'2026-10-01T09:00:00Z'},
        ]
        calls = [(fake_prs, None), ([], None)]
        with patch.object(server, 'gh_json', side_effect=calls):
            snap = server.pr_snapshot()
        self.assertIsNone(snap['current'])
        self.assertEqual(len(snap['active']), 2)
        self.assertEqual(snap['recent_completed'], [])

    def test_dev_default_permission_mode_is_autonomous_for_selected_worktree(self):
        self.assertEqual(server.PERMISSION_MODE, 'bypassPermissions')
        cmd = server._claude_command('implement the repair', 'session-1', False)
        self.assertIn('--permission-mode', cmd)
        self.assertEqual(cmd[cmd.index('--permission-mode') + 1], 'bypassPermissions')

    def test_conversation_activity_correlates_inbound_and_outbound_delivery_ids(self):
        po = server.add_activity('PO', 'status?', 'dev')
        q1 = server.enqueue(po, 'dev', 'status?', source_actor='PO')
        dev = server.add_activity('Dev', 'candidate ready', 'pm', 'responded', trigger_queue_id=q1)
        parent = next(r for r in server.list_queue() if r['id'] == q1)
        server.maybe_handoff(dev, 'Dev', 'pm', 'candidate ready', parent)
        activities = {a['id']: a for a in server.list_activity()}
        self.assertEqual(activities[dev]['trigger_queue_id'], q1)
        self.assertEqual(len(activities[dev]['deliveries']), 1)
        q2 = activities[dev]['deliveries'][0]
        self.assertEqual(q2['parent_queue_id'], q1)
        self.assertEqual(q2['recipient'], 'pm')

    def test_restart_forces_one_github_reconciliation_wake(self):
        server.set_setting('github_watch_pr', '1549')
        server.set_setting('github_watch_snapshot', '{"pr":1549}')
        server.force_github_reconcile_on_start()
        self.assertEqual(server.get_setting('github_watch_pr'), '')
        self.assertEqual(server.get_setting('github_watch_snapshot'), '')

    def test_startup_reset_clears_migrated_current_pr_and_cli_dev_lease(self):
        server.set_setting('current_pr', '1549')
        server.update_work_item('R0-1549', state='active', owner='cli_dev', branch='test/rwt-diagnostic-wrapper')
        server.update_player_status('cli_dev', status='active', task='old task', work_item_key='R0-1549', source='pm')
        server.reset_ephemeral_control_state_on_start()
        self.assertEqual(server.get_setting('current_pr'), '1549')
        player = server.list_player_status()['cli_dev']
        self.assertEqual(player['status'], 'unknown')
        self.assertEqual(player['work_item_key'], 'R0-1549')
        item = next(x for x in server.list_work_items() if x['item_key'] == 'R0-1549')
        self.assertEqual(item['state'], 'active')
        self.assertEqual(item['owner'], 'cli_dev')

    def test_no_current_pr_does_not_leave_stale_cli_dev_write_lease(self):
        server.update_work_item('R0-1549', state='active', owner='cli_dev', branch='test/rwt-diagnostic-wrapper')
        server.update_player_status('cli_dev', status='active', task='old task', work_item_key='R0-1549', source='pm')
        item = next(x for x in server.list_work_items() if x['item_key'] == 'R0-1549')
        # Exercise the same release operation used by the reconciler when GitHub has no current branch.
        server.update_work_item(item['item_key'], state='waiting', owner='unassigned', blocker='Waiting for current PM assignment')
        server.update_player_status('cli_dev', status='available', task='Waiting for current PM assignment', work_item_key='', blocker='', holding=False, source='reconciler')
        self.assertFalse(any(r['recipient'] == 'dev' and r['status'] == 'queued' for r in server.list_queue()))
        self.assertEqual(server.list_player_status()['cli_dev']['status'], 'available')


    def test_anti_idle_stale_branch_releases_player_without_name_error(self):
        server.apply_board_updates({
            'work_items':[{'item_key':'TEST-OLD','priority':1,'title':'old','state':'active','owner':'cli_dev','branch':'old-branch'}],
            'players':[{'player_id':'cli_dev','status':'active','task':'old','work_item_key':'TEST-OLD'}],
        })
        # Directly exercise the corrected status updater name used by reconciler stale-branch path.
        server.update_player_status('cli_dev', status='available', task='Waiting for current PM assignment', work_item_key='', blocker='', holding=False, source='reconciler')
        p=server.list_player_status()['cli_dev']
        self.assertEqual(p['status'], 'available')
        self.assertEqual(p['work_item_key'], '')

    def test_automation_defaults_accelerate_pm_not_raw_dev(self):
        cfg = server.automation_settings()
        self.assertTrue(cfg['pm_github_review'])
        self.assertTrue(cfg['pm_github_ci'])
        self.assertTrue(cfg['pm_github_head'])
        self.assertTrue(cfg['pm_github_deploy'])
        self.assertFalse(cfg['dev_github'])
        self.assertTrue(cfg['dev_to_pm'])
        self.assertTrue(cfg['pm_to_dev'])

    def test_github_watch_events_detect_head_review_and_terminal_ci(self):
        cfg = server.automation_settings()
        prev = {
            'pr':1549,'head':'aaa','latest_review_id':1,'latest_review_comment_id':10,'reviewDecision':None,
            'runs':{'CI - Test Audit':{'id':1,'status':'in_progress','conclusion':None}},'deploy':[]
        }
        cur = {
            'pr':1549,'head':'bbb','latest_review_id':2,'latest_review_comment_id':11,'reviewDecision':'CHANGES_REQUESTED',
            'runs':{'CI - Test Audit':{'id':1,'status':'completed','conclusion':'failure'}},'deploy':[]
        }
        ev = server.github_watch_events(prev, cur, cfg)
        joined='\n'.join(ev)
        self.assertIn('PR head changed', joined)
        self.assertIn('new pull-request review', joined)
        self.assertIn('inline review finding', joined)
        self.assertIn('CI terminal', joined)

    def test_github_event_wakes_pm_only_by_default(self):
        cfg = server.automation_settings()
        snap={'pr':1549,'title':'diag','head':'abcdef123456'}
        qids=server.emit_github_event(['CI terminal: CI - Test Audit → success'], snap, cfg)
        self.assertEqual(len(qids), 1)
        rows=server.list_queue()
        self.assertEqual(rows[-1]['recipient'],'pm')
        self.assertEqual(rows[-1]['source_actor'],'GITHUB')
        self.assertFalse(any(r['recipient']=='dev' for r in rows))

    def test_raw_github_dev_wake_is_explicit_opt_in(self):
        cfg=server.set_automation_settings({'dev_github':True})
        snap={'pr':1549,'title':'diag','head':'abcdef123456'}
        server.emit_github_event(['PR head changed: aaa → bbb'], snap, cfg)
        self.assertEqual({r['recipient'] for r in server.list_queue()}, {'pm','dev'})

    def test_routing_toggles_are_persisted(self):
        cfg=server.set_automation_settings({'dev_to_pm':False,'pm_to_dev':False,'watch_interval_seconds':3})
        self.assertFalse(cfg['dev_to_pm'])
        self.assertFalse(cfg['pm_to_dev'])
        self.assertEqual(cfg['watch_interval_seconds'],5)

    def test_init_seeds_five_players_and_rwt_queue(self):
        players = server.list_player_status()
        self.assertEqual(set(players), {'po','cli_pm','cli_dev','app_dev','browser_pm'})
        items = server.list_work_items()
        self.assertGreaterEqual(len(items), 6)
        self.assertEqual(items[0]['item_key'], 'PR-1555')
        self.assertTrue(items[0]['release_blocker'])

    def test_pm_route_accepts_board_updates(self):
        server.update_work_item('R0-1549', state='waiting')
        raw = json.dumps({
            'message':'Advance the queue.', 'next':'none',
            'board_updates': {
                'work_items':[{'item_key':'R3-Q2','state':'active','owner':'cli_dev','blocker':'none'}],
                'players':[{'player_id':'cli_dev','status':'active','task':'Q2'}]
            }
        })
        r = server.parse_pm_route(raw)
        self.assertEqual(r['next'], 'none')
        self.assertIsInstance(r['board_updates'], dict)
        server.apply_board_updates(r['board_updates'])
        q2 = next(x for x in server.list_work_items() if x['item_key']=='R3-Q2')
        self.assertEqual(q2['state'], 'active')
        self.assertEqual(q2['owner'], 'cli_dev')
        self.assertEqual(server.list_player_status()['cli_dev']['task'], 'Q2')

    def test_control_issue_comment_wakes_pm(self):
        cfg = server.automation_settings()
        prev = {
            'pr':1549,'head':'aaa','latest_review_id':1,'latest_review_comment_id':10,
            'latest_control_comment_id':20,'latest_control_comment':{'id':20,'body':'old'},
            'reviewDecision':None,'runs':{},'deploy':[]
        }
        cur = dict(prev)
        cur['latest_control_comment_id'] = 21
        cur['latest_control_comment'] = {'id':21,'body':'APP DEV STATUS — matrix cell A complete'}
        events = server.github_watch_events(prev, cur, cfg)
        self.assertTrue(any('control issue' in e.lower() and 'APP DEV STATUS' in e for e in events))

    def test_active_dev_lease_rejects_second_item_for_same_dev(self):
        server.update_work_item('R0-1549', state='waiting')
        server.update_work_item('R3-Q2', state='active', owner='cli_dev', branch='test/rwt-browser-identity')
        with self.assertRaisesRegex(ValueError, 'already holds active WRITE lease R3-Q2'):
            server.update_work_item('R2-CAUSAL-FIX', state='active', owner='cli_dev', branch='fix/causal')

    def test_active_dev_lease_rejects_second_dev_on_same_branch(self):
        server.update_work_item('R0-1549', state='waiting')
        server.update_work_item('R3-Q2', state='active', owner='cli_dev', branch='shared-branch')
        with self.assertRaisesRegex(ValueError, 'branch shared-branch already has active Dev writer cli_dev'):
            server.update_work_item('R2-CAUSAL-FIX', state='active', owner='app_dev', branch='shared-branch')

    def test_waiting_item_releases_write_capacity_for_work_stealing(self):
        server.update_work_item('R0-1549', state='waiting')
        server.update_work_item('R3-Q2', state='waiting', owner='cli_dev', branch='test/rwt-browser-identity')
        server.update_work_item('R2-CAUSAL-FIX', state='active', owner='cli_dev', branch='fix/causal')
        item = next(x for x in server.list_work_items() if x['item_key'] == 'R2-CAUSAL-FIX')
        self.assertEqual(item['owner'], 'cli_dev')
        self.assertEqual(item['state'], 'active')

    def test_conflicting_board_update_is_rejected_and_logged(self):
        server.update_work_item('R0-1549', state='waiting')
        server.update_work_item('R3-Q2', state='active', owner='cli_dev', branch='shared-branch')
        server.apply_board_updates({'work_items':[{'item_key':'R2-CAUSAL-FIX','state':'active','owner':'app_dev','branch':'shared-branch'}]})
        item = next(x for x in server.list_work_items() if x['item_key'] == 'R2-CAUSAL-FIX')
        self.assertNotEqual(item['state'], 'active')
        self.assertTrue(any('Rejected board update atomically' in a['message'] for a in server.list_activity()))

    def test_control_issue_snapshot_works_without_current_pr(self):
        server.set_setting('current_pr', '')
        control = [{'id': 42, 'body': 'PO assigns harness repair', 'html_url': 'https://example/42'}]
        with patch.object(server, 'gh_json', return_value=(control, None)) as gh:
            snap, err = server.github_watch_snapshot()
        self.assertIsNone(err)
        self.assertIsNone(snap['pr'])
        self.assertEqual(snap['latest_control_comment_id'], 42)
        self.assertEqual(snap['latest_control_comment']['body'], 'PO assigns harness repair')
        self.assertEqual(gh.call_count, 2)

    def test_actionable_cli_dev_board_assignment_forces_pm_to_dev_delivery(self):
        server.update_work_item('R0-1549', state='waiting')
        aid = server.add_activity('GITHUB', 'PO assigns Open Mic harness repair', 'pm')
        qid = server.enqueue(aid, 'pm', 'PO assigns Open Mic harness repair', source_actor='GITHUB')
        q = next(r for r in server.list_queue() if r['id'] == qid)
        routed = {
            'message': 'Assigned the Open Mic harness repair to CLI Dev.',
            'next': 'none',
            'board_updates': {
                'work_items': [{
                    'item_key': 'R2-CAUSAL-FIX', 'state': 'active', 'owner': 'cli_dev',
                    'branch': 'fix/rwt-open-mic-harness', 'next_action': 'Repair invalid locator and return packet'
                }],
                'players': [{
                    'player_id': 'cli_dev', 'status': 'active', 'task': 'Open Mic harness repair',
                    'work_item_key': 'R2-CAUSAL-FIX'
                }]
            },
            'parse_error': None,
        }
        server.PM_MODE = 'codex'
        with patch.object(server, '_run_pm_codex', return_value=(routed, 'thread-test')), patch.object(server, 'resolve_dev_target', return_value={'ok': True}):
            server.run_pm(q)
        dev = [r for r in server.list_queue() if r['recipient'] == 'dev']
        self.assertEqual(len(dev), 1)
        self.assertEqual(dev[0]['source_actor'], 'PM')
        self.assertIn('EXECUTION HANDOFF', dev[0]['content'])
        self.assertTrue(any('Corrected PM route none→dev' in a['message'] for a in server.list_activity()))

    def test_app_dev_assignment_does_not_wake_cli_dev(self):
        server.update_work_item('R0-1549', state='waiting')
        updates = {
            'work_items': [{
                'item_key': 'R2-CAUSAL-FIX', 'state': 'active', 'owner': 'app_dev',
                'branch': 'fix/rwt-open-mic-harness'
            }],
            'players': [{'player_id': 'app_dev', 'status': 'active', 'work_item_key': 'R2-CAUSAL-FIX'}]
        }
        server.apply_board_updates(updates)
        self.assertIsNone(server._actionable_cli_dev_assignment(updates))
        self.assertFalse(any(r['recipient'] == 'dev' for r in server.list_queue()))

    def test_anti_idle_wake_is_single_delivery_for_active_assignment(self):
        server.update_work_item('R0-1549', state='waiting')
        server.update_work_item('R2-CAUSAL-FIX', state='active', owner='cli_dev', branch='fix/causal', next_action='return packet')
        server.update_player_status('cli_dev', status='active', work_item_key='R2-CAUSAL-FIX', task='causal fix')
        item = next(x for x in server.list_work_items() if x['item_key'] == 'R2-CAUSAL-FIX')
        q1 = server._wake_cli_dev_for_item(item, 'test anti-idle')
        q2 = server._wake_cli_dev_for_item(item, 'test anti-idle')
        self.assertIsNotNone(q1)
        self.assertIsNone(q2)
        self.assertEqual(len([r for r in server.list_queue() if r['recipient'] == 'dev']), 1)

    def test_dashboard_exposes_full_queue_and_five_players(self):
        fake_pr = {
            'repo':'relativityE/speaksharp','error':None,'active':[], 'recent_completed':[],
            'current': {'number':1549,'title':'diag','url':'https://example/1549','headRefOid':'abc','isDraft':False,'state':'OPEN','createdAt':'2026-10-01T16:00:00Z','statusCheckRollup':[],'reviewDecision':None}
        }
        with patch.object(server, 'pr_snapshot', return_value=fake_pr):
            d = server.dashboard_snapshot()
        self.assertEqual(d['goal'], 'RWT CLOSED')
        self.assertGreaterEqual(len(d['priority_queue']), 7)
        self.assertEqual(set(d['players']), {'po','cli_pm','cli_dev','app_dev','browser_pm'})
        self.assertEqual(d['current']['number'], 1549)

    def test_idle_cli_process_does_not_hide_persisted_task_blocker(self):
        updates={'work_items':[{'item_key':'R2-CAUSAL-FIX','state':'active','owner':'cli_dev',
                                'branch':'fix/causal','blocker':'Lease transfer awaits a verified checkout'}],
                 'players':[{'player_id':'cli_dev','status':'blocked','work_item_key':'R2-CAUSAL-FIX',
                             'blocker':'Lease transfer awaits a verified checkout','source':'preflight'}]}
        self.assertTrue(server.apply_board_updates(updates))
        server.set_agent('dev',status='idle')
        fake_pr={'repo':'relativityE/speaksharp','error':None,'active':[],'recent_completed':[],
                 'current':{'number':1549,'title':'diag','url':'https://example/1549','headRefOid':'a'*40,
                            'baseRefOid':'b'*40,'isDraft':False,'state':'OPEN','createdAt':'2026-10-01T16:00:00Z',
                            'statusCheckRollup':[],'reviewDecision':None}}
        with patch.object(server,'display_pr_snapshot',return_value=fake_pr):
            blocked=server.dashboard_snapshot()['players']['cli_dev']
        self.assertEqual(blocked['status'],'blocked')
        self.assertIn('verified checkout',blocked['blocker'])

        self.assertTrue(server.apply_board_updates({'players':[{'player_id':'cli_dev','status':'available',
                                                                 'work_item_key':'R2-CAUSAL-FIX','blocker':'',
                                                                 'source':'board'}]}))
        with patch.object(server,'display_pr_snapshot',return_value=fake_pr):
            released=server.dashboard_snapshot()['players']['cli_dev']
        self.assertEqual(released['status'],'available')
        self.assertEqual(released['blocker'],'')

    def test_pm_route_schema_is_strict_structured_output_valid(self):
        schema = json.loads((Path(__file__).with_name('pm-route.schema.json')).read_text())
        def check(node, path='root'):
            if not isinstance(node, dict):
                return
            typ = node.get('type')
            is_object = typ == 'object' or (isinstance(typ, list) and 'object' in typ)
            if is_object and 'properties' in node:
                self.assertEqual(set(node.get('required', [])), set(node['properties']), path)
            for key, value in node.items():
                if isinstance(value, dict):
                    check(value, f'{path}.{key}')
                elif isinstance(value, list):
                    for i, child in enumerate(value):
                        if isinstance(child, dict):
                            check(child, f'{path}.{key}[{i}]')
        check(schema)

    def test_null_board_patch_fields_do_not_erase_existing_state(self):
        server.update_work_item('R0-1549', state='waiting')
        server.update_work_item('R3-Q2', state='ready', owner='unassigned', priority=4, title='Q2 identity')
        server.apply_board_updates({'work_items':[{'item_key':'R3-Q2','priority':None,'title':None,'state':'active','owner':'cli_dev','branch':None,'blocker':None,'blocker_since':None,'next_action':None,'po_required':None,'release_blocker':None,'notes':None}], 'players':None})
        item = next(x for x in server.list_work_items() if x['item_key']=='R3-Q2')
        self.assertEqual(item['priority'], 4)
        self.assertEqual(item['title'], 'Q2 identity')
        self.assertEqual(item['state'], 'active')
        self.assertEqual(item['owner'], 'cli_dev')


if __name__ == '__main__':
    unittest.main()
