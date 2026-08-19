/**
 * dsh-subscriptions-sandbox-shim — 订阅 provider 工具面 sandbox 升级字段清洗。
 *
 * 背景(详见 BACKLOG D001 与 https://github.com/V1ki/dsh-plugin-subscriptions/issues/7):
 * DSH core 在组合期静态向 bash/write/edit 等工具 schema 广告
 * `sandbox_permissions`/`justification`(enum 固定为 workspace-write /
 * danger-full-access),执行期才按会话 standing mode 做严格更宽检查。在
 * `danger-full-access` + `approval: never` 部署下,schema 广告的每个值都是
 * 陷阱:模型(尤其 GPT/Codex 系)主动填这两个可选参数时,调用必然以
 * `not strictly wider` 失败(approval 通道也不可用)。
 *
 * 本插件在适配器边界做两层清洗:
 *   1. 出站(stripSchema):发给模型的工具 schema 中删除这两个属性,消除误填诱因;
 *   2. 入站(stripChunks):模型返回的工具调用 arguments(block-end 收口处)
 *      JSON 解析后删除这两个键,作为硬保证——即使模型仍幻觉出它们也不会失败。
 *
 * 部署形态约束:本插件的语义是「该部署永不使用 sandbox 升级通道」,在
 * read-only / workspace-write + approval: ask 的受限部署中必须禁用
 * (manifest enabled: false),否则合法的升级重试会被误剥导致死锁。
 * 上游修复(D001)后按相同路径移除。
 */

export const ESCALATION_KEYS = ['sandbox_permissions', 'justification'];

/** 已包装标记:同一适配器实例只包装一次(注册/替换事件幂等)。 */
const WRAPPED = Symbol('dsh-subscriptions-sandbox-shim.wrapped');

function hasEscalationKeys(properties) {
  return properties !== undefined && properties !== null
    && typeof properties === 'object'
    && ESCALATION_KEYS.some((key) => Object.hasOwn(properties, key));
}

/**
 * 克隆单个工具定义,删除 parameters.properties 中的升级字段。
 * 无字段时返回原对象(引用相等)。
 * @param tool - 工具定义 { name, description, parameters }。
 * @returns 剥离后的工具定义,或原对象。
 */
export function stripToolSchema(tool) {
  const parameters = tool?.parameters;
  if (parameters === undefined || parameters === null || typeof parameters !== 'object') return tool;
  if (!hasEscalationKeys(parameters.properties)) return tool;
  const properties = { ...parameters.properties };
  delete properties.sandbox_permissions;
  delete properties.justification;
  return { ...tool, parameters: { ...parameters, properties } };
}

/**
 * 出站剥离:provider 命中且任一工具 schema 含升级字段时,返回克隆请求
 * (仅 tools 数组与命中的 parameters 为新对象,其余字段复用原引用);
 * 否则返回原对象。不修改入参(请求是 deepFreeze 的)。
 *
 * 注意:agent-loop 用 WeakSet 标记 agent-loop 请求(isAgentLoopRequest),
 * 克隆会丢失该标记——但所有标记消费方(session-title、agent-loop invariant)
 * 都位于 llm/stream waterfall 层,即本包装点之上,它们只见原始请求,
 * 因此克隆丢失标记无行为影响。
 * @param options - LLM 请求(GenerateOptions)。
 * @param providers - 生效的 provider 路由列表。
 * @returns 剥离后的请求,或原对象。
 */
export function stripSchema(options, providers) {
  if (!providers.includes(options.provider)) return options;
  if (!Array.isArray(options.tools) || options.tools.length === 0) return options;
  let changed = false;
  const tools = options.tools.map((tool) => {
    const stripped = stripToolSchema(tool);
    if (stripped !== tool) changed = true;
    return stripped;
  });
  return changed ? { ...options, tools } : options;
}

/** Collect tool call/result ids from one Harness message list. */
function toolPairIds(messages) {
  const calls = new Set();
  const results = new Set();
  for (const message of messages) {
    if (!Array.isArray(message?.content)) continue;
    for (const block of message.content) {
      if (block?.type === 'tool-call') calls.add(String(block.id));
      else if (block?.type === 'tool-result') results.add(String(block.toolCallId));
    }
  }
  return { calls, results };
}

/**
 * Remove orphan tool-call/result blocks before a Responses adapter serializes
 * them. DSH subagent settlement notices intentionally reuse a child's final
 * assistant content inside a new user message. If the child was interrupted
 * after producing tool calls, those blocks cross the session boundary without
 * their child-session tool results. dsh-plugin-subscriptions otherwise turns
 * them into parent-request `function_call` items, which the Responses API
 * rejects with "No tool output found for function call ...".
 *
 * Normal parent-session tool pairs are unchanged. The cleanup is symmetric so
 * a corrupt/resumed orphan result cannot produce the inverse API validation
 * failure either.
 */
export function stripUnpairedToolBlocks(options, providers) {
  if (!providers.includes(options.provider)) return options;
  if (!Array.isArray(options.messages) || options.messages.length === 0) return options;
  // Pairing is evaluated over role-valid blocks only. A user-role copied
  // tool-call with a colliding id must not legitimize an unrelated result.
  const roleValidMessages = options.messages.map((message) => {
    if (!Array.isArray(message?.content)) return message;
    return {
      ...message,
      content: message.content
        .filter((block) => block?.type !== 'tool-call' || message.role === 'assistant')
        .filter((block) => block?.type !== 'tool-result' || message.role === 'user'),
    };
  });
  const hasRoleInvalidBlocks = options.messages.some((message) => Array.isArray(message?.content)
    && message.content.some((block) => (block?.type === 'tool-call' && message.role !== 'assistant')
      || (block?.type === 'tool-result' && message.role !== 'user')));
  const { calls, results } = toolPairIds(roleValidMessages);
  const orphanCalls = new Set([...calls].filter((id) => !results.has(id)));
  const orphanResults = new Set([...results].filter((id) => !calls.has(id)));
  if (!hasRoleInvalidBlocks && orphanCalls.size === 0 && orphanResults.size === 0) return options;

  let changed = false;
  const messages = options.messages.map((message) => {
    if (!Array.isArray(message?.content)) return message;
    const content = message.content.filter((block) => {
      // Responses function_call items are assistant output only. Settlement
      // notices are user messages, so their copied child tool calls are always
      // data, never executable parent-history calls.
      if (block?.type === 'tool-call' && message.role !== 'assistant') return false;
      if (block?.type === 'tool-result' && message.role !== 'user') return false;
      if (block?.type === 'tool-call' && orphanCalls.has(String(block.id))) return false;
      if (block?.type === 'tool-result' && orphanResults.has(String(block.toolCallId))) return false;
      return true;
    });
    if (content.length === message.content.length) return message;
    changed = true;
    return { ...message, content };
  });
  return changed ? { ...options, messages } : options;
}

/**
 * 解析工具调用 arguments 文本,删除升级字段;解析失败、非对象或
 * 不含字段时原样返回(引用相等)。
 * @param raw - block-end 中 tool-call 的 arguments 字符串。
 * @returns 清洗后的 JSON 文本,或原文本。
 */
export function stripToolArguments(raw) {
  if (typeof raw !== 'string') return raw;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return raw;
  if (!ESCALATION_KEYS.some((key) => Object.hasOwn(parsed, key))) return raw;
  delete parsed.sandbox_permissions;
  delete parsed.justification;
  return JSON.stringify(parsed);
}

/**
 * 入站剥离:包装 chunk 流,仅重写 `block-end` 且 block.type === 'tool-call'
 * 的 chunk(BlockAssembler 直接采用 block-end 的 block,是权威收口点;
 * tool-call-delta 是碎片 JSON,不可靠)。其余 chunk 与 block 形状
 * (index/type/id/name)保持不变,不触发 llm/stream invariant 的配对校验。
 * @param stream - 下游 chunk 流(AsyncIterable<StreamChunk>)。
 * @returns 清洗后的 chunk 流。
 */
export async function* stripChunks(stream) {
  for await (const chunk of stream) {
    if (chunk?.type === 'block-end' && chunk.block?.type === 'tool-call') {
      const argumentsText = chunk.block.arguments;
      const rewritten = stripToolArguments(argumentsText);
      if (rewritten !== argumentsText) {
        yield { ...chunk, block: { ...chunk.block, arguments: rewritten } };
        continue;
      }
    }
    yield chunk;
  }
}

/**
 * 包装适配器实例的 stream 方法(单层,幂等):出站克隆请求剥离 schema,
 * 入站包装返回流剥离 arguments。保留 this 绑定与 return/throw 委托
 * (yield* / for-await 语义)。
 * @param adapter - LlmAdapter 实例。
 * @param config - 插件配置 { providers, stripSchema, stripOutput }。
 * @returns 是否本次实际完成包装(false = 已包装过或不可包装)。
 */
export function wrapAdapterStream(adapter, config) {
  if (adapter === undefined || adapter === null || typeof adapter.stream !== 'function') return false;
  if (adapter.stream[WRAPPED] === true) return false;
  const original = adapter.stream;
  adapter.stream = async function* stream(options) {
    const paired = config.stripHistory === false ? options : stripUnpairedToolBlocks(options, config.providers);
    const forwarded = config.stripSchema ? stripSchema(paired, config.providers) : paired;
    const inner = original.call(this, forwarded);
    yield* (config.stripOutput ? stripChunks(inner) : inner);
  };
  Object.defineProperty(adapter.stream, WRAPPED, { value: true });
  return true;
}
