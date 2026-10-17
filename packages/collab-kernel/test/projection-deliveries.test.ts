import { expect, it } from 'vitest'
import { project, type Overview } from '../src/index.js'
import { projectionState } from './fixtures/projection-state.js'

it('overview projection distinguishes live calls from recovered unknown deliveries', () => {
  const state = projectionState()
  const pending = { ...state.deliveries['dv-pending']!, deliveryId: 'recovered-unknown' }
  const live = { ...pending, deliveryId: 'live-call' }
  const overview: Overview = { ...state, deliveries: { [pending.deliveryId]: pending, [live.deliveryId]: live }, presence: {}, pendingDeliveries: [pending], inFlightDeliveries: [live] }
  const output = project(overview, {})
  expect(output).toContain('recovered\\-unknown')
  expect(output).toContain('live\\-call')
  expect(output).toMatch(/live\\-call[^\n]*inFlight/)
  expect(output).toMatch(/recovered\\-unknown[^\n]*unknown/)
})
