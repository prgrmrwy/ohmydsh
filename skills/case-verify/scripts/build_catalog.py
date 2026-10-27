#!/usr/bin/env python3
"""Read-only catalog projection; private asset paths never enter the payload."""
import argparse
import copy
import json
from pathlib import Path
import sys
from _model import (ModelError, require, now, sha256, load_plan, planning,
                    calculate_status, read_observations)


def _input_bytes(root):
    paths = [root / name for name in ('oracle.json', 'plan.json', 'observations.jsonl', 'plan.yaml')]
    paths += sorted((root / 'trails').glob('*.json'))
    paths += sorted((root / 'trails').glob('*.yaml'))
    return {str(path.relative_to(root)): path.read_bytes() for path in paths if path.is_file()}


def build(checking_dir):
    root = Path(checking_dir).resolve()
    # Cooperating writers may append during the shared reader's multiple reads.
    for _ in range(3):
        before = _input_bytes(root)
        try:
            result = _build_once(root)
        except (ModelError, OSError, ValueError, TypeError, KeyError):
            if before == _input_bytes(root):
                raise
            continue
        if before == _input_bytes(root):
            return result
    raise ModelError('checking 输入持续变化；请停止写入后重试查看器')


def _build_once(root):
    if not (root / 'plan.json').exists() and ((root / 'plan.yaml').exists() or any((root / 'trails').glob('*.yaml'))):
        raise ModelError('该目录早于结构化证据格式')
    require((root / 'observations.jsonl').is_file(), '尚无观察记录')
    plan = load_plan(root)
    oracle, trails, cps = planning(root, plan)
    state = calculate_status(root, check_assets=False)
    rows = read_observations(root, plan, cps, check_assets=False)
    assets = {}
    observations = []
    superseded = {row['supersedes']: row['obs_id'] for row in rows if row['supersedes']}
    fields = ('obs_id', 'checkpoint_id', 'plan_rev', 'loop', 'batch', 'env', 'status', 'actual', 'limits', 'supersedes', 'at')
    for row in rows:
        projected = {key: copy.deepcopy(row[key]) for key in fields}
        projected.update(expired=row['plan_rev'] != state['plan_rev'], superseded_by=superseded.get(row['obs_id']), evidence=[])
        for item in row['evidence']:
            entry = dict(name=Path(item['path']).name, kind=item['kind'], scope=item['scope'], unavailable=True)
            path = root / item['path']
            try:
                real = path.resolve()
                allowed = item['kind'] == 'dom' or (item['kind'] == 'screenshot' and path.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp'))
                if allowed and real.is_relative_to(root) and real.is_file() and sha256(real.read_bytes()) == item['sha256']:
                    key = sha256(item['path'].encode('utf-8'))[:24]
                    require(key not in assets or assets[key] == real, '资产 key 冲突')
                    assets[key] = real
                    entry.pop('unavailable')
                    entry['url'] = '/asset/' + key
            except (OSError, RuntimeError):
                pass
            projected['evidence'].append(entry)
        observations.append(projected)
    checkpoints = []
    for trail in trails.values():
        for step in trail['steps']:
            for cp in step['checkpoints']:
                checkpoints.append(dict(id=cp['id'], trail_id=trail['id'], trail_name=trail.get('name', trail['id']),
                    description=cp.get('description', cp.get('assertion', '')), focus=cp['focus'], verify=cp['verify'],
                    origin=cp['origin'], oracle_ids=copy.deepcopy(cp['oracle_ids']), status=state['checkpoints'][cp['id']]['status'],
                    observation_ids=[row['obs_id'] for row in rows if row['checkpoint_id'] == cp['id']]))
    oracles = []
    for item in oracle['items']:
        entry = {key: copy.deepcopy(item[key]) for key in ('id', 'title', 'precondition', 'input', 'expected', 'provenance', 'source', 'path', 'priority')}
        members = [cp['id'] for cp in checkpoints if cp['origin'] == 'oracle' and item['id'] in cp['oracle_ids']]
        current = [state['checkpoints'][cid] for cid in members]
        if not members:
            rollup = 'uncovered'
        elif any(cp['status'] == 'fail' for cp in current):
            rollup = 'fail'
        elif all(cp['status'] == 'pass' and any(row['status'] == 'pass' and row['evidence'] for row in cp['observations']) for cp in current):
            rollup = 'pass'
        else:
            rollup = 'partial'
        entry.update(checkpoint_ids=members, rollup=rollup)
        oracles.append(entry)
    catalog = dict(schema=1, generated_at=now(), title=plan.get('meta', {}).get('feature', 'Case verify'),
        oracles=oracles, checkpoints=checkpoints, observations=observations,
        gaps=dict(uncovered_oracles=[row['id'] for row in oracles if row['rollup'] == 'uncovered'],
                  derived_checkpoints=[cp['id'] for cp in checkpoints if cp['origin'] == 'derived']),
        env_keys=sorted({key for row in rows for key in row['env']}))
    return catalog, assets


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checking-dir', required=True, type=Path)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    try:
        if args.out:
            require(not args.out.resolve().is_relative_to(args.checking_dir.resolve()), '--out 不得位于 checking 目录内')
        catalog, _ = build(args.checking_dir)
        text = json.dumps(catalog, ensure_ascii=False, allow_nan=False) + '\n'
        if args.out:
            args.out.write_text(text, encoding='utf-8')
        else:
            print(text, end='')
        return 0
    except (ModelError, OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
