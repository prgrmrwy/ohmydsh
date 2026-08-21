import test from 'node:test'
import assert from 'node:assert/strict'
import { rewriteManifest } from '../scripts/lib/manifest-rewrite.mjs'

const SAMPLE = `# ohmydsh manifest(注释必须保留)
dshVersion: 0.1.1-rc.2

customizations:
  # 第三方(remote):只存 pin + 覆盖 + 记录
  - id: cost-meter
    type: package
    source: remote
    spec: dsh-cost-meter@1.5.22
    version: 1.5.22
    enabled: true
    brief: 会话费用统计
  - id: modlens
    type: package
    source: remote
    spec: '@liustack/modlens@3.21.0'
    version: 3.21.0
    enabled: true
    brief: 支持图片识别
    note: B006 生态解
`

test('rewriteManifest 只改目标条目,保留注释与其余结构', () => {
  const out = rewriteManifest(SAMPLE, [
    { id: 'cost-meter', current: '1.5.22', newVersion: '1.5.35', newSpec: 'dsh-cost-meter@1.5.35' },
  ])
  assert.match(out, /# ohmydsh manifest\(注释必须保留\)/)
  assert.match(out, /# 第三方\(remote\):只存 pin \+ 覆盖 \+ 记录/)
  assert.match(out, /spec: dsh-cost-meter@1\.5\.35/)
  assert.match(out, /version: 1\.5\.35\n/)
  assert.match(out, /spec: '@liustack\/modlens@3\.21\.0'/)
  assert.match(out, /version: 3\.21\.0\n/)
  assert.match(out, /version: 1\.5\.35\n\s+# \[\d{4}-\d{2}-\d{2}\] plugin-update: cost-meter 1\.5\.22 -> 1\.5\.35/)
  assert.doesNotMatch(out, /plugin-update: modlens/)
})

test('rewriteManifest 引号风格跟随原值(single-quoted spec 保持单引号)', () => {
  const out = rewriteManifest(SAMPLE, [
    { id: 'modlens', current: '3.21.0', newVersion: '3.23.1', newSpec: '@liustack/modlens@3.23.1' },
  ])
  assert.match(out, /spec: '@liustack\/modlens@3\.23\.1'/)
  assert.match(out, /version: 3\.23\.1/)
  assert.match(out, /spec: dsh-cost-meter@1\.5\.22/) // 未涉及条目原样
})

test('rewriteManifest 多条目同批更新,注释插入位置互不干扰', () => {
  const out = rewriteManifest(SAMPLE, [
    { id: 'cost-meter', current: '1.5.22', newVersion: '1.5.35', newSpec: 'dsh-cost-meter@1.5.35' },
    { id: 'modlens', current: '3.21.0', newVersion: '3.23.1', newSpec: '@liustack/modlens@3.23.1' },
  ])
  const cm = out.match(/version: 1\.5\.35\n\s+# .*plugin-update: cost-meter/)
  const ml = out.match(/version: 3\.23\.1\n\s+# .*plugin-update: modlens/)
  assert.ok(cm, 'cost-meter 注释紧跟其 version 行')
  assert.ok(ml, 'modlens 注释紧跟其 version 行')
  assert.match(out, /brief: 会话费用统计/) // 字段裁剪逻辑未误伤
})

test('rewriteManifest:未知条目报错(不静默)', () => {
  assert.throws(
    () => rewriteManifest(SAMPLE, [{ id: 'nope', current: '1', newVersion: '2', newSpec: 'nope@2' }]),
    /未找到条目 nope/,
  )
})