/**
 * Minimal leveled logger.
 *
 * LOG_LEVEL in backend/.env controls how much is printed:
 *   error | warn | info (default) | debug
 *
 * info  -> one-line milestones per file (start, every 10%, done)
 * debug -> also every 500-row batch, every ML call, every DB insert
 *          and every rejected row. Very noisy on large files.
 */
type Level = 'error' | 'warn' | 'info' | 'debug';

const ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };

function currentLevel(): number {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase() as Level;
  return ORDER[raw] ?? ORDER.info;
}

const enabled = (level: Level) => ORDER[level] <= currentLevel();
const stamp = () => new Date().toISOString();

export const logger = {
  info: (msg: string, ...args: unknown[]) => {
    if (enabled('info')) console.log(`[INFO] [${stamp()}] ${msg}`, ...args);
  },
  warn: (msg: string, ...args: unknown[]) => {
    if (enabled('warn')) console.warn(`[WARN] [${stamp()}] ${msg}`, ...args);
  },
  error: (msg: string, ...args: unknown[]) => {
    if (enabled('error')) console.error(`[ERROR] [${stamp()}] ${msg}`, ...args);
  },
  debug: (msg: string, ...args: unknown[]) => {
    if (enabled('debug')) console.log(`[DEBUG] [${stamp()}] ${msg}`, ...args);
  },
};
