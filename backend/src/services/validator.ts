import { logger } from '../utils/logger';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export class ValidatorService {
  async validateRecord(
    record: Record<string, string>
  ): Promise<ValidationResult> {
    const errors: string[] = [];

    // Empty row check
    const hasData = Object.values(record).some(
      (value) => value?.trim() !== ''
    );

    if (!hasData) {
      errors.push('Empty record');
      return {
        isValid: false,
        errors,
      };
    }

    // -------------------------
    // Amount validation
    // -------------------------
    if ('amount' in record) {
      const amount = Number(record.amount);

      if (
        record.amount.trim() === '' ||
        Number.isNaN(amount)
      ) {
        errors.push(
          `Invalid amount: ${record.amount}`
        );
      }

      if (!Number.isNaN(amount) && amount < 0) {
        errors.push(
          `Amount cannot be negative: ${record.amount}`
        );
      }
    }

    // -------------------------
    // Currency validation
    // -------------------------
    if ('currency' in record) {
      const currency = record.currency
        ?.trim()
        .toUpperCase();

      if (!/^[A-Z]{3}$/.test(currency)) {
        errors.push(
          `Invalid currency code: ${record.currency}`
        );
      }
    }

    // -------------------------
    // IFSC validation
    // Example: HDFC0001234
    // -------------------------
    if ('ifsc' in record) {
      const ifsc = record.ifsc
        ?.trim()
        .toUpperCase();

      const ifscPattern =
        /^[A-Z]{4}0[A-Z0-9]{6}$/;

      if (!ifscPattern.test(ifsc)) {
        errors.push(
          `Invalid IFSC format: ${record.ifsc}`
        );
      }
    }

    // -------------------------
    // Date validation
    // -------------------------
    const dateFields = [
      'transaction_date',
      'payment_date',
      'effective_date',
      'date',
    ];

    for (const field of dateFields) {
      if (field in record && record[field]) {
        const value = record[field].trim();

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
          errors.push(
            `Invalid date in ${field}: ${value}`
          );
        }
      }
    }

    // -------------------------
    // Account number validation
    // -------------------------
    if ('account_number' in record) {
      const accountNumber =
        record.account_number?.trim();

      if (!accountNumber) {
        errors.push(
          'Account number is missing'
        );
      }
    }

    // -------------------------
    // Transaction ID validation
    // -------------------------
    if ('transaction_id' in record) {
      if (!record.transaction_id?.trim()) {
        errors.push(
          'Transaction ID is missing'
        );
      }
    }

    const isValid = errors.length === 0;

    logger.debug(
      `[ValidatorService] Record validation: ${
        isValid ? 'VALID' : 'INVALID'
      }`
    );

    return {
      isValid,
      errors,
    };
  }
}

export const validatorService =
  new ValidatorService();