// Browser-safe: imported by the client bundle, so no Node built-ins here or in what it imports.
export type JevCategory =
  | 'missing-credential' | 'insufficient-credits' | 'unauthorized' | 'rate-limited'
  | 'region-blocked' | 'rejected' | 'unavailable' | 'timeout' | 'invalid-response'

/** Human-readable hint per category, shown on the chip, panel and tool errors. */
export const CATEGORY_HINTS: Readonly<Record<JevCategory, string>> = {
  'missing-credential': '未配置所选决策服务的 API key',
  'insufficient-credits': '余额不足，请充值',
  unauthorized: 'key 无效或无权限',
  'rate-limited': '请求被限流',
  'region-blocked': '地区受限',
  rejected: '请求被拒绝',
  unavailable: 'Jev 服务不可用',
  timeout: 'Jev 响应超时',
  'invalid-response': 'Jev 响应无效',
}
