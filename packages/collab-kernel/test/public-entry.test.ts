import { expect, it } from 'vitest'
import * as api from '../src/index.js'

it('public package entry offers the library without exposing unauthorised convention or dispatch writers', () => {
  expect(api.CollabService).toBeTypeOf('function')
  expect(api.FileStore).toBeTypeOf('function')
  expect(api.project).toBeTypeOf('function')
  expect(api.principals.agent).toBeTypeOf('function')
  for (const name of ['readConvention', 'canonical', 'canonicalJson', 'recordDispatch', 'appendEvent', 'COMMANDS']) expect(api).not.toHaveProperty(name)
})
