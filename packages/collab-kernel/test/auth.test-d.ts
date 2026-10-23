import { expectTypeOf, it } from 'vitest'
import type { CollabService } from '../src/index.js'
it('auth-07：类型没有字符串分发', () => { expectTypeOf<'execute' extends keyof CollabService ? true : false>().toEqualTypeOf<false>(); expectTypeOf<'recordDispatch' extends keyof CollabService ? true : false>().toEqualTypeOf<false>(); expectTypeOf<'setDeciders' extends keyof CollabService ? true : false>().toEqualTypeOf<false>(); expectTypeOf<Extract<keyof CollabService, 'requestDecision' | 'confirmDecision' | 'resetBreaker'>>().toBeNever() })
