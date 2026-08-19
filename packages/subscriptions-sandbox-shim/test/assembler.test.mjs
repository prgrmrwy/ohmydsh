/**
 * 3.4 会话一致性:清洗后的工具调用参数经过 BlockAssembler 组装后,
 * 成为最终 assistant message 的 tool-call block(agent-loop 持久化的就是
 * 该消息,resume 派生只投影 assistant/message,因此不会复活原始参数)。
 *
 * BlockAssembler 来自 DSH 运行体,仓库本地没有 @deepseek-ai 依赖,因此
 * 动态引用 profile 安装路径(可用 DSH_TEST_LLM_LIB 覆盖);未安装时 skip。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { stripChunks } from '../src/strip.js';

/** 候选 dsh-llm 位置:显式覆盖 > profile 安装 > npx 运行时安装。 */
function candidates() {
  const home = process.env.HOME ?? '';
  const list = [];
  if (process.env.DSH_TEST_LLM_LIB !== undefined) list.push(process.env.DSH_TEST_LLM_LIB);
  list.push(path.join(home, '.dsh/profiles/web/node_modules/@deepseek-ai/dsh-llm/lib/index.js'));
  const npxRoot = path.join(home, '.npm/_npx');
  try {
    for (const dir of readdirSync(npxRoot)) {
      list.push(path.join(npxRoot, dir, 'node_modules/@deepseek-ai/dsh-llm/lib/index.js'));
    }
  } catch {
    // npx 目录不存在
  }
  return list;
}

function resolveDshLlm() {
  for (const candidate of candidates()) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

test('3.4 cleaned tool-call arguments survive assembly into the persisted message shape', async (t) => {
  const llmLib = resolveDshLlm();
  if (llmLib === undefined) {
    t.skip('dsh-llm not found (profile install or npx runtime); set DSH_TEST_LLM_LIB to its lib/index.js');
    return;
  }
  const { BlockAssembler } = await import(pathToFileURL(llmLib).href);

  // 模拟订阅插件 Responses 翻译器对一次 function_call 的输出:
  // block-start(tool-call) → tool-call-delta → block-end(完整 arguments,含幻觉升级字段)。
  const chunks = [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: 'call_1', name: 'bash', argumentsDelta: '' },
    {
      type: 'block-end',
      index: 0,
      block: {
        type: 'tool-call',
        id: 'call_1',
        name: 'bash',
        arguments: JSON.stringify({
          command: 'ls',
          description: 'list files',
          sandbox_permissions: 'danger-full-access',
          justification: 'mirrored from runtime context',
        }),
      },
    },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ];

  const assembler = new BlockAssembler();
  for await (const chunk of stripChunks((async function* () { yield* chunks; })())) {
    assembler.push(chunk);
  }

  const [block] = assembler.blocks();
  assert.equal(block.type, 'tool-call');
  assert.equal(block.id, 'call_1');
  assert.equal(block.name, 'bash');
  const args = JSON.parse(block.arguments);
  assert.equal(args.command, 'ls');
  assert.equal(args.description, 'list files');
  assert.ok(!('sandbox_permissions' in args), 'sandbox_permissions must not survive assembly');
  assert.ok(!('justification' in args), 'justification must not survive assembly');
});
