#!/usr/bin/env node
import { createInterface } from 'node:readline'

const reader = createInterface({ input: process.stdin, crlfDelay: Infinity })

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

for await (const line of reader) {
  let request
  try { request = JSON.parse(line) } catch { continue }
  if (request.method === 'initialize') {
    respond(request.id, {
      protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'mock-typed', version: '1.0.0' },
    })
    continue
  }
  if (request.method === 'tools/list') {
    respond(request.id, {
      tools: [{
        name: 'typed_decide',
        description: 'Return a fixed typed routing decision.',
        inputSchema: {
          type: 'object',
          properties: { candidate: { type: 'string' } },
          required: ['candidate'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: {
            selected: { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['selected', 'confidence'],
          additionalProperties: false,
        },
      }],
    })
    continue
  }
  if (request.method === 'tools/call') {
    const value = { selected: request.params?.arguments?.candidate ?? 'unknown', confidence: 0.99 }
    respond(request.id, {
      content: [{ type: 'text', text: JSON.stringify(value) }],
      structuredContent: value,
      isError: false,
    })
    continue
  }
  if (request.id !== undefined) respond(request.id, {})
}
