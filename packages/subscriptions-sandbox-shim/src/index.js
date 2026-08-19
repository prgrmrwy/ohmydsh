/**
 * dsh-subscriptions-sandbox-shim 插件入口。
 *
 * 在 llm/adapters-updated 事件(首次注册与 HMR replace 都会触发)驱动下,
 * 对配置内 provider 路由的适配器实例包装其 stream 方法;同一实例只包装
 * 一次(见 src/strip.js 的 WRAPPED 标记)。无加载顺序依赖:apply 时先扫
 * 一遍已注册适配器,之后的事件覆盖晚注册的情况。
 */
import z from '@deepseek-ai/schemastery';
import { wrapAdapterStream } from './strip.js';

export const name = 'dsh-subscriptions-sandbox-shim';

export const inject = ['llm'];

export const Config = z.object({
  /** 生效的 provider 路由(与 dsh-plugin-subscriptions 注册的路由名一致)。 */
  providers: z.array(z.string()).default(['codex', 'grok']),
  /** 出站:从发送给模型的工具 schema 剥离升级字段。 */
  stripSchema: z.boolean().default(true),
  /** 入站:从模型返回的工具调用 arguments 剥离升级字段。 */
  stripOutput: z.boolean().default(true),
  /** 出站:清理 Responses 历史中角色非法或无配对的工具块。 */
  stripHistory: z.boolean().default(true),
});

export function apply(ctx, config) {
  const ensureWrapped = () => {
    let wrappedAny = false;
    for (const provider of config.providers) {
      let registration;
      try {
        registration = ctx.llm.registration(provider);
      } catch {
        // 尚未注册(NO_ADAPTER),等下一次 adapters-updated。
        continue;
      }
      if (wrapAdapterStream(registration.adapter, config)) wrappedAny = true;
    }
    if (wrappedAny && ctx.logger !== undefined) {
      ctx.logger.info(`[${name}] wrapped adapter(s) for: ${config.providers.join(', ')}`);
    }
  };
  // apply 时已注册的适配器(订阅插件先加载的情况)。
  ensureWrapped();
  // 之后的注册/替换(订阅插件后加载、HMR)。
  ctx.on('llm/adapters-updated', ensureWrapped);
}
