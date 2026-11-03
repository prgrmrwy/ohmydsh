import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
/**
 * Append-only `judgements.jsonl` plus the in-memory `messageId → turn` map (design D13).
 * Appends throw; callers decide whether a failure matters (judgement lines: log only; labels: 5xx).
 */
export class JudgementBook {
    file;
    turns = new Map();
    messages = new Map();
    latestUserTurn = new Map();
    constructor(file) {
        this.file = file;
    }
    append(line) {
        mkdirSync(dirname(this.file), { recursive: true });
        appendFileSync(this.file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
    }
    judged(line) {
        this.turnsOf(line.sessionId).set(line.turn, { turn: line.turn, tier: line.tier, ...(line.effort ? { effort: line.effort } : {}) });
    }
    /** A user turn began (judged or not): later continued turns attach to it. */
    userTurn(sessionId, turn) { this.latestUserTurn.set(sessionId, turn); }
    /** An assistant message: a continued turn's reply belongs to the latest user turn; mapped only when that turn was judged. */
    assistant(sessionId, messageId, turn) {
        const latest = this.latestUserTurn.get(sessionId);
        if (latest === undefined || turn < latest || !this.turns.get(sessionId)?.has(latest))
            return;
        let map = this.messages.get(sessionId);
        if (!map) {
            map = new Map();
            this.messages.set(sessionId, map);
        }
        map.set(messageId, latest);
    }
    lookup(sessionId, messageId) {
        const turn = this.messages.get(sessionId)?.get(messageId);
        const record = turn === undefined ? undefined : this.turns.get(sessionId)?.get(turn);
        return record && { ...record };
    }
    label(sessionId, turn, label) {
        this.append({ sessionId, turn, label });
        const record = this.turns.get(sessionId)?.get(turn);
        if (record)
            record.label = label;
    }
    turnsOf(sessionId) {
        let map = this.turns.get(sessionId);
        if (!map) {
            map = new Map();
            this.turns.set(sessionId, map);
        }
        return map;
    }
}
