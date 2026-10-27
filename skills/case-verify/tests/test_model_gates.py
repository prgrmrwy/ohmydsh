"""Synthetic CLI regression tests; no browser or external data required."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')


def run_cli(script, *args):
    return subprocess.run([sys.executable, '-B', str(SCRIPTS / (script + '.py')), *map(str, args)], capture_output=True, text=True)


def make_checking(root):
    root = Path(root)
    for name in ('trails', 'evidence', 'scratch', 'gates', 'oracle-sources'):
        (root / name).mkdir(parents=True, exist_ok=True)
    items = [dict(id='O-' + str(i), title='Save value', input='Enter value', expected='Saved value remains', precondition=None, entry_point=None, reviewer_notes=None, provenance='spec', source='plan-ac', path=[], priority='P1', expected_source='spec') for i in (1, 2)]
    dump(root / 'oracle.json', dict(schema=1, items=items))
    dump(root / 'plan.json', dict(meta={}, execution_strategy=dict(recommendation='single_only'), trails=[dict(id='T1', file='trails/T1.json')]))
    cps = [dict(id='C' + str(i), focus='interaction', verify='assert_dom', automation='full', origin='oracle' if i < 3 else 'derived', oracle_ids=['O-1'] if i < 3 else [], assertion='Saved value equals expected', expected_source='spec') for i in (1, 2, 3)]
    dump(root / 'trails/T1.json', dict(id='T1', mock_setup=dict(required=False, status='not_needed'), steps=[dict(id='S1', action='read', checkpoints=cps)]))
    (root / 'observations.jsonl').write_bytes(b'')
    (root / 'evidence/sample.png').write_bytes(b'synthetic-image')
    return root


def ready_checking(root):
    root = make_checking(root)
    for script, args in [('validate_oracle', ['--freeze']), ('confirm', ['--selected', 'single_agent'])]:
        p = run_cli(script, '--checking-dir', root, *args)
        if p.returncode:
            raise AssertionError(p.stderr)
    return root


def observation(checkpoint='C1', status='pass', **kw):
    value = dict(checkpoint_id=checkpoint, loop=1, batch=None, env={}, status=status, actual='Saved value verified', evidence=[dict(path='evidence/sample.png', kind='screenshot', scope='exact')], limits=[], supersedes=None)
    value.update(kw)
    return value


def append(root, value=None, rev=1):
    return run_cli('observe', 'append', '--checking-dir', root, '--expected-plan-rev', rev, '--json', json.dumps(value or observation()))


def write_report(root):
    p = run_cli('status', '--checking-dir', root, '--markdown')
    if p.returncode:
        raise AssertionError(p.stderr)
    headings = ['## Mock 证据', '### Surface × 数据态覆盖', '## 执行策略', '## 期望来源缺口', '### 未覆盖 / 天然盲区', '### 未覆盖的 oracle', '### 派生 checkpoint']
    (root / 'report.md').write_text('\n'.join(headings) + '\n' + p.stdout, encoding='utf-8')


class ModelGates(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = make_checking(Path(self.tmp.name))

    def cli(self, name, *args):
        return run_cli(name, '--checking-dir', self.root, *args)

    def ok(self, p):
        self.assertEqual(p.returncode, 0, p.stderr)

    def bad(self, p, text):
        self.assertNotEqual(p.returncode, 0)
        self.assertIn(text, p.stderr)
        self.assertNotIn('Traceback', p.stderr)

    def freeze(self):
        self.ok(self.cli('validate_oracle', '--freeze'))

    def ready(self):
        self.freeze()
        self.ok(self.cli('confirm', '--selected', 'single_agent'))

    def change(self, filename, mutate):
        path = self.root / filename
        value = json.loads(path.read_text())
        mutate(value)
        dump(path, value)

    def test_cv_004(self):
        self.freeze()
        meta = json.loads((self.root / 'plan.json').read_text())['meta']
        self.assertEqual(meta['oracle_freeze']['sha256'], hashlib.sha256((self.root / 'oracle.json').read_bytes()).hexdigest())
        self.assertIsNone(meta['active_plan_rev'])

    def test_cv_005(self):
        self.freeze()
        self.change('oracle.json', lambda x: x['items'][0].update(expected='Changed'))
        self.bad(self.cli('validate_trail_gate'), '冻结后被修改')

    def test_cv_006(self):
        self.freeze()
        self.change('plan.json', lambda x: x['meta'].update(active_plan_rev=1))
        before = (self.root / 'observations.jsonl').read_bytes()
        self.change('oracle.json', lambda x: x['items'][0].update(expected='Changed'))
        self.freeze()
        self.assertIsNone(json.loads((self.root / 'plan.json').read_text())['meta']['active_plan_rev'])
        self.assertEqual(before, (self.root / 'observations.jsonl').read_bytes())

    def test_cv_007(self):
        self.change('oracle.json', lambda x: x['items'][1].update(id='O-1'))
        self.bad(self.cli('validate_oracle'), 'O-1')
        self.change('oracle.json', lambda x: x['items'][1].update(id='O-2', priority='P5'))
        self.bad(self.cli('validate_oracle'), 'items[1].priority')

    def test_cv_008(self):
        self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update(oracle_ids=['O-1', 'O-2']))
        self.freeze()
        self.ok(self.cli('validate_trail_gate'))

    def test_cv_009(self):
        self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update(oracle_ids=['AC-9']))
        self.freeze()
        p = self.cli('validate_trail_gate')
        self.bad(p, 'AC-9')
        self.assertIn('T1.json', p.stderr)
        self.assertIn('C1', p.stderr)

    def test_cv_010(self):
        self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update(oracle_ids=[]))
        self.freeze()
        self.bad(self.cli('validate_trail_gate'), 'derived')

    def test_cv_011(self):
        self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update(result='pass'))
        self.freeze()
        self.bad(self.cli('validate_trail_gate'), 'observations.jsonl')

    def records(self):
        return [json.loads(line) for line in (self.root / 'observations.jsonl').read_text().splitlines()]

    def test_cv_012(self):
        self.ready()
        self.ok(append(self.root))
        self.assertEqual(self.records()[0]['plan_rev'], 1)

    def test_cv_013(self):
        self.freeze()
        before = (self.root / 'observations.jsonl').read_bytes()
        self.bad(append(self.root), '确认计划')
        self.assertEqual(before, (self.root / 'observations.jsonl').read_bytes())

    def test_cv_014(self):
        self.freeze()
        for args in [('--selected', 'swarm'), ()]:
            before = (self.root / 'plan.json').read_bytes()
            self.bad(self.cli('confirm', *args), 'selected')
            self.assertEqual(before, (self.root / 'plan.json').read_bytes())

    def test_cv_015(self):
        self.ready()
        self.change('plan.json', lambda x: x.update(agent_assignments={'T1': 'worker'}))
        self.bad(append(self.root), '执行输入已变化')

    def test_cv_016(self):
        self.ready()
        self.change('plan.json', lambda x: x['meta'].update(external_doc_url='https://docs.example/d/1'))
        self.ok(append(self.root))
        self.assertEqual(self.records()[0]['plan_rev'], 1)

    def test_cv_017(self):
        self.ready()
        self.ok(append(self.root))
        before = (self.root / 'observations.jsonl').read_bytes()
        self.ok(self.cli('confirm', '--selected', 'single_agent'))
        self.assertEqual(json.loads((self.root / 'plan.json').read_text())['meta']['active_plan_rev'], 2)
        self.assertEqual(before, (self.root / 'observations.jsonl').read_bytes())

    def test_cv_018(self):
        self.ready()
        self.ok(append(self.root))
        self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update(oracle_ids=['O-2']))
        self.bad(append(self.root), '确认计划')
        self.ok(self.cli('confirm', '--selected', 'single_agent'))
        self.assertEqual(json.loads((self.root / 'plan.json').read_text())['meta']['active_plan_rev'], 2)

    def test_cv_019(self):
        self.ready()
        self.ok(append(self.root, observation('C3')))
        self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][2].update(assertion='New derived assertion'))
        self.bad(append(self.root), '确认计划')
        self.ok(self.cli('confirm', '--selected', 'single_agent'))

    def test_cv_020(self):
        self.ready()
        self.ok(append(self.root))
        self.ok(append(self.root))
        before = (self.root / 'observations.jsonl').read_bytes()
        self.ok(append(self.root))
        self.assertTrue((self.root / 'observations.jsonl').read_bytes().startswith(before))
        self.assertEqual(len(self.records()), 3)
        self.assertEqual(self.records()[2]['obs_id'], 'obs-0003')
        self.assertIn('at', self.records()[2])

    def concurrent(self, *values):
        processes = [subprocess.Popen([sys.executable, '-B', str(SCRIPTS / 'observe.py'), 'append', '--checking-dir', str(self.root), '--expected-plan-rev', '1', '--json', json.dumps(value)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for value in values]
        return [(p.wait(), p.communicate()) for p in processes]

    def test_cv_021(self):
        self.ready()
        results = self.concurrent(observation(), observation())
        self.assertEqual([x[0] for x in results], [0, 0], results)
        records = self.records()
        self.assertEqual(len(records), 2)
        self.assertEqual(len({x['obs_id'] for x in records}), 2)

    def test_cv_022(self):
        self.ready()
        self.ok(self.cli('confirm', '--selected', 'single_agent'))
        before = (self.root / 'observations.jsonl').read_bytes()
        self.bad(append(self.root, rev=1), 'expected-plan-rev')
        self.bad(self.cli('observe', 'append', '--json', json.dumps(observation())), 'expected-plan-rev')
        self.freeze()
        self.bad(append(self.root, rev=2), '确认计划')
        self.assertEqual(before, (self.root / 'observations.jsonl').read_bytes())

    def test_cv_023(self):
        self.ready()
        self.ok(self.cli('confirm', '--selected', 'single_agent'))
        self.ok(append(self.root, rev=2))
        self.assertEqual(self.records()[0]['plan_rev'], 2)

    def test_cv_024(self):
        self.ready()
        for value, field in [(observation(status='ok'), 'status'), (observation('absent'), 'checkpoint_id')]:
            before = (self.root / 'observations.jsonl').read_bytes()
            self.bad(append(self.root, value), field)
            self.assertEqual(before, (self.root / 'observations.jsonl').read_bytes())

    def state(self):
        p = self.cli('status')
        self.ok(p)
        return json.loads(p.stdout)

    def test_cv_025(self):
        self.ready()
        self.ok(append(self.root))
        row = self.records()[0]
        self.assertEqual(row['evidence'][0]['sha256'], hashlib.sha256((self.root / 'evidence/sample.png').read_bytes()).hexdigest())

    def test_cv_026(self):
        self.ready()
        self.bad(append(self.root, observation(evidence=[])), 'limits')
        self.ok(append(self.root, observation(evidence=[], limits=['No screenshot available'])))

    def test_cv_027(self):
        self.ready()
        self.ok(append(self.root))
        self.ok(append(self.root, observation('C2')))
        (self.root / 'evidence/sample.png').write_bytes(b'changed')
        p = self.cli('validate_execution_gate')
        self.bad(p, 'evidence/sample.png')
        self.assertIn('obs-0001', p.stderr)

    def test_cv_028(self):
        self.ready()
        outside = Path(self.tmp.name).parent / ('outside-' + Path(self.tmp.name).name)
        outside.write_bytes(b'synthetic')
        self.addCleanup(outside.unlink)
        (self.root / 'evidence/link').symlink_to(outside)
        for path in ('../other/x.png', '/tmp/x.png', 'scratch/x.png', 'evidence/link'):
            self.bad(append(self.root, observation(evidence=[dict(path=path, kind='screenshot', scope='exact')])), path)
        self.assertEqual(self.records(), [])

    def test_cv_029(self):
        self.ready()
        self.ok(append(self.root, observation(status='fail')))
        before = (self.root / 'observations.jsonl').read_bytes()
        self.ok(append(self.root, observation(supersedes='obs-0001', actual='Corrected after retest')))
        self.assertTrue((self.root / 'observations.jsonl').read_bytes().startswith(before))
        self.assertEqual(self.state()['checkpoints']['C1']['status'], 'pass')

    def test_cv_030(self):
        self.ready()
        self.ok(append(self.root, observation(status='fail', env={'role': 'member'})))
        for value in [observation('C2', supersedes='obs-0001', env={'role': 'member'}), observation(supersedes='obs-0001', env={'role': 'admin'}), observation(supersedes='obs-0001', env={'role': 'member', 'shape': 'desktop'})]:
            self.bad(append(self.root, value), 'supersedes')
        self.ok(append(self.root, observation(supersedes='obs-0001', env={'role': 'member', 'app_version': '2'})))
        self.bad(append(self.root, observation(supersedes='obs-0001', env={'role': 'member'})), 'supersedes')

    def test_cv_031(self):
        self.ready()
        self.ok(append(self.root, observation(status='fail')))
        results = self.concurrent(observation(supersedes='obs-0001'), observation(supersedes='obs-0001'))
        self.assertEqual(sorted(x[0] for x in results), [0, 1], results)
        self.assertEqual(len(self.records()), 2)

    def test_cv_032(self):
        self.ready()
        self.ok(append(self.root, observation('C3')))
        row = self.records()[0]
        for rev in (None, 999):
            changed = dict(row)
            if rev is None:
                changed.pop('plan_rev')
            else:
                changed['plan_rev'] = rev
            (self.root / 'observations.jsonl').write_text(json.dumps(changed) + '\n')
            p = self.cli('validate_execution_gate')
            self.bad(p, 'plan_rev')
            self.assertIn('1', p.stderr)

    def test_cv_033(self):
        self.ready()
        self.ok(append(self.root, observation(loop=2, env={'role': 'admin'})))
        self.ok(append(self.root, observation(status='fail', loop=2, env={'role': 'member'})))
        state = self.state()
        self.assertEqual(state['checkpoints']['C1']['status'], 'fail')
        self.assertEqual(state['counts']['fail'], 1)

    def test_cv_034(self):
        self.test_cv_033()
        self.ok(append(self.root, observation(loop=3, env={'role': 'admin'})))
        self.assertEqual(self.state()['checkpoints']['C1']['status'], 'fail')

    def test_cv_035(self):
        self.test_cv_034()
        self.ok(append(self.root, observation(loop=3, supersedes='obs-0002', env={'role': 'member', 'app_version': '2'})))
        self.assertEqual(self.state()['checkpoints']['C1']['status'], 'pass')

    def test_cv_036(self):
        self.ready()
        self.ok(append(self.root))
        self.ok(append(self.root, observation('C2', status='blocked')))
        self.assertEqual(self.state()['continue'], ['C2', 'C3'])
        self.assertEqual(self.state()['trails']['T1'], 'blocked')

    def test_cv_037(self):
        self.ready()
        for cp in ('C1', 'C2', 'C3'):
            self.ok(append(self.root, observation(cp)))
        write_report(self.root)
        path = self.root / 'report.md'
        path.write_text(path.read_text().replace('| pass | 3 |', '| pass | 4 |'))
        self.bad(self.cli('validate_execution_gate', '--require-report'), '摘要')

    def complete(self):
        self.ready()
        for cp in ('C1', 'C2', 'C3'):
            self.ok(append(self.root, observation(cp)))

    def test_cv_038(self):
        self.complete()
        write_report(self.root)
        self.ok(self.cli('validate_execution_gate', '--require-report'))

    def test_cv_039(self):
        self.complete()
        p = self.cli('validate_execution_gate')
        self.ok(p)
        self.assertIn('O-2', p.stdout)
        self.assertIn('C3 (pass)', p.stdout)

    def test_cv_040(self):
        self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update(expected_unverified=True))
        self.complete()
        self.bad(self.cli('validate_execution_gate'), 'expected_unverified')

    def test_cv_041(self):
        self.complete()
        write_report(self.root)
        path = self.root / 'report.md'
        path.write_text(path.read_text().replace('### 派生 checkpoint', ''))
        self.bad(self.cli('validate_execution_gate', '--require-report'), '### 派生 checkpoint')

    def test_cv_042(self):
        self.change('trails/T1.json', lambda x: x.update(mock_setup=dict(required=True, status='unknown', user_decision=None)))
        self.freeze()
        self.bad(self.cli('validate_mock_gate'), '缺少 user_decision')

    def test_cv_043(self):
        self.change('trails/T1.json', lambda x: x['steps'][0].update(action='click'))
        self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update(assertion='按钮可见'))
        self.freeze()
        self.bad(self.cli('validate_trail_gate'), 'presence-only')

    def test_cv_044(self):
        self.change('trails/T1.json', lambda x: x.update(mock_setup=dict(required=True, status='available', evidence=['Synthetic fixture'])))
        self.change('trails/T1.json', lambda x: x['steps'][0].update(action='click'))
        self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update(consequence=True))
        self.freeze()
        self.ok(self.cli('validate_mock_gate'))
        self.ok(self.cli('validate_trail_gate'))

    def test_cv_045(self):
        self.change('trails/T1.json', lambda x: x.update(mock_setup=dict(required=True, status='unknown', user_decision='Use manual mock')))
        self.freeze()
        for automation in ('full', 'partial'):
            for status in ('missing', 'unknown'):
                self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update(automation=automation, mock_status=status, mock_user_decision=None))
                self.bad(self.cli('validate_mock_gate'), '未确认，不能继续自动化')
                self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update(mock_user_decision='Use prepared fixture'))
                self.ok(self.cli('validate_mock_gate'))

    def test_cv_046(self):
        self.ready()
        self.ok(append(self.root, observation(status='manual', actual='已渲染 surface 但按钮不存在')))
        for cp in ('C2', 'C3'):
            self.ok(append(self.root, observation(cp)))
        self.bad(self.cli('validate_execution_gate'), '必须为 fail')
        self.ok(append(self.root, observation(status='fail', actual='已渲染 surface 但按钮不存在', supersedes='obs-0001')))
        self.ok(self.cli('validate_execution_gate'))
        self.ok(append(self.root, observation(status='blocked', actual='等待登录页面', supersedes='obs-0004')))
        self.ok(self.cli('validate_execution_gate'))

    def test_cv_047(self):
        self.ready()
        self.ok(append(self.root, observation(status='blocked')))
        self.ok(append(self.root, observation('C2', status='partial')))
        self.ok(append(self.root, observation('C3')))
        self.ok(self.cli('validate_execution_gate'))
        state = self.state()
        self.assertEqual(state['counts']['pass'], 1)
        self.assertEqual(state['counts']['blocked'], 1)
        self.assertEqual(state['counts']['partial'], 1)

    def test_revision_reset_pending(self):
        self.complete()
        self.ok(self.cli('confirm', '--selected', 'single_agent'))
        self.assertEqual(self.state()['counts']['pending'], 3)
        self.assertEqual(self.state()['continue'], ['C1', 'C2', 'C3'])
        self.bad(append(self.root, observation(supersedes='obs-0001'), rev=2), 'supersedes')

    def test_strict_json_and_indexes(self):
        self.freeze()
        path = self.root / 'plan.json'
        original = path.read_text()
        for text in ['{"meta":{},"meta":{}}', '{"value":NaN}', '{"value":Infinity}']:
            path.write_text(text)
            self.assertNotEqual(self.cli('confirm', '--selected', 'single_agent').returncode, 0)
        path.write_text(original)
        self.change('plan.json', lambda x: x.update(trails=[]))
        self.bad(self.cli('confirm', '--selected', 'single_agent'), '一一对应')

    def test_mock_evidence_surface_regressions(self):
        self.freeze()
        self.change('trails/T1.json', lambda x: x.update(mock_setup=dict(status='available', required=True)))
        self.bad(self.cli('validate_mock_gate'), 'evidence')
        self.change('trails/T1.json', lambda x: x['mock_setup'].update(evidence=['fixture']))
        self.ok(self.cli('validate_mock_gate'))
        self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update(data_scenario='empty'))
        self.bad(self.cli('validate_mock_gate'), 'surface')
        self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update(surface='results panel'))
        self.ok(self.cli('validate_mock_gate'))

    def test_trail_discipline_regressions(self):
        self.freeze()
        self.change('trails/T1.json', lambda x: x['steps'][0].update(action='click'))
        self.bad(self.cli('validate_trail_gate'), 'consequence')
        self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update(consequence=True, expected_source='implementation'))
        self.bad(self.cli('validate_trail_gate'), 'expected_unverified')
        self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update(expected_unverified=True, input_method='ime'))
        self.bad(self.cli('validate_trail_gate'), 'IME')
        self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update(automation='manual'))
        self.ok(self.cli('validate_trail_gate'))

    def test_history_removed_checkpoint_and_assets(self):
        self.ready()
        self.ok(append(self.root, observation('C3')))
        self.change('trails/T1.json', lambda x: x['steps'][0].update(checkpoints=x['steps'][0]['checkpoints'][:2]))
        self.ok(self.cli('confirm', '--selected', 'single_agent'))
        self.assertEqual(set(self.state()['checkpoints']), {'C1', 'C2'})
        (self.root / 'evidence/sample.png').write_bytes(b'changed historical asset')
        self.bad(self.cli('status'), 'obs-0001')

    def test_actual_length_and_pending(self):
        self.ready()
        self.bad(self.cli('validate_execution_gate'), 'pending')
        for cp in ('C1', 'C2', 'C3'):
            self.ok(append(self.root, observation(cp, status='manual', actual='short')))
        self.bad(self.cli('validate_execution_gate'), '6')

    def test_readers_do_not_write(self):
        self.complete()
        before = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.ok(self.cli('status'))
        self.ok(self.cli('validate_execution_gate'))
        after = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_null_freeze_friendly(self):
        self.change('plan.json', lambda x: x['meta'].update(oracle_freeze=None))
        for script in ('validate_trail_gate', 'validate_mock_gate', 'confirm', 'status', 'validate_execution_gate'):
            self.bad(self.cli(script), '冻结')

    def test_documented_execution_strategy_and_fields(self):
        self.change('plan.json', lambda x: x.update(execution_strategy={}))
        self.change('plan.json', lambda x: x['meta'].update(execution_strategy={'recommendation': 'single_only'}))
        self.freeze()
        self.bad(self.cli('confirm', '--selected', 'swarm'), 'selected')
        self.change('trails/T1.json', lambda x: x['steps'][0].update(action='click'))
        self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update(expected_text='保存成功', selector="[role='status']"))
        self.ok(self.cli('validate_trail_gate'))
        self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update(data_scenario_required=True))
        self.bad(self.cli('validate_mock_gate'), 'surface')

    def test_structure_reader_defers_asset_checks(self):
        sys.path.insert(0, str(SCRIPTS))
        self.addCleanup(lambda: sys.path.remove(str(SCRIPTS)))
        from _model import calculate_status
        self.ready()
        self.ok(append(self.root))
        path = self.root / 'evidence/sample.png'
        path.unlink()
        path.symlink_to('/tmp/nonexistent-case-verify-evidence')
        self.assertEqual(calculate_status(self.root, check_assets=False)['counts']['pass'], 1)
        self.bad(self.cli('status'), '越界')

    def test_structured_presence_only_rejected(self):
        def presence(value):
            cp = value['steps'][0]['checkpoints'][0]
            cp.pop('assertion')
            cp.update(description='Save control', selector='#save', expected_visible=True)
        self.change('trails/T1.json', presence)
        self.freeze()
        for automation in ('full', 'partial'):
            self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update(automation=automation))
            self.bad(self.cli('validate_trail_gate'), 'presence-only')
        self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update(expected_text='Saved successfully'))
        self.ok(self.cli('validate_trail_gate'))

    def test_malformed_plan_friendly(self):
        for value in ([], None, 42, {'meta': []}, {'trails': [None]}):
            dump(self.root / 'plan.json', value)
            for script in ('validate_oracle', 'validate_mock_gate', 'validate_trail_gate', 'confirm', 'observe', 'status', 'validate_execution_gate'):
                self.bad(self.cli(script), 'plan')

    def test_checkpoint_required_enums(self):
        self.freeze()
        original = json.loads((self.root / 'trails/T1.json').read_text())
        for key, values in {'automation': ['ful', None], 'focus': ['functional', None], 'verify': ['assert_magic', None]}.items():
            for value in values:
                dump(self.root / 'trails/T1.json', original)
                self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].update({key: value}))
                for script in ('validate_trail_gate', 'validate_mock_gate', 'confirm'):
                    self.bad(self.cli(script, *(['--selected', 'single_agent'] if script == 'confirm' else [])), key)
        dump(self.root / 'trails/T1.json', original)
        self.change('trails/T1.json', lambda x: x['steps'][0]['checkpoints'][0].pop('automation'))
        self.bad(self.cli('confirm', '--selected', 'single_agent'), 'automation')

    def test_nested_container_errors_qualified(self):
        self.freeze()
        original = json.loads((self.root / 'trails/T1.json').read_text())
        for value, field in [([], 'T1.json'), ({'id': 'T1', 'steps': [None]}, 'steps[0]'), ({'id': 'T1', 'steps': [{'checkpoints': [None]}]}, 'checkpoints[0]'), ({'steps': []}, 'id'), ({'id': 'T1', 'steps': None}, 'steps')]:
            dump(self.root / 'trails/T1.json', value)
            self.bad(self.cli('validate_trail_gate'), field)
        dump(self.root / 'trails/T1.json', original)
        self.ok(self.cli('confirm', '--selected', 'single_agent'))
        (self.root / 'observations.jsonl').write_text('[]\n')
        self.bad(self.cli('status'), 'observations.jsonl 第 1 行')

    def test_supersede_env_json_types(self):
        self.ready()
        for old_env, new_env in [({'flag': True}, {'flag': 1}), ({'nested': {'values': [False]}}, {'nested': {'values': [0]}})]:
            self.ok(append(self.root, observation(status='fail', env=old_env)))
            target = self.records()[-1]['obs_id']
            before = (self.root / 'observations.jsonl').read_bytes()
            self.bad(append(self.root, observation(env=new_env, supersedes=target)), '执行维度')
            self.assertEqual(before, (self.root / 'observations.jsonl').read_bytes())
            self.ok(append(self.root, observation(env=dict(old_env, app_version='new'), supersedes=target)))

    def test_cv_003(self):
        fragment = self.root / 'fragment.json'
        dump(fragment, dict(items=json.loads((self.root / 'oracle.json').read_text())['items']))
        (self.root / 'plan.json').unlink()
        self.ok(run_cli('validate_oracle', '--fragment', fragment))
        self.assertFalse((self.root / 'plan.json').exists())

    def test_cv_002(self):
        (self.root / 'plan.json').unlink()
        (self.root / 'plan.yaml').write_text('trails: []')
        self.bad(self.cli('validate_trail_gate'), '旧格式 checking 目录不受支持')

    def test_cv_001(self):
        self.freeze()
        self.ok(self.cli('validate_trail_gate'))


if __name__ == '__main__':
    unittest.main()
