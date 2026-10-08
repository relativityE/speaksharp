"""c5 Package 2a regressions: F10 (one PM route contract for every transport) and F15 (local HTTP
control boundary).

Isolated: temp state DB per test and a fake GitHub/PM process. Handler tests drive `server.H` with
in-memory streams (no socket). Only `LoopbackControlTests` binds 127.0.0.1 on an ephemeral port; it
needs the shared local bind lease.
"""
import email.message
import io
import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import Mock, patch

import unittest

import server
import test_regressions as reg
from test_deadlock5 import HEAD, BASE, KEY, board

PORT = 4317


def route(**kw):
    r = {'message': 'directive', 'next': 'none', 'publish': True, 'pm_actions': [], 'board_updates': board(KEY),
         'review_handoffs': [], 'ask_dispositions': [], 'dev_depends_on_actions': True}
    r.update(kw)
    return r


def handoff(owner='app_dev'):
    return {'pr_number': 1570, 'head': HEAD, 'reviewed_ref': 'review 4212726964', 'disposition': 'fix_now',
            'owner': owner, 'work_item_key': None, 'instruction': 'Fix the P1 binding'}


class RouteContractTests(unittest.TestCase):
    """F10: every transport passes the whole route and is held to the same schema."""
    setUp = reg.RegressionTests.setUp
    tearDown = reg.RegressionTests.tearDown

    def test_default_codex_schema_omits_unsupported_unique_items_and_host_normalizes_paths(self):
        schema_text = server.PM_ROUTE_SCHEMA.read_text()
        self.assertNotIn('"uniqueItems"', schema_text)
        self.assertEqual(json.loads(server._owned_paths_json(['src/owned.md', 'src/owned.md'])),
                         ['src/owned.md'])
        with self.assertRaises(ValueError):
            server._owned_paths_json(['../outside.md'])

    def test_default_schema_accepts_typed_read_only_task_delivery(self):
        delivery = {
            'action_id': 'schema-probe:checkpoint',
            'task_id': 'ORCH-C12-STAGE-PROBE',
            'recipient': 'cli_dev',
            'action': 'checkpoint',
            'target_head': HEAD,
            'target_tree': '1' * 40,
            'instruction': 'Report the assigned checkout tuple without changing state.',
        }
        parsed = server.parse_pm_route(json.dumps(route(next='dev', publish=False,
                                                         task_deliveries=[delivery],
                                                         dev_action_id='schema-probe:checkpoint')))
        self.assertIsNone(parsed['parse_error'])
        self.assertEqual(parsed['task_deliveries'], [delivery])
        self.assertEqual(parsed['next'], 'dev')

    def command_route(self, obj):
        process = Mock()
        process.communicate.return_value = (json.dumps(obj), '')
        process.returncode = 0
        with patch.object(server, 'PM_COMMAND', 'fixture-pm'), patch.object(server.subprocess, 'Popen', return_value=process):
            return server._run_pm_command('turn', None)

    def test_command_adapter_keeps_structured_fields(self):
        # Inverse of review probe 12: c4 dropped all three fields.
        disp = {'ask_id': 7, 'disposition': 'hold', 'owner': 'cli_dev', 'dependency': 'refresh', 'evidence': 'HOLD',
                'release_event': 'refresh complete', 'review_handoff_index': None}
        routed, sid = self.command_route(dict(route(review_handoffs=[handoff()], ask_dispositions=[disp],
                                                    dev_depends_on_actions=False), session_id='pm-1'))
        self.assertIsNone(routed['parse_error'])
        self.assertEqual(routed['review_handoffs'], [handoff()])
        self.assertEqual(routed['ask_dispositions'], [disp])
        self.assertIs(routed['dev_depends_on_actions'], False)
        self.assertEqual(sid, 'pm-1')

    def test_command_and_codex_modes_parse_identically(self):
        obj = route(review_handoffs=[handoff()], next='dev', publish=False)
        via_command, _ = self.command_route(dict(obj))
        self.assertEqual(via_command, server.parse_pm_route(json.dumps(obj)))

    def test_present_fields_are_never_coerced(self):
        for bad, needle in (({'dev_depends_on_actions': 'false'}, 'dev_depends_on_actions'),
                            ({'publish': 'false'}, 'publish'),
                            ({'review_handoffs': {'pr_number': 1570}}, 'review_handoffs'),
                            ({'pm_actions': [{'kind': 'merge_pr', 'head': HEAD, 'base': BASE}]}, 'pm_actions[0].kind'),
                            ({'pm_actions': [{'kind': 'mark_ready', 'head': 'abc', 'base': BASE}]}, 'pm_actions[0].head'),
                            ({'review_handoffs': [dict(handoff(), pr_number='1570')]}, 'review_handoffs[0].pr_number'),
                            ({'next': 'DEV'}, 'route.next'),
                            ({'message': '   '}, 'route.message'),
                            ({'surprise': True}, 'route.surprise')):
            with self.subTest(bad=bad):
                parsed = server.parse_pm_route(json.dumps(route(**bad)))
                self.assertIsNotNone(parsed['parse_error'])
                self.assertIn(needle, parsed['parse_error'])
                self.assertEqual(parsed['next'], 'po')  # fail safe: nothing routes to Dev

    def test_omitted_fields_take_documented_defaults(self):
        parsed = server.parse_pm_route(json.dumps({'message': 'Pin', 'next': 'dev'}))
        self.assertIsNone(parsed['parse_error'])
        self.assertEqual((parsed['publish'], parsed['pm_actions'], parsed['ask_dispositions'], parsed['review_handoffs'],
                          parsed['dev_depends_on_actions'], parsed['board_updates']), (True, [], [], [], True, None))
        self.assertIn('route.message is required', server.parse_pm_route(json.dumps({'next': 'none'}))['parse_error'])

    def test_malformed_command_route_dispatches_nothing(self):
        aid = server.add_activity('GITHUB', 'packet', 'pm')
        qid = server.enqueue(aid, 'pm', 'packet', source_actor='GITHUB')
        server.PM_MODE = 'command'
        bad = route(next='dev', pm_actions=[{'kind': 'mark_ready', 'head': HEAD, 'base': BASE, 'pr_number': '1570'}])
        process = Mock()
        process.communicate.return_value = (json.dumps(bad), '')
        process.returncode = 0
        with patch.object(server, 'PM_COMMAND', 'fixture-pm'), patch.object(server.subprocess, 'Popen', return_value=process), \
             patch.object(server, 'compact_pr_context', return_value='fixture'), \
             patch.object(server, 'execute_pm_actions') as executor:
            server.run_pm(next(r for r in server.list_queue() if r['id'] == qid))
        executor.assert_not_called()
        self.assertEqual([r for r in server.list_queue() if r['recipient'] == 'dev'], [])
        self.assertTrue(any('route failed the route schema' in a['message'] and 'pm_actions[0].pr_number' in a['message']
                            for a in server.list_activity()))
        recovery = [r for r in server.list_queue() if r['recipient'] == 'pm' and r['status'] == 'queued']
        self.assertEqual(len(recovery), 1)  # one bounded recovery, naming the failure
        self.assertIn('pm_actions[0].pr_number', recovery[0]['content'])


class ControlBoundaryTests(unittest.TestCase):
    """F15 at the handler, without a socket."""
    setUp = reg.RegressionTests.setUp
    tearDown = reg.RegressionTests.tearDown

    def call(self, method, path, headers=None, body=b''):
        h = server.H.__new__(server.H)
        h.server = Mock(server_address=('127.0.0.1', PORT))
        h.client_address = ('127.0.0.1', 50000)
        h.command, h.path, h.request_version = method, path, 'HTTP/1.1'
        h.requestline = f'{method} {path} HTTP/1.1'
        msg = email.message.Message()
        for k, v in {'Host': f'127.0.0.1:{PORT}', 'Content-Length': str(len(body)), **(headers or {})}.items():
            if v is not None:
                msg[k] = v
        h.headers = msg
        h.rfile, h.wfile = io.BytesIO(body), io.BytesIO()
        getattr(h, 'do_' + method)()
        raw = h.wfile.getvalue()
        head, _, payload = raw.partition(b'\r\n\r\n')
        return int(head.split()[1]), payload

    def good(self, **extra):
        return {'Content-Type': 'application/json', server.CONTROL_TOKEN_HEADER: server.CONTROL_TOKEN,
                'Origin': f'http://127.0.0.1:{PORT}', **extra}

    def post(self, path, payload, headers):
        return self.call('POST', path, headers, json.dumps(payload).encode())

    def test_foreign_or_unauthenticated_mutations_are_refused_without_state_change(self):
        server.update_work_item('PR-1559', state='waiting')
        before = (server.list_queue(500), server.list_activity(), server.list_agents(),
                  server.list_work_items(500), server.list_player_status(), server.automation_settings(),
                  server.get_setting('current_pr'))
        cases = {
            'foreign origin': self.good(Origin='https://evil.example'),
            'text/plain simple request': self.good(**{'Content-Type': 'text/plain'}),
            'no token': self.good(**{server.CONTROL_TOKEN_HEADER: None}),
            'wrong token': self.good(**{server.CONTROL_TOKEN_HEADER: 'x' * 43}),
            'cross-site fetch metadata': self.good(**{'Sec-Fetch-Site': 'cross-site'}),
            'rebound host': self.good(Host=f'evil.example:{PORT}'),
        }
        for label, headers in cases.items():
            for path, payload in (('/api/send', {'actor': 'PO', 'route': 'pm', 'message': 'inject'}),
                                  ('/api/set-current-pr', {'pr_number': 1559}),
                                  ('/api/automation', {'auto_pm_to_dev': True}),
                                  ('/api/work-item', {'item_key': 'PR-1559', 'state': 'active'}),
                                  ('/api/player-status', {'player_id': 'cli_dev', 'status': 'active'}),
                                  ('/api/pause', {'agent': 'dev', 'paused': True}),
                                  ('/api/kill', {'agent': 'dev'}), ('/api/reset-dev', {}),
                                  ('/api/reset-pm', {}), ('/api/retry-delivery', {'id': 1})):
                with self.subTest(case=label, path=path):
                    code, body = self.post(path, payload, headers)
                    self.assertIn(code, (403, 415))
                    self.assertIn('error', json.loads(body))
        self.assertEqual((server.list_queue(500), server.list_activity(), server.list_agents(),
                          server.list_work_items(500), server.list_player_status(), server.automation_settings(),
                          server.get_setting('current_pr')), before)

    def test_same_origin_token_request_is_accepted(self):
        with patch.object(server, 'transport_status', return_value={'pm_configured': True}):
            code, body = self.post('/api/send', {'actor': 'PO', 'route': 'pm', 'message': 'hello'}, self.good())
        self.assertEqual(code, 202, body)
        self.assertEqual([r['recipient'] for r in server.list_queue()], ['pm'])
        # A non-browser adapter sends no Origin at all; the token still authorizes it.
        code, _ = self.post('/api/pause', {'agent': 'dev', 'paused': True}, self.good(Origin=None))
        self.assertEqual(code, 200)

    def test_reads_stay_open_and_the_page_carries_the_token(self):
        with patch.object(server, 'pr_snapshot', return_value={'current': None, 'active': [], 'error': None}):
            code, page = self.call('GET', '/')
            self.assertEqual(code, 200)
            self.assertIn(server.CONTROL_TOKEN.encode(), page)
            self.assertNotIn(server.TOKEN_PLACEHOLDER, page)
            self.assertEqual(self.call('GET', '/api/live')[0], 200)
            # DNS rebinding: a foreign Host can read neither the page (token) nor the API.
            self.assertEqual(self.call('GET', '/', {'Host': f'evil.example:{PORT}'})[0], 403)
            self.assertEqual(self.call('GET', '/api/live', {'Host': f'evil.example:{PORT}'})[0], 403)


class LoopbackControlTests(unittest.TestCase):
    """F15 over a real loopback socket. NEEDS THE LOCAL BIND LEASE."""
    setUp = reg.RegressionTests.setUp
    tearDown = reg.RegressionTests.tearDown

    def test_loopback_refuses_foreign_simple_post_and_accepts_the_page_token(self):
        http = ThreadingHTTPServer(('127.0.0.1', 0), server.H)
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(lambda: (http.shutdown(), http.server_close(), thread.join(timeout=3)))
        origin = f'http://127.0.0.1:{http.server_port}'

        def post(path, body, headers):
            req = urllib.request.Request(origin + path, data=json.dumps(body).encode(), headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=3) as r:
                    return r.status
            except urllib.error.HTTPError as e:
                return e.code
        with patch.object(server, 'transport_status', return_value={'pm_configured': True}), \
             patch.object(server, 'pr_snapshot', return_value={'current': None, 'active': [], 'error': None}):
            foreign = post('/api/send', {'actor': 'PO', 'route': 'pm', 'message': 'inject'},
                           {'Content-Type': 'text/plain', 'Origin': 'https://evil.example'})
            self.assertEqual(foreign, 403)
            self.assertEqual(server.list_queue(), [])
            with urllib.request.urlopen(origin + '/', timeout=3) as r:
                page = r.read().decode()
            token = page.split("const CONTROL_TOKEN='", 1)[1].split("'", 1)[0]
            self.assertEqual(post('/api/send', {'actor': 'PO', 'route': 'pm', 'message': 'hello'},
                                  {'Content-Type': 'application/json', server.CONTROL_TOKEN_HEADER: token,
                                   'Origin': origin}), 202)
            self.assertEqual([r['recipient'] for r in server.list_queue()], ['pm'])
