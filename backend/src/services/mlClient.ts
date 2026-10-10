import { logger } from '../utils/logger';

export interface AnomalyResult {
  isAnomaly: boolean;
  score: number;
  explanation?: string;
}

export interface PredictionResult {
  estimatedSeconds: number;
}

/** One Layer 2 anomaly flag, exactly as the ML service returns it. */
export interface AnomalyFlag {
  row_number: number | null; // real file row number; null for file-level flags
  level: 'RECORD' | 'FILE';
  anomaly_type: string; // e.g. HIGH_VALUE_TXN, TXN_VELOCITY, RATE_JUMP
  rule_ref: string; // workbook ID, e.g. T-N14, R-N10
  score: number; // 0..1
  method: string; // RULE | ROBUST_Z | SIGMA_Z | IFOREST
  explanation: string;
}

interface FlagsResponse {
  fileId?: string;
  count: number;
  flags: AnomalyFlag[];
}

export interface SuggestionResult {
  suggestedValue: string | null;
  confidence: number;
  explanation?: string;
}

export class MLClient {
  private readonly baseUrl: string;
  private readonly timeoutMs = 5000;
  private readonly batchTimeoutMs = 30000; // batches of rows take longer than a single call

  constructor() {
    this.baseUrl =
      process.env.ML_SERVICE_URL || 'http://localhost:8000';
  }

  /**
   * Check whether a record looks anomalous.
   */
  async checkAnomaly(
    fileId: string,
    features: Record<string, unknown>
  ): Promise<AnomalyResult> {
    try {
      logger.debug(
        `[MLClient] Checking anomaly for file=${fileId}`
      );

      const response = await this.post<AnomalyResult>(
        '/anomaly/detect',
        {
          fileId,
          features,
        }
      );

      return response;
    } catch (error) {
      logger.warn(
        `[MLClient] Anomaly service unavailable for file=${fileId}`,
        error
      );

      // Don't fail entire file if ML service is temporarily unavailable
      return {
        isAnomaly: false,
        score: 0,
      };
    }
  }

  /**
   * Layer 2: row-level anomaly checks for one batch of VALID rows.
   * rowNumbers are the real file row numbers of the rows sent (same order).
   */
  async detectAnomalyBatch(
    fileId: string,
    fileType: string,
    rows: Array<Record<string, unknown>>,
    rowNumbers: number[]
  ): Promise<AnomalyFlag[]> {
    if (rows.length === 0) return [];
    try {
      const response = await this.post<FlagsResponse>(
        '/anomaly/detect-batch',
        { fileId, fileType, rows, rowNumbers },
        this.batchTimeoutMs
      );
      return response.flags;
    } catch (error) {
      logger.warn(
        `[MLClient] Anomaly batch failed for file=${fileId}; continuing without flags`,
        error
      );
      return [];
    }
  }

  /**
   * Layer 2: file-wide checks (velocity, near-duplicates, rates series).
   * Call once after the last batch of a file.
   */
  async finishAnomalies(fileId: string): Promise<AnomalyFlag[]> {
    try {
      const response = await this.post<FlagsResponse>(
        '/anomaly/finish',
        { fileId },
        this.batchTimeoutMs
      );
      return response.flags;
    } catch (error) {
      logger.warn(
        `[MLClient] Anomaly finish failed for file=${fileId}`,
        error
      );
      return [];
    }
  }

  /**
   * Predict how long a file will take to process.
   */
  async predictProcessingTime(
    fileSizeMb: number,
    rowCount: number
  ): Promise<number> {
    try {
      const response =
        await this.post<PredictionResult>(
          '/prediction/predict-time',
          {
            fileSizeMb,
            rowCount,
          }
        );

      return response.estimatedSeconds;
    } catch (error) {
      logger.warn(
        '[MLClient] Processing-time prediction unavailable',
        error
      );

      // Simple fallback if Python service is down
      return Math.max(
        1,
        Math.ceil(rowCount / 500)
      );
    }
  }

  /**
   * Ask ML service for a correction suggestion.
   *
   * Example:
   * invalid IFSC -> closest valid IFSC
   * bad currency -> suggested currency
   */
  async suggestFix(
    fieldName: string,
    originalValue: string,
    context: Record<string, unknown> = {}
  ): Promise<SuggestionResult> {
    try {
      return await this.post<SuggestionResult>(
        '/suggestions/suggest-fix',
        {
          fieldName,
          originalValue,
          context,
        }
      );
    } catch (error) {
      logger.warn(
        `[MLClient] Suggestion service unavailable for field=${fieldName}`,
        error
      );

      return {
        suggestedValue: null,
        confidence: 0,
      };
    }
  }

  /**
   * Shared POST helper with timeout.
   */
  private async post<T>(
    endpoint: string,
    body: Record<string, unknown>,
    timeoutMs: number = this.timeoutMs
  ): Promise<T> {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(
        `${this.baseUrl}${endpoint}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        throw new Error(
          `ML service returned ${response.status} ${response.statusText}`
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const mlClient = new MLClient();