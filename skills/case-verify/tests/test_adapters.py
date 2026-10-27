"""Adapter contract tests use only local synthetic executables and directories."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('adapters', SCRIPTS / 'adapters.py')
adapters = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapters)


def item(number=1):
    return dict(id='O-' + str(number), title='Save record', input='Click save',
                expected='Record saved', precondition=None, entry_point=None,
                reviewer_notes=None, provenance='independent', source='untrusted',
                path=[], priority='P1', expected_source='spec')


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.checking = self.root / 'checking'
        self.checking.mkdir()
        self.env = patch.dict(os.environ, {'CASE_VERIFY_ADAPTERS': str(self.bin)})
        self.env.start()
        self.addCleanup(self.env.stop)

    def adapter(self, filename='qa', name='qa', provenance='independent', kind='oracle-source',
                fragment=None, exit_code=0, describe=None, extra=''):
        description = dict(name=name, kind=kind)
        if kind == 'oracle-source':
            description.update(match=r'^https://qa\.example/', provenance=provenance)
        text = json.dumps(description) if describe is None else describe
        fragment = {'items': [item(1), item(2)]} if fragment is None else fragment
        script = self.bin / filename
        script.write_text('#!' + sys.executable + '\n' +
            'import json, os, pathlib, sys\n'
            'if sys.argv[1] == "--describe":\n'
            '    print(' + repr(text) + ')\n'
            '    sys.exit(0)\n' + extra +
            'if sys.argv[1] == "fetch":\n'
            '    out = pathlib.Path(sys.argv[sys.argv.index("--out") + 1])\n'
            '    (out / "oracle.fragment.json").write_text(' + repr(json.dumps(fragment)) + ')\n'
            '    print("fetch diagnostic", file=sys.stderr)\n'
            'else:\n'
            '    pathlib.Path("push-called").write_text(os.environ.get("CASE_VERIFY_EXTERNAL_DOC_URL", ""))\n'
            '    print("https://docs.example/d/1")\n'
            'sys.exit(' + str(exit_code) + ')\n', encoding='utf-8')
        script.chmod(0o755)
        return script

    def gate(self, command, **kwargs):
        if any(Path(arg).name == 'validate_execution_gate.py' for arg in command):
            self.assertIn('--require-report', command)
            return subprocess.CompletedProcess(command, 0, '', '')
        return self.real_run(command, **kwargs)

    def push_setup(self):
        self.adapter(kind='report-sink')
        (self.checking / 'plan.json').write_text(json.dumps({'meta': {'external_doc_url': None}}))
        (self.checking / 'report.md').write_text('local report')
        (self.checking / 'observations.jsonl').write_text('local observations\n')
        self.real_run = subprocess.run

    def test_cv_052(self):
        script = self.adapter()
        result = adapters.match('https://qa.example/case/42')
        self.assertEqual(result['path'], str(script))
        self.assertEqual(result['description']['name'], 'qa')
        cli = subprocess.run([sys.executable, str(SCRIPTS / 'adapters.py'), 'match',
                              'https://qa.example/case/42'], capture_output=True, text=True)
        self.assertEqual(cli.returncode, 0, cli.stderr)
        self.assertEqual(json.loads(cli.stdout)['path'], str(script))

    def test_cv_053(self):
        with self.assertRaisesRegex(ValueError, '无匹配'):
            adapters.match('https://qa.example/case/42')
        self.adapter()
        self.adapter(filename='other', name='other')
        with self.assertRaisesRegex(ValueError, 'other.*qa|qa.*other'):
            adapters.match('https://qa.example/case/42')

    def test_cv_054(self):
        self.adapter(filename='unsafe', name='../../trails')
        self.adapter(filename='one')
        self.adapter(filename='two')
        found = adapters.discover()
        self.assertEqual(found['adapters'], [])
        self.assertEqual(len(found['excluded']), 3)
        self.assertIn('名称不合法', str(found))
        self.assertIn('名称冲突', str(found))
        for filename in ('unsafe', 'one', 'two'):
            self.assertIn(str(self.bin / filename), str(found))

    def test_cv_055(self):
        self.adapter(describe='not JSON')
        found = adapters.discover()
        self.assertEqual(found['adapters'], [])
        self.assertIn(str(self.bin / 'qa'), str(found['excluded']))
        self.assertTrue(found['excluded'][0]['reason'])

    def test_cv_056(self):
        self.adapter()
        result = adapters.fetch('https://qa.example/case/1', self.checking)
        self.assertEqual(len(result['items']), 2)
        self.assertTrue(all(i['source'] == 'qa' and i['provenance'] == 'independent'
                            for i in result['items']))
        stored = json.loads((self.checking / 'oracle-sources/qa/1/oracle.fragment.json').read_text())
        self.assertEqual(stored['items'], result['items'])
        self.assertFalse((self.checking / 'oracle.json').exists())

    def test_cv_057(self):
        self.adapter(provenance='spec')
        result = adapters.fetch('https://qa.example/case/1', self.checking)
        self.assertTrue(all(i['provenance'] == 'spec' for i in result['items']))

    def test_cv_058(self):
        self.adapter()
        adapters.fetch('https://qa.example/case/1', self.checking)
        first = (self.checking / 'oracle-sources/qa/1/oracle.fragment.json').read_bytes()
        adapters.fetch('https://qa.example/case/2', self.checking)
        self.assertEqual(first, (self.checking / 'oracle-sources/qa/1/oracle.fragment.json').read_bytes())
        self.assertTrue((self.checking / 'oracle-sources/qa/2/oracle.fragment.json').is_file())

    def test_cv_059(self):
        invalid = item()
        del invalid['expected']
        self.adapter(fragment={'items': [invalid]})
        with self.assertRaisesRegex(ValueError, r'(?s)(0.*expected|expected.*0)'):
            adapters.fetch('https://qa.example/case/1', self.checking)
        self.assertFalse((self.checking / 'oracle.json').exists())

    def test_cv_060(self):
        self.adapter(exit_code=7)
        real = subprocess.run
        commands = []
        def run(command, **kwargs):
            commands.append(command)
            return real(command, **kwargs)
        with patch.object(adapters.subprocess, 'run', side_effect=run):
            with self.assertRaisesRegex(ValueError, '(?s)7.*fetch diagnostic'):
                adapters.fetch('https://qa.example/case/1', self.checking)
        self.assertFalse(any('validate_oracle.py' in str(c) for c in commands))

    def test_cv_061(self):
        with self.assertRaisesRegex(ValueError, 'XMind'):
            adapters.fetch('https://qa.example/case/1', self.checking)

    def test_cv_062(self):
        self.push_setup()
        with patch.object(adapters.subprocess, 'run', side_effect=self.gate):
            self.assertEqual(adapters.push('qa', self.checking), 'https://docs.example/d/1')
            self.assertEqual((self.checking / 'push-called').read_text(), '')
            adapters.push('qa', self.checking)
        self.assertEqual((self.checking / 'push-called').read_text(), 'https://docs.example/d/1')
        plan = json.loads((self.checking / 'plan.json').read_text())
        self.assertEqual(plan['meta']['external_doc_url'], 'https://docs.example/d/1')

    def test_cv_063(self):
        self.push_setup()
        before = (self.checking / 'plan.json').read_bytes()
        for problem in ('报告缺失', '缺章节', '摘要不一致'):
            def gate(command, **kwargs):
                if any(Path(arg).name == 'validate_execution_gate.py' for arg in command):
                    self.assertIn('--require-report', command)
                    return subprocess.CompletedProcess(command, 1, '', problem)
                return self.real_run(command, **kwargs)
            with self.subTest(problem=problem), patch.object(adapters.subprocess, 'run', side_effect=gate):
                with self.assertRaisesRegex(ValueError, problem):
                    adapters.push('qa', self.checking)
                self.assertFalse((self.checking / 'push-called').exists())
                self.assertEqual((self.checking / 'plan.json').read_bytes(), before)

    def test_cv_064(self):
        self.push_setup()
        self.adapter(kind='report-sink', exit_code=3)
        before = {p: (self.checking / p).read_bytes() for p in
                  ('plan.json', 'report.md', 'observations.jsonl')}
        with patch.object(adapters.subprocess, 'run', side_effect=self.gate):
            with self.assertRaisesRegex(ValueError, '3'):
                adapters.push('qa', self.checking)
        for path, content in before.items():
            self.assertEqual((self.checking / path).read_bytes(), content)

    def test_parallel_fetch_directories_are_unique(self):
        self.adapter()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda number: adapters.fetch(
                'https://qa.example/case/' + str(number), self.checking), (1, 2)))
        self.assertEqual(len({r['fragment_path'] for r in results}), 2)
        self.assertTrue((self.checking / 'oracle-sources/qa/1/oracle.fragment.json').is_file())
        self.assertTrue((self.checking / 'oracle-sources/qa/2/oracle.fragment.json').is_file())

    def test_fetch_rejects_old_format_before_execution(self):
        self.adapter()
        (self.checking / 'plan.yaml').write_text('trails: []')
        with self.assertRaisesRegex(ValueError, '旧格式 checking 目录不受支持'):
            adapters.fetch('https://qa.example/case/1', self.checking)
        self.assertFalse((self.checking / 'oracle-sources').exists())

    def test_discovery_trust_boundaries(self):
        self.assertEqual(adapters.discover(), {'adapters': [], 'excluded': []})
        executable = self.adapter()
        (self.bin / 'linked').symlink_to(executable)
        (self.bin / 'not-executable').write_text('not a candidate')
        (self.bin / 'directory').mkdir()
        self.assertEqual(len(adapters.discover()['adapters']), 1)
        other = self.root / 'other'
        other.mkdir()
        duplicate = other / 'duplicate'
        duplicate.write_bytes(executable.read_bytes())
        duplicate.chmod(0o755)
        with patch.dict(os.environ, {'CASE_VERIFY_ADAPTERS': str(self.bin) + ':' + str(other)}):
            found = adapters.discover()
        self.assertEqual(found['adapters'], [])
        self.assertEqual(len(found['excluded']), 2)
        with patch.object(adapters.subprocess, 'run', side_effect=subprocess.TimeoutExpired('describe', 10)):
            self.assertIn('timed out', str(adapters.discover()['excluded']))
        with patch.object(adapters.subprocess, 'run', return_value=subprocess.CompletedProcess([], 4, '', 'failure')):
            self.assertIn('4', str(adapters.discover()['excluded']))

    def test_malformed_descriptors_are_excluded(self):
        descriptions = [[], {'name': 'qa', 'kind': 'unknown'},
                        {'name': 'qa', 'kind': 'oracle-source', 'match': '[', 'provenance': 'spec'},
                        {'name': 'qa', 'kind': 'oracle-source', 'match': '.*', 'provenance': 'derived'},
                        {'name': 'qa', 'kind': 'oracle-source', 'match': 3, 'provenance': 'spec'}]
        for description in descriptions:
            with self.subTest(description=description):
                self.adapter(describe=json.dumps(description))
                found = adapters.discover()
                self.assertEqual(found['adapters'], [])
                self.assertEqual(len(found['excluded']), 1)

    def test_non_utf8_description_is_excluded(self):
        executable = self.adapter()
        executable.write_text('#!' + sys.executable + '\nimport os\nos.write(1, b"\\xff")\n')
        found = adapters.discover()
        self.assertEqual(found['adapters'], [])
        self.assertEqual(len(found['excluded']), 1)

    def test_fetch_rejects_symlinks(self):
        self.adapter()
        outside = self.root / 'outside'
        outside.mkdir()
        (self.checking / 'oracle-sources').symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, '符号链接'):
            adapters.fetch('https://qa.example/case/1', self.checking)
        self.assertEqual(list(outside.iterdir()), [])

    def test_fetch_rejects_symlink_output(self):
        target = self.root / 'untouched.json'
        content = json.dumps({'items': [item()]})
        target.write_text(content)
        self.adapter(extra='out = pathlib.Path(sys.argv[sys.argv.index("--out") + 1])\n'
                     '(out / "oracle.fragment.json").symlink_to(' + repr(str(target)) + ')\n'
                     'sys.exit(0)\n')
        with self.assertRaisesRegex(ValueError, '符号链接'):
            adapters.fetch('https://qa.example/case/1', self.checking)
        self.assertEqual(target.read_text(), content)

    def test_run_timeout_and_bounded_log(self):
        self.adapter(extra='import time\nprint("started", flush=True)\ntime.sleep(30)\n')
        with patch.object(adapters, 'RUN_TIMEOUT', 0.1):
            with self.assertRaisesRegex(ValueError, 'timeout'):
                adapters.fetch('https://qa.example/case/1', self.checking)
        self.assertLessEqual((self.checking / 'oracle-sources/qa/1/adapter.txt').stat().st_size, 4096)
        self.adapter(extra='print("x" * 10000)\nprint("y" * 10000, file=sys.stderr)\n')
        adapters.fetch('https://qa.example/case/1', self.checking)
        self.assertLessEqual((self.checking / 'oracle-sources/qa/2/adapter.txt').stat().st_size, 4096)

    def test_sample_adapter_contract(self):
        sample = Path(__file__).parent / 'fixtures/adapters/sample-qa'
        self.assertTrue(sample.is_file(), 'sample adapter contract fixture missing')
        source = self.root / 'sample.json'
        source.write_text(json.dumps({'items': [item()]}))
        with patch.dict(os.environ, {'CASE_VERIFY_ADAPTERS': str(sample.parent),
                                    'CASE_VERIFY_SAMPLE_JSON': str(source)}):
            result = adapters.fetch('https://qa.example/case/1', self.checking)
        self.assertEqual(result['items'][0]['source'], 'sample-qa')

    def real_push_setup(self):
        from test_model_gates import ready_checking, append, observation, write_report
        ready_checking(self.checking)
        for checkpoint in ('C1', 'C2', 'C3'):
            result = append(self.checking, observation(checkpoint))
            self.assertEqual(result.returncode, 0, result.stderr)
        write_report(self.checking)
        self.adapter(kind='report-sink')

    def test_push_real_gate_and_revision(self):
        self.real_push_setup()
        from test_model_gates import run_cli
        before = json.loads((self.checking / 'plan.json').read_text())
        report = (self.checking / 'report.md').read_bytes()
        observations = (self.checking / 'observations.jsonl').read_bytes()
        adapters.push('qa', self.checking)
        result = run_cli('validate_execution_gate', '--checking-dir', self.checking, '--require-report')
        self.assertEqual(result.returncode, 0, result.stderr)
        after = json.loads((self.checking / 'plan.json').read_text())
        self.assertEqual(before['meta']['active_plan_rev'], after['meta']['active_plan_rev'])
        self.assertEqual(before['meta']['plan_revisions'], after['meta']['plan_revisions'])
        self.assertEqual((self.checking / 'report.md').read_bytes(), report)
        self.assertEqual((self.checking / 'observations.jsonl').read_bytes(), observations)

    def test_push_real_invalid_reports_zero_sink_calls(self):
        self.real_push_setup()
        report_path = self.checking / 'report.md'
        report = report_path.read_text()
        plan = (self.checking / 'plan.json').read_bytes()
        invalid = [None, report.replace('### 派生 checkpoint', '### missing'),
                   report.replace('<!-- case-verify:summary:start -->',
                                  '<!-- case-verify:summary:start -->\nincorrect summary')]
        for content in invalid:
            with self.subTest(content=content):
                if content is None:
                    report_path.unlink()
                else:
                    report_path.write_text(content)
                with self.assertRaises(ValueError):
                    adapters.push('qa', self.checking)
                self.assertFalse((self.checking / 'push-called').exists())
                self.assertEqual((self.checking / 'plan.json').read_bytes(), plan)

    def test_push_rejects_invalid_url(self):
        self.push_setup()
        self.adapter(kind='report-sink', extra='print("not a URL")\nsys.exit(0)\n')
        before = (self.checking / 'plan.json').read_bytes()
        with patch.object(adapters.subprocess, 'run', side_effect=self.gate):
            with self.assertRaisesRegex(ValueError, 'URL'):
                adapters.push('qa', self.checking)
        self.assertEqual((self.checking / 'plan.json').read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
