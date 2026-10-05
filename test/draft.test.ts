/**
 * unsentDraft has been wrong three times, each time in the same direction:
 * something that was not a person typing was read as a person typing, and mail
 * to that pane stopped. The cost is invisible — delivery reports "someone is
 * typing" and the sender believes it — so the cases live here rather than in
 * anyone's memory.
 *
 *   npm test
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCREEN = join(tmpdir(), `agx-draft-${process.pid}.txt`);
process.env.HERDR_BIN = new URL('./stub-herdr', import.meta.url).pathname;
process.env.AGX_TEST_SCREEN = SCREEN;

const { unsentDraft } = await import('../herdr.ts');

const CURSOR = '█';
let failed = 0;

async function check(name: string, screen: string, expected: string | null) {
  writeFileSync(SCREEN, screen);
  const got = await unsentDraft('t1:p1');
  const ok = expected === null ? got === null : got === expected;
  if (!ok) failed++;
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${ok ? '' : `\n        want ${JSON.stringify(expected)}\n        got  ${JSON.stringify(got)}`}`);
}

const frame = (prompt: string) =>
  ['', '  some earlier output', '─'.repeat(60), prompt, '─'.repeat(60), '  auto mode on'].join('\n');

console.log('unsentDraft');

await check('empty prompt is not a draft', frame('❯ '), null);
await check('a lone cursor is not a draft', frame(`❯ ${CURSOR}`), null);

// Hint text an agent renders inside its own empty prompt. Both of these held
// real mail: claude's until the staleness escape, codex's the same.
await check('claude placeholder', frame('❯ Try "edit <filepath> to..."'), null);
await check('codex placeholder', frame('❯ Ask Codex to do anything'), null);

// A completion offered from history. The giveaway is the cursor: still at
// column zero, because nothing was typed.
await check(
  'suggestion, cursor at the front',
  frame(`❯ ${CURSOR}eanwhile find where web reads the 422 body`),
  null,
);

// The case the guard exists for. Submitting here destroys work nobody sent.
await check(
  'real draft, cursor at the end',
  frame(`❯ half a sentence someone is still${CURSOR}`),
  `half a sentence someone is still${CURSOR}`,
);
await check('real draft, no cursor drawn', frame('❯ ask api about the 422 shape'), 'ask api about the 422 shape');

// Text that does not change is not being written. Ten minutes by default; the
// window is lowered here so the test does not take ten minutes.
process.env.AGX_DRAFT_STALE_MS = '1';
const { unsentDraft: freshDraft } = await import(`../herdr.ts?stale=${Date.now()}`);
writeFileSync(SCREEN, frame('❯ parked text nobody is editing'));
const first = await freshDraft('t1:p1');
await new Promise((r) => setTimeout(r, 30));
const second = await freshDraft('t1:p1');
const staleOk = first === 'parked text nobody is editing' && second === null;
if (!staleOk) failed++;
console.log(
  `${staleOk ? '  ok  ' : 'FAIL  '}unchanged text stops blocking once stale${
    staleOk ? '' : `\n        first ${JSON.stringify(first)} second ${JSON.stringify(second)}`
  }`,
);

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
