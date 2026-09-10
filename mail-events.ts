/**
 * WS event bus + 1s agent-state poll.
 *
 * Wiring points (the "four insertions"), all in mail-server.ts:
 *   1. const bus = createEventBus()                  — before routes
 *   2. bus.attach(httpServer, '/events')             — after listen()
 *   3. startAgentPoll(bus, ms, mergedAgents)         — after listen()
 *   4. bus.emit({type:'mail'|'delivery'|'reply', …}) — inside mail_send / mail_reply
 *
 * Contract: every client gets a `snapshot` frame on connect, then deltas. The
 * TUI and the browser views (MailConversation/MailDebugger) share this contract.
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { listAgents, type HerdrAgent } from './herdr.ts';

export type MailEvent =
  | { type: 'snapshot'; ts: number; agents: HerdrAgent[]; mail: unknown[] }
  | { type: 'agent_state'; ts: number; paneId: string; repo: string | null; from: string; to: string }
  | { type: 'agents'; ts: number; agents: HerdrAgent[] }
  | { type: 'mail'; ts: number; mail: unknown }
  | { type: 'delivery'; ts: number; id: string; to: string; delivery: string; detail?: string }
  | { type: 'reply'; ts: number; mail: unknown }
  | { type: 'deleted'; ts: number; ids: string[] }
  | { type: 'error'; ts: number; message: string };

export type EventBus = {
  emit(event: Omit<MailEvent, 'ts'> & { ts?: number }): void;
  /** In-process listeners. The server uses this to flush deferred mail on an idle transition. */
  subscribe(handler: (event: MailEvent) => void): () => void;
  attach(server: Server, path: string, snapshot: () => Promise<MailEvent>): void;
  clientCount(): number;
};

export function createEventBus(): EventBus {
  const clients = new Set<WebSocket>();
  const handlers = new Set<(event: MailEvent) => void>();

  return {
    emit(event) {
      const full = { ts: Date.now(), ...event } as MailEvent;
      const frame = JSON.stringify(full);
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      }
      for (const h of handlers) {
        try {
          h(full);
        } catch {
          /* a listener must never break delivery */
        }
      }
    },

    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },

    attach(server, path, snapshot) {
      const wss = new WebSocketServer({ server, path });
      wss.on('connection', async (ws) => {
        clients.add(ws);
        ws.on('close', () => clients.delete(ws));
        ws.on('error', () => clients.delete(ws));
        try {
          ws.send(JSON.stringify(await snapshot()));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', ts: Date.now(), message: String(err) }));
        }
      });
    },

    clientCount: () => clients.size,
  };
}

/**
 * Poll `herdr agent list` and emit only transitions. Cheap: one CLI call per
 * tick, no per-agent fan-out, because cwd already rides on the agent record.
 *
 * `enrich` is mandatory in practice: the `agents` event has ONE shape, the
 * registry-joined one the TUI renders (name + topics). Emitting the raw herdr
 * list here instead is what crashed the TUI on `a.topics.length`.
 */
export function startAgentPoll(
  bus: EventBus,
  intervalMs = 1000,
  enrich: (agents: HerdrAgent[]) => Promise<unknown[]> = async (a) => a,
) {
  const last = new Map<string, string>();
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const agents = await listAgents();
      let changed = false;
      const seen = new Set<string>();
      for (const a of agents) {
        if (!a.paneId) continue;
        seen.add(a.paneId);
        const prev = last.get(a.paneId);
        if (prev !== a.status) {
          last.set(a.paneId, a.status);
          if (prev !== undefined) {
            bus.emit({ type: 'agent_state', paneId: a.paneId, repo: a.repo, from: prev, to: a.status });
          }
          changed = true;
        }
      }
      for (const paneId of [...last.keys()]) {
        if (!seen.has(paneId)) {
          bus.emit({ type: 'agent_state', paneId, repo: null, from: last.get(paneId)!, to: 'gone' });
          last.delete(paneId);
          changed = true;
        }
      }
      if (changed) bus.emit({ type: 'agents', agents: (await enrich(agents)) as any });
    } catch (err) {
      bus.emit({ type: 'error', message: `agent poll: ${String(err)}` });
    }
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
