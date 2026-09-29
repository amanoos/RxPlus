/**
 * The admin commands behind scripts/user.ts, with the terminal and database
 * passed in so they can be tested. Never prints passwords or hashes.
 */
import { hashPassword } from '../utils/password';
import { UsernameTakenError, type UsersRepository } from './repository';
import { MIN_PASSWORD_LENGTH, normalizeUsername, USERNAME_RULES } from './username';

export interface CliIo {
  /** Prompts twice without echoing on a terminal; reads one line from a pipe. */
  readPassword(): Promise<string>;
  /** One line of input after a question. */
  ask(question: string): Promise<string>;
  out(line: string): void;
  err(line: string): void;
}

export const USAGE = `Usage: user <command>
  add <username>              create an account (prompts for the password)
  reset-password <username>   set a new password; signs the user out everywhere
  remove <username> [--yes]   delete the account and its data (--yes skips the prompt)
  list                        show every account`;

async function newPasswordHash(io: CliIo): Promise<string> {
  const password = await io.readPassword();
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  return hashPassword(password);
}

/** Runs one command; returns the process exit code. */
export async function runUserCommand(
  argv: string[],
  repo: UsersRepository,
  io: CliIo,
): Promise<number> {
  const [command, rawName, ...flags] = argv;
  const unknownFlag = flags.find((f) => !(command === 'remove' && f === '--yes'));
  if (unknownFlag) {
    io.err(`Unknown option: ${unknownFlag}\n\n${USAGE}`);
    return 1;
  }

  if (command === 'list') {
    const users = await repo.list();
    if (!users.length) io.out('No accounts yet.');
    for (const u of users) {
      // The server's local date (TZ), as YYYY-MM-DD.
      io.out(`${u.username}\tcreated ${u.createdAt.toLocaleDateString('en-CA')}`);
    }
    return 0;
  }

  if (!['add', 'reset-password', 'remove'].includes(command ?? '') || !rawName) {
    io.err(USAGE);
    return 1;
  }
  const username = normalizeUsername(rawName);
  if (!username) {
    io.err(USERNAME_RULES);
    return 1;
  }

  try {
    if (command === 'add') {
      if (await repo.findByUsername(username)) {
        throw new UsernameTakenError(`The username "${username}" already exists.`);
      }
      await repo.create(username, await newPasswordHash(io));
      io.out(`Created ${username}.`);
      return 0;
    }

    if (!(await repo.findByUsername(username))) {
      io.err(`No account named "${username}".`);
      return 1;
    }

    if (command === 'reset-password') {
      await repo.resetPassword(username, await newPasswordHash(io));
      io.out(`New password set for ${username}; their other sessions are signed out.`);
      return 0;
    }

    // remove
    if (!flags.includes('--yes')) {
      const typed = await io.ask(
        `This deletes ${username} and their data. Type the username to confirm: `,
      );
      if (typed.trim().toLowerCase() !== username) {
        io.err('Not removed: the name did not match.');
        return 1;
      }
    }
    await repo.remove(username);
    io.out(`Removed ${username}.`);
    return 0;
  } catch (error) {
    io.err((error as Error).message);
    return 1;
  }
}
