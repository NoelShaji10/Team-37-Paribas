import { Prisma } from '@prisma/client';

import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';

type RawRecord = Record<string, unknown>;

export class LoaderService {
  /**
   * Saves validated records into the correct target table.
   *
   * ProcessingFile.fileType decides where the records go:
   *
   * ACCOUNTS
   * -> Account
   *
   * BANK_TRANSACTIONS
   * -> BankTransaction
   *
   * PAYMENTS
   * -> Payment
   *
   * RATES
   * -> ExchangeRate
   */
  async loadValidRecords(
    fileId: string,
    records: RawRecord[]
  ): Promise<number> {
    if (records.length === 0) {
      return 0;
    }

    const file =
      await prisma.processingFile.findUnique({
        where: {
          id: fileId,
        },
        select: {
          fileType: true,
        },
      });

    if (!file) {
      throw new Error(
        `Processing file not found: ${fileId}`
      );
    }

    logger.info(
      `[LoaderService] Loading ${records.length} records | ` +
        `file=${fileId} | type=${file.fileType}`
    );

    switch (file.fileType) {
      case 'ACCOUNTS':
        return this.loadAccounts(
          fileId,
          records
        );

      case 'BANK_TRANSACTIONS':
        return this.loadBankTransactions(
          fileId,
          records
        );

      case 'PAYMENTS':
        return this.loadPayments(
          fileId,
          records
        );

      case 'RATES':
        return this.loadRates(
          fileId,
          records
        );

      default:
        throw new Error(
          `Unsupported file type: ${file.fileType}`
        );
    }
  }

  // ==================================================
  // ACCOUNTS
  // ==================================================

  private async loadAccounts(
    fileId: string,
    records: RawRecord[]
  ): Promise<number> {
    const data: Prisma.AccountCreateManyInput[] =
      records.map((record) => ({
        accountNumber:
          this.requiredString(
            record,
            ['account_number'],
            'account_number'
          ),

        accountHolderName:
          this.requiredString(
            record,
            [
              'account_holder_name',
              'account_name',
            ],
            'account_holder_name'
          ),

        accountType:
          this.requiredString(
            record,
            ['account_type'],
            'account_type'
          ),

        balance:
          this.requiredNumber(
            record,
            ['balance'],
            'balance'
          ),

        currency:
          this.requiredString(
            record,
            ['currency'],
            'currency'
          ).toUpperCase(),

        accountStatus:
          this.requiredString(
            record,
            ['account_status'],
            'account_status'
          ),

        ifscCode:
          this.requiredString(
            record,
            ['ifsc_code', 'ifsc'],
            'ifsc_code'
          ).toUpperCase(),

        fileId,
      }));

    const result =
      await prisma.account.createMany({
        data,
        skipDuplicates: true,
      });

    logger.info(
      `[LoaderService] Inserted ${result.count} accounts | file=${fileId}`
    );

    return result.count;
  }

  // ==================================================
  // BANK TRANSACTIONS
  // ==================================================

  private async loadBankTransactions(
    fileId: string,
    records: RawRecord[]
  ): Promise<number> {
    const data: Prisma.BankTransactionCreateManyInput[] =
      records.map((record) => ({
        transactionId:
          this.requiredString(
            record,
            ['transaction_id'],
            'transaction_id'
          ),

        accountNumber:
          this.requiredString(
            record,
            ['account_number'],
            'account_number'
          ),

        transactionDate:
          this.requiredDate(
            record,
            ['transaction_date'],
            'transaction_date'
          ),

        transactionType:
          this.requiredString(
            record,
            ['transaction_type'],
            'transaction_type'
          ),

        amount:
          this.requiredNumber(
            record,
            ['amount'],
            'amount'
          ),

        currency:
          this.requiredString(
            record,
            ['currency'],
            'currency'
          ).toUpperCase(),

        description:
          this.optionalString(
            record,
            ['description']
          ),

        ifscCode:
          this.optionalString(
            record,
            ['ifsc_code', 'ifsc']
          )?.toUpperCase(),

        fileId,
      }));

    const result =
      await prisma.bankTransaction.createMany({
        data,
        skipDuplicates: true,
      });

    logger.info(
      `[LoaderService] Inserted ${result.count} transactions | file=${fileId}`
    );

    return result.count;
  }

  // ==================================================
  // PAYMENTS
  // ==================================================

  private async loadPayments(
    fileId: string,
    records: RawRecord[]
  ): Promise<number> {
    const data: Prisma.PaymentCreateManyInput[] =
      records.map((record) => ({
        paymentId:
          this.requiredString(
            record,
            ['payment_id'],
            'payment_id'
          ),

        accountNumber:
          this.requiredString(
            record,
            ['account_number'],
            'account_number'
          ),

        paymentDate:
          this.requiredDate(
            record,
            ['payment_date'],
            'payment_date'
          ),

        paymentMethod:
          this.requiredString(
            record,
            ['payment_method'],
            'payment_method'
          ),

        amount:
          this.requiredNumber(
            record,
            ['amount'],
            'amount'
          ),

        currency:
          this.requiredString(
            record,
            ['currency'],
            'currency'
          ).toUpperCase(),

        paymentStatus:
          this.requiredString(
            record,
            ['payment_status'],
            'payment_status'
          ),

        ifscCode:
          this.optionalString(
            record,
            ['ifsc_code', 'ifsc']
          )?.toUpperCase(),

        fileId,
      }));

    const result =
      await prisma.payment.createMany({
        data,
        skipDuplicates: true,
      });

    logger.info(
      `[LoaderService] Inserted ${result.count} payments | file=${fileId}`
    );

    return result.count;
  }

  // ==================================================
  // EXCHANGE RATES
  // ==================================================

  private async loadRates(
    fileId: string,
    records: RawRecord[]
  ): Promise<number> {
    const data: Prisma.ExchangeRateCreateManyInput[] =
      records.map((record) => {
        let currencyPair =
          this.optionalString(
            record,
            ['currency_pair']
          );

        /**
         * Some datasets may provide:
         *
         * base_currency = USD
         * target_currency = INR
         *
         * instead of:
         *
         * currency_pair = USDINR
         */
        if (!currencyPair) {
          const base =
            this.optionalString(
              record,
              ['base_currency']
            );

          const target =
            this.optionalString(
              record,
              ['target_currency']
            );

          if (base && target) {
            currencyPair =
              `${base}${target}`;
          }
        }

        if (!currencyPair) {
          throw new Error(
            'Missing currency_pair / base_currency + target_currency'
          );
        }

        return {
          rateId:
            this.requiredString(
              record,
              ['rate_id'],
              'rate_id'
            ),

          currencyPair:
            currencyPair.toUpperCase(),

          rateDate:
            this.requiredDate(
              record,
              [
                'rate_date',
                'effective_date',
              ],
              'rate_date'
            ),

          exchangeRate:
            this.requiredNumber(
              record,
              [
                'exchange_rate',
                'rate',
              ],
              'exchange_rate'
            ),

          rateType:
            this.requiredString(
              record,
              ['rate_type'],
              'rate_type'
            ),

          fileId,
        };
      });

    const result =
      await prisma.exchangeRate.createMany({
        data,
        skipDuplicates: true,
      });

    logger.info(
      `[LoaderService] Inserted ${result.count} exchange rates | file=${fileId}`
    );

    return result.count;
  }

  // ==================================================
  // HELPERS
  // ==================================================

  /**
   * Returns first available value from a list
   * of possible CSV column names.
   */
  private getValue(
    record: RawRecord,
    keys: string[]
  ): unknown {
    for (const key of keys) {
      const value = record[key];

      if (
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ''
      ) {
        return value;
      }
    }

    return undefined;
  }

  private requiredString(
    record: RawRecord,
    keys: string[],
    fieldName: string
  ): string {
    const value =
      this.getValue(record, keys);

    if (value === undefined) {
      throw new Error(
        `Missing required field: ${fieldName}`
      );
    }

    return String(value).trim();
  }

  private optionalString(
    record: RawRecord,
    keys: string[]
  ): string | undefined {
    const value =
      this.getValue(record, keys);

    if (value === undefined) {
      return undefined;
    }

    return String(value).trim();
  }

  private requiredNumber(
    record: RawRecord,
    keys: string[],
    fieldName: string
  ): number {
    const value =
      this.getValue(record, keys);

    if (value === undefined) {
      throw new Error(
        `Missing required field: ${fieldName}`
      );
    }

    const parsed =
      Number(value);

    if (Number.isNaN(parsed)) {
      throw new Error(
        `Invalid number for ${fieldName}: ${value}`
      );
    }

    return parsed;
  }

  private requiredDate(
    record: RawRecord,
    keys: string[],
    fieldName: string
  ): Date {
    const value =
      this.getValue(record, keys);

    if (value === undefined) {
      throw new Error(
        `Missing required field: ${fieldName}`
      );
    }

    const date =
      new Date(String(value));

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      throw new Error(
        `Invalid date for ${fieldName}: ${value}`
      );
    }

    return date;
  }
}

export const loaderService =
  new LoaderService();