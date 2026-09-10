/**
 * herdr CLI adapter.
 *
 * Everything here is FEATURE-DETECTED, not assumed, because the CLI surface
 * differs by version and this was first written against whatever was installed:
 *
 *   · 0.9.x ships `agent prompt <target> <text> [--wait]`, which submits the
 *     text itself. When present it is used, and none of the hand-rolled
 *     injection below runs.
 *   · 0.7.1 has no `agent prompt`. There, injection is `pane send-text` plus
 *     `pane send-keys enter`, and the Enter is dropped if the pane still has a
 *     shell running — hence the read-back verification.
 *
 * Divergences from PLAN.md, confirmed by running the 0.7.1 binary (and NOT
 * claims about herdr in general):
 *   · `cwd` and `foreground_cwd` live on the AGENT record in `agent list`, so no
 *     per-agent `pane get` fan-out is needed.
 *   · Agents carry no unique name: `agent` is the kind ("claude"). The stable
 *     key is `pane_id`; human names come from the mail registry, not herdr.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, dirname, join } from 'node:path';
import { readFile, stat } from 'node:fs/promises';

const exec = promisify(execFile);
const HERDR = process.env.HERDR_BIN ?? 'herdr';

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

export type HerdrAgent = {
  /** herdr's own label, set by `agent start <name>` or `agent rename`. */
  name: string | null;
  kind: string | null;
  status: AgentStatus;
  cwd: string | null;
  foregroundCwd: string | null;
  paneId: string | null;
  tabId: string | null;
  workspaceId: string | null;
  terminalId: string | null;
  sessionId: string | null;
  focused: boolean;
  repo: string | null;
  dir: string | null;
  branch: string | null;
};

/** herdr wraps every CLI result as {id, result: {...}}. */
function unwrap(stdout: string): any {
  const parsed = JSON.parse(stdout);
  return parsed?.result ?? parsed;
}

const STATUSES = new Set(['idle', 'working', 'blocked', 'done', 'unknown']);

/**
 * Defensive on purpose: a renamed upstream field must surface as null rather
 * than as a plausible-looking wrong value, or you debug routing for an hour.
 */
function pickAgentFields(raw: any): HerdrAgent {
  const cwd = typeof raw?.cwd === 'string' ? raw.cwd : null;
  const status = STATUSES.has(raw?.agent_status) ? (raw.agent_status as AgentStatus) : 'unknown';
  return {
    name: typeof raw?.name === 'string' && raw.name ? raw.name : null,
    kind: typeof raw?.agent === 'string' ? raw.agent : null,
    status,
    cwd,
    foregroundCwd: typeof raw?.foreground_cwd === 'string' ? raw.foreground_cwd : null,
    paneId: typeof raw?.pane_id === 'string' ? raw.pane_id : null,
    tabId: typeof raw?.tab_id === 'string' ? raw.tab_id : null,
    workspaceId: typeof raw?.workspace_id === 'string' ? raw.workspace_id : null,
    terminalId: typeof raw?.terminal_id === 'string' ? raw.terminal_id : null,
    sessionId: typeof raw?.agent_session?.value === 'string' ? raw.agent_session.value : null,
    focused: raw?.focused === true,
    repo: cwd ? basename(cwd) : null, // refined to the git root by resolveRepo()
    dir: cwd ? basename(cwd) : null,
    branch: null,
  };
}

/**
 * Walk up to the git root. `basename(cwd)` alone is a bad repo name: the
 * tests session sits in e2e-tests/ui and would advertise itself as
 * "ui", colliding with the two real web-app panes.
 */
async function resolveRepo(cwd: string | null): Promise<{ root: string | null; repo: string | null }> {
  if (!cwd) return { root: null, repo: null };
  let dir = cwd;
  for (let up = 0; up < 12; up++) {
    try {
      await stat(join(dir, '.git'));
      return { root: dir, repo: basename(dir) };
    } catch {
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return { root: null, repo: basename(cwd) };
}

/** Read HEAD off disk instead of spawning git — this runs on a 1s poll. */
async function readBranch(cwd: string | null): Promise<string | null> {
  if (!cwd) return null;
  try {
    let gitDir = join(cwd, '.git');
    const dotGit = await readFile(gitDir, 'utf8').catch(() => null);
    if (dotGit) {
      const m = dotGit.match(/^gitdir:\s*(.+)$/m); // worktree: .git is a file
      if (!m) return null;
      gitDir = m[1].trim();
    }
    const head = await readFile(join(gitDir, 'HEAD'), 'utf8');
    const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/m);
    return ref ? ref[1].trim() : head.trim().slice(0, 8);
  } catch {
    return null;
  }
}

export async function listAgents(withBranch = true): Promise<HerdrAgent[]> {
  const { stdout } = await exec(HERDR, ['agent', 'list'], { maxBuffer: 8 * 1024 * 1024 });
  const agents: any[] = unwrap(stdout)?.agents ?? [];
  const mapped = agents.map(pickAgentFields);
  return Promise.all(
    mapped.map(async (a) => {
      const { root, repo } = await resolveRepo(a.cwd);
      return { ...a, repo, branch: withBranch ? await readBranch(root ?? a.cwd) : null };
    }),
  );
}

export async function readPane(paneId: string, lines = 30): Promise<string> {
  const { stdout } = await exec(HERDR, ['pane', 'read', paneId, '--lines', String(lines)], {
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The wake-up. Carries an id only, never a payload — see the payload-by-pointer
 * invariant.
 *
 * `pane run` alone is NOT reliable: observed on a live claude pane that still
 * had a shell running, the text landed in the prompt box and the Enter was
 * swallowed, so the mail sat there unsent. So: type, submit, then read the pane
 * back and submit once more if the text is still sitting in the prompt.
 */
/**
 * Does this herdr have `agent prompt`? Asked once, from --help rather than a
 * version comparison: a feature check survives version schemes changing.
 */
let agentPromptSupport: boolean | null = null;

export async function supportsAgentPrompt(): Promise<boolean> {
  if (agentPromptSupport !== null) return agentPromptSupport;
  try {
    const { stdout } = await exec(HERDR, ['agent', '--help']);
    // Two help formats seen in the wild: 0.7.x prints full signatures
    // ("herdr agent prompt <target> <text>"), 0.9.x prints a Commands block of
    // bare names ("  prompt     Submit a prompt to an agent"). Matching only
    // the first reported "not supported" on a herdr that supports it.
    agentPromptSupport = /\bagent prompt\b/.test(stdout) || /^\s*prompt\s+\S/m.test(stdout);
  } catch {
    agentPromptSupport = false;
  }
  return agentPromptSupport;
}

export async function nudge(paneId: string, text: string): Promise<void> {
  // Test affordance: exercise routing and the wait guards without writing into
  // a live agent's TTY.
  if (process.env.AGX_DRY_NUDGE ?? process.env.HERDR_MAIL_DRY_NUDGE === '1') {
    console.log(`[dry-nudge] ${paneId} <- ${text}`);
    return;
  }

  // Prefer herdr's own delivery where it exists: it owns the terminal, so it
  // knows when the text was accepted. Our send-text + Enter + read-back dance
  // exists only because 0.7.1 has no such command.
  if ((process.env.AGX_FORCE_TTY_NUDGE ?? '0') !== '1' && (await supportsAgentPrompt())) {
    await exec(HERDR, ['agent', 'prompt', paneId, text]);
    return;
  }

  await exec(HERDR, ['pane', 'send-text', paneId, text]);
  await sleep(250);
  await exec(HERDR, ['pane', 'send-keys', paneId, 'enter']);

  if (process.env.AGX_NUDGE_VERIFY ?? process.env.HERDR_MAIL_NUDGE_VERIFY === '0') return;

  // The tail of the nudge is a stable needle: if it is still on screen next to
  // the prompt marker, the submit did not take.
  const needle = text.slice(-40).trim();
  for (let attempt = 0; attempt < 2; attempt++) {
    await sleep(1200);
    const screen = await readPane(paneId, 12).catch(() => '');
    const stuck = screen.includes(needle) && /❯[^\n]*\S/.test(screen);
    if (!stuck) return;
    await exec(HERDR, ['pane', 'send-keys', paneId, 'enter']);
  }
}

export async function sendKeys(paneId: string, keys: string[]): Promise<void> {
  await exec(HERDR, ['pane', 'send-keys', paneId, ...keys]);
}

export async function herdrVersion(): Promise<string> {
  const { stdout } = await exec(HERDR, ['--version']);
  return stdout.trim();
}
