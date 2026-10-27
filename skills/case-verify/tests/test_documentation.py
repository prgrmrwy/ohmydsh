"""Published JSON examples must be accepted by the actual CLI."""
import json
from pathlib import Path
import re
import tempfile
import unittest
from test_model_gates import run_cli

REFERENCES = Path(__file__).resolve().parents[1] / 'references'


class DocumentationContract(unittest.TestCase):
    def test_published_plan_can_be_frozen_confirmed_and_observed(self):
        def examples(name):
            return [json.loads(block) for block in re.findall(r'```json\n(.*?)\n```', (REFERENCES / name).read_text(), re.S)]
        oracle, observation = examples('evidence-format.md')
        plan, trail = examples('plan-format.md')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'trails').mkdir()
            (root / 'evidence/T1-S1-C1').mkdir(parents=True)
            (root / observation['evidence'][0]['path']).write_bytes(b'synthetic image')
            for filename, value in [('oracle.json', oracle), ('plan.json', plan), ('trails/T1.json', trail)]:
                (root / filename).write_text(json.dumps(value))
            for script, args in [('validate_oracle', ['--freeze']), ('validate_mock_gate', []), ('validate_trail_gate', []), ('confirm', ['--selected', 'single_agent']), ('observe', ['append', '--expected-plan-rev', '1', '--json', json.dumps(observation)]), ('validate_execution_gate', [])]:
                result = run_cli(script, '--checking-dir', root, *args)
                self.assertEqual(result.returncode, 0, script + ': ' + result.stderr)
