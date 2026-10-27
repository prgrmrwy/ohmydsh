"""Persistent recipe fixture contract, with runtime-only fake assets."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from test_model_gates import run_cli


class FixtureContract(unittest.TestCase):
    def test_minimal_fixture_has_revisions_and_history(self):
        recipe = Path(__file__).parent / 'fixtures/minimal.py'
        spec = importlib.util.spec_from_file_location('minimal_fixture', recipe)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temporary:
            root = module.build(Path(temporary))
            self.assertEqual(len(json.loads((root / 'oracle.json').read_text())['items']), 2)
            trail = json.loads((root / 'trails/T1.json').read_text())
            cps = [cp for step in trail['steps'] for cp in step['checkpoints']]
            self.assertEqual(len(cps), 3)
            self.assertTrue(any(cp['origin'] == 'derived' for cp in cps))
            rows = [json.loads(line) for line in (root / 'observations.jsonl').read_text().splitlines()]
            self.assertEqual(len(rows), 5)
            self.assertTrue((root / 'evidence/sample.png').is_file())
            self.assertTrue(any(row['supersedes'] for row in rows))
            for script, args in [('status', []), ('validate_execution_gate', ['--require-report'])]:
                result = run_cli(script, '--checking-dir', root, *args)
                self.assertEqual(result.returncode, 0, result.stderr)
            state = json.loads(run_cli('status', '--checking-dir', root).stdout)
            self.assertEqual(state['counts']['pass'], 3)
