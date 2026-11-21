/**
 * Model-facing guidance about reading a message the child cannot see directly.
 *
 * One source for the tool description AND the delivery prompt, so the two can
 * never disagree about what the Host can and cannot resolve.
 */

import { isDocEndpoint } from './doc-endpoint.js'

/** Tool name, duplicated here only so the prompt layer does not import the tool module. */
export const LOCUS_MESSAGE_TOOL_NAME = 'pet_locus_message'

/** Linked-message tool name, for the same reason. */
export const LOCUS_LINKED_MESSAGE_TOOL_NAME = 'pet_locus_linked_message'

/**
 * The ONE decision whether a child gets `pet_locus_message`: an IM entry on a
 * Host whose media port is available. Tool assembly and prompt rendering both
 * call this, so a prompt can never name a tool the child was not given.
 */
export function publishesLocusMessageTool(endpoint: { readonly chatId: string }, mediaAvailable: boolean): boolean {
  return mediaAvailable && !isDocEndpoint(endpoint)
}

/** What to do when a request points at a message by link. */
export const MESSAGE_LINK_GUIDANCE =
  '本群消息里的飞书消息链接（形如 `…/client/message/link/open?token=…`）用 `'
  + LOCUS_LINKED_MESSAGE_TOOL_NAME
  + '` 读取：传入**含该链接的本群消息 id**（触发消息、被回复消息，或 `pet_locus_chat_history` 中行尾带 id 的行），不要自行打开链接，也不要传 URL。'
  + '读取失败（平台判定无权、链接失效、来源消息已删除等）时，在答复中如实说明无法读取该链接，请发送者直接转发那条消息；'
  + '不要声称已看过链接内容，也不要把猜测的候选当作链接指向的消息。'

/**
 * The same limitation for a Host that did not publish the message tool
 * (media port unavailable): it must not name a tool the child does not have.
 */
export const MESSAGE_LINK_GUIDANCE_WITHOUT_TOOL =
  '飞书消息链接（形如 `…/client/message/link/open?token=…`）指向的内容当前无法读取，被回复消息的图片或视频也无法读取；'
  + '不要尝试打开它，也不要声称已看过链接内容。在答复中如实说明，请发送者直接回复那条消息或转发过来。'
