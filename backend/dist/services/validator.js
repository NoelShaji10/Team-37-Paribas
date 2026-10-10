"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validatorService = exports.ValidatorService = void 0;
const logger_1 = require("../utils/logger");
class ValidatorService {
    async validateRecord(record) {
        const issues = [];
        /**
         * Helper for adding validation issues.
         */
        const addIssue = (columnName, cellValue, errorMessage, errorType) => {
            issues.push({
                columnName,
                cellValue,
                errorMessage,
                errorType,
            });
        };
        // --------------------------------------------------
        // Empty row
        // --------------------------------------------------
        const hasData = Object.values(record).some((value) => value?.trim() !== '');
        if (!hasData) {
            addIssue('row', undefined, 'Empty record', 'EMPTY_RECORD');
            return {
                isValid: false,
                errors: ['Empty record'],
                issues,
            };
        }
        // --------------------------------------------------
        // Amount
        // --------------------------------------------------
        if ('amount' in record) {
            const rawAmount = record.amount?.trim();
            const amount = Number(rawAmount);
            if (!rawAmount ||
                Number.isNaN(amount)) {
                addIssue('amount', record.amount, `Invalid amount: ${record.amount}`, 'INVALID_AMOUNT');
            }
            else if (amount < 0) {
                addIssue('amount', record.amount, `Amount cannot be negative: ${record.amount}`, 'NEGATIVE_AMOUNT');
            }
        }
        // --------------------------------------------------
        // Currency
        // --------------------------------------------------
        if ('currency' in record) {
            const currency = record.currency?.trim().toUpperCase();
            if (!/^[A-Z]{3}$/.test(currency || '')) {
                addIssue('currency', record.currency, `Invalid currency code: ${record.currency}`, 'INVALID_CURRENCY');
            }
        }
        // --------------------------------------------------
        // IFSC
        // Supports both possible CSV column names.
        // --------------------------------------------------
        const ifscColumn = 'ifsc_code' in record
            ? 'ifsc_code'
            : 'ifsc' in record
                ? 'ifsc'
                : null;
        if (ifscColumn) {
            const rawIfsc = record[ifscColumn];
            const ifsc = rawIfsc?.trim().toUpperCase();
            const ifscPattern = /^[A-Z]{4}0[A-Z0-9]{6}$/;
            if (ifsc &&
                !ifscPattern.test(ifsc)) {
                addIssue(ifscColumn, rawIfsc, `Invalid IFSC format: ${rawIfsc}`, 'INVALID_IFSC');
            }
        }
        // --------------------------------------------------
        // Date fields
        // --------------------------------------------------
        const dateFields = [
            'transaction_date',
            'payment_date',
            'effective_date',
            'rate_date',
            'date',
        ];
        for (const field of dateFields) {
            if (!(field in record)) {
                continue;
            }
            const rawValue = record[field]?.trim();
            if (!rawValue) {
                addIssue(field, record[field], `${field} is missing`, 'MISSING_DATE');
                continue;
            }
            const parsedDate = new Date(rawValue);
            if (Number.isNaN(parsedDate.getTime())) {
                addIssue(field, rawValue, `Invalid date in ${field}: ${rawValue}`, 'INVALID_DATE');
            }
        }
        // --------------------------------------------------
        // Account number
        // --------------------------------------------------
        if ('account_number' in record) {
            const accountNumber = record.account_number?.trim();
            if (!accountNumber) {
                addIssue('account_number', record.account_number, 'Account number is missing', 'MISSING_ACCOUNT_NUMBER');
            }
        }
        // --------------------------------------------------
        // Transaction ID
        // --------------------------------------------------
        if ('transaction_id' in record) {
            const transactionId = record.transaction_id?.trim();
            if (!transactionId) {
                addIssue('transaction_id', record.transaction_id, 'Transaction ID is missing', 'MISSING_TRANSACTION_ID');
            }
        }
        // --------------------------------------------------
        // Payment ID
        // --------------------------------------------------
        if ('payment_id' in record) {
            const paymentId = record.payment_id?.trim();
            if (!paymentId) {
                addIssue('payment_id', record.payment_id, 'Payment ID is missing', 'MISSING_PAYMENT_ID');
            }
        }
        // --------------------------------------------------
        // Rate ID
        // --------------------------------------------------
        if ('rate_id' in record) {
            const rateId = record.rate_id?.trim();
            if (!rateId) {
                addIssue('rate_id', record.rate_id, 'Rate ID is missing', 'MISSING_RATE_ID');
            }
        }
        // Convert structured issues into old string format
        const errors = issues.map((issue) => issue.errorMessage);
        const isValid = issues.length === 0;
        logger_1.logger.debug(`[ValidatorService] Record validation: ${isValid
            ? 'VALID'
            : `INVALID (${issues.length} issues)`}`);
        return {
            isValid,
            errors,
            issues,
        };
    }
}
exports.ValidatorService = ValidatorService;
exports.validatorService = new ValidatorService();
