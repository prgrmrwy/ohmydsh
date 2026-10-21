import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const req = createRequire(import.meta.url);
const aliases = ['cordis', 'dsh-agent', 'dsh-session', 'dsh-llm', 'dsh-tools', 'dsh-system-prompt', 'dsh-session-projection', 'dsh-scope'].map((name) => ({
  find: new RegExp(`^@deepseek-ai/${name}$`),
  replacement: req.resolve(`@deepseek-ai/${name}`),
}));
// Resolve the facade's original import to the same physical published entry.
aliases.unshift({
  find: /^@deepseek-ai\/cordis-original$/,
  replacement: req.resolve('@deepseek-ai/cordis'),
});
// Keep session-persistence on the package-root graph rather than source aliases.
aliases.unshift({
  find: /^@deepseek-ai\/dsh-session-persistence$/,
  replacement: req.resolve('@deepseek-ai/dsh-session-persistence'),
});
aliases.unshift({
  find: '@deepseek-ai/cordis',
  replacement: resolve('test/support/inquiry-source-cordis.ts'),
});
aliases.unshift({
  find: '@deepseek-ai/dsh-agent-loop',
  replacement: resolve('compat/subagent/.upstream/packages/core/agent-loop/src/index.ts'),
});

export default defineConfig({
  resolve: { alias: aliases },
  test: { include: ['test/inquiry-isolation-source.test.ts'] },
});
