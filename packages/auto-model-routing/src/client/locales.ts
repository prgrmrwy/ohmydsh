/**
 * Copy dictionaries for the AUTO client UI (composer chip, decision panel,
 * feedback label and the settings section).
 *
 * Same pattern as `dsh-magpie-connector`: the plugin keeps a module-scoped
 * translator instead of threading `t` through every helper, `apply()` binds the
 * host translator once, and before that (unit tests, or a host without a locale
 * service) the Chinese reference set is used so existing tests and behaviour do
 * not change. Placeholders use the host's `{name}` syntax and are interpolated
 * here, so the fallback path and the bound path behave identically.
 *
 * @module dsh-auto-model-routing/client/locales
 */

/** The locale namespace this plugin owns. */
export const NS = 'settings.autoModelRouting'

/** English strings (reference key set; values may contain `{placeholders}`). */
export const en = {
  routingFailed: 'The routing status request failed',
  feedbackFailed: 'The feedback request failed',
  notProvided: 'not provided',
  notDecided: 'not decided',
  toBeDetermined: 'to be determined',
  unknownService: 'unknown service',
  unknownModel: 'unknown model',
  sourceMain: 'main session',
  sourceChild: 'subtask',
  statusApplied: 'applied',
  statusFailed: 'not applied',
  statusUnsupported: 'adjustment unsupported',
  statusPending: 'decided / pending',
  capabilityLine: 'capability {capability} · decision confidence {confidence}',
  capabilitySpread: 'capability distribution: {list}',
  depthLine: 'investment {depth} · decision confidence {confidence}',
  depthSpread: 'investment distribution: {list}',
  confidenceFormula: 'confidence = (top probability − 1/n) ÷ (1 − 1/n), with n candidates; it is not the task success rate',
  feedbackAppropriate: 'allocation fits',
  feedbackTooHigh: 'investment too high',
  feedbackTooLow: 'investment too low',
  feedbackUnknown: 'cannot tell',
  feedbackSummary: 'AUTO allocation: {depth} → {effort} · {model}',
  feedbackAsk: 'rate whether the resource allocation fits',
  feedbackYour: 'your rating: {label}',
  feedbackTitle: 'Did this resource allocation fit?',
  feedbackClear: 'Withdraw rating',
  feedbackNotSaved: 'Feedback was not saved, please retry',
  navLabel: 'Auto model routing',
  strategySummary: 'View the decision policy',
  strategyIntro: 'The Agent decomposes, dispatches and verifies; Jev only makes bounded judgments, and AUTO validates the catalog and applies the resource allocation. Task count, risk and importance are not the same as reasoning difficulty. This is a read-only description and changes no setting.',
  strategyCapability: 'Capability need (subtasks only)',
  strategyCapabilityBody: 'bounded: the method is clear and the result verifiable; analytical: investigation, correlated evidence or choosing between options; frontier: unusually hard original reasoning or coupled unknowns; insufficient_context: the goal or scope is missing, so stop and ask for it.',
  strategyDepth: 'Reasoning investment (judged separately for the main session and subtasks)',
  strategyDepthBody: 'The main model never changes. Starting from the effort recommended for the concrete model, lower / baseline / higher step one level down, stay, or step one level up in the supported ladder; the current cap applies and max is never chosen automatically. A lighter model does not imply lower effort.',
  strategyFamilies: 'Capability mapping of the current sub-models',
  strategyFamilyItem: '{level} → {model} (recommended start {start})',
  strategyCatalogDefault: 'catalog default',
  strategyTrailer: 'Magpie keeps the family prefix and the real provider and never falls back across entries; model and effort must both pass the current catalog and the official allowlist. Other families need an explicitly named model and a verifiable effort.',
  strategyLimits: 'Constraints, failures and recovery',
  strategyLimitsBody: 'An explicit model or effort wins; when both are given, AUTO only validates and does not ask Jev. When the goal is missing, the catalog is invalid or the capability judgment fails, AUTO stops dispatching instead of silently inheriting or switching models. A failed main judgment visibly disables AUTO. A fresh subtask binds its exact identity when created; later messages and resumes do not re-select a model. fork is not supported yet. MANUAL stops new judgments while already bound subtasks keep their initial route.',
  strategyRules: 'The exact Jev criteria',
  strategyRulesBody: 'The English rules used at runtime are shown below as-is, so translation cannot change their meaning; the two questions are independent and cannot read each other\'s answer.',
  keySaveFailed: 'The API key was not saved',
  settingsSaveFailed: 'Settings were not saved, please check the field errors and retry',
  settingsReadFailed: 'Could not read settings, reopen this page',
  readingSettings: 'Reading settings…',
  keySaved: 'API key saved',
  settingsSaved: 'Settings saved',
  settingsNotSaved: 'Settings were not saved',
  keyUnavailable: 'unavailable',
  keyFromEnv: 'from the launch environment',
  keyConfigured: 'configured',
  keyUnconfigured: 'not configured',
  keyUnavailableHint: 'The DSH credential service is unavailable.',
  keyEnvHint: 'Keep the existing key first: remove OPENROUTER_API_KEY from the launch environment (for example .env.local) and restart, then save it here.',
  keyStoredHint: 'Stored in the DSH credential store, not in the settings file; leave it empty to keep the current key.',
  keyMissingHint: 'AUTO judgments stay disabled while no key is configured; saving a key does not resume sessions that were already disabled.',
  settingsUnavailable: 'Cannot read settings',
  settingsReadOnly: 'Settings are read-only',
  partialSaveFailed: 'Some changes were not saved, check the messages',
  save: 'Save',
  saving: 'Saving…',
  configInvalid: 'The settings file cannot be parsed or contains invalid fields; values shown come from what is parseable plus defaults, and saving overwrites the damaged part',
  deprecatedKeys: 'Old mappings in the settings file ({list}) no longer apply and are removed on the next save.',
  decisionService: 'Decision service',
  decisionServiceIntro: 'AUTO sends the redacted task to the selected decision service; there is no automatic fallback across services.',
  serviceSwitchNote: 'Save the new service first, then manage that service\'s own API key; the previous service\'s key is not reused.',
  credentialRef: 'Credential reference: {ref}',
  decisionModel: 'Decision model',
  compatibleEndpoint: 'Compatible endpoint ',
  customEndpointHint: 'Only the System One state/questions → answers contract; HTTPS or loopback HTTP; URL credentials, query strings and redirects are refused.',
  endpointLine: 'Endpoint: {endpoint}',
  connectionOk: 'Connection succeeded · {ms} ms',
  connectionFailed: 'Connection failed: {reason}',
  serviceUnavailable: 'service unavailable',
  connectFailedRetry: 'Could not reach the decision service, please retry',
  connectTestFailed: 'The connection test failed, check the network and retry',
  testing: 'Testing…',
  testConnection: 'Test connection',
  testInFlight: 'Requesting the selected decision service…',
  saveBeforeTest: 'Save the settings before testing the connection',
  testCost: 'A test costs one decision request without conversation content; save the settings first.',
  invalidService: 'Fill in a valid model and compatible endpoint',
  serviceKeyLabel: '{service} API Key',
  saveServiceFirst: 'Save the service selection first',
  stateAfterSave: 'read after saving',
  cancelRemoveKey: 'Cancel key removal',
  removeKey: 'Remove key',
  invalidKey: 'The API key must not contain whitespace and must be at most 512 characters',
  jevTimeout: 'Judgment wait limit',
  jevTimeoutHint: '1000–8000 ms, 5000 by default; after a timeout the session disables AUTO.',
  msSuffix: ' ms',
  sessionSection: 'Session',
  sessionIntro: 'The main model never changes; subtasks select model capability and reasoning investment independently and apply them at creation. MANUAL makes no automatic judgment.',
  defaultMode: 'Default mode for new sessions',
  defaultModeAutoHint: 'Only affects new sessions; every user turn sends the redacted task to the selected decision service to ask Jev.',
  defaultModeManualHint: 'Only affects new sessions and never changes existing ones.',
  decisionToast: 'Judgment hint',
  effortCap: 'Reasoning effort cap',
  autoSection: 'Automatic selection',
  autoIntro: 'The main session only adjusts reasoning investment; subtasks pick a capability tier that fits the goal and scope, then set the investment. Explicitly specified models and effort levels are preserved; there is no automatic retry or escalation.',
  autoCatalogNote: 'Magpie uses the full model id and the official allowlist; when the catalog is unavailable or the goal is unclear, AUTO stops and says so. fresh subtasks are supported, fork is not.',
  noticeNotRouted: 'The latest subtask was not routed: {reason} (runs on DSH defaults)',
  lockedModel: 'AUTO does not support the current model',
  lockedModelLine: '{provider} / {model} is outside automatic routing and the session switched to MANUAL.',
  lockedFamilies: 'Only the {families} family is supported for now; policies for other models are welcome as an issue or PR:',
  lockedHint: 'Switch back to a {families} model to enable AUTO again.',
  panelAutoTitle: 'Automatic reasoning effort',
  panelManualTitle: 'Manual: no automatic adjustment',
  panelOutput: 'This turn plugin output: {effort} · {reason}',
  panelLatest: 'Latest decision',
  panelDepth: 'AUTO · {depth}; the main model is unchanged and effort is applied per request; subtasks are selected automatically.',
  panelDisabled: 'Jev disabled ({category}): {hint}. {at}. Click AUTO to retry.',
  panelData: 'AUTO sends the redacted task text to the decision service selected in settings.',
  switchTitleLocked: 'AUTO only supports the {families} family; hover for details',
  switchTitleDisabled: 'Jev judgments are disabled: {hint}. Click AUTO to retry',
  switchTitleIdle: 'Click to toggle automatic reasoning effort',
  switchAriaLocked: 'Reasoning effort mode: {mode} (AUTO does not support the current model and cannot be toggled)',
  switchAria: 'Reasoning effort mode: {mode}, click to toggle',
  switchJevDisabled: '{mode} · Jev disabled',
  panelAria: 'Automatic routing status',
  listSeparator: ', ',
  unknownProvider: 'unknown provider',
  panelUnchanged: 'not rewritten',
  panelNoJudgment: 'no judgment yet',
  modeLoading: 'loading',
} satisfies Record<string, string>

/** The key union, derived from the English reference set. */
export type AutoKey = keyof typeof en

/** Simplified Chinese strings; the reference implementation this plugin shipped with. */
export const zh: Record<AutoKey, string> = {
  routingFailed: '路由状态请求失败',
  feedbackFailed: '反馈请求失败',
  notProvided: '未提供',
  notDecided: '尚无决定',
  toBeDetermined: '待确定',
  unknownService: '未知服务',
  unknownModel: '未知模型',
  sourceMain: '主会话',
  sourceChild: '子任务',
  statusApplied: '已应用',
  statusFailed: '未应用',
  statusUnsupported: '不支持调整',
  statusPending: '已判断/待应用',
  capabilityLine: '能力 {capability} · 判定确定度 {confidence}',
  capabilitySpread: '能力分布：{list}',
  depthLine: '投入 {depth} · 判定确定度 {confidence}',
  depthSpread: '投入分布：{list}',
  confidenceFormula: '确定度 = (最高概率 − 1/n) ÷ (1 − 1/n)，n 为候选数；不是任务成功率',
  feedbackAppropriate: '分配合适',
  feedbackTooHigh: '投入偏高',
  feedbackTooLow: '投入不足',
  feedbackUnknown: '无法判断',
  feedbackSummary: 'AUTO 分配：{depth} → {effort} · {model}',
  feedbackAsk: '评价资源分配是否合适',
  feedbackYour: '你反馈：{label}',
  feedbackTitle: '这次资源分配合适吗？',
  feedbackClear: '撤销反馈',
  feedbackNotSaved: '反馈未保存，请重试',
  navLabel: '自动模型路由',
  strategySummary: '查看决策策略',
  strategyIntro: 'Agent 负责拆解、派发与验收；Jev 只做有限判断，AUTO 验证目录并应用资源配置。任务数量、风险和重要性不直接等于推理难度。以下为只读说明，不会修改设置。',
  strategyCapability: '能力需求（仅子任务）',
  strategyCapabilityBody: 'bounded：方法明确、结果可验证的执行；analytical：需要调查、关联证据或选择方案；frontier：异常困难的原创推理或相互耦合的未知；insufficient_context：缺少目标或范围，停止并补充描述。',
  strategyDepth: '推理投入（主会话与子任务分别判断）',
  strategyDepthBody: '主模型不变。以具体模型推荐投入为起点，lower / baseline / higher 分别在受支持序列中降低一档、保持、提高一档；受当前设置上限约束，自动不选 max。轻量模型不意味着自动降低投入。',
  strategyFamilies: '当前子模型能力映射',
  strategyFamilyItem: '{level} → {model}（推荐起点 {start}）',
  strategyCatalogDefault: '目录默认',
  strategyTrailer: 'Magpie 保留对应家族前缀与真实 provider，不跨入口回退；模型与 effort 必须同时通过当前目录及官方允许列表校验。其他家族需显式指定模型及可验证投入。',
  strategyLimits: '约束、失败与恢复',
  strategyLimitsBody: '显式指定的模型与投入优先；两者都指定时只校验、不请求 Jev。目标不足、目录失效或子判断失败时停止派发，不偷偷继承或换模。主判断失败则可见停用 AUTO。fresh 子任务创建时绑定精确身份；后续消息和恢复不重新选模。fork 暂不支持。MANUAL 停止新判断，已有绑定子任务仍保持初始路线。',
  strategyRules: 'Jev 实际判据原文',
  strategyRulesBody: '下面直接展示执行中使用的英文规则，避免翻译改变含义；两个问题相互独立，不能读取对方答案。',
  keySaveFailed: 'API key 未保存',
  settingsSaveFailed: '设置未保存，请检查字段错误并重试',
  settingsReadFailed: '无法读取设置，请重新打开此页面',
  readingSettings: '正在读取设置…',
  keySaved: 'API key 已保存',
  settingsSaved: '设置已保存',
  settingsNotSaved: '设置未保存',
  keyUnavailable: '不可用',
  keyFromEnv: '来自启动环境',
  keyConfigured: '已配置',
  keyUnconfigured: '未配置',
  keyUnavailableHint: 'DSH 凭据服务不可用。',
  keyEnvHint: '先自行保留现有 key，从启动环境（如 .env.local）删除 OPENROUTER_API_KEY 并重启，再在这里保存。',
  keyStoredHint: '保存在 DSH 凭据存储，不写入设置文件；留空表示保持当前 key。',
  keyMissingHint: '未配置时 AUTO 判断会停用；保存 key 后不会自动重启已停用的会话。',
  settingsUnavailable: '无法读取设置',
  settingsReadOnly: '设置只读',
  partialSaveFailed: '部分更改未保存，请检查提示',
  save: '保存',
  saving: '保存中…',
  configInvalid: '设置文件无法解析或含无效字段，已按可解析值与默认值显示；保存会覆盖损坏部分',
  deprecatedKeys: '设置文件中的旧映射（{list}）已不再生效，下次保存设置时移除。',
  decisionService: '决策服务',
  decisionServiceIntro: 'AUTO 把脱敏任务发送给所选决策服务；不跨服务自动回退。',
  serviceSwitchNote: '切换服务后先保存，再管理该服务的独立 API key；不会沿用原服务的 key。',
  credentialRef: '凭据引用：{ref}',
  decisionModel: '决策模型',
  compatibleEndpoint: '兼容端点 ',
  customEndpointHint: '仅兼容 System One state/questions → answers；HTTPS 或回环 HTTP；禁止 URL 凭据、查询参数与重定向。',
  endpointLine: '接口：{endpoint}',
  connectionOk: '连接成功 · {ms} ms',
  connectionFailed: '连接失败：{reason}',
  serviceUnavailable: '服务不可用',
  connectFailedRetry: '无法连接决策服务，请重试',
  connectTestFailed: '连接测试失败，请检查网络后重试',
  testing: '测试中…',
  testConnection: '测试连接',
  testInFlight: '正在请求所选决策服务…',
  saveBeforeTest: '请先保存设置，再测试连接',
  testCost: '测试会产生一次决策请求，不包含会话内容；请先保存设置。',
  invalidService: '请填写有效模型和兼容端点',
  serviceKeyLabel: '{service} API Key',
  saveServiceFirst: '请先保存服务选择',
  stateAfterSave: '保存后读取',
  cancelRemoveKey: '取消删除 key',
  removeKey: '删除 key',
  invalidKey: 'API key 不能含空白，且不能超过 512 字符',
  jevTimeout: '判断等待上限',
  jevTimeoutHint: '1000–8000 毫秒，默认 5000；超时后该会话停用 AUTO。',
  msSuffix: ' 毫秒',
  sessionSection: '会话',
  sessionIntro: '主模型不变；子任务独立选择模型能力与推理投入，并在创建时应用。MANUAL 不进行自动判断。',
  defaultMode: '新会话默认模式',
  defaultModeAutoHint: '仅影响新会话；每个用户回合都会把脱敏任务发送给所选决策服务请求 Jev。',
  defaultModeManualHint: '仅影响新会话，不改变已有会话。',
  decisionToast: '判断提示',
  effortCap: '推理强度上限',
  autoSection: '自动选配',
  autoIntro: '主会话仅调整推理投入；子任务按目标与范围选择合适的能力档，再确定投入。保留显式指定的模型和推理等级，不自动重试或升级。',
  autoCatalogNote: 'Magpie 使用完整模型 ID 与官方允许列表；目录不可用或目标不清楚时停止并提示。fresh 子任务受支持，fork 暂不支持。',
  noticeNotRouted: '最近子任务未路由：{reason}（按 DSH 默认运行）',
  lockedModel: 'AUTO 不支持当前模型',
  lockedModelLine: '{provider} / {model} 不在自动路由支持范围，已切换为 MANUAL。',
  lockedFamilies: '目前仅支持 {families} 系列模型；其他模型策略欢迎提交 issue 或 PR：',
  lockedHint: '切回 {families} 系列模型后，可重新点击启用 AUTO。',
  panelAutoTitle: '自动调整推理强度',
  panelManualTitle: '手动：不自动调整',
  panelOutput: '本回合插件输出：{effort} · {reason}',
  panelLatest: '最近决策',
  panelDepth: 'AUTO · {depth}；主模型不变，推理投入按请求应用；子任务自动选配。',
  panelDisabled: 'Jev 停用（{category}）：{hint}。{at}。点击 AUTO 重试。',
  panelData: 'AUTO 会把脱敏任务文本发送给设置中所选的决策服务判断。',
  switchTitleLocked: 'AUTO 仅支持 {families} 系列模型；悬停查看说明',
  switchTitleDisabled: 'Jev 判断已停用：{hint}。点击 AUTO 重试',
  switchTitleIdle: '点击切换自动推理强度',
  switchAriaLocked: '推理强度模式：{mode}（AUTO 不支持当前模型，不可切换）',
  switchAria: '推理强度模式：{mode}，点击切换',
  switchJevDisabled: '{mode} · Jev 停用',
  panelAria: '自动路由状态',
  listSeparator: '、',
  unknownProvider: '未知 provider',
  panelUnchanged: '未改写',
  panelNoJudgment: '尚无判断',
  modeLoading: '加载中',
}

type Params = Record<string, string | number>
type Translator = (key: AutoKey) => string

let bound: Translator | undefined

/** Bind the host translator. Called once from the client entry (`apply`). */
export function bindLocale(translator: Translator): void {
  bound = translator
}

/** Drop the bound translator and fall back to the Chinese reference set (tests). */
export function resetLocale(): void {
  bound = undefined
}

/** Interpolate `{name}` placeholders; unknown names stay verbatim. */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

/**
 * Translate one key. Without a bound translator the Chinese reference set is
 * used, so unit tests and any embedding without a locale service keep the copy
 * this plugin shipped with.
 */
export function t(key: AutoKey, params?: Params): string {
  return interpolate(bound === undefined ? zh[key] : bound(key), params)
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The AUTO client copy (chip, panel, feedback label and settings section). */
    [NS]: AutoKey
  }
}
