/**
 * Copy dictionaries for the Memory settings page.
 *
 * One namespace with zh/en: the key union is the type-level source of truth,
 * `en` is the reference set, and `zh` is type-checked to the same key set so the
 * two can never drift apart.
 *
 * @module dsh-memex/client/locales
 */

/** The locale namespace this plugin owns. */
export const NS = 'settings.memex'

/** Keys of the Memory settings copy. */
export type MemexKey =
  | 'nav'
  | 'intro'
  | 'columnLibrary'
  | 'workspaceHint'
  | 'repoHint'
  | 'addPath'
  | 'addRepo'
  | 'removePath'
  | 'addStore'
  | 'removeStore'
  | 'removeStoreHint'
  | 'copy'
  | 'copied'
  | 'remoteConfigured'
  | 'remoteUnconfigured'
  | 'remoteAuto'
  | 'remoteLastSync'
  | 'remoteUnknown'
  | 'actionConfigureRemote'
  | 'actionChangeRemote'
  | 'actionConfirmChange'
  | 'actionCancel'
  | 'actionSync'
  | 'actionBrowse'
  | 'browseOpening'
  | 'browseRedirecting'
  | 'browseUnavailable'
  | 'actionPull'
  | 'actionAutoOn'
  | 'actionAutoOff'
  | 'actionBusy'
  | 'urlPlaceholder'
  | 'changeRemoteWarning'
  | 'undeclaredTitle'
  | 'undeclaredHint'
  | 'actionDeclare'
  | 'actionExpand'
  | 'actionCollapse'
  | 'actionAttach'
  | 'attachEmpty'
  | 'attachNew'
  | 'entryNew'
  | 'fallbackLabel'
  | 'fallbackHint'
  | 'assumedLabel'
  | 'assumedHint'
  | 'actionDeclareEntry'
  | 'noWorkspaceTitle'
  | 'degradedWorkspaces'
  | 'memoryLabel'
  | 'memoryHint'
  | 'entryCount'
  | 'hiddenGroup'
  | 'actionShow'
  | 'actionHide'
  | 'probeTitle'
  | 'probeHint'
  | 'probePlaceholder'
  | 'probeRun'
  | 'probeResult'
  | 'probeFailed'
  | 'save'
  | 'discard'
  | 'saved'
  | 'unsaved'
  | 'saveFailed'
  | 'conflictHome'
  | 'conflictPattern'
  | 'conflictName'
  | 'unavailableTitle'
  | 'unavailableDetail'
  | 'loading'
  | 'refresh'
  | 'libraryAbsent'
  | 'cards'
  | 'factRemote'
  | 'factAuto'
  | 'factLastSync'
  | 'factDetail'
  | 'factPublish'
  | 'partWorkspaces'
  | 'partEntry'
  | 'primaryBadge'
  | 'additionalBadge'
  | 'actionSetPrimary'
  | 'actionAddEntry'
  | 'conflictPrimary'
  | 'conflictDeclared'
  | 'itemMemory'
  | 'itemFallback'
  | 'notePreserved'
  | 'noteAlsoCloses'
  | 'noteRemovedEntryField'
  | 'noteUnregisteredReopen'
  | 'noteStagedPrimary'
  | 'noteDeclaredPrimary'
  | 'noteInheritedAttach'
  | 'noteReplaced'
  | 'noteReplacedSplit'
  | 'notePersonalDespiteDeclaration'
  | 'refuseAncestor'
  | 'refuseAncestorConfig'
  | 'refuseRemoteEntry'
  | 'refuseBinding'
  | 'refusePersonalEntry'
  | 'refuseWouldClose'
  | 'refuseStillClosed'
  | 'refuseUnregistered'
  | 'refuseDegraded'
  | 'refuseRemoteClaimed'
  | 'refuseUndecided'
  | 'attachBecomesPrimary'
  | 'attachBecomesHint'
  | 'fallbackViaBindingRead'
  | 'fallbackViaBindingWrite'
  | 'fallbackViaBindingBoth'
  | 'actionReplacePrimary'
  | 'remoteClaimedHint'
  | 'switchesReadonlyUnregistered'
  | 'switchesReadonlyPathless'
  | 'switchesReadonlyDegraded'
  | 'publishExternal'
  | 'publishInternal'
  | 'publishUnknown'
  | 'on'
  | 'off'

/** English strings (reference key set). */
export const en: Record<MemexKey, string> = {
  nav: 'Memory',
  intro: 'Each workspace carries its own memory entries. The primary entry is what reads, recalls and writes by default; an additional entry is only touched when it is named explicitly.',
  columnLibrary: 'Memory library',
  workspaceHint: 'Directory this library owns',
  repoHint: 'Repository (URL or pattern)',
  addPath: '+ path',
  addRepo: '+ repo',
  removePath: 'Remove',
  addStore: 'Add memory library',
  removeStore: 'Remove',
  removeStoreHint: 'Removing an entry does not delete the library directory.',
  copy: 'Copy',
  copied: 'Copied',
  remoteConfigured: 'Configured',
  remoteUnconfigured: 'Not set',
  remoteAuto: 'auto',
  remoteLastSync: 'last sync',
  remoteUnknown: 'Unavailable',
  actionConfigureRemote: 'Set remote',
  actionChangeRemote: 'Change remote',
  actionConfirmChange: 'Change it',
  actionCancel: 'Cancel',
  actionSync: 'Sync now',
  actionBrowse: 'Open cards',
  browseOpening: 'Starting the card browser for {scope}…',
  browseRedirecting: 'Opening {scope}…',
  browseUnavailable: 'Cannot open {scope}',
  actionPull: 'Pull changes',
  actionAutoOn: 'Turn auto on',
  actionAutoOff: 'Turn auto off',
  actionBusy: 'Working…',
  urlPlaceholder: 'git@host:owner/repo.git',
  changeRemoteWarning: 'Changing the remote fetches from and pushes to the new target.',
  undeclaredTitle: 'Libraries not in this configuration',
  undeclaredHint: 'These libraries exist under the namespace but no entry declares them. Declaring only adds them to the configuration; a publish direction must still be written in settings, and without one they count as external.',
  actionDeclare: 'Declare',
  actionExpand: 'Show details',
  actionCollapse: 'Hide details',
  actionAttach: '+ add entry',
  attachEmpty: 'Every known library is already attached',
  attachNew: 'New library…',
  entryNew: 'new library',
  fallbackLabel: 'Fallback entry',
  fallbackHint: 'On: this workspace can also read and write personal. Off: neither direction reaches it.',
  assumedLabel: 'derived, not declared',
  assumedHint: 'Nothing declares this workspace, so a session here uses the library derived from its path. It is written to the configuration only when you declare it or attach another entry.',
  actionDeclareEntry: 'Declare this entry',
  noWorkspaceTitle: 'Paths with no workspace',
  memoryLabel: 'Memory',
  memoryHint: 'Memory is off here: no recall prompt and no write reminder are injected, and memex tools refuse in this workspace. Other workspaces are unaffected.',
  entryCount: 'entries',
  hiddenGroup: 'Memory off',
  actionShow: 'Show',
  actionHide: 'Hide',
  degradedWorkspaces: 'The host exposes no workspace registry: these blocks come from the configured paths instead.',
  probeTitle: 'Check a path',
  probeHint: 'See which library a directory resolves to. Nothing is created.',
  probePlaceholder: '/path/to/workspace',
  probeRun: 'Resolve',
  probeResult: 'resolves to',
  probeFailed: 'Could not resolve',
  save: 'Save changes',
  discard: 'Discard',
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saveFailed: 'Save rejected',
  conflictHome: 'Two entries share one library path',
  conflictPattern: 'Two entries declare the same repository pattern',
  conflictName: 'Every entry needs a unique name',
  unavailableTitle: 'Host facts unavailable',
  unavailableDetail: 'The settings page can still edit the configuration; library facts stay hidden rather than guessed.',
  loading: 'Loading…',
  refresh: 'Refresh',
  libraryAbsent: 'Not created yet; it appears on the first write.',
  cards: 'cards',
  factRemote: 'Remote',
  factAuto: 'Auto-sync',
  factLastSync: 'Last sync',
  factDetail: 'Detail',
  factPublish: 'Publication',
  partWorkspaces: 'Workspaces',
  partEntry: 'Memory library',
  primaryBadge: 'primary',
  additionalBadge: 'additional',
  actionSetPrimary: 'Make primary',
  actionAddEntry: '+ entry',
  conflictPrimary: 'One workspace needs exactly one primary entry',
  conflictDeclared: 'A workspace\'s declared primary does not claim it',
  itemMemory: 'memory',
  itemFallback: 'fallback entry',
  notePreserved: '{path} keeps its {item} closed: a path declaration was added for it',
  noteAlsoCloses: 'This also turns {item} off for {path}',
  noteRemovedEntryField: 'The {item} setting on entry {scope} was removed: it closed every path the library claims',
  noteUnregisteredReopen: 'Paths of {scope} that are not registered workspaces open their {item} again',
  noteStagedPrimary: 'The derived library {scope} was declared as well, so it stays the primary',
  noteDeclaredPrimary: '{scope} stays the primary of {path}: the path declaration records it',
  noteInheritedAttach: '{scope} becomes the primary of {path}; it no longer inherits {list}',
  noteReplaced: 'Primary of {path}: {replaced} → {scope}',
  noteReplacedSplit: 'Primary of {path}: {replaced} → {scope}. {path} now claims its own entries instead of inheriting from {split}',
  notePersonalDespiteDeclaration: 'personal is an entry of {path}, so it stays reachable even with the fallback off',
  refuseAncestor: '{item} is closed for {path} by the declaration on {ancestor}; open it there',
  refuseAncestorConfig: '{item} is closed for {path} by the declaration on {ancestor}, which is not a registered workspace; edit settings to change it',
  refuseRemoteEntry: '{item} is closed by entry {scope}, which also claims by repository; edit settings to change it',
  refuseBinding: 'The binding {binding} keeps personal reachable from {path}; remove the binding to close it',
  refusePersonalEntry: 'personal is an entry of {path}; detach it to close the fallback',
  refuseWouldClose: 'This would turn {item} off for {victim}',
  refuseStillClosed: '{item} stays closed for {path} because of the declaration on {ancestor}',
  refuseUnregistered: '{path} is not a registered workspace',
  refuseDegraded: 'The host did not report its workspaces, so routing changes cannot be checked; edit settings directly',
  refuseRemoteClaimed: '{path} is claimed by a repository pattern; edit settings to change its entries',
  refuseUndecided: 'The routing of {path} is not known here',
  attachBecomesPrimary: '{scope} would become the primary of {path}, but:',
  attachBecomesHint: '{path} inherits {list} from {split}; the first entry added here becomes its primary',
  fallbackViaBindingRead: 'The fallback is off, but the binding {binding} still lets {path} read personal',
  fallbackViaBindingWrite: 'The fallback is off, but the binding {binding} still lets {path} write personal',
  fallbackViaBindingBoth: 'The fallback is off, but the binding {binding} still lets {path} read and write personal',
  actionReplacePrimary: 'Replace primary',
  remoteClaimedHint: 'A repository pattern claims this workspace. Its entries are edited in settings, not here.',
  switchesReadonlyUnregistered: 'Not a registered workspace: the switches show the configured state and are changed in settings.',
  switchesReadonlyPathless: 'This entry claims no path: the switches show the configured state and are changed in settings.',
  switchesReadonlyDegraded: 'The host did not report its workspaces: the switches show the configured state and are changed in settings.',
  publishExternal: 'external — cards may leave this machine',
  publishInternal: 'internal — cards stay inside',
  publishUnknown: 'unknown — no declaration and no remote evidence; writes are refused',
  on: 'on',
  off: 'off',
}

/** Chinese strings, type-checked against the same key set. */
export const zh: Record<MemexKey, string> = {
  nav: '记忆',
  intro: '每个工作区下面挂着它自己的记忆入口。主入口是默认读取、召回与写入的对象；附加入口只在被显式指名时才会用到。',
  columnLibrary: '记忆库',
  workspaceHint: '归属这个库的目录',
  repoHint: '仓库（地址或正则）',
  addPath: '+ 路径',
  addRepo: '+ 仓库',
  removePath: '移除',
  addStore: '添加记忆库',
  removeStore: '移除',
  removeStoreHint: '移除条目不会删除库目录。',
  copy: '复制',
  copied: '已复制',
  remoteConfigured: '已配置',
  remoteUnconfigured: '未设置',
  remoteAuto: '自动同步',
  remoteLastSync: '最近同步',
  remoteUnknown: '不可用',
  actionConfigureRemote: '设置远端',
  actionChangeRemote: '更换远端',
  actionConfirmChange: '确认更换',
  actionCancel: '取消',
  actionSync: '立即同步',
  actionBrowse: '打开卡片',
  browseOpening: '正在启动 {scope} 的卡片浏览…',
  browseRedirecting: '正在打开 {scope}…',
  browseUnavailable: '无法打开 {scope}',
  actionPull: '拉取改动',
  actionAutoOn: '开启自动同步',
  actionAutoOff: '关闭自动同步',
  actionBusy: '执行中…',
  urlPlaceholder: 'git@host:owner/repo.git',
  changeRemoteWarning: '更换远端会与新的目标仓交互（拉取并推送）。',
  undeclaredTitle: '未在配置中的库',
  undeclaredHint: '这些库已存在于命名空间下，但没有任何条目声明它们。声明只把它们纳入配置：发布方向仍要在 settings 里显式写，未写时按 external 处理。',
  actionDeclare: '声明',
  actionExpand: '展开详情',
  actionCollapse: '收起',
  actionAttach: '+ 增加附加入口',
  attachEmpty: '已知的库都已经挂上来了',
  attachNew: '新建库…',
  entryNew: '新建库',
  fallbackLabel: '兜底入口',
  fallbackHint: '开启：这个工作区也能读写 personal。关闭：两个方向都不可达。',
  assumedLabel: '派生，未声明',
  assumedHint: '没有任何条目声明这个工作区，会话在这里用的是从路径派生出来的库。只有当你声明它、或者给它挂别的入口时，才会写进配置。',
  actionDeclareEntry: '声明为配置条目',
  noWorkspaceTitle: '未对应工作区的路径',
  memoryLabel: '记忆',
  memoryHint: '这个工作区已关闭记忆：不注入召回提示与写卡提醒，memex 工具在这里会被拒绝。其他工作区不受影响。',
  entryCount: '个入口',
  hiddenGroup: '已关闭记忆',
  actionShow: '展开',
  actionHide: '收起',
  degradedWorkspaces: '宿主没有提供工作区注册表：以下块按配置里的路径列出。',
  probeTitle: '检查路径',
  probeHint: '查看某个目录会解析到哪个库。不会创建任何东西。',
  probePlaceholder: '/path/to/workspace',
  probeRun: '解析',
  probeResult: '解析为',
  probeFailed: '无法解析',
  save: '保存修改',
  discard: '放弃修改',
  saved: '已保存',
  unsaved: '有未保存的修改',
  saveFailed: '保存被拒绝',
  conflictHome: '两个条目共用了同一个库路径',
  conflictPattern: '两个条目声明了同一个仓库模式',
  conflictName: '每个条目的名称必须唯一',
  unavailableTitle: 'Host 事实不可用',
  unavailableDetail: '配置仍可编辑；库的事实保持隐藏，不用推测值填充。',
  loading: '加载中…',
  refresh: '刷新',
  libraryAbsent: '尚未创建，首次写入时创建。',
  cards: '张卡片',
  factRemote: '远端',
  factAuto: '自动同步',
  factLastSync: '最近同步',
  factDetail: '详情',
  factPublish: '发布方向',
  partWorkspaces: '工作区',
  partEntry: '记忆入口',
  primaryBadge: '主',
  additionalBadge: '附',
  actionSetPrimary: '设为主入口',
  actionAddEntry: '+ 入口',
  conflictPrimary: '同一组工作区必须恰好有一个主入口',
  conflictDeclared: '工作区声明的主入口并未认领该工作区',
  itemMemory: '记忆',
  itemFallback: '兜底入口',
  notePreserved: '{path} 的{item}保持关闭：为它补了一条路径声明',
  noteAlsoCloses: '这也会关闭 {path} 的{item}',
  noteRemovedEntryField: '已移除入口 {scope} 上的{item}设置：它会关闭该库认领的所有路径',
  noteUnregisteredReopen: '{scope} 认领的非注册工作区路径会重新打开{item}',
  noteStagedPrimary: '派生出的库 {scope} 也一并声明，以保持它是主入口',
  noteDeclaredPrimary: '{scope} 仍是 {path} 的主入口：由路径声明记录',
  noteInheritedAttach: '{scope} 成为 {path} 的主入口；不再继承 {list}',
  noteReplaced: '{path} 的主入口：{replaced} → {scope}',
  noteReplacedSplit: '{path} 的主入口：{replaced} → {scope}。{path} 改为自己认领入口，不再继承 {split}',
  notePersonalDespiteDeclaration: 'personal 是 {path} 的入口，关闭兜底后仍可访问',
  refuseAncestor: '{path} 的{item}被 {ancestor} 上的声明关闭；请在那里打开',
  refuseAncestorConfig: '{path} 的{item}被 {ancestor} 上的声明关闭，它不是注册工作区；请在设置中修改',
  refuseRemoteEntry: '{item}由入口 {scope} 关闭，它还按仓库认领；请在设置中修改',
  refuseBinding: '绑定 {binding} 让 {path} 仍能访问 personal；移除该绑定才能关闭',
  refusePersonalEntry: 'personal 是 {path} 的入口；先移除它才能关闭兜底',
  refuseWouldClose: '这会关闭 {victim} 的{item}',
  refuseStillClosed: '由于 {ancestor} 上的声明，{path} 的{item}仍然关闭',
  refuseUnregistered: '{path} 不是注册工作区',
  refuseDegraded: '宿主没有报告工作区，无法校验路由变化；请直接修改设置',
  refuseRemoteClaimed: '{path} 由仓库规则认领；请在设置中修改它的入口',
  refuseUndecided: '此处无法得知 {path} 的路由',
  attachBecomesPrimary: '{scope} 会成为 {path} 的主入口，但：',
  attachBecomesHint: '{path} 从 {split} 继承 {list}；在这里添加的第一个入口会成为它的主入口',
  fallbackViaBindingRead: '兜底已关闭，但绑定 {binding} 仍让 {path} 可读 personal',
  fallbackViaBindingWrite: '兜底已关闭，但绑定 {binding} 仍让 {path} 可写 personal',
  fallbackViaBindingBoth: '兜底已关闭，但绑定 {binding} 仍让 {path} 可读写 personal',
  actionReplacePrimary: '替换主入口',
  remoteClaimedHint: '该工作区由仓库规则认领，它的入口需在设置中修改。',
  switchesReadonlyUnregistered: '不是注册工作区：开关显示配置中的状态，需在设置中修改。',
  switchesReadonlyPathless: '该入口不认领路径：开关显示配置中的状态，需在设置中修改。',
  switchesReadonlyDegraded: '宿主没有报告工作区：开关显示配置中的状态，需在设置中修改。',
  publishExternal: '外部（卡片会离开这台机器）',
  publishInternal: '内部（卡片不出网）',
  publishUnknown: '未知（既没有声明也没有远端证据，写入会被拒绝）',
  on: '开',
  off: '关',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Memory settings page copy. */
    [NS]: MemexKey
  }
}
