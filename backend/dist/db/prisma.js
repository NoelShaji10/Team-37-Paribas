"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
require("dotenv/config");
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL is missing. Add it to backend/.env');
}
const adapter = new adapter_pg_1.PrismaPg({
    connectionString,
});
const prisma = global.__prisma ??
    new client_1.PrismaClient({
        adapter,
        log: process.env.NODE_ENV === 'development'
            ? ['query', 'warn', 'error']
            : ['error'],
    });
exports.prisma = prisma;
if (process.env.NODE_ENV !== 'production') {
    global.__prisma = prisma;
}
exports.default = prisma;
