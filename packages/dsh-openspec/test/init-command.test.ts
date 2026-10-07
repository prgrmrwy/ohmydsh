import { describe, expect, it } from 'vitest'
import { buildInitCommand, parseInitArgs } from '../src/init-command.js'

describe('init command builder', () => {
  it('default_init_creates_skeleton_without_tool_skills', () => {
    expect(buildInitCommand({ cwd: '/workspace' })).toContain('--tools none --no-copilot-cloud --no-animation')
    expect(buildInitCommand({ cwd: '/workspace' })).not.toContain('--force')
  })
  it('rejects_metacharacters_unknown_tools_and_bad_language', () => {
    expect(() => buildInitCommand({ cwd: '/workspace', tools: 'evil;touch /tmp/pwn' })).toThrow(/invalid-init-options/)
    expect(() => buildInitCommand({ cwd: '/workspace', language: 'en;rm' })).toThrow(/invalid-init-options/)
  })
  it('parser_accepts_only_each_known_flag_once_and_names_the_rejected_argument', () => {
    expect(parseInitArgs('')).toEqual({})
    expect(parseInitArgs('  --tools claude   --language zh-CN ')).toEqual({ tools: 'claude', language: 'zh-CN' })
    for (const [raw, argument] of [['--force', 'option'], ['--tools', 'tools'], ['--tools --profile', 'tools'], ['--tools a --tools b', 'tools'], ['--profile core extra', 'option'], ['; rm -rf /', 'option'], ['$(id)', 'option']] as const) {
      expect(() => parseInitArgs(raw), raw).toThrow(expect.objectContaining({ code: 'invalid-init-options', argument }))
    }
  })
  it('unknown_tool_is_rejected_against_the_supplied_official_catalog_and_none_stays_allowed', () => {
    const allowedTools = new Set(['claude', 'amazon-q'])
    expect(() => buildInitCommand({ cwd: '/workspace', tools: 'codex', allowedTools })).toThrow(expect.objectContaining({ argument: 'tools' }))
    expect(buildInitCommand({ cwd: '/workspace', tools: 'amazon-q', allowedTools })).toContain('--tools amazon-q')
    expect(buildInitCommand({ cwd: '/workspace', allowedTools })).toContain('--tools none')
  })
  it('never_offers_force_and_never_spawns_from_host', () => {
    expect(buildInitCommand({ cwd: '/workspace', force: true })).not.toContain('--force')
  })
  it('warns_about_global_config_only_when_openspec_dir_exists', () => {
    expect(buildInitCommand({ cwd: '/workspace', hasOpenSpecDir: true })).toContain('global config')
    expect(buildInitCommand({ cwd: '/workspace', hasOpenSpecDir: false })).not.toContain('global config')
  })
})
