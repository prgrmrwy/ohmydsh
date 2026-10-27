"""Case-verify JSON model. Readers never create locks, caches or other files."""
import argparse
from contextlib import contextmanager
import copy
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile


class ModelError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ModelError(message)


def now():
    return datetime.now(timezone.utc).isoformat()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def json_object(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, '重复 JSON 键: ' + key)
        value[key] = item
    return value


def parse_json(text):
    def invalid(value):
        raise ModelError('非标准 JSON 数值: ' + value)
    return json.loads(text, object_pairs_hook=json_object, parse_constant=invalid)


def read_json(path):
    return parse_json(Path(path).read_text(encoding='utf-8'))


def write_json(path, value):
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=str(path.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write('\n')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def locked(checking_dir):
    with (Path(checking_dir) / '.case-verify.lock').open('a+b') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)


def check_format(root):
    if not (root / 'plan.json').exists() and ((root / 'plan.yaml').exists() or any((root / 'trails').glob('*.yaml'))):
        raise ModelError('旧格式 checking 目录不受支持')


def load_plan(root):
    check_format(root)
    plan = read_json(root / 'plan.json')
    require(isinstance(plan, dict), 'plan 必须为对象')
    require(isinstance(plan.get('meta', {}), dict), 'plan.meta 必须为对象')
    entries = plan.get('trails', [])
    require(isinstance(entries, list) and all(isinstance(entry, dict) for entry in entries), 'plan.trails 必须为对象数组')
    return plan


def frozen(root, plan):
    freeze = plan.get('meta', {}).get('oracle_freeze')
    require(isinstance(freeze, dict) and freeze.get('sha256') == sha256((root / 'oracle.json').read_bytes()), 'oracle 在冻结后被修改或缺少冻结确认')


def validate_oracle(value, fragment=False):
    require(isinstance(value, dict), 'oracle 必须为对象')
    require(fragment or value.get('schema') == 1, 'oracle.schema 必须为 1')
    require(isinstance(value.get('items'), list), 'oracle.items 必须为数组')
    seen = set()
    for index, item in enumerate(value['items']):
        label = 'items[%s]' % index
        require(isinstance(item, dict), label + ' 必须为对象')
        for key in ('id', 'title', 'input', 'expected', 'source', 'expected_source'):
            require(isinstance(item.get(key), str) and item[key].strip(), label + '.' + key + ' 必须为非空字符串')
        require(item['id'] not in seen, label + '.id 重复: ' + item['id'])
        seen.add(item['id'])
        for key in ('precondition', 'entry_point', 'reviewer_notes'):
            require(key in item and (item[key] is None or isinstance(item[key], str)), label + '.' + key + ' 必须为字符串或 null')
        require(item.get('provenance') in ('spec', 'independent'), label + '.provenance 不合法')
        require(item.get('priority') in ('P0', 'P1', 'P2'), label + '.priority 不合法')
        require(isinstance(item.get('path'), list) and all(isinstance(x, str) for x in item['path']), label + '.path 必须为字符串数组')
    return value


def planning(root, plan):
    oracle = validate_oracle(read_json(root / 'oracle.json'))
    frozen(root, plan)
    oracle_ids = {item['id'] for item in oracle['items']}
    trails, checkpoints = {}, {}
    for path in sorted((root / 'trails').glob('*.json')):
        trail = read_json(path)
        require(isinstance(trail, dict), path.name + ': trail 必须为对象')
        require(isinstance(trail.get('id'), str) and trail['id'].strip(), path.name + ': id 必须为非空字符串')
        require(isinstance(trail.get('steps'), list), path.name + ': steps 必须为数组')
        require(isinstance(trail.get('mock_setup', {}), dict), path.name + ': mock_setup 必须为对象')
        trails[path.name] = trail
        require(not any(k in trail for k in ('status', 'blocked_reason')), path.name + ': 执行结果只能记录在 observations.jsonl')
        for step_index, step in enumerate(trail['steps']):
            step_label = path.name + ': steps[%s]' % step_index
            require(isinstance(step, dict), step_label + ' 必须为对象')
            require(isinstance(step.get('checkpoints'), list), step_label + '.checkpoints 必须为数组')
            for cp_index, cp in enumerate(step['checkpoints']):
                cp_label = step_label + '.checkpoints[%s]' % cp_index
                require(isinstance(cp, dict), cp_label + ' 必须为对象')
                label = cp_label + ': ' + str(cp.get('id'))
                for key, allowed in (('focus', ('integration', 'interaction', 'visual')), ('verify', ('assert_dom', 'assert_network', 'assert_url', 'screenshot_compare', 'visual_inspect')), ('automation', ('full', 'partial', 'manual'))):
                    require(cp.get(key) in allowed, label + ': ' + key + ' 缺失或不合法')
                require(not any(k in cp for k in ('result', 'result_detail')), label + ': 执行结果只能记录在 observations.jsonl')
                require(cp.get('origin') in ('oracle', 'derived'), label + ': origin 必须为 oracle 或 derived')
                ids = cp.get('oracle_ids')
                require(isinstance(ids, list) and all(isinstance(x, str) for x in ids), label + ': oracle_ids 必须为字符串数组')
                require(cp['origin'] != 'oracle' or ids, label + ': 挂载 oracle 或改为 derived')
                require(not set(ids) - oracle_ids, label + ': oracle id 不存在 ' + ', '.join(sorted(set(ids) - oracle_ids)))
                require(isinstance(cp.get('id'), str) and cp['id'] and cp['id'] not in checkpoints, label + ': checkpoint id 缺失或重复')
                checkpoints[cp['id']] = cp
    for entry in plan.get('trails', []):
        require('status' not in entry and 'blocked_reason' not in entry, 'plan.trails: 执行结果只能记录在 observations.jsonl')
    return oracle, trails, checkpoints


def mock_gate(root, plan):
    _, trails, _ = planning(root, plan)
    for name, trail in trails.items():
        setup = trail.get('mock_setup', {})
        require(setup.get('status') != 'available' or setup.get('evidence'), name + ': available mock 缺少 evidence')
        require(not (setup.get('required') and setup.get('status') in ('missing', 'unknown')) or setup.get('user_decision'), name + ': 缺少 user_decision')
        for step in trail.get('steps', []):
            for cp in step.get('checkpoints', []):
                label = name + ': ' + cp['id']
                require(not (cp.get('automation') in ('full', 'partial') and cp.get('mock_status') in ('missing', 'unknown')) or cp.get('mock_user_decision'), label + ': mock 未确认，不能继续自动化')
                require(not (cp.get('data_scenario') or cp.get('data_scenario_required')) or cp.get('surface'), label + ': 数据场景缺少 surface')


def trail_gate(root, plan):
    _, trails, _ = planning(root, plan)
    for name, trail in trails.items():
        for step in trail.get('steps', []):
            cps = step.get('checkpoints', [])
            for cp in cps:
                label = name + ': ' + cp['id']
                require(cp.get('expected_source') != 'implementation' or cp.get('expected_unverified') is True, label + ': implementation 必须 expected_unverified: true')
                require(cp.get('input_method') not in ('ime', 'IME') or cp.get('automation') == 'manual', label + ': IME 必须 manual')
                text = str(cp.get('assertion', cp.get('expected', cp.get('description', ''))))
                structured_presence = cp.get('verify') == 'assert_dom' and 'expected_visible' in cp and not any(cp.get(key) for key in ('expected_text', 'expected_attrs', 'assertion', 'expected'))
                presence = structured_presence or cp.get('presence_only') or re.search(r'(presence.only|按钮可见|仅.*可见|exists|is visible)', text, re.IGNORECASE)
                require(not (cp.get('automation') in ('full', 'partial') and presence), label + ': presence-only 不能作为自动化断言')
            action = str(step.get('action', '')).lower()
            if re.search(r'click|tap|type|input|fill|press_key|hover|submit|select|drag|点击|输入|提交', action):
                consequence_fields = ('expected_text', 'expected_attrs', 'expected_pattern', 'expected_response', 'expected_params', 'expected_status')
                require(any(cp.get('consequence') or any(cp.get(key) is not None for key in consequence_fields) for cp in cps), name + ': ' + str(step.get('id', step.get('seq'))) + ': 交互 step 缺少 consequence checkpoint')


def fingerprint(root, plan):
    oracle, trails, checkpoints = planning(root, plan)
    entries = plan.get('trails', [])
    names = [entry.get('file', 'trails/' + entry['id'] + '.json') for entry in entries]
    require(len(names) == len(set(names)) and set(names) == {'trails/' + name for name in trails}, 'plan.trails 索引必须与磁盘 trails 一一对应')
    normalized = copy.deepcopy(plan)
    for key in ('oracle_freeze', 'plan_revisions', 'active_plan_rev', 'external_doc_url'):
        normalized.setdefault('meta', {}).pop(key, None)
    value = dict(oracle=oracle, plan=normalized, trails=trails)
    return sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8'))


def revisions(plan):
    rows = plan.get('meta', {}).get('plan_revisions', [])
    require(isinstance(rows, list), 'plan_revisions 必须为数组')
    previous = 0
    for row in rows:
        require(isinstance(row, dict) and type(row.get('plan_rev')) is int and row['plan_rev'] > previous, 'plan_revisions.plan_rev 必须严格递增')
        previous = row['plan_rev']
    return rows


def active(root, plan):
    frozen(root, plan)
    rows = revisions(plan)
    rev = plan.get('meta', {}).get('active_plan_rev')
    row = next((row for row in rows if row['plan_rev'] == rev), None)
    require(type(rev) is int and row is not None, '需要确认计划和执行策略')
    require(row.get('input_sha256') == fingerprint(root, plan), '执行输入已变化，需要确认计划和执行策略')
    return rev


def validate_record(record, checkpoints):
    require(isinstance(record, dict), '观察必须为对象')
    require(record.get('checkpoint_id') in checkpoints, 'checkpoint_id 不存在: ' + str(record.get('checkpoint_id')))
    require(type(record.get('loop')) is int and record['loop'] > 0, 'loop 必须为正整数')
    require('batch' in record and (record['batch'] is None or isinstance(record['batch'], str)), 'batch 必须为字符串或 null')
    require(isinstance(record.get('env'), dict), 'env 必须为对象')
    require(record.get('status') in ('pass', 'fail', 'manual', 'skipped', 'partial', 'blocked'), 'status 不合法')
    require(isinstance(record.get('actual'), str), 'actual 必须为字符串')
    require(isinstance(record.get('evidence'), list), 'evidence 必须为数组')
    require(isinstance(record.get('limits'), list) and all(isinstance(x, str) and x.strip() for x in record['limits']), 'limits 必须为非空字符串数组')
    require('supersedes' in record and (record['supersedes'] is None or isinstance(record['supersedes'], str)), 'supersedes 必须为字符串或 null')


STATES = ('fail', 'blocked', 'partial', 'manual', 'pass', 'skipped', 'pending')
START = '<!-- case-verify:summary:start -->'
END = '<!-- case-verify:summary:end -->'


def evidence_check(root, record, assigning=False, check_assets=True):
    require(record['status'] not in ('pass', 'fail') or record['evidence'] or record['limits'], '必须提供证据或在 limits 中写明原因')
    for item in record['evidence']:
        require(isinstance(item, dict), 'evidence 必须为对象')
        name = item.get('path')
        require(isinstance(name, str) and name.startswith('evidence/') and not Path(name).is_absolute() and '..' not in Path(name).parts, '证据路径不合法: ' + str(name))
        path = root / name
        if check_assets:
            require(path.resolve().is_relative_to(root.resolve()), '证据路径越界: ' + name)
        require(item.get('kind') in ('screenshot', 'dom', 'network', 'log'), name + ': kind 不合法')
        require(item.get('scope') in ('exact', 'shared-step'), name + ': scope 不合法')
        if check_assets:
            require(path.is_file(), '证据不存在: ' + name)
            digest = sha256(path.read_bytes())
            if assigning:
                item['sha256'] = digest
            else:
                require(item.get('sha256') == digest, str(record.get('obs_id')) + ': 证据在被引用后发生了变化 ' + name)
        if not assigning:
            require(isinstance(item.get('sha256'), str) and len(item['sha256']) == 64, name + ': sha256 不合法')


def supersede_check(record, previous):
    target = record['supersedes']
    if target is None:
        return
    old = next((row for row in previous if row['obs_id'] == target), None)
    require(old is not None, 'supersedes 不存在或不早于当前记录: ' + target)
    require(not any(row['supersedes'] == target for row in previous), 'supersedes 已被替代: ' + target)
    dimension = lambda row: json.dumps({key: value for key, value in row['env'].items() if key not in ('app_version', 'remote_version')}, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
    require(old['checkpoint_id'] == record['checkpoint_id'] and old['plan_rev'] == record['plan_rev'] and dimension(old) == dimension(record), 'supersedes checkpoint/revision/执行维度不相同: ' + target)
    require(record['actual'].strip(), 'supersedes actual 必须说明理由')


def read_observations(root, plan, checkpoints, check_assets=True):
    path = root / 'observations.jsonl'
    data = path.read_bytes() if path.exists() else b''
    require(not data or data.endswith(b'\n'), 'observations.jsonl 末尾存在残行')
    valid_revs = {row['plan_rev'] for row in revisions(plan)}
    rows = []
    for index, line in enumerate(data.decode('utf-8').splitlines(), 1):
        try:
            row = parse_json(line)
            require(isinstance(row, dict), '观察必须为对象')
            require(type(row.get('plan_rev')) is int and row['plan_rev'] in valid_revs, 'plan_rev 缺失或不存在')
            # Historical checkpoints need not exist in the current plan.
            known = checkpoints if row['plan_rev'] == plan['meta'].get('active_plan_rev') else {row.get('checkpoint_id'): {}}
            validate_record(row, known)
            require(isinstance(row.get('obs_id'), str) and row['obs_id'].startswith('obs-') and row['obs_id'][4:].isdigit(), 'obs_id 不合法')
            require(not any(old['obs_id'] == row['obs_id'] for old in rows), 'obs_id 重复')
            require(isinstance(row.get('at'), str), 'at 缺失')
            datetime.fromisoformat(row['at'])
            evidence_check(root, row, check_assets=check_assets)
            supersede_check(row, rows)
            rows.append(row)
        except (ModelError, ValueError, TypeError, KeyError) as error:
            raise ModelError('observations.jsonl 第 %s 行: %s' % (index, error)) from None
    return rows


def calculate_status(root, check_assets=True):
    plan = load_plan(root)
    rev = active(root, plan)
    oracle, trails, cps = planning(root, plan)
    rows = read_observations(root, plan, cps, check_assets)
    replaced = {row['supersedes'] for row in rows if row['supersedes']}
    effective = [row for row in rows if row['plan_rev'] == rev and row['obs_id'] not in replaced]
    result = dict(plan_rev=rev, checkpoints={}, counts={state: 0 for state in STATES}, by_focus={}, trails={}, **{'continue': []})
    for cid, cp in cps.items():
        observations = [row for row in effective if row['checkpoint_id'] == cid]
        status = min((row['status'] for row in observations), key=STATES.index, default='pending')
        result['checkpoints'][cid] = dict(status=status, observations=observations, unresolved=[row for row in observations if row['status'] != 'pass'])
        result['counts'][status] += 1
        counts = result['by_focus'].setdefault(cp.get('focus', 'unknown'), {state: 0 for state in STATES})
        counts[status] += 1
        if status in ('pending', 'blocked'):
            result['continue'].append(cid)
    for trail in trails.values():
        statuses = [result['checkpoints'][cp['id']]['status'] for step in trail.get('steps', []) for cp in step.get('checkpoints', [])]
        result['trails'][trail['id']] = 'blocked' if 'blocked' in statuses else min(statuses, key=STATES.index, default='pending')
    return result


def markdown(state):
    return START + '\n| status | count |\n|---|---|\n' + ''.join('| %s | %s |\n' % (key, state['counts'][key]) for key in STATES) + END + '\n'


def execution_gate(root, require_report=False):
    state = calculate_status(root)
    plan = load_plan(root)
    oracle, trails, cps = planning(root, plan)
    for cid, cp in cps.items():
        require(cp.get('automation') not in ('full', 'partial') or state['checkpoints'][cid]['status'] != 'pending', cid + ': pending')
    for cid, cp in cps.items():
        for row in state['checkpoints'][cid]['observations']:
            require(not cp.get('expected_unverified') or row['status'] != 'pass', cid + ': expected_unverified 不得 PASS')
            missing = re.search(r'(surface rendered|已渲染|目标 surface).*(not found|找不到|不存在|缺失)', row['actual'], re.IGNORECASE)
            require(not missing or row['status'] == 'fail', row['obs_id'] + ': surface 缺失时状态必须为 fail')
            require(row['status'] not in ('fail', 'manual') or len(row['actual']) >= 6, row['obs_id'] + ': actual 至少 6 个字符')
    if require_report:
        path = root / 'report.md'
        require(path.is_file(), 'report.md 不存在')
        report = path.read_text(encoding='utf-8')
        for heading in ('## Mock 证据', '### Surface × 数据态覆盖', '## 执行策略', '## 期望来源缺口', '### 未覆盖 / 天然盲区', '### 未覆盖的 oracle', '### 派生 checkpoint'):
            require(heading in report, '缺少章节 ' + heading)
        require(report.count(START) == 1 and report.count(END) == 1, '报告摘要标记缺失或重复')
        summary = report[report.index(START):report.index(END) + len(END)]
        require(summary == markdown(state).rstrip('\n'), '报告摘要与观察记录不一致')
    return state


def append_record(root, plan, record, expected):
    rev = active(root, plan)
    require(expected is not None and expected == rev, 'expected-plan-rev 必须与 active_plan_rev 相同')
    require(not any(key in record for key in ('obs_id', 'at', 'plan_rev')), '调用者不得覆盖 obs_id/at/plan_rev')
    _, _, checkpoints = planning(root, plan)
    validate_record(record, checkpoints)
    path = root / 'observations.jsonl'
    data = path.read_bytes() if path.exists() else b''
    require(not data or data.endswith(b'\n'), 'observations.jsonl 末尾存在残行')
    rows = read_observations(root, plan, checkpoints)
    number = max([int(row['obs_id'].split('-')[1]) for row in rows] or [0]) + 1
    record.update(obs_id='obs-%04d' % number, at=now(), plan_rev=rev)
    evidence_check(root, record, assigning=True)
    supersede_check(record, rows)
    line = (json.dumps(record, ensure_ascii=False, allow_nan=False) + '\n').encode('utf-8')
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        try:
            require(os.write(fd, line) == len(line), '观察追加短写')
        except BaseException:
            os.ftruncate(fd, len(data))
            raise
    finally:
        os.close(fd)
    return record


def main(command):
    parser = argparse.ArgumentParser()
    parser.add_argument('action', nargs='?')
    parser.add_argument('--selected')
    parser.add_argument('--expected-plan-rev', type=int)
    parser.add_argument('--json')
    parser.add_argument('--markdown', action='store_true')
    parser.add_argument('--require-report', action='store_true')
    parser.add_argument('--checking-dir', type=Path)
    parser.add_argument('--freeze', action='store_true')
    parser.add_argument('--fragment', type=Path)
    args = parser.parse_args()
    try:
        if args.fragment:
            fragment = read_json(args.fragment)
            validate_oracle(fragment, fragment=True)
            print('片段检查通过')
            return 0
        root = args.checking_dir
        plan = load_plan(root)
        if command == 'oracle':
            validate_oracle(read_json(root / 'oracle.json'))
            if args.freeze:
                with locked(root):
                    plan = load_plan(root)
                    validate_oracle(read_json(root / 'oracle.json'))
                    plan.setdefault('meta', {})['oracle_freeze'] = dict(sha256=sha256((root / 'oracle.json').read_bytes()), at=now())
                    plan['meta']['active_plan_rev'] = None
                    write_json(root / 'plan.json', plan)
        elif command == 'trail':
            trail_gate(root, plan)
        elif command == 'mock':
            mock_gate(root, plan)
        elif command == 'confirm':
            with locked(root):
                plan = load_plan(root)
                digest = fingerprint(root, plan)
                mock_gate(root, plan)
                trail_gate(root, plan)
                require(args.selected in ('single_agent', 'swarm'), 'selected 必须为 single_agent 或 swarm')
                strategies = (plan.get('execution_strategy', {}), plan.get('meta', {}).get('execution_strategy', {}))
                require(args.selected != 'swarm' or not any(strategy.get('recommendation') == 'single_only' for strategy in strategies if isinstance(strategy, dict)), 'selected swarm 不可用: single_only')
                rows = revisions(plan)
                rev = max([row['plan_rev'] for row in rows] or [0]) + 1
                rows.append(dict(plan_rev=rev, input_sha256=digest, selected=args.selected, at=now()))
                plan.setdefault('meta', {}).update(plan_revisions=rows, active_plan_rev=rev)
                write_json(root / 'plan.json', plan)
        elif command == 'status':
            result = calculate_status(root)
            print(markdown(result) if args.markdown else json.dumps(result, ensure_ascii=False), end='' if args.markdown else '\n')
            return 0
        elif command == 'execution':
            result = execution_gate(root, args.require_report)
            oracle, _, cps = planning(root, plan)
            covered = {oid for cp in cps.values() if cp['origin'] == 'oracle' for oid in cp['oracle_ids']}
            print('未覆盖的 oracle: ' + ', '.join(item['id'] for item in oracle['items'] if item['id'] not in covered))
            print('派生 checkpoint: ' + ', '.join(cid + ' (' + result['checkpoints'][cid]['status'] + ')' for cid, cp in cps.items() if cp['origin'] == 'derived'))
        elif command == 'observe':
            require(args.action == 'append', 'observe 需要 append')
            with locked(root):
                result = append_record(root, load_plan(root), parse_json(args.json or '{}'), args.expected_plan_rev)
            print(json.dumps(result, ensure_ascii=False))
            return 0
        print('检查通过')
        return 0
    except (ModelError, OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        return 1
