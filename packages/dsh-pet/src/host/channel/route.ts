/**
 * Chat-to-workspace routing.
 *
 * A chat reaches a workspace either through its own binding row or through the
 * configured default, and the default result is written back so the user can
 * see and change it afterwards. Routing fails CLOSED: an unresolvable target
 * raises no work at all rather than falling back to some other workspace,
 * because "somewhere else" is the one outcome nobody asked for.
 */

import type { PetRepository } from '../repository.js'
import type { PetChatBinding } from '../spec.js'

/** Outcome of routing one chat. */
export type RouteDecision =
  | {
      readonly routed: true
      readonly workspaceId: string
      readonly workspacePath: string
      readonly binding: PetChatBinding
    }
  | { readonly routed: false; readonly reason: string }

/** Reads a chat's display name, for the route row and prompts. */
export interface ChatNamer {
  /**
   * @param chatId - Target chat.
   * @returns the name, or `undefined` when it cannot be read.
   */
  chatName(chatId: string): Promise<string | undefined>
}

/** Resolves a workspace id to its filesystem path, when it still exists. */
export interface WorkspaceLocator {
  /**
   * @param workspaceId - Registered DSH workspace id.
   * @returns the workspace path, or `undefined` when it is unknown.
   */
  locate(workspaceId: string): string | undefined
}

/**
 * Route one chat to a workspace, writing back a default-derived binding.
 *
 * @param repository - Pet repository.
 * @param locator - Proves a workspace id still resolves to a path.
 * @param chat - The chat to route.
 * @returns the routing decision.
 */
export async function routeChat(
  repository: PetRepository,
  locator: WorkspaceLocator,
  chat: { readonly chatId: string; readonly chatType: 'p2p' | 'group'; readonly chatName?: string },
  namer?: ChatNamer,
): Promise<RouteDecision> {
  const existing = repository.getChatBinding(chat.chatId)
  if (existing !== undefined) {
    // Backfill a row created before the name could be read, so an older
    // binding stops showing as a bare `oc_…` forever.
    if (existing.chatName === undefined && namer !== undefined) {
      const resolved = await namer.chatName(chat.chatId)
      if (resolved !== undefined) {
        await repository.putChatBinding({ ...existing, chatName: resolved })
        const path = locator.locate(existing.workspaceId)
        if (path !== undefined) {
          return {
            routed: true,
            workspaceId: existing.workspaceId,
            workspacePath: path,
            binding: { ...existing, chatName: resolved },
          }
        }
      }
    }
    const path = locator.locate(existing.workspaceId)
    if (path === undefined) {
      // The binding still names a workspace, but that workspace is gone.
      // Silently re-routing to the default would run the user's request in a
      // repository they did not choose.
      return {
        routed: false,
        reason:
          `Chat ${chat.chatId} is bound to workspace '${existing.workspaceId}', ` +
          'which is no longer registered in this Host.',
      }
    }
    return { routed: true, workspaceId: existing.workspaceId, workspacePath: path, binding: existing }
  }

  const config = repository.getChannelConfig()
  const fallback = config.defaultWorkspaceId
  if (fallback === undefined || fallback === '') {
    return {
      routed: false,
      reason:
        `Chat ${chat.chatId} has no binding and no default workspace is configured. ` +
        'Set one in Pet Settings → Channel.',
    }
  }
  const path = locator.locate(fallback)
  if (path === undefined) {
    return {
      routed: false,
      reason:
        `The default workspace '${fallback}' is no longer registered in this Host. ` +
        'Choose another in Pet Settings → Channel.',
    }
  }

  // Write the result back so the chat becomes visible and re-bindable in
  // Settings without the user having to know its id in advance — which for a
  // p2p chat they cannot: bot identity may not list private conversations, so
  // an inbound message is the only way its id is ever learned.
  // Read the name now rather than leaving the row anonymous: the settings
  // list and every prompt identify the conversation by it.
  const resolvedName = chat.chatName ?? (await namer?.chatName(chat.chatId))
  const binding = await repository.putChatBinding({
    chatId: chat.chatId,
    chatType: chat.chatType,
    workspaceId: fallback,
    ...(resolvedName !== undefined ? { chatName: resolvedName } : {}),
    boundBy: 'auto',
    boundAt: Date.now(),
  })
  return { routed: true, workspaceId: fallback, workspacePath: path, binding }
}
