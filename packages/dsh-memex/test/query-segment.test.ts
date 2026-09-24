import { describe, expect, it } from 'vitest'
import { segmentQuery } from '../src/tools/query-segment.js'

/**
 * The kernel treats a run of Han characters as one literal token. These tests
 * pin the two properties that make query segmentation safe to apply globally:
 * ASCII queries must survive byte-for-byte, and Han runs must be split.
 */
describe('segmentQuery', () => {
  describe('ASCII queries are returned unchanged', () => {
    // Real queries against this corpus: identifiers, dotted paths, flags,
    // version strings. A single altered byte here would change which cards the
    // kernel returns for every English query.
    const identity = [
      'SettingsScope.mutate',
      'connection.rpc.handle 405',
      'pnpm file: hardlink',
      'node:sqlite NUL',
      'memex sync --init',
      'AgentSetup unpublished agent',
      'dsh-v0.1.5-rc.2',
      '../../src/commands/search.js',
    ]
    for (const query of identity) {
      it(`preserves ${JSON.stringify(query)}`, () => {
        expect(segmentQuery(query)).toBe(query)
      })
    }

    it('preserves surrounding whitespace when there is nothing to segment', () => {
      // Without Han characters the function returns early, so spacing is never
      // normalized. This keeps "no Han" a strict identity, not an approximation.
      expect(segmentQuery('  spaced   out  ')).toBe('  spaced   out  ')
      expect(segmentQuery('')).toBe('')
      expect(segmentQuery('   ')).toBe('   ')
    })
  })

  describe('Han runs are split into overlapping bigrams', () => {
    it('splits a run longer than two characters', () => {
      expect(segmentQuery('代理配置')).toBe('代理 理配 配置')
    })

    it('splits a full natural-language question', () => {
      // The motivating case: one 10-character token that matches nothing.
      expect(segmentQuery('子进程能不能用上代理')).toBe('子进 进程 程能 能不 不能 能用 用上 上代 代理')
    })

    it('leaves runs of one or two characters alone', () => {
      // A 2-char run would reproduce itself; a 1-char run cannot be split.
      expect(segmentQuery('代')).toBe('代')
      expect(segmentQuery('代理')).toBe('代理')
    })

    it('segments each Han run independently', () => {
      expect(segmentQuery('会话删不掉 提示被占用')).toBe('会话 话删 删不 不掉 提示 示被 被占 占用')
    })
  })

  describe('mixed queries keep code tokens intact', () => {
    it('does not disturb ASCII tokens adjacent to Han text', () => {
      expect(segmentQuery('settings mutate 值 类型')).toBe('settings mutate 值 类型')
      expect(segmentQuery('memex 中文 locale 报错')).toBe('memex 中文 locale 报错')
    })

    it('keeps a version string whole between Han runs', () => {
      // Splitting this would destroy the single most selective token present.
      expect(segmentQuery('升级到 0.1.5-rc.2 以后 图片草稿 坏了')).toBe(
        '升级 级到 0.1.5-rc.2 以后 图片 片草 草稿 坏了',
      )
    })

    it('keeps a dotted identifier whole', () => {
      expect(segmentQuery('调用 connection.rpc.handle 返回 405')).toBe(
        '调用 connection.rpc.handle 返回 405',
      )
    })
  })

  describe('boundary input', () => {
    it('treats full-width punctuation as a run boundary', () => {
      expect(segmentQuery('（全角）标点，夹杂。测试')).toBe('（ 全角 ） 标点 ， 夹杂 。 测试')
    })

    it('is idempotent once segmented', () => {
      // Recall may re-issue a query that already went through segmentation;
      // a second pass must not shred bigrams into unrelated pairs.
      const once = segmentQuery('代理配置')
      expect(segmentQuery(once)).toBe(once)
    })

    it('leaves kana and Hangul untouched', () => {
      // The kernel matches neither regex on these, so it indexes no tokens for
      // them. Segmenting would invent query tokens that cannot match anything.
      expect(segmentQuery('ひらがな')).toBe('ひらがな')
      expect(segmentQuery('한글테스트')).toBe('한글테스트')
    })

    it('segments Han while leaving adjacent kana alone', () => {
      expect(segmentQuery('漢字とかな')).toBe('漢字 とかな')
    })
  })
})
