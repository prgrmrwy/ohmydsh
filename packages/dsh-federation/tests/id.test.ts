import { describe, expect, it } from 'vitest'
import {
  FederatedIdError,
  decodeSessionId,
  decodeWorkspaceId,
  encodeSessionId,
  encodeWorkspaceId,
  parseNodeId,
  type NativeSessionId,
  type NativeWorkspaceId,
  type NodeId,
} from '../src/core/index.js'

const node = parseNodeId('node-a')
const nodes = new Set<NodeId>([node])

function randomUnicode(seed: number): string {
  let value = `native-${seed}-`
  for (let i = 0; i < 12; i++) {
    const point = 0x20 + ((seed * 1103515245 + i * 12345) >>> 0) % (0xd7ff - 0x20)
    value += String.fromCodePoint(point)
  }
  return value
}

describe('fed1 identity codec', () => {
  it('round-trips arbitrary valid UTF-8 native IDs with canonical output', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const native = randomUnicode(seed)
      const session = encodeSessionId({ nodeId: node, nativeId: native as NativeSessionId })
      const workspace = encodeWorkspaceId({ nodeId: node, nativeId: native as NativeWorkspaceId })
      expect(decodeSessionId(session, nodes)).toEqual({ nodeId: node, nativeId: native })
      expect(decodeWorkspaceId(workspace, nodes)).toEqual({ nodeId: node, nativeId: native })
    }
  })

  it('fails closed for malformed, unknown-version, unknown-node and wrong-kind IDs', () => {
    const session = encodeSessionId({ nodeId: node, nativeId: 'same' as NativeSessionId })
    expect(() => decodeWorkspaceId(session, nodes)).toThrowError(expect.objectContaining({ code: 'WRONG_KIND' }))
    expect(() => decodeSessionId(session, new Set())).toThrowError(expect.objectContaining({ code: 'UNKNOWN_NODE' }))
    expect(() => decodeSessionId(session.replace('fed1:', 'fed2:'), nodes)).toThrowError(expect.objectContaining({ code: 'UNKNOWN_VERSION' }))
    for (const value of ['', 'native', 'fed1:node-a:s:', 'fed1:node a:s:c2FtZQ', 'fed1:node-a:s:c2FtZQ==', 'fed1:node-a:s:%%%%']) {
      expect(() => decodeSessionId(value, nodes), value).toThrow(FederatedIdError)
    }
  })

  it('enforces UTF-8 byte bounds and rejects invalid UTF-8', () => {
    expect(() => encodeSessionId({ nodeId: node, nativeId: '' as NativeSessionId })).toThrowError(expect.objectContaining({ code: 'MALFORMED' }))
    expect(() => encodeSessionId({ nodeId: node, nativeId: '界'.repeat(1366) as NativeSessionId })).toThrowError(expect.objectContaining({ code: 'TOO_LONG' }))
    expect(() => decodeSessionId('fed1:node-a:s:_w', nodes)).toThrowError(expect.objectContaining({ code: 'MALFORMED' }))
  })

  it('keeps identity stable across display/alias rename and separates native collisions', () => {
    const native = 'native-collision'
    const a = parseNodeId('node-a')
    const b = parseNodeId('node-b')
    const before = encodeSessionId({ nodeId: a, nativeId: native as NativeSessionId })
    const renamedMetadata = { displayName: 'Renamed VM', sshAlias: 'new-alias' }
    expect(renamedMetadata.displayName).toBe('Renamed VM')
    expect(encodeSessionId({ nodeId: a, nativeId: native as NativeSessionId })).toBe(before)
    expect(encodeSessionId({ nodeId: b, nativeId: native as NativeSessionId })).not.toBe(before)
  })
})
