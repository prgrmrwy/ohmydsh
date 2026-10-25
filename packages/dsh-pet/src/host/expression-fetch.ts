/** Owner-triggered download: use the Host's fetch/network policy, not a Pet firewall. */
import { PetError } from './errors.js'
import { MAX_EXPRESSION_SOURCE_BYTES } from '../wire.js'

export const MAX_EXPRESSION_URL_REDIRECTS = 3
export const EXPRESSION_URL_TIMEOUT_MS = 10_000

/** HTTPS and URL credentials are checked without inspecting DNS or IP addresses. */
export function parseExpressionUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new PetError('INVALID_REQUEST', '不是合法的下载 URL')
  }
  if (url.protocol !== 'https:') {
    throw new PetError('INVALID_REQUEST', '只支持 https:// 下载链接')
  }
  if (url.username !== '' || url.password !== '') {
    throw new PetError('INVALID_REQUEST', '下载链接不允许携带用户名或密码')
  }
  return url
}

function fetchFailed(message: string): never {
  throw new PetError('EXPRESSION_FETCH_FAILED', `下载动画失败：${message}`)
}

/** Read decoded fetch bytes; MIME labels do not replace the shared Lottie validator. */
async function readBounded(response: Response, controller: AbortController): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase()
  if (
    (!encoding || encoding === 'identity') &&
    Number.isFinite(declared) &&
    declared > MAX_EXPRESSION_SOURCE_BYTES
  ) {
    fetchFailed(`内容超过 ${MAX_EXPRESSION_SOURCE_BYTES} 字节上限`)
  }
  if (response.body === null) fetchFailed('响应没有可读取的内容')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_EXPRESSION_SOURCE_BYTES) {
        fetchFailed(`内容超过 ${MAX_EXPRESSION_SOURCE_BYTES} 字节上限`)
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof PetError) throw error
    fetchFailed(controller.signal.aborted ? '请求超时' : '读取响应内容失败')
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** The caller validates the downloaded text before atomically replacing the asset. */
export async function fetchExpressionSource(rawUrl: string): Promise<string> {
  let url = parseExpressionUrl(rawUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), EXPRESSION_URL_TIMEOUT_MS)
  let response: Response | undefined
  try {
    for (let hop = 0; hop <= MAX_EXPRESSION_URL_REDIRECTS; hop += 1) {
      try {
        // Plain fetch inherits the dispatcher installed by the DSH Host.
        response = await globalThis.fetch(url, {
          method: 'GET',
          redirect: 'manual',
          credentials: 'omit',
          signal: controller.signal,
        })
      } catch {
        fetchFailed(controller.signal.aborted ? '请求超时' : '请求失败')
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined)
        if (hop === MAX_EXPRESSION_URL_REDIRECTS) fetchFailed('重定向次数过多')
        const location = response.headers.get('location')
        if (location === null || location.trim() === '') fetchFailed('重定向缺少 Location')
        let next: URL
        try {
          next = new URL(location, url)
        } catch {
          throw new PetError('INVALID_REQUEST', '重定向目标不是合法 URL')
        }
        url = parseExpressionUrl(next.href)
        continue
      }
      if (!response.ok) fetchFailed(`下载失败（HTTP ${response.status}）`)
      return await readBounded(response, controller)
    }
    return fetchFailed('重定向次数过多')
  } finally {
    clearTimeout(timer)
    controller.abort()
    if (response?.body !== null && response?.body !== undefined && !response.body.locked) {
      await response.body.cancel().catch(() => undefined)
    }
  }
}
