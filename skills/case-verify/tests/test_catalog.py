"""Catalog tests use synthetic checking data only."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

from test_model_gates import ready_checking, observation, append, run_cli, dump, SCRIPTS
sys.path.insert(0, str(SCRIPTS))
from build_catalog import build
from _model import ModelError


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='viewer-sentinel-')
        self.addCleanup(self.tmp.cleanup)
        self.root = ready_checking(Path(self.tmp.name))

    def add(self, value=None, rev=1):
        result = append(self.root, value or observation(), rev=rev)
        self.assertEqual(result.returncode, 0, result.stderr)

    def catalog(self):
        return build(self.root)[0]

    def test_catalog_path_projection(self):
        self.add()
        catalog, assets = build(self.root)
        item = catalog['observations'][0]['evidence'][0]
        self.assertEqual(set(item), {'name', 'kind', 'scope', 'url'})
        self.assertEqual(item['name'], 'sample.png')
        self.assertNotIn(self.root.name, json.dumps(catalog))
        self.assertEqual(len(assets), 1)
        self.assertEqual(len(next(iter(assets))), 24)

    def test_absolute_source_text(self):
        self.add(observation(actual=str(self.root)))
        catalog = self.catalog()
        self.assertEqual(catalog['observations'][0]['actual'], str(self.root))
        catalog['observations'][0]['actual'] = ''
        self.assertNotIn(str(self.root), json.dumps(catalog))

    def test_source_text_literal(self):
        actual = '保存后 evidence/ 目录未出现导出文件'
        self.add(observation(actual=actual))
        self.assertEqual(self.catalog()['observations'][0]['actual'], actual)

    def test_old_or_missing_observations(self):
        (self.root / 'observations.jsonl').unlink()
        with self.assertRaisesRegex(ModelError, '尚无观察记录'):
            build(self.root)
        (self.root / 'plan.json').unlink()
        (self.root / 'plan.yaml').write_text('trails: []')
        with self.assertRaisesRegex(ModelError, '该目录早于结构化证据格式'):
            build(self.root)

    def test_missing_or_escaping_asset(self):
        self.add()
        path = self.root / 'evidence/sample.png'
        path.unlink()
        self.assertTrue(self.catalog()['observations'][0]['evidence'][0]['unavailable'])
        path.symlink_to('/tmp/nonexistent-viewer-outside')
        self.assertTrue(self.catalog()['observations'][0]['evidence'][0]['unavailable'])
        self.assertEqual(build(self.root)[1], {})

    def test_rollup_superseded_fail(self):
        self.add(observation(status='fail'))
        self.add(observation(supersedes='obs-0001'))
        self.add(observation('C2'))
        catalog = self.catalog()
        self.assertEqual(catalog['oracles'][0]['rollup'], 'pass')
        self.assertEqual(catalog['observations'][0]['superseded_by'], 'obs-0002')

    def test_rollup_pending_member(self):
        self.add()
        self.assertEqual(self.catalog()['oracles'][0]['rollup'], 'partial')

    def test_rollup_no_evidence(self):
        for cp in ('C1', 'C2'):
            self.add(observation(cp, evidence=[], limits=['Synthetic no screenshot limitation']))
        self.assertEqual(self.catalog()['oracles'][0]['rollup'], 'partial')

    def test_derived_not_coverage(self):
        self.add(observation('C3'))
        catalog = self.catalog()
        self.assertEqual(catalog['oracles'][1]['rollup'], 'uncovered')
        self.assertIn('C3', catalog['gaps']['derived_checkpoints'])

    def test_history_expired_and_env_union(self):
        self.add(observation(env={'role': 'member'}))
        self.add(observation('C3', status='fail', env={'shape': 'desktop'}))
        result = run_cli('confirm', '--checking-dir', self.root, '--selected', 'single_agent')
        self.assertEqual(result.returncode, 0, result.stderr)
        catalog = self.catalog()
        self.assertTrue(all(row['expired'] for row in catalog['observations']))
        self.assertTrue(all(cp['status'] == 'pending' for cp in catalog['checkpoints']))
        self.assertEqual(catalog['env_keys'], ['role', 'shape'])
        self.assertEqual(catalog['oracles'][0]['rollup'], 'partial')

    def test_debug_output_outside_only(self):
        import subprocess
        for target in (self.root / 'catalog.json', self.root / 'evidence/catalog.json'):
            result = run_cli('build_catalog', '--checking-dir', self.root, '--out', target)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(target.exists())
        with tempfile.TemporaryDirectory() as outside:
            target = Path(outside) / 'catalog.json'
            result = run_cli('build_catalog', '--checking-dir', self.root, '--out', target)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(target.read_text())['schema'], 1)

    def test_unreleased_cross_loop_fail(self):
        self.add(observation(status='fail', loop=1, env={'role': 'member'}))
        self.add(observation(loop=2, env={'role': 'admin'}))
        self.add(observation('C2'))
        self.assertEqual(self.catalog()['oracles'][0]['rollup'], 'fail')

    def test_invalid_structure_not_asset_downgrade(self):
        (self.root / 'observations.jsonl').write_text('[]\n')
        with self.assertRaisesRegex(ModelError, '第 1 行'):
            build(self.root)

    def test_snapshot_retries_concurrent_append(self):
        from unittest.mock import patch
        import build_catalog
        self.add()
        self.add(observation('C2'))
        real_status = build_catalog.calculate_status
        calls = []
        def racing_status(*args, **kwargs):
            state = real_status(*args, **kwargs)
            calls.append(1)
            if len(calls) == 1:
                self.add(observation(status='fail', env={'role': 'other'}))
            return state
        with patch.object(build_catalog, 'calculate_status', side_effect=racing_status):
            catalog = self.catalog()
        self.assertEqual(catalog['oracles'][0]['rollup'], 'fail')
        self.assertEqual(catalog['checkpoints'][0]['status'], 'fail')
        self.assertEqual(len(catalog['observations']), 3)
        self.assertEqual(len(calls), 2)

    def test_snapshot_rejects_continuous_change(self):
        from unittest.mock import patch
        import build_catalog
        real_status = build_catalog.calculate_status
        calls = []
        def racing_status(*args, **kwargs):
            state = real_status(*args, **kwargs)
            calls.append(1)
            self.add(observation(status='fail', env={'attempt': len(calls)}))
            return state
        with patch.object(build_catalog, 'calculate_status', side_effect=racing_status):
            with self.assertRaisesRegex(ModelError, '输入持续变化'):
                build(self.root)
        self.assertEqual(len(calls), 3)

    def test_hash_mismatch_and_network_log(self):
        self.add()
        for kind in ('network', 'log'):
            self.add(observation(evidence=[dict(path='evidence/sample.png', kind=kind, scope='exact')]))
        (self.root / 'evidence/sample.png').write_bytes(b'changed')
        catalog, assets = build(self.root)
        self.assertEqual(assets, {})
        for row in catalog['observations']:
            self.assertEqual(set(row['evidence'][0]), {'name', 'kind', 'scope', 'unavailable'})


if __name__ == '__main__':
    unittest.main()
