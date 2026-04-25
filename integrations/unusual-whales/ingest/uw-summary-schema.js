import { validateAgainstSchema } from './json-schema.js';

export const uwSummarySchema = {
  type: 'object',
  required: [
    'source',
    'status',
    'last_update',
    'flow',
    'darkpool',
    'volatility',
    'sentiment',
    'dealer_crosscheck',
    'quality'
  ],
  additionalProperties: false,
  properties: {
    secret: { type: 'string' },
    source: { type: 'string' },
    status: {
      type: 'string',
      enum: ['live', 'stale', 'partial', 'unavailable', 'error']
    },
    last_update: { type: ['string', 'null'] },
    test_context: {
      type: 'object',
      additionalProperties: false,
      properties: {
        market_session: { type: 'string' },
        expiration: { type: 'string' },
        purpose: { type: 'string' }
      }
    },
    flow: {
      type: 'object',
      required: ['flow_bias', 'institutional_entry'],
      additionalProperties: false,
      properties: {
        flow_bias: {
          type: 'string',
          enum: ['bullish', 'bearish', 'mixed', 'unavailable']
        },
        institutional_entry: {
          type: 'string',
          enum: ['none', 'building', 'bombing', 'unavailable']
        }
      }
    },
    darkpool: {
      type: 'object',
      required: ['darkpool_bias'],
      additionalProperties: false,
      properties: {
        darkpool_bias: {
          type: 'string',
          enum: ['support', 'resistance', 'neutral', 'unavailable']
        }
      }
    },
    volatility: {
      type: 'object',
      required: ['volatility_light'],
      additionalProperties: false,
      properties: {
        volatility_light: {
          type: 'string',
          enum: ['red', 'yellow', 'green', 'unavailable']
        }
      }
    },
    sentiment: {
      type: 'object',
      required: ['market_tide'],
      additionalProperties: false,
      properties: {
        market_tide: {
          type: 'string',
          enum: ['risk_on', 'risk_off', 'mixed', 'unavailable']
        }
      }
    },
    dealer_crosscheck: {
      type: 'object',
      required: ['state'],
      additionalProperties: false,
      properties: {
        state: {
          type: 'string',
          enum: ['confirm', 'conflict', 'unavailable']
        }
      }
    },
    quality: {
      type: 'object',
      required: ['data_quality', 'missing_fields'],
      additionalProperties: false,
      properties: {
        data_quality: {
          type: 'string',
          enum: ['live', 'partial', 'stale', 'unavailable', 'error']
        },
        missing_fields: {
          type: 'array',
          items: { type: 'string' }
        },
        warnings: {
          type: 'array',
          items: { type: 'string' }
        },
        raw_rows_sent: { type: 'boolean' }
      }
    }
  }
};

export function validateUwSummaryPayload(payload) {
  const result = validateAgainstSchema(payload, uwSummarySchema);
  return {
    ok: result.valid,
    errors: result.errors
  };
}

export const validateUwSummary = validateUwSummaryPayload;
