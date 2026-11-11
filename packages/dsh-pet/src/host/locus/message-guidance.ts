/**
 * Model-facing guidance about reading a message the child cannot see directly.
 *
 * One source for the tool description AND the delivery prompt, so the two can
 * never disagree about what the Host can and cannot resolve.
 */

import { isDocEndpoint } from './doc-endpoint.js'

/** Tool name, duplicated here only so the prompt layer does not import the tool module. */
export const LOCUS_MESSAGE_TOOL_NAME = 'pet_locus_message'

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
  '飞书消息链接（形如 `…/client/message/link/open?token=…`）无法由 Host 解析为消息，不要尝试打开它，也不要声称已看过链接内容。'
  + '可以在本入口历史（`pet_locus_chat_history`，含媒体的行行尾带消息 id）或被回复的消息里寻找候选消息，并用 `'
  + LOCUS_MESSAGE_TOOL_NAME
  + '` 读取；确认不了是哪一条时，在答复中如实说明无法打开该链接，请发送者直接回复那条消息或转发过来，'
  + '不要把猜测的候选当作已确认的那条。'

/**
 * The same limitation for a Host that did not publish the message tool
 * (media port unavailable): it must not name a tool the child does not have.
 */
export const MESSAGE_LINK_GUIDANCE_WITHOUT_TOOL =
  '飞书消息链接（形如 `…/client/message/link/open?token=…`）无法由 Host 解析为消息，当前也无法读取其它消息的图片或视频；'
  + '不要尝试打开它，也不要声称已看过链接内容。在答复中如实说明无法打开该链接，请发送者直接回复那条消息或转发过来。'
