/**
 * Simple console logger with ANSI color support.
 * Uses no external dependencies — just Node's built-in process.stdout.
 */

// Handle EPIPE gracefully when piping to head/tail/etc.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});
process.stderr.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

// ANSI escape codes
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';

function isColorSupported(): boolean {
  return process.stdout.isTTY === true;
}

function colorize(color: string, text: string): string {
  if (!isColorSupported()) return text;
  return `${color}${text}${RESET}`;
}

/** Plain informational message — no prefix. */
export function log(message: string, ...args: unknown[]): void {
  console.log(message, ...args);
}

/** Prefixed with a cyan arrow — used for status updates. */
export function info(message: string, ...args: unknown[]): void {
  const prefix = colorize(CYAN + BOLD, '→');
  console.log(`${prefix} ${message}`, ...args);
}

/** Prefixed with a yellow warning symbol. */
export function warn(message: string, ...args: unknown[]): void {
  const prefix = colorize(YELLOW + BOLD, '⚠');
  console.warn(`${prefix} ${colorize(YELLOW, message)}`, ...args);
}

/** Prefixed with a red error symbol. Writes to stderr. */
export function error(message: string, ...args: unknown[]): void {
  const prefix = colorize(RED + BOLD, '✖');
  console.error(`${prefix} ${colorize(RED, message)}`, ...args);
}

/** Prefixed with a green checkmark — used for successful operations. */
export function success(message: string, ...args: unknown[]): void {
  const prefix = colorize(GREEN + BOLD, '✔');
  console.log(`${prefix} ${colorize(GREEN, message)}`, ...args);
}

/** Dimmed output for verbose/debug detail. */
export function debug(message: string, ...args: unknown[]): void {
  if (process.env['ATTESTING_DEBUG']) {
    const prefix = colorize(DIM, '[debug]');
    console.log(`${prefix} ${colorize(DIM, message)}`, ...args);
  }
}
