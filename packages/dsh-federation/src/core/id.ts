import type {
  FederatedSessionId,
  FederatedWorkspaceId,
  NativeSessionId,
  NativeWorkspaceId,
  NodeId,
  SessionRef,
  WorkspaceRef,
} from './types.js'

export const FEDERATION_ID_VERSION = 'fed1' as const
const NODE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const ENCODED_NATIVE_ID = /^[A-Za-z0-9_-]+$/
const MAX_NATIVE_ID_UTF8_BYTES = 4096
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export class FederatedIdError extends Error {
  constructor(readonly code: 'MALFORMED' | 'UNKNOWN_VERSION' | 'WRONG_KIND' | 'UNKNOWN_NODE' | 'TOO_LONG', message: string) {
    super(message)
    this.name = 'FederatedIdError'
  }
}

export function parseNodeId(value: string): NodeId {
  if (!NODE_ID.test(value)) throw new FederatedIdError('MALFORMED', 'node id must be a CSS/route-safe opaque token')
  return value as NodeId
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64urlToBytes(value: string): Uint8Array {
  if (!ENCODED_NATIVE_ID.test(value)) throw new FederatedIdError('MALFORMED', 'native id encoding is malformed')
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    throw new FederatedIdError('MALFORMED', 'native id encoding is invalid base64url')
  }
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function encodeNativeId(value: string): string {
  const bytes = encoder.encode(value)
  if (bytes.length === 0) throw new FederatedIdError('MALFORMED', 'native id must not be empty')
  if (bytes.length > MAX_NATIVE_ID_UTF8_BYTES) throw new FederatedIdError('TOO_LONG', 'native id exceeds 4096 UTF-8 bytes')
  return bytesToBase64url(bytes)
}

function decodeNativeId(value: string): string {
  const bytes = base64urlToBytes(value)
  if (bytes.length === 0) throw new FederatedIdError('MALFORMED', 'native id must not be empty')
  if (bytes.length > MAX_NATIVE_ID_UTF8_BYTES) throw new FederatedIdError('TOO_LONG', 'native id exceeds 4096 UTF-8 bytes')
  let decoded: string
  try {
    decoded = decoder.decode(bytes)
  } catch {
    throw new FederatedIdError('MALFORMED', 'native id is not valid UTF-8')
  }
  if (encodeNativeId(decoded) !== value) throw new FederatedIdError('MALFORMED', 'native id encoding is not canonical')
  return decoded
}

export function encodeWorkspaceId(ref: WorkspaceRef): FederatedWorkspaceId {
  return `${FEDERATION_ID_VERSION}:${parseNodeId(ref.nodeId)}:w:${encodeNativeId(ref.nativeId)}` as FederatedWorkspaceId
}

export function encodeSessionId(ref: SessionRef): FederatedSessionId {
  return `${FEDERATION_ID_VERSION}:${parseNodeId(ref.nodeId)}:s:${encodeNativeId(ref.nativeId)}` as FederatedSessionId
}

function decode(value: string, expectedKind: 'w' | 's', knownNodes: ReadonlySet<NodeId>): { nodeId: NodeId; nativeId: string } {
  const parts = value.split(':')
  if (parts.length !== 4) throw new FederatedIdError('MALFORMED', 'federated id must have four fields')
  const [version, rawNodeId, kind, encoded] = parts
  if (version !== FEDERATION_ID_VERSION) {
    if (/^fed\d+$/.test(version ?? '')) throw new FederatedIdError('UNKNOWN_VERSION', `unsupported federation id version ${version}`)
    throw new FederatedIdError('MALFORMED', 'federated id prefix is malformed')
  }
  const nodeId = parseNodeId(rawNodeId ?? '')
  if (kind !== expectedKind) throw new FederatedIdError('WRONG_KIND', `expected ${expectedKind} federated id`)
  if (!knownNodes.has(nodeId)) throw new FederatedIdError('UNKNOWN_NODE', `unknown federation node ${nodeId}`)
  return { nodeId, nativeId: decodeNativeId(encoded ?? '') }
}

export function decodeWorkspaceId(value: string, knownNodes: ReadonlySet<NodeId>): WorkspaceRef {
  const decoded = decode(value, 'w', knownNodes)
  return { nodeId: decoded.nodeId, nativeId: decoded.nativeId as NativeWorkspaceId }
}

export function decodeSessionId(value: string, knownNodes: ReadonlySet<NodeId>): SessionRef {
  const decoded = decode(value, 's', knownNodes)
  return { nodeId: decoded.nodeId, nativeId: decoded.nativeId as NativeSessionId }
}

export function isFederatedId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('fed')
}
