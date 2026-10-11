import { logger } from '../utils/logger';

/* =========================================================
   SINGLE-ROW ANOMALY CONTRACT
   Kept for backward compatibility
   ========================================================= */

export interface AnomalyResult {
  fileId?: string;
  isAnomaly: boolean;
  score: number;
  reason?: string;
  explanation?: string;
}

/* =========================================================
   LAYER 2 ANOMALY CONTRACTS
   ========================================================= */

export interface AnomalyFlag {
  row_number: number | null;

  level: string;

  anomaly_type: string;

  rule_ref: string;

  score: number;

  method: string;

  explanation: string;
}

export interface AnomalyFlagsResponse {
  fileId?: string | null;

  count: number;

  flags: AnomalyFlag[];
}

export interface FileAnomalyFeatures {
  file_type: string;

  size_bytes?: number;

  total_records?: number;

  rejected_records?: number;

  actual_seconds?: number;

  predicted_seconds?: number;
}

/* =========================================================
   PROCESSING TIME CONTRACT
   ========================================================= */

export interface PredictionResult {
  estimatedSeconds: number;

  unit?: string;

  method?: string;
}

/* =========================================================
   AI SUGGESTION CONTRACT
   ========================================================= */

export interface SuggestionResult {
  suggestedValue: string | null;

  confidence: number;

  explanation?: string;

  source?: string;
}

/* =========================================================
   CUSTOM ML ERROR
   ========================================================= */

export class MLServiceError extends Error {
  readonly endpoint: string;

  readonly status?: number;

  readonly responseBody?: string;

  constructor(
    message: string,
    endpoint: string,
    status?: number,
    responseBody?: string
  ) {
    super(message);

    this.name =
      'MLServiceError';

    this.endpoint =
      endpoint;

    this.status =
      status;

    this.responseBody =
      responseBody;
  }
}

/* =========================================================
   ML CLIENT
   ========================================================= */

export class MLClient {
  private readonly baseUrl: string;

  /**
   * Isolation Forest + SHAP can take longer
   * than simple validation calls.
   */
  private readonly timeoutMs =
    30000;

  constructor() {
    const configuredUrl =
      process.env.ML_SERVICE_URL ||
      'http://localhost:8000';

    /**
     * Remove trailing slash so:
     *
     * http://localhost:8000/
     *
     * does not become:
     *
     * http://localhost:8000//anomaly/...
     */
    this.baseUrl =
      configuredUrl.replace(
        /\/+$/,
        ''
      );

    logger.info(
      `[MLClient] ML service URL=${this.baseUrl}`
    );
  }

  /* =======================================================
     HEALTH CHECK
     ======================================================= */

  async healthCheck(): Promise<boolean> {
    const endpoint =
      '/health';

    try {
      const response =
        await this.get<{
          status: string;
        }>(
          endpoint
        );

      return (
        response.status ===
        'ok'
      );
    } catch (error) {
      logger.error(
        '[MLClient] ML health check failed',
        error
      );

      return false;
    }
  }

  /* =======================================================
     SINGLE-ROW ANOMALY CHECK

     This is no longer used by the new processor,
     but keep it because Python still supports it.
     ======================================================= */

  async checkAnomaly(
    fileId: string,
    features: Record<
      string,
      unknown
    >,
    fileType?: string
  ): Promise<AnomalyResult> {
    const endpoint =
      '/anomaly/detect';

    logger.debug(
      `[MLClient] Single anomaly request | ` +
        `file=${fileId} | ` +
        `type=${fileType ?? 'auto'}`
    );

    return this.post<AnomalyResult>(
      endpoint,
      {
        fileId,
        features,
        fileType,
      }
    );
  }

  /* =======================================================
     BATCH ANOMALY DETECTION

     Python:
     POST /anomaly/detect-batch
     ======================================================= */

  async detectAnomalyBatch(
    fileId: string,
    fileType: string,
    rows: Array<
      Record<
        string,
        unknown
      >
    >,
    rowNumbers: number[],
    // Account info read from the Account table, for the rules that need it
    // (T-N11 overdraft, T-N12 night transfer from a retail account)
    accounts: Record<string, { account_type: string; balance: string; currency: string }> = {}
  ): Promise<AnomalyFlagsResponse> {
    const endpoint =
      '/anomaly/detect-batch';

    if (
      rows.length ===
      0
    ) {
      return {
        fileId,
        count: 0,
        flags: [],
      };
    }

    if (
      rowNumbers.length !==
      rows.length
    ) {
      throw new Error(
        `ML row mapping mismatch. ` +
          `rows=${rows.length}, ` +
          `rowNumbers=${rowNumbers.length}`
      );
    }

    logger.info(
      `[MLClient] POST ${endpoint} | ` +
        `file=${fileId} | ` +
        `type=${fileType} | ` +
        `rows=${rows.length}`
    );

    try {
      const response =
        await this.post<AnomalyFlagsResponse>(
          endpoint,
          {
            fileId,
            fileType,
            rows,
            rowNumbers,
            accounts,
          }
        );

      logger.info(
        `[MLClient] Batch anomaly success | ` +
          `file=${fileId} | ` +
          `count=${response.count}`
      );

      return response;
    } catch (error) {
      /**
       * IMPORTANT:
       *
       * Do NOT return:
       *
       * {
       *   count: 0,
       *   flags: []
       * }
       *
       * here.
       *
       * That would make an ML failure look
       * like the model found no anomalies.
       */
      logger.error(
        `[MLClient] Batch anomaly detection FAILED | ` +
          `file=${fileId} | ` +
          `type=${fileType}`,
        error
      );

      throw error;
    }
  }

  /* =======================================================
     FINISH FILE SESSION

     Python keeps state for multiple batches.

     This detects patterns such as:
     - TXN_VELOCITY
     - PAYMENT_BURST
     - NEAR_DUPLICATE
     - RATE_JUMP
     - STALE_RATE
     ======================================================= */

  async finishAnomalyFile(
    fileId: string
  ): Promise<AnomalyFlagsResponse> {
    const endpoint =
      '/anomaly/finish';

    logger.info(
      `[MLClient] POST ${endpoint} | file=${fileId}`
    );

    try {
      const response =
        await this.post<AnomalyFlagsResponse>(
          endpoint,
          {
            fileId,
          }
        );

      logger.info(
        `[MLClient] Finish anomaly success | ` +
          `file=${fileId} | ` +
          `count=${response.count}`
      );

      return response;
    } catch (error) {
      logger.error(
        `[MLClient] Finish anomaly detection FAILED | file=${fileId}`,
        error
      );

      throw error;
    }
  }

  /* =======================================================
     FILE-LEVEL ANOMALIES

     Detects:
     - FILE_SIZE_UNUSUAL
     - RECORD_COUNT_UNUSUAL
     - REJECTION_RATE_HIGH
     - PROCESSING_TIME_MISS
     ======================================================= */

  async detectFileAnomalies(
    features:
      FileAnomalyFeatures,

    history:
      FileAnomalyFeatures[] =
      []
  ): Promise<AnomalyFlagsResponse> {
    const endpoint =
      '/anomaly/file-level';

    logger.info(
      `[MLClient] POST ${endpoint} | ` +
        `type=${features.file_type} | ` +
        `records=${features.total_records ?? 0} | ` +
        `history=${history.length}`
    );

    try {
      const response =
        await this.post<AnomalyFlagsResponse>(
          endpoint,
          {
            features,
            history,
          }
        );

      logger.info(
        `[MLClient] File-level anomaly success | ` +
          `type=${features.file_type} | ` +
          `count=${response.count}`
      );

      return response;
    } catch (error) {
      logger.error(
        `[MLClient] File-level anomaly detection FAILED | ` +
          `type=${features.file_type}`,
        error
      );

      throw error;
    }
  }

  /* =======================================================
     PROCESSING TIME PREDICTION
     ======================================================= */

  async predictProcessingTime(
    fileSizeMb: number,
    rowCount: number,
    fileType?: string,
    sizeBytes?: number,
    concurrency = 1
  ): Promise<number> {
    const endpoint =
      '/prediction/predict-time';

    try {
      const response =
        await this.post<PredictionResult>(
          endpoint,
          {
            fileType,

            rowCount,

            fileSizeMb,

            sizeBytes,

            concurrency,
          }
        );

      logger.info(
        `[MLClient] ETA prediction | ` +
          `type=${fileType ?? 'unknown'} | ` +
          `rows=${rowCount} | ` +
          `seconds=${response.estimatedSeconds} | ` +
          `method=${response.method ?? 'unknown'}`
      );

      return (
        response.estimatedSeconds
      );
    } catch (error) {
      /**
       * ETA failure should not stop ingestion,
       * so prediction is allowed to fall back.
       */
      logger.warn(
        '[MLClient] Processing-time prediction unavailable. Using fallback.',
        error
      );

      return Math.max(
        1,
        Math.ceil(
          rowCount /
            500
        )
      );
    }
  }

  /* =======================================================
     AI FIX SUGGESTIONS
     ======================================================= */

  async suggestFix(
    fieldName: string,
    originalValue: string,
    context: Record<
      string,
      unknown
    > = {}
  ): Promise<SuggestionResult> {
    const endpoint =
      '/suggestions/suggest-fix';

    try {
      const response =
        await this.post<SuggestionResult>(
          endpoint,
          {
            fieldName,
            originalValue,
            context,
          }
        );

      logger.debug(
        `[MLClient] Suggestion success | ` +
          `field=${fieldName} | ` +
          `confidence=${response.confidence}`
      );

      return response;
    } catch (error) {
      /**
       * Suggestions are optional.
       * A failed suggestion must not crash
       * the ingestion pipeline.
       */
      logger.warn(
        `[MLClient] Suggestion service unavailable | field=${fieldName}`,
        error
      );

      return {
        suggestedValue:
          null,

        confidence:
          0,

        explanation:
          'ML suggestion service unavailable',
      };
    }
  }

  /* =======================================================
     POST HELPER
     ======================================================= */

  private async post<T>(
    endpoint: string,
    body: Record<
      string,
      unknown
    >
  ): Promise<T> {
    const url =
      `${this.baseUrl}${endpoint}`;

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () => {
          controller.abort();
        },
        this.timeoutMs
      );

    const startedAt =
      Date.now();

    try {
      logger.debug(
        `[MLClient] Request → ${url}`
      );

      const response =
        await fetch(
          url,
          {
            method:
              'POST',

            headers: {
              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify(
                body
              ),

            signal:
              controller.signal,
          }
        );

      const elapsedMs =
        Date.now() -
        startedAt;

      /**
       * Read as text first.
       *
       * This lets us show Python/FastAPI
       * validation errors instead of hiding
       * the useful response body.
       */
      const responseText =
        await response.text();

      if (
        !response.ok
      ) {
        logger.error(
          `[MLClient] HTTP ERROR | ` +
            `endpoint=${endpoint} | ` +
            `status=${response.status} | ` +
            `durationMs=${elapsedMs} | ` +
            `body=${responseText}`
        );

        throw new MLServiceError(
          `ML service returned ` +
            `${response.status} ${response.statusText}. ` +
            `Response: ${responseText}`,
          endpoint,
          response.status,
          responseText
        );
      }

      logger.debug(
        `[MLClient] Response ← ${endpoint} | ` +
          `status=${response.status} | ` +
          `durationMs=${elapsedMs}`
      );

      if (
        !responseText
      ) {
        throw new MLServiceError(
          `ML service returned an empty response for ${endpoint}`,
          endpoint,
          response.status
        );
      }

      try {
        return JSON.parse(
          responseText
        ) as T;
      } catch (parseError) {
        throw new MLServiceError(
          `ML service returned invalid JSON for ${endpoint}. ` +
            `Response: ${responseText}`,
          endpoint,
          response.status,
          responseText
        );
      }
    } catch (error) {
      if (
        error instanceof
        MLServiceError
      ) {
        throw error;
      }

      if (
        error instanceof Error &&
        error.name ===
          'AbortError'
      ) {
        throw new MLServiceError(
          `ML request timed out after ${this.timeoutMs}ms: ${endpoint}`,
          endpoint
        );
      }

      const message =
        error instanceof Error
          ? error.message
          : String(
              error
            );

      throw new MLServiceError(
        `Unable to reach ML service at ${url}: ${message}`,
        endpoint
      );
    } finally {
      clearTimeout(
        timeout
      );
    }
  }

  /* =======================================================
     GET HELPER
     ======================================================= */

  private async get<T>(
    endpoint: string
  ): Promise<T> {
    const url =
      `${this.baseUrl}${endpoint}`;

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () => {
          controller.abort();
        },
        this.timeoutMs
      );

    try {
      const response =
        await fetch(
          url,
          {
            method:
              'GET',

            headers: {
              Accept:
                'application/json',
            },

            signal:
              controller.signal,
          }
        );

      const responseText =
        await response.text();

      if (
        !response.ok
      ) {
        throw new MLServiceError(
          `ML service returned ${response.status} ${response.statusText}: ${responseText}`,
          endpoint,
          response.status,
          responseText
        );
      }

      if (
        !responseText
      ) {
        throw new MLServiceError(
          `ML service returned an empty response for ${endpoint}`,
          endpoint,
          response.status
        );
      }

      return JSON.parse(
        responseText
      ) as T;
    } catch (error) {
      if (
        error instanceof
        MLServiceError
      ) {
        throw error;
      }

      if (
        error instanceof Error &&
        error.name ===
          'AbortError'
      ) {
        throw new MLServiceError(
          `ML request timed out after ${this.timeoutMs}ms: ${endpoint}`,
          endpoint
        );
      }

      const message =
        error instanceof Error
          ? error.message
          : String(
              error
            );

      throw new MLServiceError(
        `Unable to reach ML service at ${url}: ${message}`,
        endpoint
      );
    } finally {
      clearTimeout(
        timeout
      );
    }
  }
}

export const mlClient =
  new MLClient();