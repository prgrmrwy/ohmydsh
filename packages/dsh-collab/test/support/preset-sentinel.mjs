import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const deps = createRequire(new URL('../../../../spike/collab-components/package.json', import.meta.url))
const { defineTool } = await import(pathToFileURL(deps.resolve('@deepseek-ai/dsh-tools')).href)
export const name = 'collab-test-preset-sentinel'
export const inject = ['tools']
export function apply(ctx, config) {
  ctx.tools.register(defineTool({
    name: config.toolName,
    description: 'Isolated preset membership sentinel',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return config.toolName },
  }))
}
