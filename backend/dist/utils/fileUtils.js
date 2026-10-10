"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDirectories = ensureDirectories;
exports.moveFile = moveFile;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * Ensures required storage directories exist.
 */
function ensureDirectories() {
    const dirs = [
        path_1.default.join(__dirname, '../../uploads'),
        path_1.default.join(__dirname, '../../quarantine'),
        path_1.default.join(__dirname, '../../processed')
    ];
    dirs.forEach((dir) => {
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
    });
}
/**
 * Safely moves a file between stages (e.g., uploads -> processed or quarantine).
 */
function moveFile(sourcePath, destinationPath) {
    const targetDir = path_1.default.dirname(destinationPath);
    if (!fs_1.default.existsSync(targetDir)) {
        fs_1.default.mkdirSync(targetDir, { recursive: true });
    }
    fs_1.default.renameSync(sourcePath, destinationPath);
}
