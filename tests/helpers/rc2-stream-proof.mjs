import WebSocket from 'ws'

/**
 * Opens both real rc.2 event streams and returns the carrier-owned readiness
 * proof. Tests must dispose the carrier; callers cannot replace this with
 * booleans because capability publication depends on physical WebSocket opens.
 */
export async function openRealRc2Streams(federation, endpoint, generation = 1) {
  const carrier = new federation.DualEventCarrier({
    endpoint,
    generation,
    currentGeneration: () => generation,
    createSocket: url => new WebSocket(url),
    validate: federation.validateRc2EventEnvelope,
    onFrame() {},
    onDisconnect() {},
  })
  try {
    const proof = await carrier.open()
    return { proof, dispose: () => carrier.dispose() }
  } catch (cause) {
    carrier.dispose()
    throw cause
  }
}
