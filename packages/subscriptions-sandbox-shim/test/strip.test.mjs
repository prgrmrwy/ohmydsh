/**
 * 纯逻辑单测(零外部依赖,直接 import src/strip.js):
 * 3.1 stripSchema / stripToolSchema、3.2 stripChunks / stripToolArguments、
 * 3.3 wrapAdapterStream 幂等。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ESCALATION_KEYS,
  stripChunks,
  stripSchema,
  stripToolArguments,
  stripToolSchema,
  stripUnpairedToolBlocks,
  wrapAdapterStream,
} from '../src/strip.js';

const PROVIDERS = ['codex', 'grok'];

function bashTool(withEscalation = true) {
  const parameters = {
    type: 'object',
    properties: {
      command: { type: 'string', required: true },
      description: { type: 'string', required: true },
      ...(withEscalation
        ? {
            sandbox_permissions: { type: 'string', enum: ['workspace-write', 'danger-full-access'] },
            justification: { type: 'string' },
          }
        : {}),
    },
  };
  return { name: 'bash', description: 'Run a command.', parameters };
}

// ---------- 3.1 stripSchema / stripToolSchema ----------

test('3.1 stripToolSchema removes both escalation keys, keeps the rest', () => {
  const tool = bashTool(true);
  const stripped = stripToolSchema(tool);
  assert.notEqual(stripped, tool);
  assert.equal(stripped.name, 'bash');
  assert.equal(stripped.description, tool.description);
  assert.deepEqual(stripped.parameters.type, 'object');
  assert.ok(!('sandbox_permissions' in stripped.parameters.properties));
  assert.ok(!('justification' in stripped.parameters.properties));
  assert.deepEqual(stripped.parameters.properties.command, tool.parameters.properties.command);
  // 原对象不被修改
  assert.ok('sandbox_permissions' in tool.parameters.properties);
});

test('3.1 stripToolSchema returns the same reference when no escalation keys', () => {
  const tool = bashTool(false);
  assert.equal(stripToolSchema(tool), tool);
});

test('3.1 stripSchema returns the same reference when provider is not targeted', () => {
  const options = { provider: 'deepseek', tools: [bashTool(true)] };
  assert.equal(stripSchema(options, PROVIDERS), options);
});

test('3.1 stripSchema returns the same reference when tools have no escalation keys', () => {
  const options = { provider: 'codex', tools: [bashTool(false)] };
  assert.equal(stripSchema(options, PROVIDERS), options);
});

test('3.1 stripSchema returns the same reference without tools', () => {
  const options = { provider: 'codex', messages: [] };
  assert.equal(stripSchema(options, PROVIDERS), options);
});

test('3.1 stripSchema clones only tools and parameters, reuses other references', () => {
  const messages = [];
  const signal = {};
  const options = { provider: 'codex', tools: [bashTool(true), bashTool(false)], messages, signal };
  const stripped = stripSchema(options, PROVIDERS);
  assert.notEqual(stripped, options);
  assert.notEqual(stripped.tools, options.tools);
  assert.notEqual(stripped.tools[0], options.tools[0]);
  assert.equal(stripped.tools[1], options.tools[1]); // 未命中工具保持引用
  assert.equal(stripped.messages, messages);
  assert.equal(stripped.signal, signal);
  assert.equal(stripped.provider, 'codex');
});

// ---------- Responses history pairing guard ----------

function assistantToolMessage(id = 'call_1') {
  return {
    role: 'assistant',
    content: [
      { type: 'reasoning', text: 'checking' },
      { type: 'tool-call', id, name: 'bash', arguments: JSON.stringify({ command: 'ls' }) },
    ],
  };
}

function toolResultMessage(id = 'call_1') {
  return {
    role: 'user',
    content: [{ type: 'tool-result', toolCallId: id, content: [{ type: 'text', text: 'ok' }] }],
  };
}

test('pairing guard removes child tool calls embedded in a user settlement notice', () => {
  const notice = {
    role: 'user',
    content: [
      { type: 'text', text: 'Background subagent was stopped.' },
      { type: 'reasoning', text: 'partial answer' },
      { type: 'tool-call', id: 'call_child', name: 'bash', arguments: '{"command":"ls"}' },
    ],
  };
  const options = { provider: 'codex', messages: [notice] };
  const stripped = stripUnpairedToolBlocks(options, PROVIDERS);
  assert.notEqual(stripped, options);
  assert.deepEqual(stripped.messages[0].content, notice.content.slice(0, 2));
  assert.equal(options.messages[0].content.length, 3, 'original frozen request shape must stay untouched');
});

test('pairing guard does not let a user-role copied call pair with a parent result', () => {
  const copied = {
    role: 'user',
    content: [{ type: 'tool-call', id: 'collision', name: 'bash', arguments: '{}' }],
  };
  const options = { provider: 'codex', messages: [copied, toolResultMessage('collision')] };
  const stripped = stripUnpairedToolBlocks(options, PROVIDERS);
  assert.deepEqual(stripped.messages.map((message) => message.content), [[], []]);
});

test('pairing guard preserves normal paired tool calls and results', () => {
  const messages = [assistantToolMessage(), toolResultMessage()];
  const options = { provider: 'codex', messages };
  assert.equal(stripUnpairedToolBlocks(options, PROVIDERS), options);
});

test('pairing guard removes orphan results symmetrically', () => {
  const options = { provider: 'codex', messages: [toolResultMessage('missing')] };
  const stripped = stripUnpairedToolBlocks(options, PROVIDERS);
  assert.deepEqual(stripped.messages[0].content, []);
});

test('pairing guard does not affect non-target providers', () => {
  const options = { provider: 'deepseek', messages: [assistantToolMessage('orphan')] };
  assert.equal(stripUnpairedToolBlocks(options, PROVIDERS), options);
});

// ---------- 3.2 stripChunks / stripToolArguments ----------

test('3.2 stripToolArguments removes both keys from valid JSON', () => {
  const raw = JSON.stringify({ command: 'ls', description: 'x', sandbox_permissions: 'danger-full-access', justification: 'y' });
  const out = stripToolArguments(raw);
  const parsed = JSON.parse(out);
  assert.equal(parsed.command, 'ls');
  assert.equal(parsed.description, 'x');
  assert.ok(!('sandbox_permissions' in parsed));
  assert.ok(!('justification' in parsed));
});

test('3.2 stripToolArguments removes both keys when only one is present', () => {
  const raw = JSON.stringify({ command: 'ls', sandbox_permissions: 'workspace-write' });
  const parsed = JSON.parse(stripToolArguments(raw));
  assert.ok(!('sandbox_permissions' in parsed));
  assert.ok(!('justification' in parsed));
  assert.equal(parsed.command, 'ls');
});

test('3.2 stripToolArguments returns the same reference for invalid JSON', () => {
  const raw = '{not json';
  assert.equal(stripToolArguments(raw), raw);
});

test('3.2 stripToolArguments returns the same reference when keys absent', () => {
  const raw = JSON.stringify({ command: 'ls' });
  assert.equal(stripToolArguments(raw), raw);
});

test('3.2 stripToolArguments returns non-strings untouched', () => {
  assert.equal(stripToolArguments(undefined), undefined);
  assert.equal(stripToolArguments(42), 42);
});

async function collect(stream) {
  const out = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

function chunksWithToolCall(argumentsText) {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: 'call_1', name: 'bash', argumentsDelta: '' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call_1', name: 'bash', arguments: argumentsText } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ];
}

async function* fromArray(chunks) {
  yield* chunks;
}

test('3.2 stripChunks rewrites only the tool-call block-end arguments', async () => {
  const raw = JSON.stringify({ command: 'ls', description: 'x', sandbox_permissions: 'danger-full-access', justification: 'y' });
  const chunks = chunksWithToolCall(raw);
  const out = await collect(stripChunks(fromArray(chunks)));
  assert.equal(out.length, 4);
  const blockEnd = out[2];
  assert.equal(blockEnd.type, 'block-end');
  assert.equal(blockEnd.index, 0);
  assert.equal(blockEnd.block.type, 'tool-call');
  assert.equal(blockEnd.block.id, 'call_1');
  assert.equal(blockEnd.block.name, 'bash');
  const parsed = JSON.parse(blockEnd.block.arguments);
  assert.equal(parsed.command, 'ls');
  assert.ok(!('sandbox_permissions' in parsed));
  assert.ok(!('justification' in parsed));
  // 其余 chunk 引用不变
  assert.equal(out[0], chunks[0]);
  assert.equal(out[1], chunks[1]);
  assert.equal(out[3], chunks[3]);
});

test('3.2 stripChunks passes through invalid JSON arguments unchanged', async () => {
  const raw = '{broken';
  const chunks = chunksWithToolCall(raw);
  const out = await collect(stripChunks(fromArray(chunks)));
  assert.equal(out[2], chunks[2]); // 同一引用
});

test('3.2 stripChunks passes through non-tool-call chunks unchanged', async () => {
  const chunks = [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'hi' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'hi' } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
  ];
  const out = await collect(stripChunks(fromArray(chunks)));
  assert.deepEqual(out, chunks);
});

// ---------- 3.3 wrapAdapterStream 幂等 ----------

test('3.3 wrapAdapterStream wraps once and is idempotent', async () => {
  const calls = [];
  const adapter = {
    async *stream(options) {
      calls.push(options);
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call_1', name: 'bash', arguments: JSON.stringify({ command: 'ls', sandbox_permissions: 'danger-full-access' }) } };
    },
  };
  const config = { providers: PROVIDERS, stripSchema: true, stripOutput: true };
  assert.equal(wrapAdapterStream(adapter, config), true);
  assert.equal(wrapAdapterStream(adapter, config), false); // 第二次不包装

  const options = { provider: 'codex', tools: [bashTool(true)] };
  const out = await collect(adapter.stream(options));
  // 出站:适配器收到剥离后的 schema
  assert.equal(calls.length, 1);
  assert.ok(!('sandbox_permissions' in calls[0].tools[0].parameters.properties));
  // 入站:返回的参数被清洗
  const args = JSON.parse(out[0].block.arguments);
  assert.ok(!('sandbox_permissions' in args));
  // 原请求未被修改
  assert.ok('sandbox_permissions' in options.tools[0].parameters.properties);
});

test('3.3 wrapAdapterStream removes unpaired history blocks before forwarding', async () => {
  const calls = [];
  const adapter = {
    async *stream(options) {
      calls.push(options);
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };
  const config = { providers: PROVIDERS, stripSchema: true, stripOutput: true };
  wrapAdapterStream(adapter, config);
  const notice = {
    role: 'user',
    content: [
      { type: 'text', text: 'settled' },
      { type: 'tool-call', id: 'call_child', name: 'bash', arguments: '{}' },
    ],
  };
  await collect(adapter.stream({ provider: 'codex', messages: [notice] }));
  assert.deepEqual(calls[0].messages[0].content, [{ type: 'text', text: 'settled' }]);
});

test('3.3 wrapAdapterStream honors stripHistory false', async () => {
  const calls = [];
  const adapter = {
    async *stream(options) {
      calls.push(options);
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };
  wrapAdapterStream(adapter, { providers: PROVIDERS, stripSchema: false, stripOutput: false, stripHistory: false });
  const options = { provider: 'codex', messages: [assistantToolMessage('orphan')] };
  await collect(adapter.stream(options));
  assert.equal(calls[0], options);
});

test('3.3 wrapAdapterStream skips non-callable adapters', () => {
  assert.equal(wrapAdapterStream(undefined, {}), false);
  assert.equal(wrapAdapterStream({}, { providers: PROVIDERS }), false);
});

test('3.3 stripSchema is idempotent (double strip yields same result)', () => {
  const options = { provider: 'codex', tools: [bashTool(true)] };
  const once = stripSchema(options, PROVIDERS);
  const twice = stripSchema(once, PROVIDERS);
  assert.equal(twice, once); // 第二次无字段,引用不变
});

test('ESCALATION_KEYS covers the two documented fields', () => {
  assert.deepEqual(ESCALATION_KEYS, ['sandbox_permissions', 'justification']);
});
