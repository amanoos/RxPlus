// Prints an APP_PASSWORD_HASH for .env. Usage: npm run hash-password
// Interactive: prompts twice without echoing. Piped: reads one line from stdin.
import { createInterface } from 'node:readline/promises';

import { hashPassword } from '../src/server/utils/password.ts';

const MIN_LENGTH = 12;

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

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) return line;
    return '';
  }
  const first = await promptHidden('Password: ');
  const second = await promptHidden('Repeat password: ');
  if (first !== second) throw new Error('Passwords do not match.');
  return first;
}

try {
  const password = await readPassword();
  if (password.length < MIN_LENGTH) {
    throw new Error(`Password must be at least ${MIN_LENGTH} characters.`);
  }
  console.log(`\nAdd this line to .env:\n\nAPP_PASSWORD_HASH=${await hashPassword(password)}\n`);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
