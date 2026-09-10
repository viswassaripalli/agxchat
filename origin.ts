/**
 * Which pane a request physically came from.
 *
 * Everything about a sender used to be self-reported: the client named its own
 * pane and the server checked only that the name agreed with itself, so a
 * consistent lie passed. A receiving session put the requirement precisely —
 * it "has to be stamped by the server from the connection it actually received
 * the mail on … never from a field the client supplies."
 *
 * So: take the peer port off the socket, ask the OS which process owns it,
 * walk that process's ancestry, and compare against the pids herdr reports for
 * each pane. Nothing in that chain is supplied by the caller.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const HERDR = process.env.HERDR_BIN ?? 'herdr';

/** pid that owns the client end of a loopback connection on `port`. */
async function pidForPort(port: number): Promise<number | null> {
  try {
    const { stdout } = await exec('lsof', ['-nP', '-Fpn', `-iTCP:${port}`, '-sTCP:ESTABLISHED']);
    // lsof -F emits records: pPID\nnLOCAL->REMOTE. The client is the end whose
    // LOCAL side is this port; the server's own record has it as REMOTE.
    let pid: number | null = null;
    for (const line of stdout.split('\n')) {
      if (line.startsWith('p')) pid = Number(line.slice(1)) || null;
      else if (line.startsWith('n') && pid) {
        const local = line.slice(1).split('->')[0] ?? '';
        if (local.endsWith(`:${port}`) && pid !== process.pid) return pid;
      }
    }
  } catch {
    /* lsof missing or refused */
  }
  return null;
}

async function ancestry(pid: number, limit = 12): Promise<number[]> {
  const chain: number[] = [];
  let cur = pid;
  for (let i = 0; i < limit && cur > 1; i++) {
    chain.push(cur);
    try {
      const { stdout } = await exec('ps', ['-o', 'ppid=', '-p', String(cur)]);
      const parent = Number(stdout.trim());
      if (!parent || parent === cur) break;
      cur = parent;
    } catch {
      break;
    }
  }
  return chain;
}

/** Every pid herdr associates with a pane: its shell and its foreground set. */
async function panePids(paneId: string): Promise<number[]> {
  try {
    const { stdout } = await exec(HERDR, ['pane', 'process-info', '--pane', paneId], {
      maxBuffer: 4 * 1024 * 1024,
    });
    const info = (JSON.parse(stdout)?.result ?? {}).process_info ?? {};
    const pids: number[] = [];
    if (info.shell_pid) pids.push(Number(info.shell_pid));
    if (info.foreground_process_group_id) pids.push(Number(info.foreground_process_group_id));
    for (const p of info.foreground_processes ?? []) if (p?.pid) pids.push(Number(p.pid));
    return pids.filter(Boolean);
  } catch {
    return [];
  }
}

export async function originPane(remotePort: number | undefined, paneIds: string[]): Promise<string | null> {
  if (!remotePort) return null;
  const clientPid = await pidForPort(remotePort);
  if (!clientPid) return null;
  const chain = new Set(await ancestry(clientPid));
  for (const paneId of paneIds) {
    const pids = await panePids(paneId);
    if (pids.some((p) => chain.has(p))) return paneId;
  }
  return null;
}
