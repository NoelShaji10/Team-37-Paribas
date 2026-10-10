import { logger } from '../utils/logger';

export interface AnomalyResult {
  isAnomaly: boolean;
  score: number;
  explanation?: string;
}

export interface PredictionResult {
  estimatedSeconds: number;
}

export interface SuggestionResult {
  suggestedValue: string | null;
  confidence: number;
  explanation?: string;
}

export class MLClient {
  private readonly baseUrl: string;
  private readonly timeoutMs = 5000;

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
    body: Record<string, unknown>
  ): Promise<T> {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

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