// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { installRoutingNavIcon } from '../src/client/nav-icon.js'
it('spec Scenario "导航图标只作用于本区块"', async () => {
  document.body.innerHTML = '<div role="dialog"><nav><button><svg></svg>自动模型路由</button><button><svg></svg>其它</button></nav></div><nav><button>自动模型路由</button></nav>'
  const dispose = installRoutingNavIcon(document)
  expect(document.querySelectorAll('[data-amr-nav]')).toHaveLength(1)
  const own = document.querySelector('[data-amr-nav]')!
  own.textContent = '其它'
  await new Promise(resolve => queueMicrotask(resolve as () => void))
  expect(document.querySelectorAll('[data-amr-nav]')).toHaveLength(0)
  own.textContent = '自动模型路由'
  await new Promise(resolve => queueMicrotask(resolve as () => void))
  expect(document.querySelectorAll('[data-amr-nav]')).toHaveLength(1)
  dispose()
  expect(document.querySelector('[data-amr-nav]')).toBeNull()
  expect(document.querySelector('style[data-amr-nav-style]')).toBeNull()
  document.body.innerHTML = ''
  expect(() => installRoutingNavIcon(document)()).not.toThrow()
})
