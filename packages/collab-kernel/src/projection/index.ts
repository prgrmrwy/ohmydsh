import type { Delivery, Overview, Presence, SpaceState } from '../model/index.js'

function plainText(value: string): string {
  return value.replace(/\p{Cc}+/gu, ' ').trim().replace(/[!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~]/g, '\\$&')
}
const active = (status: string) => status === 'draft' || status === 'agreed'

export function project(state: SpaceState, presence: Record<string, Presence>): string {
  const lines = ['# 协作空间总览']
  if (state.purpose !== undefined) lines.push('', `用途：${plainText(state.purpose)}`)
  lines.push('', '## Charter')
  const charter = Object.values(state.items).find(item => item.kind === 'charter')
  if (charter) lines.push(`Charter：${plainText(charter.title)}（revision ${charter.revision}）`)
  else lines.push('Charter：无')

  lines.push('', '## 成员')
  for (const member of Object.values(state.members).sort((a, b) => a.joinSeq - b.joinSeq)) {
    lines.push(`- 成员 ${plainText(member.name)}：${member.status}；在线 ${presence[member.name] ?? 'unknown'}；状态 ${plainText(member.statusText) || '无'}`)
  }

  lines.push('', '## 待确认')
  for (const item of Object.values(state.items).filter(item => active(item.status) && item.requiredAcks.some(name => item.acks[name] !== item.revision))) {
    const missing = item.requiredAcks.filter(name => item.acks[name] !== item.revision)
    lines.push(`条目 ${plainText(item.id)} ${plainText(item.title)}；缺少 ${missing.map(plainText).join('、')}`)
  }

  lines.push('', '## 未结 request')
  for (const item of Object.values(state.items)) {
    if (item.kind === 'request' && active(item.status) && item.progress !== 'done' && item.progress !== 'rejected') lines.push(`- Request ${plainText(item.id)} ${plainText(item.title)}；承接 ${plainText(item.assignee)}；进度 ${item.progress}`)
  }

  // Items locked by the removed escalation/decision mechanisms: read-only history from pre-change logs.
  const history = Object.values(state.items).filter(item => !active(item.status))
  if (history.length) {
    lines.push('', '## 历史条目')
    for (const item of history) lines.push(`- 条目 ${plainText(item.id)} ${plainText(item.title)}；只读历史 ${item.status}${item.kind === 'request' ? `；进度 ${item.progress}` : ''}`)
  }

  lines.push('', '## 待处理投递')
  const overview = state as SpaceState & Partial<Pick<Overview, 'pendingDeliveries' | 'inFlightDeliveries'>>
  const pending = overview.pendingDeliveries ?? Object.values(state.deliveries).filter(delivery => delivery.outcome === undefined)
  const renderDelivery = (delivery: Delivery, status: 'unknown' | 'inFlight'): string => `投递 ${plainText(delivery.deliveryId)}：${delivery.kind}；成员 ${plainText(delivery.member)}；结果 ${status}`
  for (const delivery of pending) lines.push(renderDelivery(delivery, 'unknown'))
  for (const delivery of overview.inFlightDeliveries ?? []) lines.push(renderDelivery(delivery, 'inFlight'))
  return lines.join('\n')
}
