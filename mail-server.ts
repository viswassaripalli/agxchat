/**
 * AGxChat — one server process, HTTP transport, shared state.
 *
 * The single most important config detail: HTTP, not stdio. stdio would spawn a
 * separate server per client and hand each one an empty mailbox.
 *
 * Invariants enforced here:
 *   1. Payload by pointer — the TTY carries `mail <id>, call mail_inbox` and
 *      nothing else. Bodies over MAX_BODY are rejected with a pointer hint.
 *   2. Deadlock is a cycle in the wait graph — async send is the default and is
 *      deadlock-free; mail_wait carries all three guards (timeout cap, cycle
 *      detection, depth cap of one).
 */
import express from 'express';
import { randomBytes } from 'node:crypto';
import { readFile, appendFile, writeFile, mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { listAgents, nudge, sendKeys, readPane, herdrVersion, type HerdrAgent } from './herdr.ts';
import { createEventBus, startAgentPoll, type MailEvent } from './mail-events.ts';

const PORT = Number(process.env.AGX_PORT ?? process.env.HERDR_MAIL_PORT ?? 7777);
const MAX_BODY = 2000;
const MAX_WAIT_MS = 5 * 60 * 1000;

// ─────────────────────────────── state ───────────────────────────────

type Delivery =
  | 'queued'
  | 'nudged_idle'
  | 'nudged_inline'
  | 'deferred'
  | 'stalled'
  | 'target_blocked'
  | 'undeliverable';

type Mail = {
  id: string;
  kind: 'ask' | 'note' | 'reply';
  from: string;
  to: string;
  subject: string;
  body: string;
  pointers: string[];
  expect: string | null;
  replyTo: string | null;
  data: unknown;
  createdAt: number;
  readAt: number | null;
  delivery: Delivery;
  deliveryDetail: string | null;
  targetPaneId: string | null;
  inline: boolean;
  /** false when the recipient reads via the TUI/API and wants no TTY writes. */
  notify: boolean;
  /**
   * The human the sender claims asked for this. A HINT, NOT PROOF: the server
   * is localhost and unauthenticated, so any sender can write anything here.
   * It exists because a receiving agent otherwise sees every request as coming
   * from another bot and refuses side-effecting work — which is the correct
   * default, and this is what lets a human's request be distinguishable at all.
   */
  requestedBy: string | null;
  /**
   * When `requestedBy` is second-hand — the sender learned of the request from
   * another agent's mail rather than from the human — this is that mail's id.
   * Observed live: a session relayed "viswas has since asked for this" for a
   * run the human never asked for, and the receiver could not tell the claim
   * was laundered. A first-hand claim is already weak (unauthenticated
   * localhost); a relayed one is weaker, and must not look identical.
   */
  via: string | null;
  nudgedAt: number | null;
  /** Set when the target started working after the nudge: it picked this up. */
  engagedAt: number | null;
};

type Session = {
  name: string;
  topics: string[];
  cwd: string | null;
  paneId: string | null;
  registeredAt: number;
  lastSeen: number;
};

const registry = new Map<string, Session>();
const mail = new Map<string, Mail>();

/**
 * Durability: an append-only JSONL log next to the server.
 *
 * PLAN.md accepted an in-memory Map and listed "restart the server, lose the
 * queue" as a known weakness. It cost a real conversation twice during this
 * build, so it is no longer accepted. Every create and every mutation appends a
 * full record; on load the last record for an id wins, so replay needs no
 * diffing. The file is compacted once it passes COMPACT_AT lines.
 */
const STORE = process.env.AGX_STORE ?? process.env.HERDR_MAIL_STORE ?? '.run/mail.jsonl';
const COMPACT_AT = 5000;
let storeLines = 0;
let storeBroken = false;

async function persist(m: Mail) {
  if (storeBroken) return;
  try {
    await mkdir(STORE.replace(/\/[^/]+$/, ''), { recursive: true });
    await appendFile(STORE, JSON.stringify(m) + '\n');
    if (++storeLines > COMPACT_AT) await compactStore();
  } catch (err) {
    // A broken disk must never take delivery down with it.
    storeBroken = true;
    console.error(`mail store disabled: ${String(err)}`);
  }
}

async function compactStore() {
  const live = [...mail.values()].map((m) => JSON.stringify(m)).join('\n');
  await writeFile(STORE, live + (live ? '\n' : ''));
  storeLines = mail.size;
}

/** A delete is recorded as a tombstone append, never a rewrite. */
async function persistDelete(id: string) {
  if (storeBroken) return;
  try {
    await mkdir(STORE.replace(/\/[^/]+$/, ''), { recursive: true });
    await appendFile(STORE, JSON.stringify({ id, _deleted: true }) + '\n');
    storeLines++;
  } catch (err) {
    storeBroken = true;
    console.error(`mail store disabled: ${String(err)}`);
  }
}

async function loadStore() {
  let raw: string;
  try {
    raw = await readFile(STORE, 'utf8');
  } catch {
    return { restored: 0 };
  }
  const lines = raw.split('\n').filter(Boolean);
  storeLines = lines.length;
  let bad = 0;
  for (const line of lines) {
    try {
      const m = JSON.parse(line) as Mail & { _deleted?: boolean };
      if (!m?.id) continue;
      if (m._deleted) mail.delete(m.id); // tombstone
      else mail.set(m.id, m); // last write wins
    } catch {
      bad++;
    }
  }
  return { restored: mail.size, lines: lines.length, unparseable: bad };
}
/** waiter → target. An edge exists only while someone is inside mail_wait. */
const waitGraph = new Map<string, { target: string; mailId: string }>();

const key = (name: string) => name.trim().toLowerCase();

function newId(): string {
  for (let i = 0; i < 50; i++) {
    const id = randomBytes(2).toString('hex');
    if (!mail.has(id)) return id;
  }
  return randomBytes(4).toString('hex');
}

function inboxOf(name: string): Mail[] {
  const k = key(name);
  return [...mail.values()].filter((m) => key(m.to) === k).sort((a, b) => a.createdAt - b.createdAt);
}

// ───────────────────────── pane + identity resolution ─────────────────────────

/**
 * Resolved fresh at delivery time: pane ids move when the user rearranges the
 * workspace, but cwd does not.
 */
async function resolvePane(session: Session | undefined, name: string, agents?: HerdrAgent[]) {
  const list = agents ?? (await listAgents(false));
  if (session?.paneId) {
    const hit = list.find((a) => a.paneId === session.paneId);
    if (hit) return hit;
  }
  if (session?.cwd) {
    const hit = list.find((a) => a.cwd === session.cwd || a.foregroundCwd === session.cwd);
    if (hit) return hit;
  }
  const byName = list.filter((a) => a.name && key(a.name) === key(name));
  if (byName.length === 1) return byName[0];
  const byRepo = list.filter((a) => a.repo && key(a.repo) === key(name));
  if (byRepo.length === 1) return byRepo[0];
  const byPane = list.find((a) => a.paneId === name);
  return byPane ?? null;
}

type Resolution =
  | { ok: true; name: string; via: 'name' | 'topic' | 'repo' | 'pane' }
  | { ok: false; reason: 'unknown'; known: string[] }
  | { ok: false; reason: 'ambiguous'; candidates: { name: string; repo: string | null; paneId: string | null }[] };

/**
 * Three passes: agent name → registered topic → repo (exact, then substring).
 * Ambiguity returns the candidates with their repos instead of guessing —
 * two panes can legitimately hold the same repo name from different worktrees.
 */
async function resolveTarget(to: string, agents: HerdrAgent[]): Promise<Resolution> {
  const t = key(to);

  if (registry.has(t)) return { ok: true, name: registry.get(t)!.name, via: 'name' };

  const herdrNamed = agents.filter((a) => a.name && key(a.name) === t);
  if (herdrNamed.length === 1) return { ok: true, name: herdrNamed[0].name!, via: 'name' };

  const byTopic = [...registry.values()].filter((s) => s.topics.some((x) => key(x) === t));
  if (byTopic.length === 1) return { ok: true, name: byTopic[0].name, via: 'topic' };
  if (byTopic.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      candidates: byTopic.map((s) => ({
        name: s.name,
        repo: agents.find((a) => a.paneId === s.paneId)?.repo ?? null,
        paneId: s.paneId,
      })),
    };
  }

  const paneHit = agents.find((a) => a.paneId === to);
  if (paneHit) return { ok: true, name: paneHit.paneId!, via: 'pane' };

  const exact = agents.filter((a) => a.repo && key(a.repo) === t);
  const pool = exact.length ? exact : agents.filter((a) => a.repo && key(a.repo).includes(t));
  if (pool.length === 1) {
    const a = pool[0];
    const registered = [...registry.values()].find((s) => s.paneId === a.paneId);
    return { ok: true, name: registered?.name ?? a.paneId!, via: 'repo' };
  }
  if (pool.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      candidates: pool.map((a) => ({
        name: [...registry.values()].find((s) => s.paneId === a.paneId)?.name ?? a.paneId!,
        repo: a.repo,
        paneId: a.paneId,
      })),
    };
  }

  return { ok: false, reason: 'unknown', known: [...registry.values()].map((s) => s.name) };
}

// ─────────────────────────────── delivery ───────────────────────────────

const bus = createEventBus();

/** Payload by pointer: the TTY carries an id, never the content. */
function nudgeText(m: Mail): string {
  // A reply is the end of an exchange. Handing the recipient instructions for
  // replying to the reply is how you get an infinite politeness loop.
  if (m.kind === 'reply') {
    return m.inline
      ? `[agxchat reply ${m.id} from ${m.from}] ${m.subject} — ${m.body}`
      : `mail ${m.id}: reply from ${m.from} — call mail_inbox`;
  }
  const behalf = m.requestedBy
    ? m.via
      ? ` on behalf of ${m.requestedBy} — SECOND-HAND, relayed by ${m.from} from mail ${m.via}, not heard from the human`
      : ` on behalf of ${m.requestedBy}`
    : '';
  if (!m.inline) return `mail ${m.id} from ${m.from}${behalf} — call mail_inbox`;
  // Fallback for a session that has not wired up the mail MCP server yet: the
  // question rides in the TTY and the answer comes back the same way.
  const reply =
    `If you have the \`mail\` MCP server, reply with mail_reply({mail_id:"${m.id}", body:"..."}). ` +
    `Otherwise reply by running: curl -s -X POST localhost:${PORT}/reply -H 'Content-Type: application/json' ` +
    `-d '{"mail_id":"${m.id}","from":"${m.to}","body":"YOUR ANSWER HERE"}'`;
  return [
    `[agxchat ${m.id} from ${m.from}${behalf}] ${m.subject}`,
    m.body,
    m.pointers.length ? `files: ${m.pointers.join(', ')}` : '',
    reply,
  ]
    .filter(Boolean)
    .join(' — ');
}

async function nudgeNow(m: Mail, paneId: string, status: string) {
  try {
    await nudge(paneId, nudgeText(m));
    m.delivery = m.inline ? 'nudged_inline' : 'nudged_idle';
    m.deliveryDetail = `pane ${paneId} (${status})`;
    m.nudgedAt = Date.now();
  } catch (err) {
    m.delivery = 'undeliverable';
    m.deliveryDetail = `nudge failed: ${String(err)}`;
  }
}

/** Called on every idle/done transition — this is what makes deferral work. */
async function flushDeferred(paneId: string, status: string) {
  const pending = [...mail.values()].filter((m) => m.delivery === 'deferred' && m.targetPaneId === paneId);
  for (const m of pending) {
    await nudgeNow(m, paneId, status);
    await persist(m);
    bus.emit({ type: 'delivery', id: m.id, to: m.to, delivery: m.delivery, detail: m.deliveryDetail ?? undefined });
  }
}

/**
 * Stall detection.
 *
 * `agent_status` is not enough to know a nudge landed. Observed: a session
 * parked on a permission prompt — answer written, waiting on a human to approve
 * the send — reports `done`, not `blocked`. So mail to it gets `nudged_idle`
 * and then silently goes nowhere.
 *
 * Rather than pattern-matching dialog text, infer it: a mail that was nudged,
 * has neither been read nor answered, and whose target is NOT working, is a
 * mail nobody is acting on. Pane text is read only to explain WHY, never to
 * decide. Nothing is re-nudged — a stalled agent needs a human, not more text.
 */
const STALL_MS = Number(process.env.AGX_STALL_MS ?? process.env.HERDR_MAIL_STALL_MS ?? 60_000);
const PERMISSION_MARKERS = /need permission|do you want|would you like|\ballow\b|requires approval|esc to (cancel|interrupt)/i;

/** A stall is a live guess, not a verdict: reading or engaging clears it. */
function unstall(m: Mail, why: string) {
  if (m.delivery !== 'stalled') return false;
  m.delivery = m.inline ? 'nudged_inline' : 'nudged_idle';
  m.deliveryDetail = why;
  bus.emit({ type: 'delivery', id: m.id, to: m.to, delivery: m.delivery, detail: m.deliveryDetail });
  return true;
}

async function checkStalls() {
  const now = Date.now();
  const candidates = [...mail.values()].filter((m) => {
    if (m.delivery !== 'nudged_idle' && m.delivery !== 'nudged_inline') return false;
    if (m.readAt !== null || m.engagedAt !== null) return false;
    if (m.nudgedAt === null || now - m.nudgedAt <= STALL_MS) return false;
    // An inline reply carries its whole payload in the TTY and nothing answers
    // a reply, so it has no "read" and no "answered" signal to wait for. It is
    // delivered on arrival; flagging it would stall forever.
    if (m.kind === 'reply' && m.inline) return false;
    return ![...mail.values()].some((r) => r.kind === 'reply' && r.replyTo === m.id);
  });
  if (candidates.length === 0) return;

  const agents = await listAgents(false).catch(() => []);
  for (const m of candidates) {
    const pane = agents.find((a) => a.paneId === m.targetPaneId);
    if (!pane) {
      m.delivery = 'undeliverable';
      m.deliveryDetail = 'target pane disappeared after the nudge';
    } else if (pane.status === 'working') {
      continue; // it is thinking about it; not stalled
    } else {
      const screen = m.targetPaneId ? await readPane(m.targetPaneId, 25).catch(() => '') : '';
      const awaiting = PERMISSION_MARKERS.test(screen);
      m.delivery = 'stalled';
      m.deliveryDetail = awaiting
        ? `pane ${pane.paneId} looks parked on a prompt (reports "${pane.status}"); a human must clear it`
        : `pane ${pane.paneId} is ${pane.status} but has not read mail ${m.id} in ${Math.round((now - m.nudgedAt!) / 1000)}s`;
    }
    await persist(m);
    bus.emit({ type: 'delivery', id: m.id, to: m.to, delivery: m.delivery, detail: m.deliveryDetail ?? undefined });
  }
}

bus.subscribe((ev) => {
  if (ev.type === 'agent_state' && (ev.to === 'idle' || ev.to === 'done')) {
    void flushDeferred(ev.paneId, ev.to);
  }
  // A target that starts working after a nudge has engaged with it. Recorded
  // even when the mail is not currently flagged, because a session that picks
  // mail up and finishes inside the stall window would otherwise be flagged
  // afterwards for never having "read" it.
  if (ev.type === 'agent_state' && ev.to === 'working') {
    for (const m of mail.values()) {
      if (m.targetPaneId === ev.paneId && m.nudgedAt && !m.engagedAt) {
        m.engagedAt = Date.now();
        void persist(m);
      }
      if (m.targetPaneId === ev.paneId && unstall(m, `pane ${ev.paneId} started working on it`)) {
        void persist(m);
      }
    }
  }
});


/**
 * Delivery is a function of the target's lifecycle state:
 *   idle/done → nudge now
 *   working   → DEFER. Verified on claude in herdr 0.7.1: a `/btw` side turn
 *               answers without derailing the main task but reports
 *               "No tools here. Cannot run command." — it cannot reach
 *               mail_inbox, so a /btw nudge is useless. Deferred mail is
 *               flushed by flushDeferred() on the idle transition.
 *   blocked   → undeliverable; only a human or `pane send-keys esc` clears it.
 */
async function deliver(m: Mail, opts: { silent?: boolean } = {}) {
  const agents = await listAgents(false);
  const session = registry.get(key(m.to));
  const pane = await resolvePane(session, m.to, agents);

  m.targetPaneId = pane?.paneId ?? null;

  if (!m.notify) {
    m.delivery = 'queued';
    m.deliveryDetail = 'recipient reads via TUI/API; no TTY write';
  } else if (!pane?.paneId) {
    m.delivery = 'undeliverable';
    m.deliveryDetail = 'no live pane for target';
  } else if (pane.status === 'blocked') {
    m.delivery = 'target_blocked';
    m.deliveryDetail = `pane ${pane.paneId} is blocked; a human or \`pane send-keys esc\` must clear it`;
  } else if (opts.silent) {
    m.delivery = 'queued';
    m.deliveryDetail = 'sender is blocked in mail_wait; no nudge needed';
  } else if (pane.status === 'working') {
    m.delivery = 'deferred';
    m.deliveryDetail = `pane ${pane.paneId} is working; queued until it goes idle`;
  } else {
    await nudgeNow(m, pane.paneId, pane.status);
  }

  bus.emit({ type: 'delivery', id: m.id, to: m.to, delivery: m.delivery, detail: m.deliveryDetail ?? undefined });
  return { pane, delivery: m.delivery, detail: m.deliveryDetail };
}

async function mergedAgents() {
  const agents = await listAgents();
  return agents.map((a) => {
    const s = [...registry.values()].find((x) => x.paneId === a.paneId || (x.cwd && x.cwd === a.cwd));
    return { ...a, name: s?.name ?? a.name ?? a.paneId, topics: s?.topics ?? [], registered: Boolean(s) };
  });
}

async function snapshot(): Promise<MailEvent> {
  return { type: 'snapshot', ts: Date.now(), agents: (await mergedAgents()) as any, mail: [...mail.values()] };
}

/**
 * Pre-seed the registry from agents.json.
 *
 * Without this, "ask design ..." fails until the design session happens to
 * call mail_register — and a session never does that unprompted. Seeding makes
 * topic routing work against sessions that were already running before the mail
 * server existed. A live mail_register call overwrites the seeded entry.
 */
async function loadSeed(path = process.env.AGX_SEED ?? process.env.HERDR_MAIL_SEED ?? 'agents.json') {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return { loaded: 0, path, bound: [] as string[] };
  }
  const parsed = JSON.parse(raw);
  const agents = await listAgents(false);
  const bound: string[] = [];
  for (const entry of parsed?.agents ?? []) {
    if (typeof entry?.name !== 'string') continue;
    const session: Session = {
      name: entry.name,
      topics: Array.isArray(entry.topics) ? entry.topics : [],
      cwd: typeof entry.cwd === 'string' ? entry.cwd : null,
      paneId: typeof entry.pane_id === 'string' ? entry.pane_id : null,
      registeredAt: Date.now(),
      lastSeen: 0,
    };
    const pane = await resolvePane(session, session.name, agents);
    session.paneId = pane?.paneId ?? session.paneId;
    registry.set(key(session.name), session);
    bound.push(`${session.name}${pane ? ` -> ${pane.paneId} (${pane.status})` : ' -> NO PANE'}`);
  }
  return { loaded: registry.size, path, bound };
}

// ─────────────────────────────── MCP tools ───────────────────────────────

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const fail = (code: string, extra: Record<string, unknown> = {}) => ({
  isError: true,
  content: [{ type: 'text' as const, text: JSON.stringify({ error: code, ...extra }, null, 2) }],
});

function buildMcpServer(identity: string | null) {
  const server = new McpServer({ name: 'agxchat', version: '0.1.0' });
  const me = () => {
    if (!identity) return null;
    const s = registry.get(key(identity));
    if (s) s.lastSeen = Date.now();
    return identity;
  };
  const noIdentity = () =>
    fail('no_identity', {
      hint: 'Set headers: {"X-Herdr-Agent": "<your-name>"} in this repo\'s .mcp.json mail server entry.',
    });

  server.registerTool(
    'mail_agents',
    {
      title: 'List agents',
      description:
        'Who is running: name, repo, branch, lifecycle state, pane, and registered topics. Use this before mail_send to pick a target.',
      inputSchema: {},
    },
    async () => ok({ self: identity, agents: await mergedAgents() }),
  );

  server.registerTool(
    'mail_register',
    {
      title: 'Register this session',
      description:
        'Declare the topics this session answers for so other agents can address it by subject instead of by pane. Pass cwd so the server can bind you to a pane.',
      inputSchema: {
        topics: z.array(z.string()).describe('e.g. ["design", "design-system"]'),
        cwd: z.string().optional().describe('absolute path of this session, used to bind you to a herdr pane'),
        pane_id: z.string().optional().describe('optional explicit herdr pane id, e.g. "wC:p1"'),
      },
    },
    async ({ topics, cwd, pane_id }) => {
      const name = me();
      if (!name) return noIdentity();
      const prev = registry.get(key(name));
      const session: Session = {
        name,
        topics,
        cwd: cwd ?? prev?.cwd ?? null,
        paneId: pane_id ?? prev?.paneId ?? null,
        registeredAt: prev?.registeredAt ?? Date.now(),
        lastSeen: Date.now(),
      };
      const pane = await resolvePane(session, name);
      session.paneId = pane?.paneId ?? session.paneId;
      registry.set(key(name), session);
      bus.emit({ type: 'agents', agents: (await mergedAgents()) as any });
      return ok({
        registered: session,
        pane: pane ? { paneId: pane.paneId, repo: pane.repo, status: pane.status } : null,
        warning: pane ? undefined : 'No pane matched — mail to you will be undeliverable. Pass cwd or pane_id.',
      });
    },
  );

  server.registerTool(
    'mail_send',
    {
      title: 'Send mail',
      description:
        'Send to an agent name, a registered topic, or a repo name. Async and deadlock-free: returns as soon as the nudge is delivered. Keep the body short and pass large content as file paths in `pointers`.',
      inputSchema: {
        to: z.string().describe('agent name, topic, repo name, or pane id'),
        subject: z.string(),
        body: z.string().describe(`what you want; <= ${MAX_BODY} chars. Large content goes in pointers.`),
        pointers: z.array(z.string()).optional().describe('absolute file paths carrying the real payload'),
        expect: z.string().optional().describe('the reply shape you want back'),
        kind: z.enum(['ask', 'note']).optional(),
        inline: z
          .boolean()
          .optional()
          .describe('put the question itself in the target TTY. Only for a session that lacks the mail MCP server.'),
        requested_by: z
          .string()
          .optional()
          .describe(
            'the human who asked you to send this, if a person did IN THIS SESSION. Unverified — the receiver treats ' +
              'it as a claim, not proof. Omit it when you are acting on your own initiative.',
          ),
        via: z
          .string()
          .optional()
          .describe(
            'REQUIRED if requested_by is second-hand: the id of the mail that told you the human asked. Relaying ' +
              'another agent\'s claim as if you heard it from the human yourself is how a fabricated approval spreads.',
          ),
      },
    },
    async ({ to, subject, body, pointers, expect, kind, inline, requested_by, via }) => {
      const from = me();
      if (!from) return noIdentity();
      if (body.length > MAX_BODY) {
        return fail('body_too_large', {
          length: body.length,
          max: MAX_BODY,
          hint: 'Payload by pointer: write the content to a file and pass its absolute path in `pointers`.',
        });
      }

      const agents = await listAgents(false);
      const resolved = await resolveTarget(to, agents);
      if (!resolved.ok) return fail(resolved.reason, resolved);

      const m: Mail = {
        id: newId(),
        kind: kind ?? 'ask',
        from,
        to: resolved.name,
        subject,
        body,
        pointers: pointers ?? [],
        expect: expect ?? null,
        replyTo: null,
        data: null,
        createdAt: Date.now(),
        readAt: null,
        delivery: 'queued',
        deliveryDetail: null,
        targetPaneId: null,
        inline: inline ?? false,
        notify: true,
        requestedBy: requested_by ?? null,
        via: via ?? null,
        nudgedAt: null,
        engagedAt: null,
      };
      mail.set(m.id, m);
      await persist(m);
      bus.emit({ type: 'mail', mail: m });

      const res = await deliver(m);
      await persist(m);
      return ok({
        id: m.id,
        to: m.to,
        via: resolved.via,
        requested_by: m.requestedBy,
        via: m.via,
        provenance: m.requestedBy ? (m.via ? 'second-hand (relayed)' : 'first-hand claim, unverified') : 'none',
        target: res.pane ? { paneId: res.pane.paneId, repo: res.pane.repo, status: res.pane.status } : null,
        delivery: res.delivery,
        detail: res.detail,
        next:
          res.delivery === 'deferred'
            ? `Target is busy. The nudge fires automatically when it goes idle. Do not block on this.`
            : m.kind === 'ask'
              ? `Call mail_wait({mail_id:"${m.id}"}) only if you must block; otherwise keep working and read mail_inbox later.`
              : undefined,
      });
    },
  );

  server.registerTool(
    'mail_inbox',
    {
      title: 'Read inbox',
      description: 'Mail addressed to this session. Returns the full structured payload — never read it off the terminal.',
      inputSchema: {
        unread_only: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        mail_id: z.string().optional(),
      },
    },
    async ({ unread_only, limit, mail_id }) => {
      const name = me();
      if (!name) return noIdentity();
      let items = inboxOf(name);
      if (mail_id) items = items.filter((m) => m.id === mail_id);
      if (unread_only) items = items.filter((m) => m.readAt === null);
      items = items.slice(-(limit ?? 20));
      const now = Date.now();
      for (const m of items) {
        const wasStalled = unstall(m, 'read by recipient');
        if (m.readAt === null) {
          m.readAt = now;
          await persist(m);
        } else if (wasStalled) {
          await persist(m);
        }
      }
      return ok({
        self: name,
        unread: inboxOf(name).filter((m) => m.readAt === null).length,
        mail: items,
        next: items.some((m) => m.kind === 'ask') ? 'Answer each ask with mail_reply({mail_id, body}).' : undefined,
      });
    },
  );

  server.registerTool(
    'mail_reply',
    {
      title: 'Reply to mail',
      description: 'Structured answer back to the sender. Large results go on disk and travel as paths in `pointers`.',
      inputSchema: {
        mail_id: z.string(),
        body: z.string(),
        pointers: z.array(z.string()).optional(),
        data: z.any().optional().describe('structured result, returned verbatim to the sender'),
      },
    },
    async ({ mail_id, body, pointers, data }) => {
      const from = me();
      if (!from) return noIdentity();
      if (body.length > MAX_BODY) {
        return fail('body_too_large', { length: body.length, max: MAX_BODY, hint: 'Write the result to a file and pass its path in `pointers`.' });
      }
      const orig = mail.get(mail_id);
      if (!orig) return fail('unknown_mail', { mail_id });
      if (key(orig.to) !== key(from)) return fail('not_addressed_to_you', { mail_id, addressed_to: orig.to });

      const reply: Mail = {
        id: newId(),
        kind: 'reply',
        from,
        to: orig.from,
        subject: `re: ${orig.subject}`,
        body,
        pointers: pointers ?? [],
        expect: null,
        replyTo: orig.id,
        data: data ?? null,
        createdAt: Date.now(),
        readAt: null,
        delivery: 'queued',
        deliveryDetail: null,
        targetPaneId: null,
        inline: orig.inline,
        notify: orig.notify, // a TUI-only sender stays TUI-only for the reply
        requestedBy: orig.requestedBy,
        via: orig.via,
        nudgedAt: null,
        engagedAt: null,
      };
      mail.set(reply.id, reply);
      await persist(reply);
      bus.emit({ type: 'reply', mail: reply });

      // If the sender is parked in mail_wait, its wait loop picks this up; a
      // nudge there would inject text into a session mid-tool-call.
      const waiting = waitGraph.get(key(orig.from))?.mailId === orig.id;
      const res = await deliver(reply, { silent: waiting });
      await persist(reply);
      return ok({ id: reply.id, to: reply.to, replyTo: orig.id, delivery: res.delivery, detail: res.detail });
    },
  );

  server.registerTool(
    'mail_wait',
    {
      title: 'Block for a reply',
      description:
        'Blocks until a reply to `mail_id` arrives. Guarded: mandatory timeout capped at 5 minutes, refuses cycles with would_deadlock, and allows one outstanding blocking ask per session. Prefer async send.',
      inputSchema: {
        mail_id: z.string(),
        timeout_ms: z.number().int().min(1000).max(MAX_WAIT_MS).describe('mandatory; capped at 300000'),
      },
    },
    async ({ mail_id, timeout_ms }) => {
      const self = me();
      if (!self) return noIdentity();
      const orig = mail.get(mail_id);
      if (!orig) return fail('unknown_mail', { mail_id });
      if (key(orig.from) !== key(self)) return fail('not_your_mail', { mail_id, sender: orig.from });

      // Guard 3 — depth cap: one outstanding blocking ask, no nesting.
      const existing = waitGraph.get(key(self));
      if (existing) return fail('wait_in_progress', { already_waiting_on: existing.mailId, target: existing.target });

      // Guard 2 — cycle detection: walk the graph from the target back to self.
      let cursor = key(orig.to);
      const path = [key(self)];
      for (let hop = 0; hop < registry.size + 2; hop++) {
        path.push(cursor);
        if (cursor === key(self)) return fail('would_deadlock', { cycle: path });
        const edge = waitGraph.get(cursor);
        if (!edge) break;
        cursor = key(edge.target);
      }

      if (orig.delivery === 'target_blocked') return fail('target_blocked', { detail: orig.deliveryDetail });
      if (orig.delivery === 'undeliverable') return fail('undeliverable', { detail: orig.deliveryDetail });

      // Guard 1 — mandatory timeout, capped by the schema.
      waitGraph.set(key(self), { target: orig.to, mailId: orig.id });
      const deadline = Date.now() + Math.min(timeout_ms, MAX_WAIT_MS);
      try {
        while (Date.now() < deadline) {
          const reply = [...mail.values()].find((m) => m.kind === 'reply' && m.replyTo === orig.id);
          if (reply) {
            reply.readAt = reply.readAt ?? Date.now();
            return ok({ status: 'replied', reply });
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        return ok({
          status: 'timeout',
          waited_ms: Math.min(timeout_ms, MAX_WAIT_MS),
          hint: `No reply to ${orig.id} yet. Keep working; the reply lands in mail_inbox.`,
        });
      } finally {
        waitGraph.delete(key(self));
      }
    },
  );

  return server;
}

/** Every message whose replyTo chain reaches `rootId`, plus the root itself. */
function threadIds(rootId: string): string[] {
  const rootOf = (m: Mail): string => {
    let cur = m;
    for (let hop = 0; hop < 20 && cur.replyTo; hop++) {
      const parent = mail.get(cur.replyTo);
      if (!parent) break;
      cur = parent;
    }
    return cur.id;
  };
  return [...mail.values()].filter((m) => m.id === rootId || rootOf(m) === rootId).map((m) => m.id);
}

/**
 * Deleted mail is recoverable because the store is append-only: a tombstone
 * hides a record, it does not erase it. This reads the log directly rather
 * than memory, which is the whole point — memory is where it is already gone.
 */
async function deletedMail(): Promise<Mail[]> {
  let raw: string;
  try {
    raw = await readFile(STORE, 'utf8');
  } catch {
    return [];
  }
  const last = new Map<string, Mail>();
  const tombed = new Set<string>();
  for (const line of raw.split('\n').filter(Boolean)) {
    try {
      const r = JSON.parse(line) as Mail & { _deleted?: boolean };
      if (!r?.id) continue;
      if (r._deleted) tombed.add(r.id);
      else {
        last.set(r.id, r);
        tombed.delete(r.id); // written again after a delete: live once more
      }
    } catch {
      /* skip */
    }
  }
  return [...tombed].map((id) => last.get(id)).filter((m): m is Mail => Boolean(m) && !mail.has(m!.id));
}

async function removeMail(ids: string[]) {
  const removed: string[] = [];
  for (const id of ids) {
    if (!mail.has(id)) continue;
    mail.delete(id);
    await persistDelete(id);
    removed.push(id);
  }
  if (removed.length) bus.emit({ type: 'deleted', ids: removed });
  return removed;
}

// ─────────────────────────────── HTTP ───────────────────────────────

const app = express();
app.use(express.json({ limit: '4mb' }));

const identityOf = (req: express.Request) => {
  const h = req.header('X-Herdr-Agent');
  return h && h.trim() ? h.trim() : null;
};

/**
 * Stateless transport: a fresh McpServer per request, shared state in the
 * module above. Every session hits the same process, so every session sees the
 * same mailbox.
 */
app.post('/mcp', async (req, res) => {
  try {
    const server = buildMcpServer(identityOf(req));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: String(err) });
  }
});
app.get('/mcp', (_req, res) => res.status(405).json({ error: 'use POST (stateless streamable http)' }));
app.delete('/mcp', (_req, res) => res.status(405).json({ error: 'stateless: nothing to delete' }));

app.get('/health', async (_req, res) => {
  res.json({
    ok: true,
    herdr: await herdrVersion().catch((e) => `unavailable: ${String(e)}`),
    port: PORT,
    sessions: registry.size,
    mail: mail.size,
    store: storeBroken ? 'DISABLED' : STORE,
    stalled: [...mail.values()].filter((m) => m.delivery === 'stalled').map((m) => ({ id: m.id, to: m.to, detail: m.deliveryDetail })),
    waiting: [...waitGraph.entries()].map(([k, v]) => ({ waiter: k, ...v })),
    ws_clients: bus.clientCount(),
  });
});

app.get('/agents', async (_req, res) => res.json({ agents: await mergedAgents() }));

app.post('/reload-seed', async (_req, res) => res.json(await loadSeed()));

app.get('/mail', async (req, res) => {
  const to = typeof req.query.to === 'string' ? req.query.to : null;
  const all = [...mail.values()].sort((a, b) => a.createdAt - b.createdAt);
  if (!to) return res.json({ mail: all });

  // Fetching your own inbox IS reading it. Without this, a session that reads
  // with the CLI never marks anything read, and stall detection — which keys
  // off readAt — fires on mail that was delivered and read perfectly well.
  const mine = all.filter((m) => key(m.to) === key(to));
  if (req.query.mark !== 'none') {
    for (const m of mine) {
      const wasStalled = unstall(m, 'read by recipient');
      if (m.readAt === null) {
        m.readAt = Date.now();
        await persist(m);
      } else if (wasStalled) {
        await persist(m);
      }
    }
  }
  res.json({ mail: mine });
});

/** Powers the TUI's `i` key. */
app.post('/mail', async (req, res) => {
  const { from = 'tui', to, subject = '(no subject)', body = '', pointers = [], expect = null, kind = 'ask' } =
    req.body ?? {};
  // Default by sender: a real session wants the reply nudged back into its own
  // pane; the TUI and scripts read the mailbox and want no TTY write. Explicit
  // notify always wins.
  const senderPane = await resolvePane(registry.get(key(String(from))), String(from));
  const notify = typeof req.body?.notify === 'boolean' ? req.body.notify : Boolean(senderPane?.paneId);
  if (typeof to !== 'string' || !to) return res.status(400).json({ error: 'to is required' });
  if (typeof body === 'string' && body.length > MAX_BODY) return res.status(413).json({ error: 'body too large; use pointers' });

  const agents = await listAgents(false);
  const resolved = await resolveTarget(to, agents);
  if (!resolved.ok) return res.status(409).json(resolved);

  const m: Mail = {
    id: newId(), kind, from, to: resolved.name, subject, body,
    pointers, expect, replyTo: null, data: null,
    createdAt: Date.now(), readAt: null, delivery: 'queued', deliveryDetail: null,
    targetPaneId: null, inline: Boolean(req.body?.inline), notify,
    requestedBy: typeof req.body?.requested_by === 'string' && req.body.requested_by.trim()
      ? req.body.requested_by.trim()
      : null,
    via: typeof req.body?.via === 'string' && req.body.via.trim() ? req.body.via.trim() : null,
    nudgedAt: null, engagedAt: null,
  };
  mail.set(m.id, m);
  await persist(m);
  bus.emit({ type: 'mail', mail: m });
  const out = await deliver(m);
  await persist(m);
  res.json({ id: m.id, to: m.to, delivery: out.delivery, detail: out.detail });
});

/**
 * Reply channel for a session that has no mail MCP server but does have Bash.
 * The nudge hands it this exact curl line, so a two-way conversation works with
 * zero setup on the receiving side.
 */
app.post('/reply', async (req, res) => {
  const { mail_id, from, body = '', pointers = [], data = null } = req.body ?? {};
  const orig = mail.get(String(mail_id));
  if (!orig) return res.status(404).json({ error: 'unknown_mail', mail_id });
  if (typeof body !== 'string' || !body.trim()) return res.status(400).json({ error: 'body is required' });
  if (body.length > MAX_BODY) return res.status(413).json({ error: 'body too large; use pointers' });

  const reply: Mail = {
    id: newId(), kind: 'reply', from: String(from ?? orig.to), to: orig.from,
    subject: `re: ${orig.subject}`, body, pointers, expect: null, replyTo: orig.id, data,
    createdAt: Date.now(), readAt: null, delivery: 'queued', deliveryDetail: null,
    targetPaneId: null, inline: orig.inline, notify: orig.notify, requestedBy: orig.requestedBy,
    via: orig.via, nudgedAt: null, engagedAt: null,
  };
  mail.set(reply.id, reply);
  await persist(reply);
  bus.emit({ type: 'reply', mail: reply });
  const waiting = waitGraph.get(key(orig.from))?.mailId === orig.id;
  const out = await deliver(reply, { silent: waiting });
  await persist(reply);
  res.json({ ok: true, id: reply.id, to: reply.to, delivery: out.delivery });
});

/**
 * Provenance audit. Every claim of human authority in the mailbox, so a
 * fabricated one can be found after the fact — which is the only defence an
 * unauthenticated bus has.
 */
app.get('/provenance', (_req, res) => {
  const claims = [...mail.values()]
    .filter((m) => m.requestedBy)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((m) => ({
      id: m.id,
      from: m.from,
      to: m.to,
      subject: m.subject,
      requested_by: m.requestedBy,
      via: m.via,
      kind: m.via ? 'second-hand' : 'first-hand',
      via_exists: m.via ? mail.has(m.via) : null,
      via_claim: m.via ? (mail.get(m.via)?.requestedBy ?? null) : null,
    }));
  res.json({
    claims,
    second_hand: claims.filter((c) => c.kind === 'second-hand').length,
    dangling: claims.filter((c) => c.via && !c.via_exists).map((c) => c.id),
  });
});

/** What a delete hid, and can be brought back. */
app.get('/deleted', async (_req, res) => {
  const items = await deletedMail();
  res.json({ deleted: items.map((m) => ({ id: m.id, from: m.from, to: m.to, subject: m.subject, createdAt: m.createdAt })) });
});

/** Undo a delete: re-append the original record, which outranks its tombstone. */
app.post('/mail/:id/restore', async (req, res) => {
  const items = await deletedMail();
  const found = items.find((m) => m.id === req.params.id);
  if (!found) return res.status(404).json({ error: 'not_recoverable', id: req.params.id });
  mail.set(found.id, found);
  await persist(found);
  bus.emit({ type: 'mail', mail: found });
  res.json({ ok: true, restored: found.id, subject: found.subject });
});

/** Delete one message. */
app.delete('/mail/:id', async (req, res) => {
  const removed = await removeMail([req.params.id]);
  if (!removed.length) return res.status(404).json({ error: 'unknown_mail', id: req.params.id });
  res.json({ ok: true, removed });
});

/** Delete a whole thread — the root and every reply under it. */
app.delete('/thread/:id', async (req, res) => {
  if (!mail.has(req.params.id)) return res.status(404).json({ error: 'unknown_mail', id: req.params.id });
  const removed = await removeMail(threadIds(req.params.id));
  res.json({ ok: true, removed });
});

/**
 * Clear the whole mailbox. Requires ?confirm=yes so a stray DELETE cannot wipe
 * the history — the store is the only copy.
 */
app.delete('/mail', async (req, res) => {
  if (req.query.confirm !== 'yes') {
    return res.status(400).json({ error: 'confirm_required', hint: 'DELETE /mail?confirm=yes' });
  }
  const removed = await removeMail([...mail.keys()]);
  res.json({ ok: true, removed: removed.length });
});

/** Powers the TUI's `e` key — the only thing in this design that can clear a blocked agent. */
app.post('/agent/:name/send-keys', async (req, res) => {
  const keys: string[] = Array.isArray(req.body?.keys) && req.body.keys.length ? req.body.keys : ['esc'];
  const session = registry.get(key(req.params.name));
  const pane = await resolvePane(session, req.params.name);
  if (!pane?.paneId) return res.status(404).json({ error: 'no pane for that agent' });
  try {
    await sendKeys(pane.paneId, keys);
    res.json({ ok: true, paneId: pane.paneId, keys });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

const httpServer = app.listen(PORT, '127.0.0.1', async () => {
  console.log(`AGxChat on http://127.0.0.1:${PORT}  (mcp: /mcp, events: ws://127.0.0.1:${PORT}/events)`);
  console.log(`herdr: ${await herdrVersion().catch(() => 'NOT FOUND on PATH')}`);
  const store = await loadStore().catch((e) => ({ restored: 0, error: String(e) }));
  console.log(`  store ${STORE}: ${store.restored} mail restored${'error' in store ? ` (${store.error})` : ''}`);
  const seed = await loadSeed().catch((e) => ({ loaded: 0, path: 'agents.json', bound: [`seed failed: ${String(e)}`] }));
  for (const line of seed.bound) console.log(`  seed  ${line}`);
});

bus.attach(httpServer, '/events', snapshot);
startAgentPoll(bus, Number(process.env.AGX_POLL_MS ?? process.env.HERDR_MAIL_POLL_MS ?? 1000), () => mergedAgents());

const stallTimer = setInterval(() => void checkStalls(), Math.max(5000, Math.floor(STALL_MS / 3)));
stallTimer.unref?.();
