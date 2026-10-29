#!/usr/bin/env python3
"""Loopback-only, read-only evidence viewer. No directory/file fallback routes."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from socketserver import TCPServer
import sys
from urllib.parse import unquote
from _model import ModelError, require
from build_catalog import build

CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"


class LoopbackHTTPServer(ThreadingHTTPServer):
    def server_bind(self):
        # HTTPServer's reverse DNS lookup can stall readiness on offline runners.
        TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


def create_server(checking_dir, port=0, static_dir=None):
    root = Path(checking_dir).resolve()
    catalog, assets = build(root)
    payload = json.dumps(catalog, ensure_ascii=False, allow_nan=False).encode('utf-8')
    static = Path(static_dir) if static_dir else Path(__file__).resolve().parents[1] / 'viewer'
    routes = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript'),
              '/logic.js': ('logic.js', 'text/javascript'), '/style.css': ('style.css', 'text/css')}
    kinds = {item['url'].split('/')[-1]: item['kind'] for row in catalog['observations'] for item in row['evidence'] if 'url' in item}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', CSP)
            super().end_headers()

        def reply(self, status, body=b'', content_type='text/plain; charset=utf-8'):
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            hosts = self.headers.get_all('Host', [])
            if len(hosts) != 1 or hosts[0] not in ('127.0.0.1:%s' % self.server.server_port, 'localhost:%s' % self.server.server_port) or self.headers.get('Sec-Fetch-Site', '').lower() == 'cross-site':
                self.reply(403, b'Forbidden')
                return
            route = unquote(self.path)
            if route == '/api/catalog':
                self.reply(200, payload, 'application/json; charset=utf-8')
            elif route == '/health':
                self.reply(200, b'{"ok":true}', 'application/json; charset=utf-8')
            elif route in routes:
                filename, content_type = routes[route]
                try:
                    self.reply(200, (static / filename).read_bytes(), content_type)
                except OSError:
                    self.reply(404, b'Not found')
            elif route.startswith('/asset/') and route[len('/asset/'):] in assets:
                key = route[len('/asset/'):]
                try:
                    path = assets[key].resolve()
                    if not path.is_relative_to(root) or not path.is_file():
                        self.reply(404, b'Not found')
                        return
                    data = path.read_bytes()
                    if kinds[key] == 'dom':
                        content_type = 'text/plain; charset=utf-8'
                    elif data.startswith(b'\xff\xd8\xff'):
                        content_type = 'image/jpeg'
                    elif data.startswith(b'\x89PNG\r\n\x1a\n'):
                        content_type = 'image/png'
                    elif data.startswith(b'RIFF') and data[8:12] == b'WEBP':
                        content_type = 'image/webp'
                    else:
                        self.reply(404, b'Not found')
                        return
                    self.reply(200, data, content_type)
                except (OSError, RuntimeError):
                    self.reply(404, b'Not found')
            else:
                self.reply(404, b'Not found')

    return LoopbackHTTPServer(('127.0.0.1', port), Handler)


def select_directory(directory=None, workspace=None):
    if directory is not None:
        return Path(directory)
    workspace = Path(workspace) if workspace is not None else Path.cwd()
    candidates = sorted({path.parent for pattern in ('openspec/changes/*/checking/plan.json', 'docs/checking/*/plan.json') for path in workspace.glob(pattern) if path.is_file()})
    require(len(candidates) == 1, '请指定 checking 目录；候选目录:\n' + ('\n'.join(str(p) for p in candidates) or '(无)'))
    return candidates[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checking-dir', type=Path)
    parser.add_argument('--port', type=int, default=0)
    args = parser.parse_args()
    server = None
    try:
        require(0 <= args.port <= 65535, 'port 必须在 0..65535')
        server = create_server(select_directory(args.checking_dir), args.port)
        print('CASE_VERIFY_VIEW_URL=http://127.0.0.1:%s/' % server.server_port, flush=True)
        server.serve_forever()
        return 0
    except KeyboardInterrupt:
        return 0
    except (ModelError, OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        return 1
    finally:
        if server is not None:
            server.server_close()


if __name__ == '__main__':
    raise SystemExit(main())
