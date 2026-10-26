import { afterEach, expect, it, vi } from 'vitest'
vi.mock('../src/host/maintenance.js', () => ({ wsStatus: vi.fn(), wsPromote: vi.fn(), wsClean: vi.fn(), wsPreparePreview: vi.fn() }))
import { wsPreparePreview } from '../src/host/maintenance.js'
import { main } from '../src/cli.js'
import { WS_TOOL_PARAMETERS } from '../src/host/tool.js'

afterEach(() => vi.restoreAllMocks())
it('advertises prepare-preview and CLI returns failure for a failed hook', async () => {
  expect(WS_TOOL_PARAMETERS.action.enum).toContain('prepare-preview')
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.mocked(wsPreparePreview).mockResolvedValue({ preview: { status: 'failed' } } as never)
  expect(await main(['prepare-preview', '/test/worktree'])).toBe(1)
  expect(wsPreparePreview).toHaveBeenCalledWith('/test/worktree')
  vi.mocked(wsPreparePreview).mockResolvedValue({ preview: { status: 'skipped' } } as never)
  expect(await main(['prepare-preview', '/test/worktree'])).toBe(0)
})
