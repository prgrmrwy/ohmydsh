import { BREAKER_LIMIT, type Delivery, type Overview, type Presence, type SpaceState } from '../model/index.js'

function plainText(value: string): string {
  return value.replace(/\p{Cc}+/gu, ' ').trim().replace(/[!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~]/g, '\\$&')
}

export function project(state: SpaceState, presence: Record<string, Presence | 'paused'>): string {
  const lines = ['# 协作空间总览', '', '## Charter']
  const charter = Object.values(state.items).find(item => item.kind === 'charter')
  if (charter) lines.push(`Charter：${plainText(charter.title)}（revision ${charter.revision}）`)
  else lines.push('Charter：无')

  lines.push('', '## 成员')
  for (const member of Object.values(state.members).sort((a, b) => a.joinSeq - b.joinSeq)) {
    const online = presence[member.name] ?? 'unknown'
    const onlineText = member.wakeCount >= BREAKER_LIMIT ? 'paused' : online
    lines.push(`- 成员 ${plainText(member.name)}：${member.status}；在线 ${onlineText}；状态 ${plainText(member.statusText) || '无'}`)
  }

  lines.push('', '## 待确认')
  for (const item of Object.values(state.items).filter(item => item.requiredAcks.some(name => item.acks[name] !== item.revision))) {
    const missing = item.requiredAcks.filter(name => item.acks[name] !== item.revision)
    lines.push(`条目 ${plainText(item.id)} ${plainText(item.title)}；缺少 ${missing.map(plainText).join('、')}`)
  }

  lines.push('', '## 未结 request')
  for (const item of Object.values(state.items).filter(item => item.kind === 'request' && item.progress !== 'done' && item.progress !== 'rejected')) {
    if (item.kind === 'request') lines.push(`- Request ${plainText(item.id)} ${plainText(item.title)}；承接 ${plainText(item.assignee)}；进度 ${item.progress}`)
  }

  lines.push('', '## 已升级')
  for (const item of Object.values(state.items).filter(item => item.status === 'escalated')) lines.push(`- 条目 ${plainText(item.id)} ${plainText(item.title)}`)

  lines.push('', '## 已决定')
  for (const item of Object.values(state.items).filter(item => item.status === 'decided')) {
    const decision = state.decisions.find(entry => entry.itemId === item.id)
    lines.push(`条目 ${plainText(item.id)} ${plainText(item.title)}；决定人 ${plainText(decision?.actor ?? 'unknown')}；选择 ${plainText(decision?.choice ?? 'unknown')}`)
  }

  lines.push('', '## 等待确认通道')
  for (const request of Object.values(state.requests).filter(request => request.status === 'open' && request.awaitingChannel)) {
    lines.push(`决策请求 ${plainText(request.id)}（条目 ${plainText(request.itemId)}）：awaitingChannel`)
  }

  lines.push('', '## 待处理投递')
  const overview = state as SpaceState & Partial<Pick<Overview, 'pendingDeliveries' | 'inFlightDeliveries'>>
  const pending = overview.pendingDeliveries ?? Object.values(state.deliveries).filter(delivery => delivery.outcome === undefined)
  const renderDelivery = (delivery: Delivery, status: 'unknown' | 'inFlight'): string => `投递 ${plainText(delivery.deliveryId)}：${delivery.kind}；成员 ${plainText(delivery.member)}；结果 ${status}`
  for (const delivery of pending) lines.push(renderDelivery(delivery, 'unknown'))
  for (const delivery of overview.inFlightDeliveries ?? []) lines.push(renderDelivery(delivery, 'inFlight'))
  return lines.join('\n')
}
