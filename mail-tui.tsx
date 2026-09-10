/**
 * AGxChat — thread list + thread detail.
 *
 * Runs as a herdr pane, ideally in its own workspace:
 *   herdr pane run <pane> "cd ~/Desktop/agxchat && npx tsx mail-tui.tsx"
 *
 * Threads, not a message stream: a root ask plus its replies is one row, which
 * is the unit you actually reason about ("did design ever answer?"). Consumes
 * the same event contract as the browser views — a `snapshot` frame on connect,
 * then deltas.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { render, Box, Text, useApp, useInput, useStdout } from 'ink';
import WebSocket from 'ws';

const PORT = Number(process.env.AGX_PORT ?? process.env.HERDR_MAIL_PORT ?? 7777);
const BASE = `http://127.0.0.1:${PORT}`;
/** Whose name reads as "us" in a thread header. */
const ME = (process.env.AGX_ME ?? process.env.HERDR_MAIL_ME ?? 'desktop').toLowerCase();

type Agent = {
  name: string | null;
  paneId: string | null;
  repo: string | null;
  dir: string | null;
  status: string;
  branch: string | null;
  topics: string[];
};

type Mail = {
  id: string;
  kind: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  pointers: string[];
  replyTo: string | null;
  createdAt: number;
  readAt: number | null;
  delivery: string;
  deliveryDetail: string | null;
  requestedBy?: string | null;
};

type Thread = {
  root: Mail;
  messages: Mail[];
  subject: string;
  a: string;
  b: string;
  lastAt: number;
  needsAttention: boolean;
  reason: string | null;
  answeredIn: number | null;
};

const STATUS_COLOR: Record<string, string> = {
  idle: 'green',
  done: 'cyan',
  working: 'yellow',
  blocked: 'red',
  unknown: 'gray',
  gone: 'gray',
};

/** Only states worth a badge; a plain successful nudge says nothing useful. */
const NOTABLE: Record<string, string> = {
  queued: 'cyan',
  deferred: 'yellow',
  stalled: 'red',
  target_blocked: 'red',
  undeliverable: 'red',
};

const ATTENTION = new Set(['stalled', 'target_blocked', 'undeliverable']);
const UNANSWERED_AFTER = 60_000;

const clock = (ts: number) => new Date(ts).toTimeString().slice(0, 8);

function age(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

/** Wrap to width, then clip — collapsed bodies are shortened, never dropped. */
function clip(body: string, maxLines: number, width: number) {
  const lines: string[] = [];
  for (const para of body.split('\n')) {
    if (para.length <= width) {
      lines.push(para);
      continue;
    }
    for (let i = 0; i < para.length; i += width) lines.push(para.slice(i, i + width));
  }
  if (lines.length <= maxLines) return { text: lines.join('\n'), hidden: 0 };
  return { text: lines.slice(0, maxLines).join('\n'), hidden: lines.length - maxLines };
}

function buildThreads(mail: Mail[]): Thread[] {
  const byId = new Map(mail.map((m) => [m.id, m]));
  /** Walk replyTo up to the root so a reply-to-a-reply stays in one thread. */
  const rootOf = (m: Mail): Mail => {
    let cur = m;
    for (let hop = 0; hop < 20 && cur.replyTo; hop++) {
      const parent = byId.get(cur.replyTo);
      if (!parent) break;
      cur = parent;
    }
    return cur;
  };

  const groups = new Map<string, Mail[]>();
  for (const m of mail) {
    const root = rootOf(m);
    const list = groups.get(root.id) ?? [];
    list.push(m);
    groups.set(root.id, list);
  }

  const now = Date.now();
  const threads: Thread[] = [];
  for (const [rootId, list] of groups) {
    const root = byId.get(rootId)!;
    const messages = [...list].sort((x, y) => x.createdAt - y.createdAt);
    const replies = messages.filter((m) => m.id !== root.id);
    const blocked = messages.find((m) => ATTENTION.has(m.delivery));
    const unanswered = root.kind === 'ask' && replies.length === 0 && now - root.createdAt > UNANSWERED_AFTER;
    threads.push({
      root,
      messages,
      subject: root.subject,
      a: root.from,
      b: root.to,
      lastAt: messages[messages.length - 1].createdAt,
      needsAttention: Boolean(blocked) || unanswered,
      reason: blocked ? blocked.delivery : unanswered ? 'no reply' : null,
      answeredIn: replies.length ? replies[0].createdAt - root.createdAt : null,
    });
  }
  return threads.sort((x, y) => y.lastAt - x.lastAt);
}

function AgentStrip({ agents, columns }: { agents: Agent[]; columns: number }) {
  const shown: Agent[] = [];
  let used = 0;
  for (const a of agents) {
    const cost = (a.name ?? a.paneId ?? '?').length + a.status.length + 4;
    if (used + cost > columns - 14 && shown.length > 0) break;
    shown.push(a);
    used += cost;
  }
  const overflow = agents.length - shown.length;
  return (
    <Box>
      {shown.map((a, i) => (
        <Text key={a.paneId ?? i}>
          <Text bold color={STATUS_COLOR[a.status] ?? 'gray'}>
            {a.name ?? a.paneId}
          </Text>
          <Text dimColor> {a.status}</Text>
          <Text> </Text>
        </Text>
      ))}
      {overflow > 0 && <Text dimColor>+{overflow}</Text>}
    </Box>
  );
}

function ThreadRow({ t, selected, width }: { t: Thread; selected: boolean; width: number }) {
  const mine = (name: string) => name.toLowerCase() === ME;
  return (
    <Box flexDirection="column" paddingX={1} backgroundColor={selected ? '#243447' : undefined}>
      <Text wrap="truncate">
        {t.needsAttention ? <Text bold color="red">!</Text> : <Text> </Text>}
        <Text bold color={mine(t.a) ? 'cyan' : 'yellow'}>
          {t.a}
        </Text>
        <Text dimColor> ⇄ </Text>
        <Text bold color={mine(t.b) ? 'cyan' : 'yellow'}>
          {t.b}
        </Text>
      </Text>
      <Box justifyContent="space-between">
        <Box width={Math.max(10, width - 8)}>
          <Text wrap="truncate" dimColor={!selected}>
            {' '}
            {t.subject}
          </Text>
        </Box>
        <Text dimColor>{age(Date.now() - t.lastAt)}</Text>
      </Box>
    </Box>
  );
}

function Message({ m, maxLines, width }: { m: Mail; maxLines: number; width: number }) {
  const { text, hidden } = clip(m.body, maxLines, Math.max(24, width - 2));
  const badge = NOTABLE[m.delivery];
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text wrap="truncate">
        <Text bold color={m.from.toLowerCase() === ME ? 'cyan' : 'yellow'}>
          {m.from}
        </Text>
        <Text dimColor> → {m.to} </Text>
        <Text dimColor>
          {clock(m.createdAt)} {m.id}
        </Text>
        {badge && <Text color={badge}> {m.delivery}</Text>}
        {m.requestedBy && <Text color="magenta"> for {m.requestedBy}</Text>}
      </Text>
      <Text>{text}</Text>
      {hidden > 0 && <Text dimColor>… +{hidden} lines · c for full bodies</Text>}
      {m.pointers.length > 0 && <Text color="blue">↳ {m.pointers.join(', ')}</Text>}
      {m.deliveryDetail && ATTENTION.has(m.delivery) && <Text color="red">⚠ {m.deliveryDetail}</Text>}
    </Box>
  );
}

function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [mail, setMail] = useState<Mail[]>([]);
  const [conn, setConn] = useState<'connecting' | 'live' | 'down'>('connecting');
  const [cursor, setCursor] = useState(0);
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [fullBodies, setFullBodies] = useState(false);
  const [follow, setFollow] = useState(true);
  /** Off by default: distinct questions are distinct threads. On, every exchange
   *  between the same two agents reads as one conversation — which is what you
   *  want when a session sent six follow-ups as six new threads. */
  const [byPair, setByPair] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [mode, setMode] = useState<'browse' | 'to' | 'subject' | 'body'>('browse');
  const [confirmDelete, setConfirmDelete] = useState<Thread | null>(null);
  const [draft, setDraft] = useState({ to: '', subject: '', body: '' });
  const [tick, setTick] = useState(0);

  // Ages are relative, so the list must repaint even when nothing arrives.
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let dead = false;
    const connect = () => {
      ws = new WebSocket(`ws://127.0.0.1:${PORT}/events`);
      ws.on('open', () => setConn('live'));
      ws.on('close', () => {
        setConn('down');
        if (!dead) setTimeout(connect, 1500);
      });
      ws.on('error', () => setConn('down'));
      ws.on('message', (buf) => {
        const ev = JSON.parse(String(buf));
        if (ev.type === 'snapshot') {
          setAgents(ev.agents ?? []);
          setMail(ev.mail ?? []);
        } else if (ev.type === 'agents') {
          setAgents(ev.agents ?? []);
        } else if (ev.type === 'mail' || ev.type === 'reply') {
          setMail((ms) => [...ms.filter((x) => x.id !== ev.mail.id), ev.mail]);
        } else if (ev.type === 'deleted') {
          const gone = new Set<string>(ev.ids);
          setMail((ms) => ms.filter((m) => !gone.has(m.id)));
        } else if (ev.type === 'delivery') {
          setMail((ms) =>
            ms.map((x) => (x.id === ev.id ? { ...x, delivery: ev.delivery, deliveryDetail: ev.detail ?? null } : x)),
          );
        } else if (ev.type === 'error') {
          setNote(String(ev.message).slice(0, 80));
        }
      });
    };
    connect();
    return () => {
      dead = true;
      ws?.close();
    };
  }, []);

  const threads = useMemo(() => {
    const built = buildThreads(mail);
    if (!byPair) return built;
    const pairs = new Map<string, Thread>();
    for (const t of built) {
      const key = [t.a.toLowerCase(), t.b.toLowerCase()].sort().join(' ⇄ ');
      const prev = pairs.get(key);
      if (!prev) {
        pairs.set(key, { ...t });
        continue;
      }
      const messages = [...prev.messages, ...t.messages].sort((x, y) => x.createdAt - y.createdAt);
      pairs.set(key, {
        ...prev,
        messages,
        // The newest exchange names the merged conversation.
        subject: prev.lastAt >= t.lastAt ? prev.subject : t.subject,
        lastAt: Math.max(prev.lastAt, t.lastAt),
        needsAttention: prev.needsAttention || t.needsAttention,
        reason: prev.reason ?? t.reason,
      });
    }
    return [...pairs.values()].sort((x, y) => y.lastAt - x.lastAt);
  }, [mail, tick, byPair]);
  const visible = useMemo(() => (onlyAttention ? threads.filter((t) => t.needsAttention) : threads), [threads, onlyAttention]);
  const attentionCount = threads.filter((t) => t.needsAttention).length;

  // Follow mode keeps the newest thread selected as traffic arrives.
  useEffect(() => {
    if (follow) setCursor(0);
  }, [follow, visible.length]);

  const selected = visible[Math.min(cursor, Math.max(visible.length - 1, 0))];
  const columns = stdout?.columns ?? 120;
  const rows = stdout?.rows ?? 40;
  const listWidth = Math.max(28, Math.min(46, Math.floor(columns * 0.34)));
  const detailWidth = columns - listWidth - 6;

  const send = async () => {
    try {
      const r = await fetch(`${BASE}/mail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: ME, requested_by: process.env.AGX_FOR ?? process.env.HERDR_MAIL_FOR ?? undefined, ...draft }),
      });
      const j: any = await r.json();
      setNote(r.ok ? `sent ${j.id} → ${j.to} (${j.delivery})` : `send failed: ${j.error ?? j.reason}`);
    } catch (err) {
      setNote(`send failed: ${String(err)}`);
    }
    setDraft({ to: '', subject: '', body: '' });
    setMode('browse');
  };

  /** Deletes the whole thread: a half-deleted exchange is worse than either. */
  const removeThread = async (t: Thread) => {
    try {
      const r = await fetch(`${BASE}/thread/${encodeURIComponent(t.root.id)}`, { method: 'DELETE' });
      const j: any = await r.json();
      setNote(r.ok ? `deleted ${j.removed.length} message${j.removed.length === 1 ? '' : 's'}` : `delete failed: ${j.error}`);
    } catch (err) {
      setNote(`delete failed: ${String(err)}`);
    }
    setConfirmDelete(null);
    setCursor((c) => Math.max(0, c - 1));
  };

  const unblock = () => {
    const name = selected ? (selected.b.toLowerCase() === ME ? selected.a : selected.b) : null;
    if (!name) return;
    void fetch(`${BASE}/agent/${encodeURIComponent(name)}/send-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: ['esc'] }),
    })
      .then((r) => r.json())
      .then((j: any) => setNote(j.ok ? `esc → ${name} (${j.paneId})` : `unblock failed: ${j.error}`))
      .catch((err) => setNote(`unblock failed: ${String(err)}`));
  };

  useInput((input, key) => {
    if (confirmDelete) {
      if (input === 'y' || input === 'Y') return void removeThread(confirmDelete);
      return setConfirmDelete(null);
    }
    if (mode !== 'browse') {
      if (key.escape) {
        setMode('browse');
        setDraft({ to: '', subject: '', body: '' });
        return;
      }
      if (key.return) {
        if (mode === 'to') return setMode('subject');
        if (mode === 'subject') return setMode('body');
        return void send();
      }
      const field = mode as 'to' | 'subject' | 'body';
      if (key.backspace || key.delete) return setDraft((d) => ({ ...d, [field]: d[field].slice(0, -1) }));
      if (input && !key.ctrl && !key.meta) setDraft((d) => ({ ...d, [field]: d[field] + input }));
      return;
    }

    if (input === 'q' || (key.ctrl && input === 'c')) return exit();
    if (input === 'j' || key.downArrow) {
      setFollow(false);
      return setCursor((c) => Math.min(c + 1, Math.max(visible.length - 1, 0)));
    }
    if (input === 'k' || key.upArrow) {
      setFollow(false);
      return setCursor((c) => Math.max(c - 1, 0));
    }
    if (input === 'f') {
      setCursor(0);
      return setOnlyAttention((v) => !v);
    }
    if (input === 'c') return setFullBodies((v) => !v);
    if (input === 'G') return setFollow((v) => !v);
    if (input === 'p') {
      setCursor(0);
      return setByPair((v) => !v);
    }
    if (input === 'e') return unblock();
    if (input === 'd') {
      if (selected) setConfirmDelete(selected);
      return;
    }
    if (input === 'i') {
      const counterpart = selected ? (selected.b.toLowerCase() === ME ? selected.a : selected.b) : '';
      setDraft({ to: counterpart, subject: '', body: '' });
      return setMode('to');
    }
    if (input === 'r') {
      void fetch(`${BASE}/reload-seed`, { method: 'POST' })
        .then((r) => r.json())
        .then((j: any) => setNote(`seed reloaded: ${j.loaded} sessions`))
        .catch((err) => setNote(`reload failed: ${String(err)}`));
    }
  });

  const maxLines = fullBodies ? 60 : 6;
  const listRows = Math.max(4, rows - 8);
  const listStart = Math.max(0, Math.min(cursor - Math.floor(listRows / 6), Math.max(0, visible.length - Math.floor(listRows / 3))));
  const listSlice = visible.slice(listStart, listStart + Math.floor(listRows / 3));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <AgentStrip agents={agents} columns={columns} />
        <Text color={conn === 'live' ? 'green' : conn === 'down' ? 'red' : 'yellow'}>{conn}</Text>
      </Box>

      <Box>
        <Text dimColor>
          {threads.length} thread{threads.length === 1 ? '' : 's'}
          {attentionCount > 0 ? ' · ' : ''}
        </Text>
        {attentionCount > 0 && <Text color="red">{attentionCount} need attention</Text>}
        <Text> </Text>
        <Text color={onlyAttention ? 'red' : 'gray'} dimColor={!onlyAttention}>
          [{onlyAttention ? 'attention' : 'all'}]
        </Text>
        <Text> </Text>
        <Text color={fullBodies ? 'cyan' : 'gray'} dimColor={!fullBodies}>
          [{fullBodies ? 'full bodies' : 'short bodies'}]
        </Text>
        <Text> </Text>
        <Text color={byPair ? 'cyan' : 'gray'} dimColor={!byPair}>
          [{byPair ? 'by pair' : 'by thread'}]
        </Text>
        {follow && <Text dimColor> [following]</Text>}
      </Box>

      <Box marginTop={1}>
        <Box flexDirection="column" width={listWidth} flexShrink={0} borderStyle="round" borderColor="gray">
          {listSlice.map((t, i) => (
            <ThreadRow key={t.root.id} t={t} selected={listStart + i === cursor} width={listWidth} />
          ))}
          {visible.length === 0 && (
            <Text dimColor>{onlyAttention ? '  nothing needs attention' : '  no threads yet'}</Text>
          )}
        </Box>

        <Box flexDirection="column" flexGrow={1} paddingX={2}>
          {selected ? (
            <>
              <Text bold>{selected.subject}</Text>
              <Text dimColor>
                {selected.messages.length} message{selected.messages.length === 1 ? '' : 's'}
                {selected.answeredIn !== null
                  ? ` · answered in ${age(selected.answeredIn)}`
                  : ' · awaiting reply'}
                {selected.reason ? ` · ${selected.reason}` : ''}
              </Text>
              <Box marginTop={1} flexDirection="column">
                {selected.messages.map((m) => (
                  <Message key={m.id} m={m} maxLines={maxLines} width={detailWidth} />
                ))}
              </Box>
            </>
          ) : (
            <Text dimColor>nothing selected</Text>
          )}
        </Box>
      </Box>

      {confirmDelete && (
        <Box borderStyle="round" borderColor="red" paddingX={1}>
          <Text>
            <Text bold color="red">delete thread</Text>
            <Text dimColor> · {confirmDelete.messages.length} message{confirmDelete.messages.length === 1 ? '' : 's'} · </Text>
            <Text>{confirmDelete.subject}</Text>
            <Text dimColor> — this cannot be undone. </Text>
            <Text bold>y</Text>
            <Text dimColor> to delete, any other key to cancel</Text>
          </Text>
        </Box>
      )}

      {mode !== 'browse' && (
        <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
          <Text bold color="magenta">
            WRITE <Text dimColor>enter = next · esc = cancel</Text>
          </Text>
          <Text>
            <Text dimColor>to </Text>
            {draft.to}
            {mode === 'to' ? '▎' : ''}
          </Text>
          <Text>
            <Text dimColor>subject </Text>
            {draft.subject}
            {mode === 'subject' ? '▎' : ''}
          </Text>
          <Text>
            <Text dimColor>body </Text>
            {draft.body}
            {mode === 'body' ? '▎' : ''}
          </Text>
        </Box>
      )}

      {note && <Text dimColor>{note}</Text>}

      <Text dimColor>
        {mode === 'browse'
          ? 'j/k move · f filter · c bodies · p pair · i write · d delete · e unblock · G follow · q quit'
          : 'typing…'}
      </Text>
    </Box>
  );
}

render(<App />);
