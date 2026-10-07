import { describe, expect, it } from 'vitest'
import { diagnoseSkillWinners } from '../src/manage-check.js'

describe('skill precedence diagnostics', () => {
  it('project_skill_wins_and_check_reports_winning_source_and_provider', async () => {
    const skills = { list: async () => [{ name: 'openspec-apply-change', source: 'project-agents', provider: 'workspace-copy' }] }
    expect(await diagnoseSkillWinners(skills as never, ['openspec-apply-change'])).toEqual([{ name: 'openspec-apply-change', source: 'project-agents', provider: 'workspace-copy' }])
  })
})
