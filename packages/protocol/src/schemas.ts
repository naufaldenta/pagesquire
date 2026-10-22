import {
  CAPABILITY_AVAILABILITY_STATUSES,
  EMOTIONS,
  PROTOCOL_VERSION,
} from './types.js';

const identifier = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9_-]+$',
};
const capabilityId = {
  type: 'string',
  maxLength: 128,
  pattern: '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$',
};
const handlerId = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z][A-Za-z0-9_.-]*$',
};

export const capabilitySchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:pagesquire:capability:0.1',
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'description',
    'execution',
    'handler',
    'inputSchema',
    'risk',
    'verification',
  ],
  properties: {
    id: capabilityId,
    description: { type: 'string', minLength: 1, maxLength: 1000 },
    execution: { const: 'browser' },
    handler: handlerId,
    inputSchema: {
      type: 'object',
      required: ['type', 'additionalProperties'],
      properties: {
        type: { const: 'object' },
        additionalProperties: { const: false },
      },
      additionalProperties: true,
    },
    risk: { enum: ['read_only', 'reversible', 'consequential'] },
    verification: {
      type: 'object',
      required: ['handler'],
      properties: { handler: handlerId },
      additionalProperties: false,
    },
    aliases: {
      type: 'array',
      maxItems: 50,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 120 },
    },
  },
};

export const manifestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:pagesquire:manifest:0.1',
  type: 'object',
  required: ['schemaVersion', 'capabilities'],
  properties: {
    schemaVersion: { const: PROTOCOL_VERSION },
    capabilities: {
      type: 'array',
      maxItems: 1000,
      items: { $ref: capabilitySchema.$id },
    },
  },
  additionalProperties: false,
};

export const actionCallSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:pagesquire:action-call:0.1',
  type: 'object',
  required: [
    'protocolVersion',
    'callId',
    'capabilityId',
    'snapshotId',
    'parameters',
  ],
  properties: {
    protocolVersion: { const: PROTOCOL_VERSION },
    callId: identifier,
    capabilityId,
    snapshotId: identifier,
    parameters: { type: 'object', maxProperties: 100 },
  },
  additionalProperties: false,
};

export const responseSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:pagesquire:response:0.1',
  type: 'object',
  required: ['protocolVersion', 'text', 'emotion', 'finished', 'toolCalls'],
  properties: {
    protocolVersion: { const: PROTOCOL_VERSION },
    text: { type: 'string', maxLength: 32000 },
    emotion: { enum: [...EMOTIONS] },
    finished: { type: 'boolean' },
    toolCalls: {
      type: 'array',
      maxItems: 10,
      items: { $ref: actionCallSchema.$id },
    },
  },
  additionalProperties: false,
};

export const snapshotSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:pagesquire:snapshot:0.1',
  type: 'object',
  required: [
    'protocolVersion',
    'id',
    'url',
    'title',
    'text',
    'targets',
    'truncated',
  ],
  properties: {
    protocolVersion: { const: PROTOCOL_VERSION },
    id: identifier,
    url: { type: 'string', maxLength: 4096, pattern: '^https?://' },
    title: { type: 'string', maxLength: 200 },
    text: { type: 'string', maxLength: 32000 },
    targets: {
      type: 'array',
      maxItems: 1000,
      items: {
        type: 'object',
        required: ['id', 'tag', 'name', 'role', 'disabled', 'actionable'],
        properties: {
          id: identifier,
          tag: { type: 'string', maxLength: 40 },
          name: { type: 'string', maxLength: 120 },
          role: { type: 'string', maxLength: 100 },
          disabled: { type: 'boolean' },
          actionable: { type: 'boolean' },
          href: { type: 'string', maxLength: 4096, pattern: '^https?://' },
        },
        additionalProperties: false,
      },
    },
    truncated: {
      type: 'object',
      required: ['text', 'targets'],
      properties: { text: { type: 'boolean' }, targets: { type: 'boolean' } },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export const actionResultSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:pagesquire:action-result:0.1',
  type: 'object',
  required: [
    'protocolVersion',
    'callId',
    'capabilityId',
    'status',
    'code',
    'message',
    'evidence',
  ],
  properties: {
    protocolVersion: { const: PROTOCOL_VERSION },
    callId: identifier,
    capabilityId,
    status: { enum: ['success', 'failed', 'unverified', 'cancelled'] },
    code: { type: 'string', minLength: 1, maxLength: 80 },
    message: { type: 'string', maxLength: 2000 },
    evidence: { type: 'object', maxProperties: 100 },
    observation: { $ref: snapshotSchema.$id },
  },
  additionalProperties: false,
};

export const appContextSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:pagesquire:app-context:1',
  type: 'object',
  required: ['schemaVersion', 'fields', 'availability'],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: 1 },
    fields: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        required: ['name', 'value'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', maxLength: 64, pattern: '^[a-z][a-z0-9_]*$' },
          value: {
            anyOf: [
              { type: 'string', maxLength: 200 },
              { type: 'number', minimum: -1e12, maximum: 1e12 },
              { type: 'boolean' },
            ],
          },
        },
      },
    },
    availability: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        required: ['capabilityId', 'status'],
        additionalProperties: false,
        properties: {
          capabilityId,
          status: { enum: [...CAPABILITY_AVAILABILITY_STATUSES] },
        },
      },
    },
  },
};

export const chatRequestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:pagesquire:chat-request:0.1',
  type: 'object',
  required: ['protocolVersion', 'requestId', 'snapshot', 'capabilityIds'],
  properties: {
    protocolVersion: { const: PROTOCOL_VERSION },
    requestId: identifier,
    conversationId: identifier,
    message: { type: 'string', minLength: 1, maxLength: 4000, pattern: '\\S' },
    result: { $ref: actionResultSchema.$id },
    snapshot: { $ref: snapshotSchema.$id },
    appContext: { $ref: appContextSchema.$id },
    capabilityIds: {
      type: 'array',
      maxItems: 100,
      uniqueItems: true,
      items: capabilityId,
    },
  },
  oneOf: [
    { required: ['message'], properties: { message: true, result: false } },
    {
      required: ['result', 'conversationId'],
      properties: { result: true, conversationId: true, message: false },
    },
  ],
  additionalProperties: false,
};

export const chatReplySchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:pagesquire:chat-reply:0.1',
  type: 'object',
  required: ['protocolVersion', 'conversationId', 'response'],
  properties: {
    protocolVersion: { const: PROTOCOL_VERSION },
    conversationId: identifier,
    response: { $ref: responseSchema.$id },
  },
  additionalProperties: false,
};

export const providerResponseSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:pagesquire:provider-response:0.1',
  type: 'object',
  required: ['text', 'emotion', 'finished', 'toolCalls'],
  properties: {
    text: { type: 'string', maxLength: 8000 },
    emotion: { enum: EMOTIONS },
    finished: { type: 'boolean' },
    toolCalls: {
      type: 'array',
      maxItems: 1,
      items: {
        type: 'object',
        required: ['capabilityId', 'parameters'],
        properties: { capabilityId, parameters: { type: 'object' } },
        additionalProperties: false,
      },
    },
  },
  oneOf: [
    {
      properties: {
        finished: { const: true },
        toolCalls: { type: 'array', maxItems: 0 },
      },
    },
    {
      properties: {
        finished: { const: false },
        toolCalls: { type: 'array', minItems: 1 },
      },
    },
  ],
  additionalProperties: false,
};

export const protocolSchemas = {
  appContext: appContextSchema,
  capability: capabilitySchema,
  manifest: manifestSchema,
  actionCall: actionCallSchema,
  response: responseSchema,
  snapshot: snapshotSchema,
  actionResult: actionResultSchema,
  chatRequest: chatRequestSchema,
  chatReply: chatReplySchema,
  providerResponse: providerResponseSchema,
};
