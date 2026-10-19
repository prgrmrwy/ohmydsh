import { it, expect } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Agents from '@deepseek-ai/dsh-agent';
import Sessions from '@deepseek-ai/dsh-session';
import Llm, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import Tools, { defineTool } from '@deepseek-ai/dsh-tools';
import Prompt from '@deepseek-ai/dsh-system-prompt';
import Projections from '@deepseek-ai/dsh-session-projection';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';

it('exposes the live isolated queued-turn claim probe', async () => {
  const ctx = new Context();
  try {
    for (const p of [Sessions, Agents, Llm, Prompt, Tools, Projections]) await ctx.plugin(p);
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 });
    expect(ctx.agentLoop.supportsIsolatedQueuedTurnClaim).toBe(true);
    expect(ctx.agentLoop.probeIsolatedQueuedTurnClaim({
      nextStepId: 'probe-gui-step',
      nextTurnId: 'probe-inquiry-turn',
    })).toEqual({
      claimedMessageIds: ['probe-inquiry-turn'],
      pendingNextStepIds: ['probe-gui-step'],
    });
  } finally {
    await ctx.fiber.dispose();
  }
});

it.each(['user', 'pet-inquiry', 'pet-inquiry-result'])('queued %s preserves specified turn claim', async (kind) => {
  const ctx = new Context();
  try {
    for (const p of [Sessions, Agents, Llm, Prompt, Tools, Projections]) await ctx.plugin(p);
    let calls = 0;
    class Fake extends LlmAdapter {
      async *stream() {
        calls++;
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: 'done' };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    }
    ctx.llm.registerAdapter(['fake'], new Fake());
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 });
    const a = await ctx.agentLoop.create('probe', { provider: 'fake', model: 'm' });
    const claimed: Array<{ turn: number; id: string }> = [];
    ctx.on('agent/inbox/claimed', (p) => claimed.push({ turn: p.turn, id: p.message.id }));
    const gui = createUserMessage({ content: [{ type: 'text', text: 'GUI' }], source: { kind: 'user' } });
    const q = createUserMessage({ content: [{ type: 'text', text: 'Q' }], source: { kind } as never });
    a.send(gui, 'next-step', false);
    a.followup(q);
    await a.whenIdle();
    expect(claimed).toHaveLength(2);
    const qt = claimed.find((x) => x.id === q.id)!.turn;
    const gt = claimed.find((x) => x.id === gui.id)!.turn;
    if (kind === 'user') {
      expect(qt).toBe(gt);
      expect(calls).toBe(1);
    } else {
      expect(qt).not.toBe(gt);
      expect(qt).toBe(1);
      expect(gt).toBe(2);
      expect(calls).toBe(2);
    }
    expect(a.inbox.nextStep).toHaveLength(0);
  } finally {
    await ctx.fiber.dispose();
  }
});

it.each(['pet-inquiry', 'pet-inquiry-result'])('%s owns a held tool turn while GUI is steered mid-run', async (kind) => {
  const ctx = new Context();
  let release!: () => void;
  let enter!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  try {
    for (const p of [Sessions, Agents, Llm, Prompt, Tools, Projections]) await ctx.plugin(p);
    let calls = 0;
    const requests: any[] = [];
    class Fake extends LlmAdapter {
      async *stream(options: any) {
        calls++;
        requests.push(options);
        if (calls === 1) {
          const block = { type: 'tool-call', id: 'call', name: 'hold', arguments: '{}' };
          yield { type: 'block-start', index: 0, blockType: 'tool-call' };
          yield { type: 'tool-call-delta', index: 0, id: 'call', name: 'hold', argumentsDelta: '{}' };
          yield { type: 'block-end', index: 0, block };
          yield { type: 'finish', reason: { kind: 'tool-calls' } };
        } else {
          yield { type: 'block-start', index: 0, blockType: 'text' };
          yield { type: 'text-delta', index: 0, text: 'done' };
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        }
      }
    }
    ctx.llm.registerAdapter(['fake'], new Fake());
    ctx.tools.register(defineTool({
      name: 'hold', description: 'Wait on a test latch', parameters: {},
      output: { schema: { type: 'boolean' }, render: () => [] },
      async execute(_args, exec) {
        enter();
        await held;
        exec.deferContext(createUserMessage({
          content: [{ type: 'text', text: 'owned-host-context' }],
          source: { kind: 'user' },
        }));
        return true;
      },
    }));
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 });
    const a = await ctx.agentLoop.create('probe', { provider: 'fake', model: 'm' });
    const claimed: Array<{ turn: number; id: string }> = [];
    const cancelled: unknown[] = [];
    ctx.on('agent/inbox/claimed', (p) => claimed.push({ turn: p.turn, id: p.message.id }));
    ctx.on('agent/inbox/cancelled', (p) => cancelled.push(p));
    const gui1 = createUserMessage({ content: [{ type: 'text', text: 'GUI before' }], source: { kind: 'user' } });
    const q = createUserMessage({ content: [{ type: 'text', text: 'Q' }], source: { kind } as never });
    a.send(gui1, 'next-step', false);
    a.followup(q);
    const stage = await Promise.race([entered.then(() => 'entered'), a.whenIdle().then(() => 'idle')]);
    expect(stage).toBe('entered');
    const gui2 = createUserMessage({ content: [{ type: 'text', text: 'GUI during' }], source: { kind: 'user' } });
    a.steer(gui2);
    release();
    await Promise.race([a.whenIdle(), new Promise((_, reject) => setTimeout(() => reject(new Error('agent idle timeout')), 5000))]);
    expect(claimed.find((x) => x.id === q.id)?.turn).toBe(1);
    expect(claimed.filter((x) => x.id === gui1.id || x.id === gui2.id).map((x) => x.turn)).toEqual([2, 2]);
    expect(claimed).toHaveLength(4);
    expect(calls).toBe(3);
    expect(cancelled).toHaveLength(0);
    expect(a.inbox.nextStep).toHaveLength(0);
    expect(requests[1].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', toolCallId: 'call', source: { kind: 'tool', callId: 'call' } }),
      expect.objectContaining({ role: 'user', content: [{ type: 'text', text: 'owned-host-context' }] }),
    ]));
  } finally {
    release();
    await ctx.fiber.dispose();
  }
});
