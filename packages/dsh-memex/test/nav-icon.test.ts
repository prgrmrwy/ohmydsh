import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemexSettingsNavIcon } from '../src/client/nav-icon.js'

it('renders the original book with the shell size and theme color', () => {
  const markup = renderToStaticMarkup(createElement(MemexSettingsNavIcon, { size: 24 }))
  expect(markup).toContain('width="24" height="24"')
  expect(markup).toContain('stroke="currentColor"')
  expect(markup).toContain('stroke-width="1.3"')
  expect(markup).toContain('M2.4 2.6h4.1')
  expect(markup).toContain('aria-hidden="true"')
})
