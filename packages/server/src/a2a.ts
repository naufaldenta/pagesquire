import { createHash, randomBytes } from 'node:crypto';
import { AssistantError } from './engine.js';
import type { LinkManager } from './link.js';
import {
  signWithSiteKey,
  signingPublicKey,
  verifySiteSignature,
} from './signing.js';

/**
 * PageSquire Link's optional A2A interface (Phase 6E): a signed A2A 1.0
 * Agent Card and a JSON-RPC endpoint where other agents send a request into
 * a skill the owner opened. The answer is never an action, only a
 * single-use link where the person continues on this site and confirms
 * there. See docs/link.md.
 */

/** The A2A protocol version this interface speaks. */
export const A2A_PROTOCOL_VERSION = '1.0';
/** How long the continuation link an agent receives stays redeemable. */
export const A2A_TICKET_SECONDS = 600;
/** The Agent Card extension that publishes each open skill's fields. */
export const A2A_EXTENSION =
  'https://github.com/naufaldenta/pagesquire/blob/main/docs/link.md#a2a-interface-phase-6e';
/** Where a site publishes the key set that verifies its Agent Card. */
export const A2A_KEYS_PATH = '/.well-known/pagesquire-keys.json';

export interface AgentCardSignature {
  /** base64url JSON protected header: alg, typ, kid, jku. */
  protected: string;
  /** base64url Ed25519 signature. */
  signature: string;
}

export interface AgentCard {
  name: string;
  description: string;
  supportedInterfaces: {
    url: string;
    protocolBinding: string;
    protocolVersion: string;
  }[];
  version: string;
  capabilities: Record<string, unknown>;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: {
    id: string;
    name: string;
    description: string;
    tags: string[];
    examples?: string[];
  }[];
  signatures?: AgentCardSignature[];
}

/** One Ed25519 public key in JWK form (RFC 8037). */
export interface SiteJwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  kid: string;
  use: 'sig';
  alg: 'EdDSA';
}

/**
 * RFC 8785 (JCS) canonical JSON for plain JSON values: object keys sorted by
 * UTF-16 code units, no whitespace, ECMAScript number and string forms.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new TypeError('JSON numbers must be finite.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
      .join(',')}}`;
  throw new TypeError('Only JSON values can be canonicalized.');
}

const base64url = (text: string) => Buffer.from(text).toString('base64url');

/** The site key as a JWK; `kid` is its RFC 7638 thumbprint. */
export function siteJwk(signingKey: string): SiteJwk {
  const x = Buffer.from(
    signingPublicKey(signingKey).slice('ed25519:'.length),
    'base64',
  ).toString('base64url');
  const kid = createHash('sha256')
    .update(canonicalize({ crv: 'Ed25519', kty: 'OKP', x }))
    .digest('base64url');
  return { kty: 'OKP', crv: 'Ed25519', x, kid, use: 'sig', alg: 'EdDSA' };
}

/**
 * Signs an Agent Card as A2A section 8.4 describes: JCS over the card
 * without `signatures`, a JWS with an EdDSA protected header naming the key
 * (`kid`) and where to fetch it (`jku`). Returns the card with the signature.
 */
export function signAgentCard(
  card: AgentCard,
  signingKey: string,
  jku: string,
): AgentCard {
  const { signatures: _signatures, ...unsigned } = card;
  const header = base64url(
    canonicalize({
      alg: 'EdDSA',
      typ: 'JOSE',
      kid: siteJwk(signingKey).kid,
      jku,
    }),
  );
  const input = `${header}.${base64url(canonicalize(unsigned))}`;
  const signature = Buffer.from(
    signWithSiteKey('', input, signingKey),
    'base64',
  ).toString('base64url');
  return { ...unsigned, signatures: [{ protected: header, signature }] };
}

/** Whether one of the card's signatures verifies with a key from `keys` (a JWK Set). */
export function verifyAgentCard(
  card: unknown,
  keys: { keys?: unknown },
): boolean {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return false;
  const { signatures, ...unsigned } = card as Record<string, unknown>;
  if (!Array.isArray(signatures)) return false;
  const payload = base64url(canonicalize(unsigned));
  return signatures.some((entry) => {
    try {
      const { protected: header, signature } = entry as AgentCardSignature;
      const claims = JSON.parse(Buffer.from(header, 'base64url').toString());
      const key = (Array.isArray(keys.keys) ? keys.keys : []).find(
        (candidate) =>
          candidate?.kid === claims.kid &&
          candidate.kty === 'OKP' &&
          candidate.crv === 'Ed25519',
      ) as SiteJwk | undefined;
      if (claims.alg !== 'EdDSA' || !key) return false;
      return verifySiteSignature(
        '',
        `${header}.${payload}`,
        Buffer.from(signature, 'base64url').toString('base64'),
        `ed25519:${Buffer.from(key.x, 'base64url').toString('base64')}`,
      );
    } catch {
      return false;
    }
  });
}

/** A request an agent sent into an open skill, read from an A2A message. */
export interface AgentRequest {
  skill?: string;
  goal: string;
  fields: Record<string, unknown>;
}

const rpcError = (code: number, reason: string, message: string) =>
  Object.assign(new AssistantError(reason, message, 200), { rpc: code });

/**
 * Reads SendMessage params: one user message whose parts are text (the
 * goal) and at most one data part `{ skill?, goal?, fields? }`. Files and
 * URLs are not accepted, and a message cannot continue an earlier task.
 */
export function readAgentMessage(params: unknown): {
  request: AgentRequest;
  contextId?: string;
} {
  const record = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const invalid = (message: string) => rpcError(-32602, 'A2A_INVALID', message);
  if (!record(params) || !record(params.message))
    throw invalid('SendMessage needs a message.');
  const message = params.message;
  const outputs = record(params.configuration)
    ? params.configuration.acceptedOutputModes
    : undefined;
  if (
    Array.isArray(outputs) &&
    !outputs.some(
      (mode) => mode === 'text/plain' || mode === 'application/json',
    )
  )
    throw rpcError(
      -32005,
      'A2A_CONTENT',
      'This agent answers with text/plain and application/json only.',
    );
  if (message.taskId !== undefined)
    throw rpcError(-32001, 'A2A_TASK', 'This agent keeps no tasks.');
  if (
    message.role !== 'ROLE_USER' ||
    typeof message.messageId !== 'string' ||
    !/^[\x21-\x7e]{1,128}$/.test(message.messageId) ||
    !Array.isArray(message.parts) ||
    message.parts.length < 1 ||
    message.parts.length > 10
  )
    throw invalid(
      'Send one user message with a messageId and one to ten parts.',
    );
  const texts: string[] = [];
  let data: Record<string, unknown> | undefined;
  for (const part of message.parts) {
    if (!record(part)) throw invalid('Each part must be an object.');
    if (typeof part.text === 'string') texts.push(part.text);
    else if (record(part.data) && !data) data = part.data;
    else
      throw rpcError(
        -32005,
        'A2A_CONTENT',
        'Send text and at most one data part; files and URLs are not accepted.',
      );
  }
  if (
    data &&
    Object.keys(data).some((key) => !['skill', 'goal', 'fields'].includes(key))
  )
    throw invalid('The data part takes skill, goal and fields only.');
  const goal =
    typeof data?.goal === 'string' ? data.goal : texts.join(' ').trim();
  const contextId =
    typeof message.contextId === 'string' &&
    /^[\x21-\x7e]{1,128}$/.test(message.contextId)
      ? message.contextId
      : undefined;
  return {
    request: {
      ...(typeof data?.skill === 'string' ? { skill: data.skill } : {}),
      goal,
      fields: record(data?.fields) ? data.fields : {},
    },
    ...(contextId ? { contextId } : {}),
  };
}

const UNSUPPORTED: Record<string, number> = {
  GetTask: -32001,
  CancelTask: -32001,
  SubscribeToTask: -32001,
  SendStreamingMessage: -32004,
  ListTasks: -32004,
  CreateTaskPushNotificationConfig: -32003,
  GetTaskPushNotificationConfig: -32003,
  ListTaskPushNotificationConfigs: -32003,
  DeleteTaskPushNotificationConfig: -32003,
  GetExtendedAgentCard: -32007,
};

/**
 * The A2A JSON-RPC endpoint (`SendMessage` only; this agent keeps no tasks)
 * for a Node or Next.js route. Rate-limit it per client in front.
 */
export function createA2AHandler(
  manager: LinkManager,
): (request: Request) => Promise<Response> {
  const json = (status: number, value: unknown) =>
    new Response(JSON.stringify(value), {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  return async (request) => {
    if (request.method !== 'POST')
      return json(405, {
        error: { code: 'METHOD_NOT_ALLOWED', message: 'POST JSON-RPC.' },
      });
    if (
      !(request.headers.get('content-type') ?? '')
        .toLowerCase()
        .startsWith('application/json')
    )
      return json(415, {
        error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Send JSON.' },
      });
    const raw = await request.text();
    if (raw.length > 65536)
      return json(413, {
        error: {
          code: 'REQUEST_TOO_LARGE',
          message: 'The request is too large.',
        },
      });
    const version =
      request.headers.get('a2a-version') ??
      new URL(request.url).searchParams.get('A2A-Version') ??
      '';
    return json(
      200,
      await answerA2A(manager, raw, version).catch(() => ({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: 'The request could not be handled.' },
      })),
    );
  };
}

/**
 * One JSON-RPC request body to its JSON-RPC answer. `version` is the
 * request's A2A-Version; an empty one means 0.3, which is not served.
 */
export async function answerA2A(
  manager: LinkManager,
  raw: string,
  version: string,
): Promise<Record<string, unknown>> {
  const error = (
    id: unknown,
    code: number,
    message: string,
    reason?: string,
  ) => ({
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(reason
        ? {
            data: [
              {
                '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                reason,
                domain: 'pagesquire',
              },
            ],
          }
        : {}),
    },
  });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return error(null, -32700, 'The request is not JSON.');
  }
  const call = body as Record<string, unknown> | null;
  const id = call?.id;
  if (
    !call ||
    typeof call !== 'object' ||
    Array.isArray(call) ||
    call.jsonrpc !== '2.0' ||
    typeof call.method !== 'string' ||
    !(
      id === undefined ||
      id === null ||
      typeof id === 'number' ||
      (typeof id === 'string' && id.length <= 128)
    )
  )
    return error(null, -32600, 'Send one JSON-RPC 2.0 request.');
  if (version.trim() !== A2A_PROTOCOL_VERSION)
    return error(
      id,
      -32009,
      `This agent speaks A2A ${A2A_PROTOCOL_VERSION}; send the A2A-Version header.`,
      'A2A_VERSION',
    );
  if (call.method !== 'SendMessage')
    return UNSUPPORTED[call.method] !== undefined
      ? error(
          id,
          UNSUPPORTED[call.method]!,
          UNSUPPORTED[call.method] === -32001
            ? 'This agent keeps no tasks.'
            : `${call.method} is not supported.`,
          'A2A_UNSUPPORTED',
        )
      : error(id, -32601, `Unknown method ${call.method}.`);
  try {
    const { request, contextId } = readAgentMessage(call.params);
    const ticket = await manager.agentHandoff(request);
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      result: {
        message: {
          messageId: `msg_${randomBytes(16).toString('base64url')}`,
          ...(contextId ? { contextId } : {}),
          role: 'ROLE_AGENT',
          parts: [
            {
              text: `Open ${ticket.url} to continue on ${ticket.name}. The link works once, within ${A2A_TICKET_SECONDS / 60} minutes, and the person confirms on the site before its assistant does anything.`,
            },
            {
              data: {
                url: ticket.url,
                expiresAt: new Date(ticket.expiresAt).toISOString(),
              },
              mediaType: 'application/json',
            },
          ],
        },
      },
    };
  } catch (failure) {
    if (failure instanceof AssistantError)
      return error(
        id,
        (failure as AssistantError & { rpc?: number }).rpc ??
          (failure.code === 'LINK_BUSY' ? -32603 : -32602),
        failure.message,
        failure.code,
      );
    throw failure;
  }
}
