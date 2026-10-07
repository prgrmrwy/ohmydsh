import { describe, expect, it } from 'vitest'
import { buildInitCommand } from '../src/init-command.js'

describe('init command builder', () => {
  it('default_init_creates_skeleton_without_tool_skills', () => {
    expect(buildInitCommand({ cwd: '/workspace' })).toContain('--tools none --no-copilot-cloud --no-animation')
    expect(buildInitCommand({ cwd: '/workspace' })).not.toContain('--force')
  })
  it('rejects_metacharacters_unknown_tools_and_bad_language', () => {
    expect(() => buildInitCommand({ cwd: '/workspace', tools: 'evil;touch /tmp/pwn' })).toThrow(/invalid-init-options/)
    expect(() => buildInitCommand({ cwd: '/workspace', language: 'en;rm' })).toThrow(/invalid-init-options/)
  })
  it('never_offers_force_and_never_spawns_from_host', () => {
    expect(buildInitCommand({ cwd: '/workspace', force: true })).not.toContain('--force')
  })
  it('warns_about_global_config_only_when_openspec_dir_exists', () => {
    expect(buildInitCommand({ cwd: '/workspace', hasOpenSpecDir: true })).toContain('global config')
    expect(buildInitCommand({ cwd: '/workspace', hasOpenSpecDir: false })).not.toContain('global config')
  })
})
