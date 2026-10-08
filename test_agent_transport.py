import json
import os
import unittest
from unittest.mock import patch, Mock

import agent_transport as transport


SESSION = 'a076ba87-4ad9-48fa-bff9-4e71a1535b5b'


class CodexQueueTransportTests(unittest.TestCase):
    def route_env(self, route, extra=None):
        env = {'RWT_AGENT_ROUTES_JSON': json.dumps({'version': 1, 'routes': {'cli_dev': route}})}
        env.update(extra or {})
        return env

    def test_local_route_requires_explicit_full_session_identity(self):
        route = transport.configured_route('cli_dev', self.route_env({
            'provider': 'codex_app_server', 'session_id': SESSION}))
        self.assertEqual((route.actor_id, route.session_id, route.remote_url), ('cli_dev', SESSION, ''))
        with self.assertRaisesRegex(transport.RouteError, 'full Codex session UUID'):
            transport.configured_route('cli_dev', self.route_env({
                'provider': 'codex_app_server', 'session_id': '01a0f83f'}))

    def test_remote_route_requires_wss_and_an_auth_token_name_and_value(self):
        entry = {'provider': 'codex_app_server', 'session_id': SESSION,
                 'remote_url': 'wss://pm-host.example/ws', 'auth_token_env': 'RWT_PM_TOKEN'}
        with self.assertRaisesRegex(transport.RouteError, 'is unset'):
            transport.configured_route('cli_dev', self.route_env(entry))
        route = transport.configured_route('cli_dev', self.route_env(entry, {'RWT_PM_TOKEN': 'secret'}))
        self.assertEqual(route.remote_url, entry['remote_url'])
        self.assertNotIn('secret', ' '.join(transport.queue_command('codex', route, 'task')))
        with self.assertRaisesRegex(transport.RouteError, 'must use wss'):
            transport.configured_route('cli_dev', self.route_env({**entry, 'remote_url': 'ws://pm-host.example/ws'},
                                                                  {'RWT_PM_TOKEN': 'secret'}))

    def test_queue_invokes_existing_session_and_reports_acceptance_only(self):
        route = transport.configured_route('cli_dev', self.route_env({
            'provider': 'codex_app_server', 'session_id': SESSION}))
        proc = Mock(returncode=0, stdout='queued', stderr='')
        with patch.object(transport.subprocess, 'run', return_value=proc) as run:
            result = transport.queue_message('codex', route, 'task', env={})
        self.assertEqual(result['transport'], 'codex_app_server')
        self.assertTrue(result['accepted'])
        self.assertEqual(run.call_args.args[0], ['codex', 'queue', '--thread', SESSION, '--message', 'task'])
        self.assertEqual(run.call_args.kwargs['stdin'], transport.subprocess.DEVNULL)

    def test_unix_route_uses_socket_without_remote_token_flag(self):
        route = transport.configured_route('cli_dev', self.route_env({
            'provider': 'codex_app_server', 'session_id': SESSION, 'remote_url': 'unix:///tmp/codex.sock'}))
        self.assertEqual(transport.queue_command('codex', route, 'continue'),
                         ['codex', 'queue', '--thread', SESSION, '--message', 'continue',
                          '--remote', 'unix:///tmp/codex.sock'])

    def test_timeout_is_uncertain_and_never_claimed_as_rejected(self):
        route = transport.CodexRoute('cli_dev', SESSION)
        with patch.object(transport.subprocess, 'run', side_effect=transport.subprocess.TimeoutExpired('codex', 15)):
            with self.assertRaises(transport.QueueUncertain):
                transport.queue_message('codex', route, 'task', env={})

    def test_task_message_binds_action_actor_candidate_and_callback(self):
        message = transport.task_message(action_id='source-41:checkpoint', actor_id='cli_dev',
            task_id='PR-1570-P1', instruction='read and report', target_head='a' * 40,
            target_tree='b' * 40, callback_url='https://board.example/api/agent-task', callback_token='t' * 64)
        for value in ('source-41:checkpoint', 'Actor: cli_dev', 'PR-1570-P1', 'a' * 40,
                      'b' * 40, 'stage=receipt', 'stage=result', 'https://board.example/api/agent-task'):
            self.assertIn(value, message)
        self.assertIn('Authorization: Bearer ' + 't' * 64, message)


if __name__ == '__main__':
    unittest.main()
