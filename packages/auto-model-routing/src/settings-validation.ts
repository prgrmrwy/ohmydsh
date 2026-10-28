import type { SettingsIssue } from './settings-contract.js'

export const MODEL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}(?![\s\S])/
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function issue(path: string, code: string, message: string): SettingsIssue { return { path, code, message } }
