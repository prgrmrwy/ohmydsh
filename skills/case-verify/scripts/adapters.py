#!/usr/bin/env python3
"""Execute explicitly trusted adapters; their output remains untrusted data."""
import argparse
from collections import Counter
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

DESCRIBE_TIMEOUT = 10
RUN_TIMEOUT = 300
SCRIPTS = Path(__file__).resolve().parent


def strict_json(text):
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                raise ValueError('重复 JSON 键: ' + key)
            result[key] = value
        return result
    def constant(value):
        raise ValueError('非法 JSON 数值: ' + value)
    return json.loads(text, object_pairs_hook=pairs, parse_constant=constant)


def discover():
    available, excluded = [], []
    seen = set()
    for directory in os.environ.get('CASE_VERIFY_ADAPTERS', '').split(':'):
        if not directory:
            continue
        root = Path(directory).absolute()
        try:
            if root.is_symlink() or not root.is_dir():
                raise ValueError('不是普通目录，或是符号链接')
            entries = sorted(root.iterdir())
        except (OSError, ValueError) as exc:
            excluded.append({'path': str(root), 'reason': str(exc)})
            continue
        for candidate in entries:
            if str(candidate) in seen:
                continue
            seen.add(str(candidate))
            try:
                if not stat.S_ISREG(candidate.lstat().st_mode) or not os.access(candidate, os.X_OK):
                    continue
                result = subprocess.run([str(candidate), '--describe'], capture_output=True,
                                        text=True, timeout=DESCRIBE_TIMEOUT)
                if result.returncode:
                    raise ValueError('--describe 退出码 %s: %s' % (result.returncode, result.stderr[-4096:]))
                description = strict_json(result.stdout)
                if not isinstance(description, dict):
                    raise ValueError('描述必须为 JSON 对象')
                if not isinstance(description.get('name'), str) or not re.fullmatch(r'[a-z][a-z0-9-]{0,39}', description['name']):
                    raise ValueError('名称不合法')
                if description.get('kind') not in ('oracle-source', 'report-sink'):
                    raise ValueError('kind 不合法')
                if description['kind'] == 'oracle-source':
                    if description.get('provenance') not in ('independent', 'spec'):
                        raise ValueError('provenance 不合法')
                    if not isinstance(description.get('match'), str):
                        raise ValueError('match 必须为 URL 正则')
                    re.compile(description['match'])
                available.append({'path': str(candidate), 'description': description})
            except (OSError, ValueError, re.error, subprocess.TimeoutExpired) as exc:
                excluded.append({'path': str(candidate), 'reason': str(exc)})
    counts = Counter(a['description']['name'] for a in available)
    unique = []
    for adapter in available:
        if counts[adapter['description']['name']] > 1:
            excluded.append({'path': adapter['path'], 'reason': '名称冲突: ' + adapter['description']['name']})
        else:
            unique.append(adapter)
    return {'adapters': unique, 'excluded': excluded}


def _discovered():
    result = discover()
    for excluded in result['excluded']:
        print('%s: %s' % (excluded['path'], excluded['reason']), file=sys.stderr)
    return result['adapters']


def match(url):
    matches = [a for a in _discovered() if a['description']['kind'] == 'oracle-source'
               and re.search(a['description']['match'], url)]
    if not matches:
        raise ValueError('无匹配 adapter；请提供 XMind 导出文件或用例文本')
    if len(matches) != 1:
        raise ValueError('匹配冲突: ' + ', '.join(a['description']['name'] + ' (' + a['path'] + ')' for a in matches))
    return matches[0]


def _safe_path(root, path):
    root = root.absolute()
    path = path.absolute()
    path.relative_to(root)
    # Inspect the checking root and descendants, not platform aliases above it (/var).
    for part in [path] + list(path.parents):
        if part.is_symlink():
            raise ValueError('路径包含符号链接: ' + str(part))
        if part == root:
            break
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError:
        raise ValueError('路径越界: ' + str(path))
    return path


def _invocation_dir(checking_dir, name):
    root = Path(checking_dir).absolute()
    parent = _safe_path(root, root / 'oracle-sources' / name)
    parent.mkdir(parents=True, exist_ok=True)
    sequence = max([int(p.name) for p in parent.iterdir() if re.fullmatch(r'[1-9][0-9]*', p.name)] or [0]) + 1
    while True:
        destination = _safe_path(root, parent / str(sequence))
        try:
            destination.mkdir()
            return destination
        except FileExistsError:
            sequence += 1


def _run(command, checking_dir, log_dir, env=None):
    # File-backed capture bounds memory even for a noisy trusted executable.
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        try:
            result = subprocess.run(command, cwd=str(checking_dir), env=env,
                                    stdout=stdout, stderr=stderr, timeout=RUN_TIMEOUT)
            code = result.returncode
        except subprocess.TimeoutExpired:
            code = 'timeout (%ss)' % RUN_TIMEOUT
        tails = []
        for stream in (stdout, stderr):
            stream.seek(0, os.SEEK_END)
            size = stream.tell()
            stream.seek(max(0, size - 4096))
            tails.append(stream.read())
        log = (b'stdout:\n' + tails[0] + b'\nstderr:\n' + tails[1])[-4096:]
        log_path = _safe_path(Path(checking_dir), log_dir / 'adapter.txt')
        log_path.write_bytes(log)
        if code != 0:
            raise ValueError('adapter 退出码 %s: %s' % (code, tails[1].decode('utf-8', errors='replace')))
        return tails[0].decode('utf-8', errors='replace')


def _gate(script, args, checking_dir):
    result = subprocess.run([sys.executable, '-B', str(SCRIPTS / script)] + args,
                            cwd=str(checking_dir), capture_output=True, text=True,
                            timeout=RUN_TIMEOUT)
    if result.returncode:
        raise ValueError(result.stderr or result.stdout or ('门禁失败: ' + script))


def fetch(url, checking_dir):
    adapter = match(url)
    root = Path(checking_dir).absolute()
    from _model import check_format
    check_format(root)
    out = _invocation_dir(root, adapter['description']['name'])
    _run([adapter['path'], 'fetch', url, '--out', str(out)], root, out)
    fragment_path = _safe_path(root, out / 'oracle.fragment.json')
    if not stat.S_ISREG(fragment_path.lstat().st_mode):
        raise ValueError('oracle.fragment.json 必须为普通文件')
    fragment = strict_json(fragment_path.read_text(encoding='utf-8'))
    if not isinstance(fragment, dict) or not isinstance(fragment.get('items'), list):
        raise ValueError('片段必须为 {items: [...]}')
    for index, item in enumerate(fragment['items']):
        if not isinstance(item, dict):
            raise ValueError('items[%s] 必须为对象' % index)
        item['provenance'] = adapter['description']['provenance']
        item['source'] = adapter['description']['name']
    fragment_path.write_text(json.dumps(fragment, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    _gate('validate_oracle.py', ['--fragment', str(fragment_path)], root)
    return dict(fragment, fragment_path=str(fragment_path))


def push(name, checking_dir):
    adapter = next((a for a in _discovered() if a['description']['name'] == name
                    and a['description']['kind'] == 'report-sink'), None)
    if adapter is None:
        raise ValueError('无 report-sink adapter: ' + name)
    root = Path(checking_dir).absolute()
    _gate('validate_execution_gate.py', ['--checking-dir', str(root), '--require-report'], root)
    plan_path = _safe_path(root, root / 'plan.json')
    plan = strict_json(plan_path.read_text(encoding='utf-8'))
    env = os.environ.copy()
    env.pop('CASE_VERIFY_EXTERNAL_DOC_URL', None)
    if plan['meta'].get('external_doc_url'):
        env['CASE_VERIFY_EXTERNAL_DOC_URL'] = plan['meta']['external_doc_url']
    out = _invocation_dir(root, name)
    stdout = _run([adapter['path'], 'push', str(root)], root, out, env)
    lines = stdout.rstrip().splitlines()
    url = lines[-1] if lines else ''
    parsed = urlsplit(url)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc or any(c.isspace() for c in url):
        raise ValueError('adapter stdout 最后一行必须为 http(s) URL')
    from _model import locked, write_json
    with locked(root):
        plan = strict_json(plan_path.read_text(encoding='utf-8'))
        plan['meta']['external_doc_url'] = url
        write_json(plan_path, plan)
    return url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('list')
    matcher = commands.add_parser('match')
    matcher.add_argument('url')
    runner = commands.add_parser('run')
    operations = runner.add_subparsers(dest='operation', required=True)
    fetcher = operations.add_parser('fetch')
    fetcher.add_argument('url')
    fetcher.add_argument('--checking-dir', required=True)
    pusher = operations.add_parser('push')
    pusher.add_argument('name')
    pusher.add_argument('--checking-dir', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'list':
            result = discover()
        elif args.command == 'match':
            result = match(args.url)
        elif args.operation == 'fetch':
            result = fetch(args.url, args.checking_dir)
        else:
            result = {'external_doc_url': push(args.name, args.checking_dir)}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
