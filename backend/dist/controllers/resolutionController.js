"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveRejection = exports.getPendingRejections = void 0;
const logger_1 = require("../utils/logger");
const getPendingRejections = async (_req, res) => {
    try {
        const rejections = [
            {
                id: 'rej_1',
                fileId: 'file_mock_1',
                rowNumber: 42,
                rawData: 'TXN9004,INVALID_ACC,KKBK0000321,INR,1200.00,2026-10-10T10:00:15Z',
                reason: 'Account number INVALID_ACC does not exist in master records',
                status: 'PENDING'
            },
            {
                id: 'rej_2',
                fileId: 'file_mock_1',
                rowNumber: 108,
                rawData: 'TXN9005,ACC100004,WRONG_IFSC,GBP,53000.00,2026-10-10T10:00:20Z',
                reason: 'Invalid IFSC format: WRONG_IFSC',
                status: 'PENDING'
            }
        ];
        res.json({ success: true, data: rejections });
    }
    catch (error) {
        logger_1.logger.error('[ResolutionController] getPendingRejections error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
exports.getPendingRejections = getPendingRejections;
const resolveRejection = async (req, res) => {
    try {
        const { id } = req.params;
        const { action, correctedData, notes } = req.body;
        logger_1.logger.info(`[ResolutionController] Resolving rejection ${id} with action: ${action}`);
        res.json({
            success: true,
            data: {
                id,
                action,
                correctedData,
                notes,
                status: 'RESOLVED',
                resolvedAt: new Date().toISOString()
            }
        });
    }
    catch (error) {
        logger_1.logger.error('[ResolutionController] resolveRejection error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
exports.resolveRejection = resolveRejection;
