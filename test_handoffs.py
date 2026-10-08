import base64
import hashlib
import io
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import server


def attachment(name, data=b'specification'):
    return {'name': name, 'data': 'data:application/octet-stream;base64,' + base64.b64encode(data).decode()}


class HandoffTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patches = [patch.object(server, 'HANDOFFS', Path(self.tmp.name) / 'handoffs'),
                        patch.object(server, 'DB', Path(self.tmp.name) / 'state.db')]
        for p in self.patches:
            p.start()
        server.init_db()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def test_original_names_and_checksum_manifest_in_separate_immutable_packets(self):
        a = server.save_files([attachment('SESSION_PAGE_SPEC.md')], '#1258', 'designer')
        b = server.save_files([attachment('SESSION_PAGE_SPEC.md', b'revised')], '1258', 'designer')
        c = server.save_files([attachment('SESSION_PAGE_SPEC.md')], '1570', 'designer')
        self.assertEqual(a[0][1].name, 'SESSION_PAGE_SPEC.md')
        self.assertIn('/handoffs/PR-1258/designer/', str(a[0][1]))
        self.assertNotEqual(a[0][1], b[0][1])
        self.assertIn('/handoffs/PR-1570/designer/', str(c[0][1]))
        self.assertEqual(a[0][1].read_bytes(), b'specification')
        manifest = json.loads(a[-1][1].read_text())
        self.assertEqual(manifest['files'][0]['sha256'], hashlib.sha256(b'specification').hexdigest())

    def test_zip_specs_are_readable_without_downloads_or_manual_extraction(self):
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, 'w') as z:
            z.writestr('handoff/SESSION_PAGE_SPEC.md', 'designer source')
        files = server.save_files([attachment('design.zip', payload.getvalue())], 1258, 'designer')
        extracted = next(path for name, path, size in files if name == 'unpacked/handoff/SESSION_PAGE_SPEC.md')
        self.assertEqual(extracted.read_text(), 'designer source')
        self.assertIn(str(extracted), server.compose_user_message('Read design', files))

    def test_zip_traversal_and_symlink_are_rejected_before_packet_creation(self):
        for name, link in [('../escape.md', False), ('/escape.md', False), ('link.md', True)]:
            with self.subTest(name=name):
                payload = io.BytesIO()
                with zipfile.ZipFile(payload, 'w') as z:
                    info = zipfile.ZipInfo(name)
                    if link:
                        info.create_system = 3
                        info.external_attr = 0o120777 << 16
                    z.writestr(info, 'unsafe')
                with self.assertRaises(ValueError):
                    server.save_files([attachment('design.zip', payload.getvalue())], 1258, 'designer')
                self.assertFalse(server.HANDOFFS.exists())

    def test_invalid_scope_duplicate_name_and_invalid_payload_do_not_publish_partial_files(self):
        cases = [([attachment('ok.md')], '../1258', 'designer'),
                 ([attachment('ok.md')], 1258, '../designer'),
                 ([attachment('ok.md'), attachment('ok.md')], 1258, 'designer'),
                 ([attachment('ok.md'), {'name': 'bad.md', 'data': 'not base64!'}], 1258, 'designer')]
        for files, scope, topic in cases:
            with self.subTest(scope=scope, topic=topic):
                with self.assertRaises(ValueError):
                    server.save_files(files, scope, topic)
                self.assertFalse(server.HANDOFFS.exists())

    def test_pm_http_delivery_includes_readable_files_and_manifest(self):
        http = ThreadingHTTPServer(('127.0.0.1', 0), server.H)
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        try:
            req = urllib.request.Request(f'http://127.0.0.1:{http.server_port}/api/send',
                data=json.dumps({'actor': 'PO', 'route': 'pm', 'message': 'Read these specs',
                                 'handoff_pr': 1258, 'handoff_topic': 'designer',
                                 'files': [attachment('SESSION_PAGE_SPEC.md')]}).encode(),
                headers={'Content-Type': 'application/json', server.CONTROL_TOKEN_HEADER: server.CONTROL_TOKEN})
            with patch.object(server, 'transport_status', return_value={'pm_configured': True}):
                with urllib.request.urlopen(req) as response:
                    result = json.load(response)
                    self.assertEqual(response.status, 202)
            queued = next(row for row in server.list_queue() if row['id'] == result['delivery_ids'][0])
            self.assertEqual(queued['recipient'], 'pm')
            self.assertIn('SESSION_PAGE_SPEC.md:', queued['content'])
            self.assertIn(result['handoff_manifest'], queued['content'])
            self.assertTrue(Path(result['handoff_manifest']).is_file())
        finally:
            http.shutdown()
            http.server_close()
            thread.join(timeout=3)

    def test_github_only_reports_local_paths_without_claiming_remote_attachments(self):
        http = ThreadingHTTPServer(('127.0.0.1', 0), server.H)
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        try:
            req = urllib.request.Request(f'http://127.0.0.1:{http.server_port}/api/send',
                data=json.dumps({'route': 'none', 'message': 'Read specs', 'files': [attachment('source.md')]}).encode(),
                headers={'Content-Type': 'application/json', server.CONTROL_TOKEN_HEADER: server.CONTROL_TOKEN})
            with patch.object(server, 'post_control_issue_comment', return_value=(True, None)) as post:
                with urllib.request.urlopen(req) as response:
                    self.assertEqual(response.status, 202)
            self.assertIn('source.md:', post.call_args.args[0])
            self.assertIn('not downloadable GitHub attachments', post.call_args.args[0])
        finally:
            http.shutdown()
            http.server_close()
            thread.join(timeout=3)
