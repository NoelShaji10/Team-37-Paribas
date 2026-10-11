import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is missing. Add it to backend/.env'
  );
}

const adapter = new PrismaPg({
  connectionString,
});

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const prisma =
  global.__prisma ??
  new PrismaClient({
    adapter,
    // SQL query logging is very noisy (every insert of every batch).
    // Turn it on only when debugging: PRISMA_LOG_QUERIES=true in .env
    log:
      process.env.PRISMA_LOG_QUERIES === 'true'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

export { prisma };
export default prisma;