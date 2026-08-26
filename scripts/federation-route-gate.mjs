const FEDERATED_PREFIX = 'fed1:'

function containsFederatedIdentity(value, seen = new Set()) {
  if (typeof value === 'string') return value.startsWith(FEDERATED_PREFIX)
  if (typeof value !== 'object' || value === null || seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.some(item => containsFederatedIdentity(item, seen))
  return Object.values(value).some(item => containsFederatedIdentity(item, seen))
}

function pathOf(request) {
  return new URL(request.url).pathname
}

async function jsonBodyContainsFederatedIdentity(request) {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') return false
  try {
    return containsFederatedIdentity(await request.clone().json())
  } catch {
    return false
  }
}

export function createFederationRequestClassifier(inventory) {
  const exactPaths = new Set(inventory.exactRoutes.map(route => route.path))
  return async request => {
    const pathname = pathOf(request)
    if (exactPaths.has(pathname)) return { kind: 'exact', pathname }
    if (pathname === '/api/session.export') {
      return [...new URL(request.url).searchParams.values()].some(value => value.startsWith(FEDERATED_PREFIX))
        ? { kind: 'reject-unclassified-federated', pathname }
        : { kind: 'fallback', pathname }
    }
    if (pathname.startsWith('/api/') && await jsonBodyContainsFederatedIdentity(request)) {
      return { kind: 'reject-unclassified-federated', pathname }
    }
    return { kind: 'fallback', pathname }
  }
}

export function createFederationPreFallbackHandler({ inventory, exactHandlers, fallback }) {
  const classify = createFederationRequestClassifier(inventory)
  return {
    async fetch(request) {
      const result = await classify(request)
      if (result.kind === 'reject-unclassified-federated') {
        return Response.json({ error: { code: 'federation-route-unclassified' } }, { status: 400 })
      }
      if (result.kind === 'exact') {
        const handler = exactHandlers.get(result.pathname)
        if (handler === undefined) return new Response('federation route unavailable', { status: 503 })
        return handler(request)
      }
      return fallback.fetch(request)
    },
  }
}

export async function registerRouteTransaction(register, routes) {
  const disposers = []
  try {
    for (const route of routes) disposers.push(await register(route))
  } catch (error) {
    for (const dispose of disposers.reverse()) await dispose()
    throw error
  }
  let disposed = false
  return async () => {
    if (disposed) return
    disposed = true
    for (const dispose of disposers.reverse()) await dispose()
  }
}

export function exactRoutesFromProtocol(protocol, typert) {
  const routes = []
  for (const route of protocol.unaryRoutes) routes.push({ path: route.path, source: 'api-proxy' })
  for (const route of protocol.nonUnaryRoutes) {
    if (route.path.startsWith('/api/session.export')) routes.push({ path: '/api/session.export', source: 'download' })
  }
  for (const route of typert.endpoints) {
    if (route.identityFields.length > 0) routes.push({ path: `/api/${route.endpoint}`, source: 'typert' })
  }
  return routes
}

export function assertRouteInventory(routes) {
  const seen = new Set()
  for (const route of routes) {
    if (!route.path.startsWith('/api/') || route.path.includes('?')) throw new Error(`invalid exact route ${route.path}`)
    if (seen.has(route.path)) throw new Error(`duplicate exact route ${route.path}`)
    seen.add(route.path)
  }
}
