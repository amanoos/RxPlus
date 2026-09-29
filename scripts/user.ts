// Manages accounts (bundled to dist/user.cjs).
// Dev: npm run user -- <command> · Docker: docker compose exec app node dist/user.cjs <command>
// Interactive: prompts without echoing. Piped: reads one line per answer from stdin.
import { createInterface } from 'node:readline/promises';

import { runUserCommand, type CliIo } from '../src/server/accounts/cli';
import { createUsersRepository } from '../src/server/accounts/repository';
import { createDb } from '../src/server/db/client';

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let input = '';
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          return resolve(input);
        }
        if (char === '\u0003') {
          stdin.setRawMode(false);
          return reject(new Error('Cancelled'));
        }
        if (char === '\u007f' || char === '\b') input = input.slice(0, -1);
        else input += char;
      }
    };
    stdin.on('data', onData);
  });
}

// One reader for the whole run, so piped answers are taken line by line.
const piped = process.stdin.isTTY
  ? null
  : createInterface({ input: process.stdin })[Symbol.asyncIterator]();

async function readLine(question: string): Promise<string> {
  if (piped) {
    const next = await piped.next();
    return next.done ? '' : next.value;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

const io: CliIo = {
  async readPassword() {
    if (piped) return readLine('');
    const first = await promptHidden('Password: ');
    const second = await promptHidden('Repeat password: ');
    if (first !== second) throw new Error('Passwords do not match.');
    return first;
  },
  ask: readLine,
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

async function main(): Promise<number> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');
  const { db, pool } = createDb(url);
  try {
    return await runUserCommand(process.argv.slice(2), createUsersRepository(db), io);
  } finally {
    await pool.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(`[user] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
