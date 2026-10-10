"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mlClient = exports.MLClient = void 0;
const logger_1 = require("../utils/logger");
class MLClient {
    baseUrl;
    timeoutMs = 5000;
    constructor() {
        this.baseUrl =
            process.env.ML_SERVICE_URL || 'http://localhost:8000';
    }
    /**
     * Check whether a record looks anomalous.
     */
    async checkAnomaly(fileId, features) {
        try {
            logger_1.logger.debug(`[MLClient] Checking anomaly for file=${fileId}`);
            const response = await this.post('/anomaly/detect', {
                fileId,
                features,
            });
            return response;
        }
        catch (error) {
            logger_1.logger.warn(`[MLClient] Anomaly service unavailable for file=${fileId}`, error);
            // Don't fail entire file if ML service is temporarily unavailable
            return {
                isAnomaly: false,
                score: 0,
            };
        }
    }
    /**
     * Predict how long a file will take to process.
     */
    async predictProcessingTime(fileSizeMb, rowCount) {
        try {
            const response = await this.post('/prediction/predict-time', {
                fileSizeMb,
                rowCount,
            });
            return response.estimatedSeconds;
        }
        catch (error) {
            logger_1.logger.warn('[MLClient] Processing-time prediction unavailable', error);
            // Simple fallback if Python service is down
            return Math.max(1, Math.ceil(rowCount / 500));
        }
    }
    /**
     * Ask ML service for a correction suggestion.
     *
     * Example:
     * invalid IFSC -> closest valid IFSC
     * bad currency -> suggested currency
     */
    async suggestFix(fieldName, originalValue, context = {}) {
        try {
            return await this.post('/suggestions/suggest-fix', {
                fieldName,
                originalValue,
                context,
            });
        }
        catch (error) {
            logger_1.logger.warn(`[MLClient] Suggestion service unavailable for field=${fieldName}`, error);
            return {
                suggestedValue: null,
                confidence: 0,
            };
        }
    }
    /**
     * Shared POST helper with timeout.
     */
    async post(endpoint, body) {
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
        }, this.timeoutMs);
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`ML service returned ${response.status} ${response.statusText}`);
            }
            return (await response.json());
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
exports.MLClient = MLClient;
exports.mlClient = new MLClient();
