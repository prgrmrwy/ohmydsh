"""Loopback HTTP tests; no external sites or real checking data."""
import hashlib
import http.client
import json
from pathlib import Path
import selectors
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from test_model_gates import ready_checking, observation, append, SCRIPTS
sys.path.insert(0, str(SCRIPTS))
from view import create_server

PNG = b'\x89PNG\r\n\x1a\nsynthetic'


class ViewServerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = ready_checking(Path(self.tmp.name) / 'checking')
        (self.root / 'evidence/sample.png').write_bytes(PNG)
        result = append(self.root)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.static = Path(self.tmp.name) / 'static'
        self.static.mkdir()
        for name in ('index.html', 'app.js', 'logic.js', 'style.css'):
            (self.static / name).write_text('synthetic ' + name)

    def server(self):
        server = create_server(self.root, static_dir=self.static)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def close():
            server.shutdown()
            server.server_close()
            thread.join(3)
        self.addCleanup(close)
        return server

    def request(self, server, path, headers=None, method='GET'):
        conn = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
        try:
            conn.request(method, path, headers=headers or {})
            response = conn.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            conn.close()

    def snapshot(self):
        return {str(p.relative_to(self.root)): ('link', str(p.readlink())) if p.is_symlink() else ('dir',) if p.is_dir() else (hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_mtime_ns) for p in self.root.rglob('*')}

    def test_read_only_snapshot(self):
        before = self.snapshot()
        server = self.server()
        self.assertEqual(server.server_address[0], '127.0.0.1')
        status, _, body = self.request(server, '/api/catalog')
        self.assertEqual(status, 200)
        url = json.loads(body)['observations'][0]['evidence'][0]['url']
        self.assertEqual(self.request(server, url)[0], 200)
        self.assertEqual(before, self.snapshot())

    def test_bind_does_not_resolve_hostname(self):
        # Loopback readiness must not wait for a runner's reverse DNS resolver.
        with patch('socket.getfqdn', side_effect=AssertionError('unexpected hostname lookup')):
            server = create_server(self.root, static_dir=self.static)
        self.addCleanup(server.server_close)
        self.assertEqual(server.server_name, '127.0.0.1')
        self.assertEqual(server.server_port, server.socket.getsockname()[1])
        self.assertGreater(server.server_port, 0)

    def test_ready_line_flush(self):
        p = subprocess.Popen([sys.executable, '-B', str(SCRIPTS / 'view.py'), '--checking-dir', str(self.root), '--port', '0'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(p.stdout, selectors.EVENT_READ)
                self.assertTrue(selector.select(10), 'ready line not flushed')
                line = p.stdout.readline().strip()
            self.assertTrue(line.startswith('CASE_VERIFY_VIEW_URL=http://127.0.0.1:'), line)
            self.assertIsNone(p.poll())
            port = int(line.rsplit(':', 1)[1].rstrip('/'))
            conn = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
            conn.request('GET', '/health')
            self.assertEqual(conn.getresponse().status, 200)
            conn.close()
        finally:
            p.terminate()
            p.communicate(timeout=5)

    def test_port_in_use(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            sock.listen()
            result = subprocess.run([sys.executable, '-B', str(SCRIPTS / 'view.py'), '--checking-dir', str(self.root), '--port', str(sock.getsockname()[1])], capture_output=True, text=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('CASE_VERIFY_VIEW_URL=', result.stdout)
        self.assertNotIn('not implemented', result.stderr)

    def test_ambiguous_directory(self):
        for name in ('one', 'two'):
            p = Path(self.tmp.name) / 'openspec/changes' / name / 'checking'
            p.mkdir(parents=True)
            (p / 'plan.json').write_text('{}')
        result = subprocess.run([sys.executable, '-B', str(SCRIPTS / 'view.py')], cwd=self.tmp.name, capture_output=True, text=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('one/checking', result.stderr)
        self.assertIn('two/checking', result.stderr)

    def test_asset_image(self):
        server = self.server()
        catalog = json.loads(self.request(server, '/api/catalog')[2])
        result, headers, body = self.request(server, catalog['observations'][0]['evidence'][0]['url'])
        self.assertEqual(result, 200)
        self.assertTrue(headers['Content-Type'].startswith('image/'))
        self.assertEqual(body, PNG)

    def test_logic_module_route(self):
        server = self.server()
        status, headers, body = self.request(server, '/logic.js')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Content-Type'], 'text/javascript')
        self.assertEqual(body, (self.static / 'logic.js').read_bytes())
        self.assertEqual(self.request(server, '/other.js')[0], 404)

    def test_static_root_separation(self):
        server = self.server()
        for path in ('/', '/app.js', '/logic.js', '/style.css'):
            self.assertEqual(self.request(server, path)[0], 200)

    def test_asset_replaced_symlink(self):
        server = self.server()
        catalog = json.loads(self.request(server, '/api/catalog')[2])
        url = catalog['observations'][0]['evidence'][0]['url']
        secret = Path(self.tmp.name) / 'outside.txt'
        secret.write_text('outside-synthetic-secret')
        path = self.root / 'evidence/sample.png'
        path.unlink()
        path.symlink_to(secret)
        result, _, body = self.request(server, url)
        self.assertEqual(result, 404)
        self.assertNotIn(b'outside-synthetic-secret', body)

    def test_forbidden_paths(self):
        server = self.server()
        for path in ('/asset/../../etc/passwd', '/asset/%2Fetc%2Fpasswd', '/asset/0000', '/server.py', '/evidence/sample.png', '/api/catalog/extra'):
            status, headers, _ = self.request(server, path)
            self.assertEqual(status, 404, path)
            self.security(headers)

    def security(self, headers):
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        self.assertIn("frame-ancestors 'none'", headers['Content-Security-Policy'])

    def test_cross_site_host(self):
        server = self.server()
        for headers in ({'Host': 'evil.example'}, {'Sec-Fetch-Site': 'cross-site'}, {'Host': '127.0.0.1:1'}):
            status, response, _ = self.request(server, '/api/catalog', headers)
            self.assertEqual(status, 403)
            self.security(response)

    def test_head_dom_jpeg_and_error_headers(self):
        dom = self.root / 'evidence/dom.html'
        dom.write_text('<script>synthetic attack</script>')
        jpeg = self.root / 'evidence/odd.png'
        jpeg.write_bytes(b'\xff\xd8\xffsynthetic-jpeg')
        for name, kind in [('dom.html', 'dom'), ('odd.png', 'screenshot')]:
            result = append(self.root, observation(evidence=[dict(path='evidence/' + name, kind=kind, scope='exact')]))
            self.assertEqual(result.returncode, 0, result.stderr)
        server = self.server()
        catalog = json.loads(self.request(server, '/api/catalog')[2])
        for row, mime, body in [(catalog['observations'][1], 'text/plain; charset=utf-8', dom.read_bytes()), (catalog['observations'][2], 'image/jpeg', jpeg.read_bytes())]:
            url = row['evidence'][0]['url']
            status, headers, actual = self.request(server, url)
            self.assertEqual((status, headers['Content-Type'], actual), (200, mime, body))
            self.security(headers)
            status, headers, actual = self.request(server, url, method='HEAD')
            self.assertEqual((status, actual), (200, b''))
            self.assertEqual(int(headers['Content-Length']), len(body))
            self.security(headers)
        for route in ('/health', '/', '/app.js', '/logic.js', '/style.css', '/api/catalog'):
            status, headers, _ = self.request(server, route)
            self.assertEqual(status, 200)
            self.security(headers)
        status, headers, _ = self.request(server, '/api/catalog', {'Host': 'localhost:' + str(server.server_port)})
        self.assertEqual(status, 200)
        self.security(headers)

    def test_invalid_catalog_cli_no_ready(self):
        (self.root / 'observations.jsonl').unlink()
        result = subprocess.run([sys.executable, '-B', str(SCRIPTS / 'view.py'), '--checking-dir', str(self.root)], capture_output=True, text=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('尚无观察记录', result.stderr)
        self.assertNotIn('Traceback', result.stderr)
        self.assertNotIn('CASE_VERIFY_VIEW_URL=', result.stdout)
        (self.root / 'plan.json').unlink()
        (self.root / 'plan.yaml').write_text('trails: []')
        result = subprocess.run([sys.executable, '-B', str(SCRIPTS / 'view.py'), '--checking-dir', str(self.root)], capture_output=True, text=True, timeout=5)
        self.assertIn('该目录早于结构化证据格式', result.stderr)
        self.assertNotIn('CASE_VERIFY_VIEW_URL=', result.stdout)

    def test_network_not_served(self):
        path = self.root / 'evidence/network.json'
        path.write_text('private-synthetic-network-body')
        result = append(self.root, observation(evidence=[dict(path='evidence/network.json', kind='network', scope='exact')]))
        self.assertEqual(result.returncode, 0, result.stderr)
        server = self.server()
        catalog = json.loads(self.request(server, '/api/catalog')[2])
        item = catalog['observations'][1]['evidence'][0]
        self.assertEqual(set(item), {'name', 'kind', 'scope', 'unavailable'})
        for url in ('/evidence/network.json', '/asset/network.json', '/network.json'):
            status, _, body = self.request(server, url)
            self.assertEqual(status, 404)
            self.assertNotIn(b'private-synthetic-network-body', body)


if __name__ == '__main__':
    unittest.main()
