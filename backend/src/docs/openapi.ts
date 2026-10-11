/**
 * OpenAPI 3 description of the backend API, served at /api/docs (Swagger UI)
 * and /api/openapi.json. Keep it in step with src/routes/*.ts.
 */
export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Bank File Processing - Backend API',
    version: '1.0.0',
    description:
      'Ingestion, monitoring and resolution API used by the dashboard. ' +
      'The backend calls the ML service (http://localhost:8000/docs) for normalisation, ' +
      'AI-suggested fixes, anomaly detection and processing-time prediction.',
  },
  servers: [{ url: 'http://localhost:5000', description: 'Local' }],
  tags: [
    { name: 'Health' },
    { name: 'Files', description: 'Upload and monitor files' },
    { name: 'Dashboard', description: 'KPI summary' },
    { name: 'Resolutions', description: 'Rejected rows and AI-suggested fixes' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Is the backend running?',
        responses: {
          200: {
            description: 'Running',
            content: { 'application/json': { example: { success: true, message: 'Backend is running' } } },
          },
        },
      },
    },
    '/api/files/upload': {
      post: {
        tags: ['Files'],
        summary: 'Upload a CSV file for processing',
        description:
          'Checks the file (checksum duplicate, type, file-level validation), predicts its processing time and queues it. ' +
          'A file that fails file-level validation is quarantined and returns 422 with the reason. ' +
          'Upload accounts files before the transactions / payments that reference them.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: { file: { type: 'string', format: 'binary', description: 'e.g. bank_txns_demo.csv' } },
              },
            },
          },
        },
        responses: {
          202: {
            description: 'Queued',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: { fileId: 'a4d50320-a12f-4ad3-83dc-806e543d9a76', fileName: 'bank_txns_demo.csv',
                    fileType: 'BANK_TRANSACTIONS', status: 'QUEUED' },
                },
              },
            },
          },
          400: { description: 'Duplicate file, unsupported format or unknown file type' },
          422: { description: 'Quarantined by file-level validation (reason in message)' },
        },
      },
    },
    '/api/files': {
      get: {
        tags: ['Files'],
        summary: 'List all files with status, progress, predicted time and counts',
        responses: {
          200: {
            description: 'Files, newest first',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/ProcessingFile' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/files/{id}': {
      get: {
        tags: ['Files'],
        summary: 'One file with its anomalies (Layer 2) and rejections (Layer 1)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' },
          description: 'fileId from /api/files or the upload response' }],
        responses: {
          200: {
            description: 'File detail',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      allOf: [
                        { $ref: '#/components/schemas/ProcessingFile' },
                        {
                          type: 'object',
                          properties: {
                            anomalies: { type: 'array', items: { $ref: '#/components/schemas/Anomaly' } },
                            faultLogs: { type: 'array', items: { $ref: '#/components/schemas/FaultLog' } },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
          404: { description: 'File not found' },
        },
      },
    },
    '/api/dashboard/summary': {
      get: {
        tags: ['Dashboard'],
        summary: 'KPI summary for the dashboard cards',
        responses: {
          200: {
            description: 'Summary',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: { totalFiles: 3, queuedFiles: 0, activeProcessing: 0, completedFiles: 1, failedFiles: 0,
                    needsReviewFiles: 2, totalRejections: 325, pendingRejections: 325, totalAnomalies: 89,
                    averageProcessingTimeMs: 4210,
                    worker: { activeJobs: 0, queuedJobs: 0, maxConcurrentJobs: 3, isRunning: true } },
                },
              },
            },
          },
        },
      },
    },
    '/api/resolutions/pending': {
      get: {
        tags: ['Resolutions'],
        summary: 'Rejected rows waiting for review, with AI-suggested fixes',
        responses: {
          200: {
            description: 'Pending rejections',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/FaultLog' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/resolutions/{id}/resolve': {
      post: {
        tags: ['Resolutions'],
        summary: 'Accept, edit or reject an AI suggestion (feeds learning from fixes)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' },
          description: 'FaultLog id from /api/resolutions/pending' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['action'],
                properties: {
                  action: { type: 'string', enum: ['APPROVE', 'EDIT', 'REJECT'],
                    description: 'APPROVE uses the AI suggestion; EDIT saves correctedValue; REJECT declines it' },
                  correctedValue: { type: 'string', description: 'Required for EDIT' },
                  reviewedBy: { type: 'string' },
                },
              },
              examples: {
                approve: { summary: 'Accept the AI suggestion', value: { action: 'APPROVE', reviewedBy: 'operator' } },
                edit: { summary: 'Save my own value', value: { action: 'EDIT', correctedValue: 'USD', reviewedBy: 'operator' } },
                reject: { summary: 'Decline the suggestion', value: { action: 'REJECT', reviewedBy: 'operator' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Resolved' },
          400: { description: 'Missing action, missing correctedValue for EDIT, or already resolved' },
          404: { description: 'Rejection not found' },
        },
      },
    },
  },
  components: {
    schemas: {
      ProcessingFile: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          originalName: { type: 'string', example: 'bank_txns_demo.csv' },
          fileType: { type: 'string', enum: ['ACCOUNTS', 'BANK_TRANSACTIONS', 'PAYMENTS', 'RATES'] },
          status: { type: 'string', enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW'] },
          sizeBytes: { type: 'string', description: 'BigInt as text' },
          progress: { type: 'number' },
          totalRows: { type: 'integer' },
          processedRows: { type: 'integer' },
          failedRows: { type: 'integer' },
          predictedDurationMs: { type: 'integer', nullable: true, description: 'ETA model prediction' },
          actualDurationMs: { type: 'integer', nullable: true },
          errorMessage: { type: 'string', nullable: true, description: 'e.g. "Quarantined [FILE_HEADER_MISMATCH]: ..."' },
          _count: { type: 'object', properties: { anomalies: { type: 'integer' }, faultLogs: { type: 'integer' } } },
        },
      },
      Anomaly: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          rowNumber: { type: 'integer', nullable: true, description: 'CSV line; null for file-level flags' },
          anomalyType: { type: 'string', example: 'HIGH_VALUE_TXN' },
          description: { type: 'string', example: 'amount 1,500,000.00 is 6.8 SDs above normal (250,000) for INR, debit' },
          score: { type: 'number', example: 0.97 },
          details: {
            type: 'object',
            properties: {
              ruleRef: { type: 'string', example: 'T-N14' },
              method: { type: 'string', enum: ['RULE', 'ROBUST_Z', 'SIGMA_Z', 'IFOREST'] },
              level: { type: 'string', enum: ['RECORD', 'FILE'] },
            },
          },
        },
      },
      FaultLog: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          rowNumber: { type: 'integer' },
          columnName: { type: 'string', example: 'currency' },
          cellValue: { type: 'string', example: 'USX' },
          errorMessage: { type: 'string', example: 'Currency USX is not in the ISO 4217 master list (rule A-5/T-6/P-6)' },
          errorType: { type: 'string', example: 'INVALID_CURRENCY' },
          status: { type: 'string', enum: ['PENDING', 'APPROVED', 'EDITED', 'REJECTED', 'SAVED_TO_TARGET'] },
          aiSuggestion: { type: 'string', nullable: true, example: 'USD' },
          aiConfidence: { type: 'number', nullable: true, example: 0.83 },
          aiExplanation: { type: 'string', nullable: true, example: "'USX' is one character from USD (United States Dollar)" },
        },
      },
    },
  },
};
