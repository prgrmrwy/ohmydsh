import { expectTypeOf, it } from 'vitest'
import type { CollabEvent } from '../src/index.js'
import { CollabService } from '../src/index.js'

it('surface-02：公开类型不含事件写入', () => {
  type AcceptsEvents<T> = T extends (...args: infer A) => unknown
    ? A extends [infer First, ...unknown[]]
      ? First extends CollabEvent | CollabEvent[]
        ? true
        : false
      : false
    : false
  type MethodParams<T> = { [K in keyof T]: AcceptsEvents<T[K]> }[keyof T]
  expectTypeOf<Extract<MethodParams<CollabService>, true>>().toBeNever()
})
