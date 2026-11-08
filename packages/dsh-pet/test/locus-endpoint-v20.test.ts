import { describe, expect, it } from 'vitest'
import {
  endpointFromKey,
  endpointKeyOf,
  LocusError,
  normalizeLocusEndpoint,
} from '../src/host/locus/aggregate.js'
import { endpointKeyV20 } from '../src/host/locus/locus-set-v20.js'
import { STORAGE_KEY_SEPARATOR } from '../src/host/locus/storage-key.js'
import { docChatId, isDocEndpoint } from '../src/host/locus/doc-endpoint.js'

describe('unified locus endpoint normalization', () => {
  it('normalizes chat and optional thread ids and keeps their keys distinct', () => {
    const chat = normalizeLocusEndpoint({ chatId: '  oc_chat  ', threadId: '   ' })
    const topic = normalizeLocusEndpoint({ chatId: ' oc_chat ', threadId: ' omt_thread ' })

    expect(chat.endpoint).toEqual({ chatId: 'oc_chat' })
    expect(topic.endpoint).toEqual({ chatId: 'oc_chat', threadId: 'omt_thread' })
    expect(chat.key).toBe('oc_chat')
    expect(topic.key).toBe(`oc_chat${STORAGE_KEY_SEPARATOR}omt_thread`)
    expect(endpointFromKey(topic.key)).toEqual(topic.endpoint)
    expect(endpointKeyOf(chat.endpoint)).not.toBe(endpointKeyOf(topic.endpoint))
  })

  it('spec Scenario "既有群入口键不变": IM keys are byte-identical to the pre-change form', () => {
    const group = normalizeLocusEndpoint({ chatId: 'oc_A' })
    const topic = normalizeLocusEndpoint({ chatId: 'oc_A', threadId: 'omt_T' })

    expect(group.key).toBe('oc_A')
    expect(topic.key).toBe(`oc_A${STORAGE_KEY_SEPARATOR}omt_T`)
    expect(isDocEndpoint(group.endpoint)).toBe(false)
    expect(isDocEndpoint(topic.endpoint)).toBe(false)
  })

  it('spec Scenario "规范化不丢失文档前缀": normalize → key → parse round-trips a comment entry', () => {
    const chatId = docChatId('Dx0000000000000000000000001')!
    const normalized = normalizeLocusEndpoint({ chatId, threadId: '7696944637407137026' })

    const parsed = endpointFromKey(normalized.key)

    expect(parsed).toEqual({ chatId: 'doc:docx:Dx0000000000000000000000001', threadId: '7696944637407137026' })
    expect(isDocEndpoint(parsed)).toBe(true)
  })

  it('an IM egress handed a doc root id throws locally before any lark-cli call', async () => {
    const { createLarkCliClient } = await import('../src/host/channel/lark.js')
    const calls: unknown[] = []
    const client = createLarkCliClient('lark-cli', (async (...args: unknown[]) => {
      calls.push(args)
      return { stdout: '{"ok":true,"data":{}}' }
    }) as never)

    await expect(client.chatName(docChatId('Dx0000000000000000000000001')!)).rejects.toThrow(/doc-comment identifier/)
    await expect(client.reply('doc:docx:Dx0000000000000000000000001/1/2', 'hi')).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  it('keeps a document entry and a same-literal chat entry in different storage keys', () => {
    const doc = endpointKeyV20({ chatId: docChatId('X1')! })
    const chat = endpointKeyV20({ chatId: 'X1' })
    expect(doc).not.toBe(chat)
    expect(doc).toBe(normalizeLocusEndpoint({ chatId: docChatId('X1')! }).key)
    expect(chat).toBe(normalizeLocusEndpoint({ chatId: 'X1' }).key)
  })

  it('rejects missing ids and delimiter injection', () => {
    expect(() => normalizeLocusEndpoint({ chatId: ' ' })).toThrow(LocusError)
    expect(() => normalizeLocusEndpoint({ chatId: `oc_chat${STORAGE_KEY_SEPARATOR}other` })).toThrow(
      /may not contain the storage key separator/,
    )
    expect(() => endpointFromKey('')).toThrow(LocusError)
  })
})
