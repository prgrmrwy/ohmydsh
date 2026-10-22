import type { CollabEvent, Member } from '../../src/index.js'
import { defaultMembers, world } from './world.js'

export const dispatchMembers = (): Member[] => defaultMembers()

export async function dispatchWorld(extra: CollabEvent[] = [], members = dispatchMembers()) {
  return world(extra, members)
}
