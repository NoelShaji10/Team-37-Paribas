"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateFileChecksum = calculateFileChecksum;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
/**
 * Calculates SHA256 checksum for deduplication and integrity check.
 */
function calculateFileChecksum(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto_1.default.createHash('sha256');
        const stream = fs_1.default.createReadStream(filePath);
        stream.on('data', (data) => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', (err) => reject(err));
    });
}
