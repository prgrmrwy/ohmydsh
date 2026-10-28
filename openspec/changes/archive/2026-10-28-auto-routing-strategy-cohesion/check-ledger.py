"""Mechanical ledger check for this change: every test-plan row's test name appears exactly once in its file and passed.
Inputs: vitest JSON (/tmp/amr-vitest.json) from the package and node:test TAP (/tmp/amr-sync.tap) from the root sync test."""
import json, re, sys
res = json.load(open('/tmp/amr-vitest.json'))
status = {}
for f in res['testResults']:
    for t in f['assertionResults']:
        for key in [t['title'], *t['ancestorTitles']]:
            status.setdefault(key, []).append(t['status'])
tap = open('/tmp/amr-sync.tap').read()
bad, rows = [], 0
for line in open('openspec/changes/auto-routing-strategy-cohesion/test-plan.md').read().splitlines():
    if not line.startswith('| specs/'): continue
    rows += 1
    cols = [c.strip() for c in line.strip('|').split('|')]
    path, name = cols[2], cols[3]
    if open(path).read().count(name) != 1: bad.append(('count', path, name)); continue
    if path.endswith('.mjs'): ok = re.search(r'^ok \d+ - ' + re.escape(name) + '$', tap, re.M) is not None
    else:
        hits = [k for k in status if k == name or k.startswith(name + ' (') or k.startswith(name + ':')]
        ok = bool(hits) and all(s == 'passed' for k in hits for s in status[k])
    if not ok: bad.append(('not-passed', path, name))
print(f'{rows} rows; package tests {res["numPassedTests"]}/{res["numTotalTests"]} passed, {res["numFailedTests"]} failed, {res["numPendingTests"]} skipped')
for b in bad: print('BAD', *b)
sys.exit(1 if bad else 0)
