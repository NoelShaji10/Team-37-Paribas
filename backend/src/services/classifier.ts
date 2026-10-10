import { logger } from '../utils/logger';

export type FileCategory =
  | 'PAYMENTS'
  | 'BANK_TRANSACTIONS'
  | 'ACCOUNTS'
  | 'RATES'
  | 'UNKNOWN';

export class ClassifierService {
  async classifyFileType(
    headers: string[],
    originalName?: string
  ): Promise<FileCategory> {
    const normalizedHeaders = headers.map((header) =>
      header
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
    );

    const fileName = originalName?.toLowerCase() || '';

    logger.debug(
      `[ClassifierService] Classifying file=${fileName}, headers=${normalizedHeaders.join(',')}`
    );

    const scores: Record<FileCategory, number> = {
      PAYMENTS: 0,
      BANK_TRANSACTIONS: 0,
      ACCOUNTS: 0,
      RATES: 0,
      UNKNOWN: 0,
    };

    // Payments
    const paymentHeaders = [
      'payment_id',
      'beneficiary',
      'beneficiary_account',
      'account_number',
      'ifsc',
      'ifsc_code',
      'payment_date',
      'payment_method',
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

    // Bank Transactions
    const transactionHeaders = [
      'transaction_id',
      'transaction_date',
      'transaction_type',
      'account_number',
      'description',
      'ifsc',
      'ifsc_code',
      'debit',
      'credit',
      'balance',
      'amount',
      'currency',
    ];

    scores.BANK_TRANSACTIONS += this.calculateScore(
      normalizedHeaders,
      transactionHeaders
    );

    if (
      fileName.includes('transaction') ||
      fileName.includes('transactions') ||
      fileName.includes('txn')
    ) {
      scores.BANK_TRANSACTIONS += 3;
    }

    // Accounts
    const accountHeaders = [
      'account_id',
      'account_number',
      'account_name',
      'account_holder_name',
      'customer_id',
      'account_type',
      'account_status',
      'balance',
      'currency',
      'ifsc',
      'ifsc_code',
    ];

    scores.ACCOUNTS += this.calculateScore(
      normalizedHeaders,
      accountHeaders
    );

    if (fileName.includes('account')) {
      scores.ACCOUNTS += 3;
    }

    // Rates
    const rateHeaders = [
      'rate_id',
      'currency_pair',
      'currency_code',
      'currency',
      'exchange_rate',
      'rate',
      'rate_date',
      'effective_date',
      'rate_type',
      'base_currency',
      'target_currency',
    ];

    scores.RATES += this.calculateScore(
      normalizedHeaders,
      rateHeaders
    );

    if (
      fileName.includes('rate') ||
      fileName.includes('rates') ||
      fileName.includes('fx') ||
      fileName.includes('exchange')
    ) {
      scores.RATES += 3;
    }

    const rankedResults = Object.entries(scores)
      .filter(([type]) => type !== 'UNKNOWN')
      .sort((a, b) => b[1] - a[1]);

    const bestMatch = rankedResults[0];

    if (!bestMatch || bestMatch[1] < 2) {
      logger.warn(
        `[ClassifierService] Unable to confidently classify file=${originalName || 'unknown'}`
      );

      return 'UNKNOWN';
    }

    const fileType = bestMatch[0] as FileCategory;

    logger.info(
      `[ClassifierService] Classified file=${originalName || 'unknown'} as ${fileType} with score=${bestMatch[1]}`
    );

    return fileType;
  }

  private calculateScore(
    headers: string[],
    expectedHeaders: string[]
  ): number {
    let score = 0;

    for (const expectedHeader of expectedHeaders) {
      if (headers.includes(expectedHeader)) {
        score++;
      }
    }

    return score;
  }
}

export const classifierService =
  new ClassifierService();