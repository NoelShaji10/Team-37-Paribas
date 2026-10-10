import { logger } from '../utils/logger';

export type FileCategory =
  | 'PAYMENTS'
  | 'BANK_TXNS'
  | 'ACCOUNTS'
  | 'RATES'
  | 'UNKNOWN';

export class ClassifierService {
  async classifyFileType(
    headers: string[],
    originalName?: string
  ): Promise<FileCategory> {
    const normalizedHeaders = headers.map((header) =>
      header.trim().toLowerCase().replace(/\s+/g, '_')
    );

    const fileName = originalName?.toLowerCase() || '';

    logger.debug(
      `[ClassifierService] Classifying file=${fileName}, headers=${normalizedHeaders.join(',')}`
    );

    const scores: Record<FileCategory, number> = {
      PAYMENTS: 0,
      BANK_TXNS: 0,
      ACCOUNTS: 0,
      RATES: 0,
      UNKNOWN: 0,
    };

    // -------------------------
    // Payments
    // -------------------------
    const paymentHeaders = [
      'payment_id',
      'beneficiary',
      'beneficiary_account',
      'ifsc',
      'payment_date',
      'payment_status',
      'amount',
      'currency',
    ];

    scores.PAYMENTS += this.calculateScore(
      normalizedHeaders,
      paymentHeaders
    );

    if (fileName.includes('payment')) {
      scores.PAYMENTS += 3;
    }

    // -------------------------
    // Bank Transactions
    // -------------------------
    const transactionHeaders = [
      'transaction_id',
      'transaction_date',
      'transaction_type',
      'account_number',
      'debit',
      'credit',
      'balance',
      'amount',
    ];

    scores.BANK_TXNS += this.calculateScore(
      normalizedHeaders,
      transactionHeaders
    );

    if (
      fileName.includes('transaction') ||
      fileName.includes('txn')
    ) {
      scores.BANK_TXNS += 3;
    }

    // -------------------------
    // Accounts
    // -------------------------
    const accountHeaders = [
      'account_id',
      'account_number',
      'account_name',
      'customer_id',
      'account_type',
      'account_status',
      'currency',
    ];

    scores.ACCOUNTS += this.calculateScore(
      normalizedHeaders,
      accountHeaders
    );

    if (fileName.includes('account')) {
      scores.ACCOUNTS += 3;
    }

    // -------------------------
    // Rates
    // -------------------------
    const rateHeaders = [
      'currency_code',
      'currency',
      'exchange_rate',
      'rate',
      'effective_date',
      'base_currency',
      'target_currency',
    ];

    scores.RATES += this.calculateScore(
      normalizedHeaders,
      rateHeaders
    );

    if (
      fileName.includes('rate') ||
      fileName.includes('fx')
    ) {
      scores.RATES += 3;
    }

    const result = Object.entries(scores)
      .filter(([type]) => type !== 'UNKNOWN')
      .sort((a, b) => b[1] - a[1])[0];

    if (!result || result[1] < 2) {
      logger.warn(
        `[ClassifierService] Unable to confidently classify file ${originalName || ''}`
      );

      return 'UNKNOWN';
    }

    const fileType = result[0] as FileCategory;

    logger.info(
      `[ClassifierService] Classified file as ${fileType} with score ${result[1]}`
    );

    return fileType;
  }

  private calculateScore(
    headers: string[],
    expectedHeaders: string[]
  ): number {
    let score = 0;

    for (const header of expectedHeaders) {
      if (headers.includes(header)) {
        score++;
      }
    }

    return score;
  }
}

export const classifierService =
  new ClassifierService();