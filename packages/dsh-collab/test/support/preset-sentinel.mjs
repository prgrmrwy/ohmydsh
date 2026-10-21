import { moduleOf } from './controller-harness.mjs'
const { defineTool } = await moduleOf('dsh-tools')
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
