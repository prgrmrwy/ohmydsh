import { expectTypeOf, it } from 'vitest'
import type { DispatchCompletedEvent } from '../src/index.js'
import { CollabService } from '../src/index.js'

it('dispatch-06：宿主不能写入投递结果', () => {
  type PublicMethods = keyof CollabService
  expectTypeOf<Extract<PublicMethods, 'recordDispatch' | 'completeDispatch' | 'dispatchCompleted'>>().toBeNever()
  type EventWriters = { [K in keyof CollabService]: CollabService[K] extends (...args: infer A) => unknown ? Extract<A[number], DispatchCompletedEvent> extends never ? never : K : never }[keyof CollabService]
  expectTypeOf<EventWriters>().toBeNever()
})
