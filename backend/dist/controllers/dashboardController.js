"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardSummary = void 0;
const logger_1 = require("../utils/logger");
const getDashboardSummary = async (_req, res) => {
    try {
        const summary = {
            totalFiles: 24,
            activeProcessing: 3,
            totalRejections: 14,
            totalAnomalies: 2,
            systemThroughput: 1450 // rows per second
        };
        res.json({ success: true, data: summary });
    }
    catch (error) {
        logger_1.logger.error('[DashboardController] getDashboardSummary error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
exports.getDashboardSummary = getDashboardSummary;
