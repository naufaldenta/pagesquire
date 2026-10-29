import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import {
  A2A_EXTENSION,
  A2A_KEYS_PATH,
  A2A_PROTOCOL_VERSION,
  A2A_TICKET_SECONDS,
  signAgentCard,
  siteJwk,
  type AgentCard,
  type AgentRequest,
  type SiteJwk,
} from './a2a.js';
import { AssistantError, fail } from './engine.js';
import {
  signWithSiteKey,
  signingPublicKey,
  verifySiteSignature,
} from './signing.js';

/**
 * PageSquire Link: pairing two PageSquire sites of different owners (Phase
 * 6A) and handing visitors between them (Phase 6B). See docs/link.md. Every message between the sites is an Ed25519
 * envelope signed with the site key, bound to sender, recipient and link,
 * short-lived and accepted once.
 */

/** Prefix of every signed link message, so link and call signatures never mix. */
export const LINK_CONTEXT = 'pagesquire-link-v1.';
/** Lifetime of one link message. */
export const LINK_TTL_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 120;
const MAX_CLAIMS = 32768;
const MAX_BODY_BYTES = 65536;
const INVITATION_HOURS = 24;
const ID = /^[A-Za-z0-9_-]{16,64}$/;
const CODE = /^[A-Za-z0-9_-]{22}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/;
/** How long a handoff code stays redeemable. */
export const LINK_TICKET_SECONDS = 120;
/** How long the partner may send a visitor back after a handoff. */
const RETURN_HOURS = 24;
const RETURN_ID = /^ret_[A-Za-z0-9_-]{22}$/;

export type LinkFieldSchema =
  | {
      type: 'string';
      maxLength?: number;
      pattern?: string;
      format?: 'date' | 'time' | 'email';
      enum?: string[];
    }
  | { type: 'integer' | 'number'; minimum?: number; maximum?: number }
  | { type: 'boolean' };

/** A service a site offers partners; A2A AgentSkill fields plus what a handoff may carry. */
export interface LinkSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  fields: Record<string, LinkFieldSchema>;
  /** Same-origin page where a handoff into this skill opens. */
  startPath: string;
}

/** This site's side of Link: its partner endpoint path, display name and skills. */
export interface LinkProfile {
  endpoint: string;
  name: string;
  skills: LinkSkill[];
}

export interface LinkPartner {
  origin: string;
  name: string;
  /** Absolute URL of the partner's link endpoint. */
  endpoint: string;
  publicKey: string;
  skills: LinkSkill[];
}

/** What one owner approved on their own side of a link. */
export interface LinkScope {
  /** Partner skills this site may offer, with the fields it may carry for each. */
  offer: Record<string, string[]>;
  /** This site's own skills the partner may hand visitors into. */
  accept: string[];
}

export interface LinkRecord {
  id: string;
  role: 'inviter' | 'invitee';
  status: 'pending' | 'active' | 'revoked';
  partner: LinkPartner;
  ours: LinkScope & { approved: boolean };
  theirs: { approved: boolean; accept: string[] };
  createdAt: number;
  updatedAt: number;
  revokedBy?: 'us' | 'partner';
  /** Local counts for the owner. */
  stats?: LinkStats;
}

/** What one link carried, counted on this site only. */
export interface LinkStats {
  /** Handoffs and returns sent to the partner. */
  sent: number;
  /** Handoffs and returns received from the partner. */
  received: number;
  /** Handoffs per skill: the partner's skill when sent, this site's when received. */
  skills?: Record<string, { sent: number; received: number }>;
  /** When the last handoff or return went either way. */
  lastAt?: number;
}

/** A partner skill the assistant may offer now: active link, offered here and accepted there. */
export interface LinkOffer {
  /** `host/skill`, the value the model names. */
  ref: string;
  link: string;
  partner: { origin: string; name: string };
  skill: LinkSkill;
  /** Fields this site's scope lets the handoff carry. */
  fields: string[];
}

/** Owner dashboard data: who offers what, and what was carried. */
export interface LinkOverview {
  links: { active: number; pending: number; revoked: number };
  totals: { sent: number; received: number };
  /**
   * Partner skills the assistant may offer now, grouped by skill ID. When
   * several partners share an ID, the visitor chooses between them.
   */
  offered: {
    skill: string;
    name: string;
    partners: { link: string; origin: string; name: string }[];
  }[];
  /** This site's skills and the active partners that may hand visitors into each. */
  accepted: {
    skill: string;
    name: string;
    partners: { link: string; origin: string; name: string }[];
  }[];
  /** With the A2A interface on: the open skills and the requests agents sent. */
  agents?: { skills: string[]; received: number; lastAt?: number };
}

/**
 * The partner skills an assistant may offer: active links, offered by this
 * site's scope and accepted by the partner, in link order.
 */
export function linkOffers(records: readonly LinkRecord[]): LinkOffer[] {
  const offers = new Map<string, LinkOffer>();
  for (const link of records) {
    if (link.status !== 'active') continue;
    const host = new URL(link.partner.origin).host;
    for (const skill of link.partner.skills) {
      const fields = link.ours.offer[skill.id];
      const ref = `${host}/${skill.id}`;
      if (fields && link.theirs.accept.includes(skill.id) && !offers.has(ref))
        offers.set(ref, {
          ref,
          link: link.id,
          partner: { origin: link.partner.origin, name: link.partner.name },
          skill,
          fields,
        });
    }
  }
  return [...offers.values()];
}

export interface LinkInvitation {
  id: string;
  /** base64url SHA-256 of the secret; the secret itself is never stored. */
  keyHash: string;
  expiresAt: number;
}

/** What the assistant asks to hand to a partner: a skill, the visitor's goal and fields. */
export interface LinkHandoff {
  skill: string;
  /** The visitor's goal in a sentence, at most 300 characters. */
  goal: string;
  fields?: Record<string, string | number | boolean>;
  locale?: string;
  /**
   * The page on this site where the partner may send the visitor back
   * (Phase 6C), as an absolute URL; other origins are ignored.
   */
  returnUrl?: string;
}

/** What the assistant sends back to the site the visitor came from (Phase 6C). */
export interface LinkReturn {
  /** The return reference from the arrival ticket. */
  returnId: string;
  /** What was done here, in a sentence of at most 300 characters. */
  outcome: string;
  locale?: string;
}

/**
 * A handoff or return the partner sent, or a request an A2A agent sent
 * (Phase 6E), waiting for the visitor to arrive with its code. A return's
 * `goal` is the outcome the partner reported.
 */
export interface LinkTicket {
  kind: 'handoff' | 'return' | 'agent';
  /** The link ID; `a2a` for an agent's request. */
  link: string;
  /** The partner site; absent on an agent's request. */
  partner?: { origin: string; name: string };
  skill: string;
  goal: string;
  fields: Record<string, string | number | boolean>;
  locale?: string;
  /** On a handoff the partner may answer: the reference to send back with. */
  returnId?: string;
  expiresAt: number;
}

export interface LinkData {
  links: Record<string, LinkRecord>;
  invitations: Record<string, LinkInvitation>;
  /** Accepted message nonces until they expire, keyed `origin nonce`. */
  nonces: Record<string, number>;
  /** Open handoffs, keyed by the base64url SHA-256 of their code. */
  tickets: Record<string, LinkTicket>;
  /** Handoffs this site sent that the partner may still answer with a return. */
  returns: Record<
    string,
    { link: string; skill: string; path: string; expiresAt: number }
  >;
  /** Requests A2A agents sent into open skills (Phase 6E), counted locally. */
  agents?: { received: number; lastAt?: number };
}

/** Durable storage for one site's links. Operations run one at a time. */
export interface LinkStore {
  transaction<T>(operation: (data: LinkData) => T | Promise<T>): Promise<T>;
}

const emptyData = (): LinkData => ({
  links: {},
  invitations: {},
  nonces: {},
  tickets: {},
  returns: {},
});

/** Process memory only: for tests and single-process demos. */
export class MemoryLinkStore implements LinkStore {
  #data = emptyData();
  #queue: Promise<unknown> = Promise.resolve();

  transaction<T>(operation: (data: LinkData) => T | Promise<T>): Promise<T> {
    const run = this.#queue.then(async () => {
      const working = structuredClone(this.#data);
      const result = await operation(working);
      this.#data = working;
      return result;
    });
    this.#queue = run.catch(() => {});
    return run;
  }
}

/**
 * One JSON file, replaced atomically. For a single process; use a shared
 * store with real locking when several processes serve the site.
 */
export class FileLinkStore implements LinkStore {
  #queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  transaction<T>(operation: (data: LinkData) => T | Promise<T>): Promise<T> {
    const run = this.#queue.then(async () => {
      let data = emptyData();
      try {
        const text = await readFile(this.path, 'utf8');
        if (text.length > 2_000_000) throw new Error('too large');
        data = { ...emptyData(), ...JSON.parse(text) } as LinkData;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          fail('INVALID_STORE', 'The link store is unreadable.', 500);
      }
      const result = await operation(data);
      const temporary = `${this.path}.${randomBytes(6).toString('hex')}.tmp`;
      await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
      await rename(temporary, this.path);
      return result;
    });
    this.#queue = run.catch(() => {});
    return run;
  }
}

const random = (bytes: number) => randomBytes(bytes).toString('base64url');
const ticketKey = (code: string) =>
  createHash('sha256').update(code).digest('base64url');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Origins a partner may have: HTTPS, or plain HTTP only on local and `.test`
 * hosts for development.
 */
export function linkOriginAllowed(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.origin !== value) return false;
  if (url.protocol === 'https:') return true;
  const host = url.hostname;
  return (
    url.protocol === 'http:' &&
    (host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]' ||
      host.endsWith('.localhost') ||
      host.endsWith('.test'))
  );
}

const path = (value: unknown) =>
  typeof value === 'string' &&
  value.length <= 200 &&
  value.startsWith('/') &&
  !value.startsWith('//') &&
  !/[\s\\#]/.test(value);
const text = (value: unknown, max: number, min = 1) =>
  typeof value === 'string' && value.length >= min && value.length <= max;
const list = (value: unknown, max: number, item: number) =>
  Array.isArray(value) &&
  value.length <= max &&
  value.every((entry) => text(entry, item));

function field(value: unknown): LinkFieldSchema | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value);
  const only = (...allowed: string[]) =>
    keys.every((key) => allowed.includes(key));
  const bound = (key: string) =>
    value[key] === undefined ||
    (typeof value[key] === 'number' && Number.isFinite(value[key]));
  if (value.type === 'boolean' && only('type')) return { type: 'boolean' };
  if (
    (value.type === 'integer' || value.type === 'number') &&
    only('type', 'minimum', 'maximum') &&
    bound('minimum') &&
    bound('maximum')
  )
    return value as LinkFieldSchema;
  if (
    value.type === 'string' &&
    only('type', 'maxLength', 'pattern', 'format', 'enum') &&
    (value.maxLength === undefined ||
      (Number.isInteger(value.maxLength) &&
        (value.maxLength as number) >= 1 &&
        (value.maxLength as number) <= 200)) &&
    (value.pattern === undefined || text(value.pattern, 200)) &&
    (value.format === undefined ||
      ['date', 'time', 'email'].includes(value.format as string)) &&
    (value.enum === undefined || list(value.enum, 20, 80))
  ) {
    if (value.pattern !== undefined)
      try {
        new RegExp(value.pattern as string);
      } catch {
        return undefined;
      }
    return value as LinkFieldSchema;
  }
  return undefined;
}

/** A checked return body: the reference, a one-line outcome and an optional locale. */
function checkReturn(value: unknown): {
  return: string;
  outcome: string;
  locale?: string;
} {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) =>
        !['return', 'outcome', 'locale'].includes(key) &&
        value[key] !== undefined,
    ) ||
    typeof value.return !== 'string' ||
    !RETURN_ID.test(value.return)
  )
    fail('RETURN_INVALID', 'The return is malformed.', 400);
  if (
    typeof value.outcome !== 'string' ||
    value.outcome.trim() === '' ||
    [...value.outcome].length > 300 ||
    CONTROL.test(value.outcome)
  )
    fail(
      'RETURN_INVALID',
      'A return needs an outcome of at most 300 characters.',
      400,
    );
  if (
    value.locale !== undefined &&
    (typeof value.locale !== 'string' || !LOCALE.test(value.locale))
  )
    fail('RETURN_INVALID', 'The return locale is invalid.', 400);
  return {
    return: value.return,
    outcome: value.outcome,
    ...(value.locale !== undefined ? { locale: value.locale as string } : {}),
  };
}

/** Whether a value fits a skill field's schema. PHP applies the same rules. */
export function linkValueAllowed(
  schema: LinkFieldSchema,
  value: unknown,
): boolean {
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type !== 'string')
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (schema.type === 'number' || Number.isInteger(value)) &&
      (schema.minimum === undefined || value >= schema.minimum) &&
      (schema.maximum === undefined || value <= schema.maximum)
    );
  if (
    typeof value !== 'string' ||
    value === '' ||
    [...value].length > (schema.maxLength ?? 200) ||
    CONTROL.test(value) ||
    (schema.enum !== undefined && !schema.enum.includes(value)) ||
    (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value))
  )
    return false;
  if (schema.format === 'date') {
    const match = /^([1-9]\d{3})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const date = new Date(Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!));
    return date.toISOString().slice(0, 10) === value;
  }
  if (schema.format === 'time')
    return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
  if (schema.format === 'email')
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  return true;
}

/** A checked copy of a skill catalog, or undefined when anything is off. */
export function readLinkSkills(value: unknown): LinkSkill[] | undefined {
  if (!Array.isArray(value) || value.length > 20) return undefined;
  const skills: LinkSkill[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      Object.keys(entry).some(
        (key) =>
          ![
            'id',
            'name',
            'description',
            'tags',
            'examples',
            'fields',
            'startPath',
          ].includes(key),
      ) ||
      typeof entry.id !== 'string' ||
      !/^[a-z0-9_]{1,40}$/.test(entry.id) ||
      ids.has(entry.id) ||
      !text(entry.name, 80) ||
      !text(entry.description, 300) ||
      !list(entry.tags, 10, 40) ||
      (entry.examples !== undefined && !list(entry.examples, 5, 200)) ||
      !path(entry.startPath) ||
      !isRecord(entry.fields) ||
      Object.keys(entry.fields).length > 10
    )
      return undefined;
    const fields: Record<string, LinkFieldSchema> = {};
    for (const [name, schema] of Object.entries(entry.fields)) {
      const checked = field(schema);
      if (!/^[a-z][A-Za-z0-9_]{0,39}$/.test(name) || !checked) return undefined;
      fields[name] = checked;
    }
    ids.add(entry.id);
    skills.push({
      id: entry.id,
      name: entry.name as string,
      description: entry.description as string,
      tags: [...(entry.tags as string[])],
      ...(entry.examples
        ? { examples: [...(entry.examples as string[])] }
        : {}),
      fields,
      startPath: entry.startPath as string,
    });
  }
  return skills;
}

/** The partner described by a `/.well-known/pagesquire.json` document, if it offers Link. */
export function readLinkDeclaration(
  value: unknown,
  origin: string,
): LinkPartner | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.publicKey !== 'string' ||
    !/^ed25519:[A-Za-z0-9+/]{43}=$/.test(value.publicKey) ||
    !Array.isArray(value.features) ||
    !value.features.includes('link') ||
    !isRecord(value.link) ||
    !path(value.link.endpoint) ||
    !text(value.link.name, 80)
  )
    return undefined;
  const skills = readLinkSkills(value.link.skills);
  if (!skills) return undefined;
  return {
    origin,
    name: value.link.name as string,
    endpoint: `${origin}${value.link.endpoint as string}`,
    publicKey: value.publicKey,
    skills,
  };
}

export type LinkMessageType =
  | 'accept'
  | 'accepted'
  | 'approve'
  | 'revoke'
  | 'ack'
  | 'handoff'
  | 'ticket'
  | 'return';

export interface LinkEnvelope {
  /** JSON text of LinkClaims, signed as written. */
  claims: string;
  /** Base64 Ed25519 signature over LINK_CONTEXT + claims. */
  value: string;
}

export interface LinkClaims {
  v: 1;
  type: LinkMessageType;
  from: string;
  to: string;
  link: string | null;
  nonce: string;
  iat: number;
  exp: number;
  body: Record<string, unknown>;
}

const TYPES: readonly LinkMessageType[] = [
  'accept',
  'accepted',
  'approve',
  'revoke',
  'ack',
  'handoff',
  'ticket',
  'return',
];

/** Signs one link message with the site key. */
export function signLinkEnvelope(
  message: Pick<LinkClaims, 'type' | 'from' | 'to' | 'link' | 'body'> & {
    nonce?: string;
  },
  signingKey: string,
  now = Date.now(),
): LinkEnvelope {
  const iat = Math.floor(now / 1000);
  const claims: LinkClaims = {
    v: 1,
    type: message.type,
    from: message.from,
    to: message.to,
    link: message.link,
    nonce: message.nonce ?? random(16),
    iat,
    exp: iat + LINK_TTL_SECONDS,
    body: message.body,
  };
  const text = JSON.stringify(claims);
  return {
    claims: text,
    value: signWithSiteKey(LINK_CONTEXT, text, signingKey),
  };
}

/** The claims of a well-formed envelope, before any signature check. */
export function readLinkClaims(envelope: unknown): LinkClaims | undefined {
  if (
    !isRecord(envelope) ||
    typeof envelope.claims !== 'string' ||
    envelope.claims.length > MAX_CLAIMS ||
    typeof envelope.value !== 'string'
  )
    return undefined;
  let claims: unknown;
  try {
    claims = JSON.parse(envelope.claims);
  } catch {
    return undefined;
  }
  return isRecord(claims) &&
    claims.v === 1 &&
    TYPES.includes(claims.type as LinkMessageType) &&
    typeof claims.from === 'string' &&
    linkOriginAllowed(claims.from) &&
    typeof claims.to === 'string' &&
    linkOriginAllowed(claims.to) &&
    (claims.link === null ||
      (typeof claims.link === 'string' && ID.test(claims.link))) &&
    typeof claims.nonce === 'string' &&
    ID.test(claims.nonce) &&
    Number.isInteger(claims.iat) &&
    Number.isInteger(claims.exp) &&
    isRecord(claims.body)
    ? (claims as unknown as LinkClaims)
    : undefined;
}

/**
 * Checks signature, recipient and time window. Throws LINK_* errors.
 * Single use is the caller's job (nonce bookkeeping in its store).
 */
export function verifyLinkEnvelope(
  envelope: unknown,
  publicKey: string,
  expected: {
    to: string;
    from?: string;
    type?: LinkMessageType;
    link?: string | null;
  },
  now = Date.now(),
): LinkClaims {
  const claims = readLinkClaims(envelope);
  if (!claims) fail('LINK_INVALID', 'The link message is malformed.', 400);
  if (
    !verifySiteSignature(
      LINK_CONTEXT,
      (envelope as LinkEnvelope).claims,
      (envelope as LinkEnvelope).value,
      publicKey,
    )
  )
    fail(
      'LINK_SIGNATURE',
      "The link message is not signed by the partner's key.",
      401,
    );
  const seconds = now / 1000;
  if (
    claims.exp < claims.iat ||
    claims.exp - claims.iat > LINK_TTL_SECONDS ||
    claims.iat > seconds + CLOCK_SKEW_SECONDS ||
    seconds > claims.exp + CLOCK_SKEW_SECONDS
  )
    fail('LINK_EXPIRED', 'The link message has expired.', 401);
  if (
    claims.to !== expected.to ||
    (expected.from !== undefined && claims.from !== expected.from) ||
    (expected.type !== undefined && claims.type !== expected.type) ||
    (expected.link !== undefined && claims.link !== expected.link)
  )
    fail(
      'LINK_INVALID',
      'The link message is for another site, link or step.',
      400,
    );
  return claims;
}

/** A pairing invitation: `psq1.<origin, base64url>.<invitation ID>.<secret>`. */
export function readLinkInvitation(
  code: string,
): { origin: string; id: string; secret: string } | undefined {
  const parts = String(code).trim().split('.');
  if (parts.length !== 4 || parts[0] !== 'psq1') return undefined;
  let origin: string;
  try {
    origin = Buffer.from(parts[1]!, 'base64url').toString('utf8');
  } catch {
    return undefined;
  }
  return linkOriginAllowed(origin) &&
    /^inv_[A-Za-z0-9_-]{22}$/.test(parts[2]!) &&
    /^[A-Za-z0-9_-]{43}$/.test(parts[3]!)
    ? { origin, id: parts[2]!, secret: parts[3]! }
    : undefined;
}

/** Proof that the accepting site holds the invitation secret, tied to its origin and nonce. */
export function invitationProof(
  keyHash: string,
  from: string,
  nonce: string,
): string {
  return createHmac('sha256', Buffer.from(keyHash, 'base64url'))
    .update(`pagesquire-link-accept.${from}.${nonce}`)
    .digest('base64url');
}

export interface LinkOptions {
  store: LinkStore;
  /** The site key (EngineOptions.signing.key). */
  signingKey: string;
  /** This site's origin, e.g. https://hotel.example. */
  origin: string;
  profile: LinkProfile;
  /** Network access to partners (default: global fetch). */
  fetch?: typeof fetch;
  now?: () => number;
  /**
   * The optional A2A interface (Phase 6E): its JSON-RPC endpoint path, the
   * profile skills any A2A agent may send requests into, and the Agent
   * Card's description.
   */
  a2a?: { endpoint: string; skills: string[]; description?: string };
}

/**
 * One site's links: owner operations (invite, accept, approve, revoke) and
 * the partner endpoint (`receive`, or `createLinkHandler`).
 */
export class LinkManager {
  readonly #options: Required<Omit<LinkOptions, 'fetch' | 'a2a'>> & {
    fetch: typeof fetch;
    a2a?: LinkOptions['a2a'];
  };
  readonly #refreshed = new Map<string, number>();

  constructor(options: LinkOptions) {
    signingPublicKey(options.signingKey);
    if (!linkOriginAllowed(options.origin))
      fail(
        'INVALID_OPTIONS',
        'The link origin must be an HTTPS origin (HTTP only for local and .test hosts).',
        500,
      );
    const skills = readLinkSkills(options.profile?.skills);
    if (
      !skills ||
      !path(options.profile.endpoint) ||
      !text(options.profile.name, 80)
    )
      fail(
        'INVALID_OPTIONS',
        'The link profile needs an endpoint path, a name and valid skills.',
        500,
      );
    const a2a = options.a2a;
    if (
      a2a &&
      (!path(a2a.endpoint) ||
        !Array.isArray(a2a.skills) ||
        a2a.skills.some((id) => !skills.some((skill) => skill.id === id)) ||
        (a2a.description !== undefined && !text(a2a.description, 300)))
    )
      fail(
        'INVALID_OPTIONS',
        'The A2A interface needs an endpoint path, skills from the profile and a description of at most 300 characters.',
        500,
      );
    this.#options = {
      ...options,
      ...(a2a
        ? {
            a2a: {
              endpoint: a2a.endpoint,
              skills: [...new Set(a2a.skills)],
              ...(a2a.description !== undefined
                ? { description: a2a.description }
                : {}),
            },
          }
        : {}),
      profile: {
        endpoint: options.profile.endpoint,
        name: options.profile.name,
        skills,
      },
      fetch: options.fetch ?? fetch,
      now: options.now ?? Date.now,
    };
  }

  /** The `link` section of this site's `/.well-known/pagesquire.json`. */
  declaration(): { endpoint: string; name: string; skills: LinkSkill[] } {
    return structuredClone(this.#options.profile);
  }

  async list(): Promise<LinkRecord[]> {
    return this.#options.store.transaction((data) => Object.values(data.links));
  }

  async get(id: string): Promise<LinkRecord | undefined> {
    return this.#options.store.transaction((data) => data.links[id]);
  }

  /** What an owner dashboard shows: link counts, offered services and totals. */
  async overview(): Promise<LinkOverview> {
    const records = await this.list();
    const links = { active: 0, pending: 0, revoked: 0 };
    const totals = { sent: 0, received: 0 };
    for (const link of records) {
      links[link.status]++;
      totals.sent += link.stats?.sent ?? 0;
      totals.received += link.stats?.received ?? 0;
    }
    const offered = new Map<string, LinkOverview['offered'][number]>();
    for (const offer of linkOffers(records)) {
      const entry = offered.get(offer.skill.id) ?? {
        skill: offer.skill.id,
        name: offer.skill.name,
        partners: [],
      };
      entry.partners.push({ link: offer.link, ...offer.partner });
      offered.set(offer.skill.id, entry);
    }
    const accepted = this.#options.profile.skills.map((skill) => ({
      skill: skill.id,
      name: skill.name,
      partners: records
        .filter(
          (link) =>
            link.status === 'active' && link.ours.accept.includes(skill.id),
        )
        .map((link) => ({
          link: link.id,
          origin: link.partner.origin,
          name: link.partner.name,
        })),
    }));
    const agents = this.#options.a2a
      ? await this.#options.store.transaction((data) => ({
          skills: [...this.#options.a2a!.skills],
          received: data.agents?.received ?? 0,
          ...(data.agents?.lastAt !== undefined
            ? { lastAt: data.agents.lastAt }
            : {}),
        }))
      : undefined;
    return {
      links,
      totals,
      offered: [...offered.values()],
      accepted,
      ...(agents ? { agents } : {}),
    };
  }

  /**
   * This site's A2A Agent Card (Phase 6E), for `/.well-known/agent-card.json`:
   * the open skills, the JSON-RPC interface, and a signature with the site
   * key that `agentKeys()` verifies.
   */
  agentCard(): AgentCard {
    const a2a = this.#a2a();
    const { name, skills } = this.#options.profile;
    const open = skills.filter((skill) => a2a.skills.includes(skill.id));
    return signAgentCard(
      {
        name,
        description:
          a2a.description ??
          `Continue a request on ${name} with its PageSquire assistant. Each answer is a single-use link where the person confirms on the site.`,
        supportedInterfaces: [
          {
            url: `${this.#options.origin}${a2a.endpoint}`,
            protocolBinding: 'JSONRPC',
            protocolVersion: A2A_PROTOCOL_VERSION,
          },
        ],
        version: '1.0.0',
        capabilities: {
          streaming: false,
          pushNotifications: false,
          extensions: [
            {
              uri: A2A_EXTENSION,
              description:
                'PageSquire handoff: send a data part { skill, goal, fields } with the fields listed here. The answer is a single-use link where the person continues on this site.',
              required: false,
              params: {
                skills: Object.fromEntries(
                  open.map((skill) => [skill.id, { fields: skill.fields }]),
                ),
              },
            },
          ],
        },
        defaultInputModes: ['text/plain', 'application/json'],
        defaultOutputModes: ['text/plain', 'application/json'],
        skills: open.map(({ id, name, description, tags, examples }) => ({
          id,
          name,
          description,
          tags,
          ...(examples ? { examples } : {}),
        })),
      },
      this.#options.signingKey,
      `${this.#options.origin}${A2A_KEYS_PATH}`,
    );
  }

  /** The JWK Set at A2A_KEYS_PATH that verifies the Agent Card. */
  agentKeys(): { keys: SiteJwk[] } {
    this.#a2a();
    return { keys: [siteJwk(this.#options.signingKey)] };
  }

  /**
   * An A2A agent's request into an open skill (Phase 6E): checked like a
   * partner's handoff, then stored under a fresh code for
   * A2A_TICKET_SECONDS. Returns the single-use link to give the person.
   */
  async agentHandoff(
    request: AgentRequest,
  ): Promise<{ url: string; expiresAt: number; name: string }> {
    const a2a = this.#a2a();
    const { skills } = this.#options.profile;
    const open = skills.filter((skill) => a2a.skills.includes(skill.id));
    const skill =
      request.skill ?? (open.length === 1 ? open[0]!.id : undefined);
    if (skill === undefined)
      fail(
        'A2A_INVALID',
        'Name one of the skills on the Agent Card in a data part.',
        400,
      );
    const goal = typeof request.goal === 'string' ? request.goal.trim() : '';
    // A visitor reads the goal as their own request; it may not send them elsewhere.
    if (/https?:|www\./i.test(goal))
      fail('A2A_INVALID', 'The goal must not contain links.', 400);
    const body = this.#checkHandoff(
      { skill, goal, fields: request.fields ?? {} },
      skills,
      (entry) =>
        a2a.skills.includes(entry.id) ? Object.keys(entry.fields) : undefined,
    );
    const code = random(16);
    const now = this.#options.now();
    const expiresAt = now + A2A_TICKET_SECONDS * 1000;
    await this.#options.store.transaction((data) => {
      this.#prune(data);
      // Agents may hold at most half of the open codes, so partners' handoffs keep room.
      const tickets = Object.values(data.tickets);
      if (
        tickets.length >= 1000 ||
        tickets.filter((ticket) => ticket.kind === 'agent').length >= 500
      )
        fail('LINK_BUSY', 'Too many open handoffs. Try again shortly.', 429);
      data.tickets[ticketKey(code)] = {
        kind: 'agent',
        link: 'a2a',
        ...body,
        expiresAt,
      };
      data.agents = { received: (data.agents?.received ?? 0) + 1, lastAt: now };
    });
    const start = skills.find((entry) => entry.id === body.skill)!.startPath;
    return {
      url: `${this.#options.origin}${start}#psq-agent=${code}`,
      expiresAt,
      name: this.#options.profile.name,
    };
  }

  #a2a(): NonNullable<LinkOptions['a2a']> {
    const a2a = this.#options.a2a;
    if (!a2a) fail('A2A_DISABLED', 'This site takes no A2A requests.', 404);
    return a2a;
  }

  /** A single-use invitation for another owner; only a hash of its secret is kept. */
  async createInvitation(
    hours = INVITATION_HOURS,
  ): Promise<{ code: string; expiresAt: number }> {
    if (!Number.isInteger(hours) || hours < 1 || hours > 168)
      fail('INVALID_OPTIONS', 'Invitations last 1 to 168 hours.', 500);
    const id = `inv_${random(16)}`;
    const secret = random(32);
    const expiresAt = this.#options.now() + hours * 3_600_000;
    await this.#options.store.transaction((data) => {
      this.#prune(data);
      data.invitations[id] = {
        id,
        keyHash: createHash('sha256').update(secret).digest('base64url'),
        expiresAt,
      };
    });
    const origin = Buffer.from(this.#options.origin).toString('base64url');
    return { code: `psq1.${origin}.${id}.${secret}`, expiresAt };
  }

  /** Accepts another owner's invitation. The link stays pending until both sides approve. */
  async acceptInvitation(code: string): Promise<LinkRecord> {
    const invitation = readLinkInvitation(code);
    if (!invitation || invitation.origin === this.#options.origin)
      fail(
        'INVITATION_INVALID',
        'This is not a valid invitation for another site.',
        400,
      );
    const partner = await this.#declaration(invitation.origin);
    const nonce = random(16);
    const keyHash = createHash('sha256')
      .update(invitation.secret)
      .digest('base64url');
    const answer = await this.#send(
      partner,
      {
        type: 'accept',
        link: null,
        nonce,
        body: {
          invitation: invitation.id,
          proof: invitationProof(keyHash, this.#options.origin, nonce),
        },
      },
      'accepted',
    );
    const id = answer.body.link;
    if (typeof id !== 'string' || !ID.test(id) || answer.link !== id)
      fail(
        'PARTNER_INVALID',
        'The partner answered with an invalid link.',
        502,
      );
    const now = this.#options.now();
    const record: LinkRecord = {
      id,
      role: 'invitee',
      status: 'pending',
      partner,
      ours: { approved: false, offer: {}, accept: [] },
      theirs: { approved: false, accept: [] },
      createdAt: now,
      updatedAt: now,
    };
    await this.#options.store.transaction((data) => {
      data.links[id] = record;
    });
    return record;
  }

  /**
   * Approves this site's side: which partner skills to offer (with the fields
   * each may carry) and which of its own skills to accept. The partner is told;
   * `notified` is false when it could not be reached (approve again later).
   */
  async approve(
    id: string,
    scope: LinkScope,
  ): Promise<{ record: LinkRecord; notified: boolean }> {
    const record = await this.#options.store.transaction((data) => {
      const link = data.links[id];
      if (!link) fail('LINK_UNKNOWN', 'No such link.', 404);
      if (link.status === 'revoked')
        fail('LINK_REVOKED', 'This link was revoked.', 410);
      link.ours = { approved: true, ...this.#checkScope(link, scope) };
      link.status = link.theirs.approved ? 'active' : 'pending';
      link.updatedAt = this.#options.now();
      return link;
    });
    const notified = await this.#send(
      record.partner,
      {
        type: 'approve',
        link: id,
        body: { accept: record.ours.accept },
      },
      'ack',
    ).then(
      () => true,
      () => false,
    );
    return { record, notified };
  }

  /** Revokes the link here at once, then tells the partner. */
  async revoke(id: string): Promise<{ record: LinkRecord; notified: boolean }> {
    const record = await this.#options.store.transaction((data) => {
      const link = data.links[id];
      if (!link) fail('LINK_UNKNOWN', 'No such link.', 404);
      if (link.status !== 'revoked') {
        link.status = 'revoked';
        link.revokedBy = 'us';
        link.updatedAt = this.#options.now();
      }
      return link;
    });
    const notified = await this.#send(
      record.partner,
      { type: 'revoke', link: id, body: {} },
      'ack',
    ).then(
      () => true,
      () => false,
    );
    return { record, notified };
  }

  /**
   * Hands a visitor to the partner (Phase 6B). The skill must be offered here
   * and accepted there, and every field allowed by this site's scope and valid
   * for the partner's schema. Returns the URL where the visitor continues; its
   * fragment code works once, for LINK_TICKET_SECONDS.
   */
  async handoff(
    id: string,
    handoff: LinkHandoff,
  ): Promise<{ url: string; expiresAt: number }> {
    const link = await this.get(id);
    if (!link) fail('LINK_UNKNOWN', 'No such link.', 404);
    this.#active(link);
    const { returnUrl, ...requested } = isRecord(handoff)
      ? handoff
      : ({} as LinkHandoff);
    const body = this.#checkHandoff(requested, link.partner.skills, (skill) =>
      link.theirs.accept.includes(skill.id)
        ? link.ours.offer[skill.id]
        : undefined,
    );
    // The partner may send the visitor back once, to the page they left from.
    const back = this.#returnPath(returnUrl);
    const returnId = back ? `ret_${random(16)}` : undefined;
    if (returnId)
      await this.#options.store.transaction((data) => {
        this.#prune(data);
        if (Object.keys(data.returns).length >= 1000)
          fail('LINK_BUSY', 'Too many open handoffs. Try again shortly.', 429);
        data.returns[returnId] = {
          link: id,
          skill: body.skill,
          path: back!,
          expiresAt: this.#options.now() + RETURN_HOURS * 3_600_000,
        };
      });
    const answer = await this.#send(
      link.partner,
      {
        type: 'handoff',
        link: id,
        body: { ...body, ...(returnId ? { return: returnId } : {}) },
      },
      'ticket',
    );
    const skill = link.partner.skills.find((entry) => entry.id === body.skill)!;
    const prefix = `${link.partner.origin}${skill.startPath}#psq-link=`;
    const { url, expiresAt } = answer.body;
    if (
      typeof url !== 'string' ||
      !url.startsWith(prefix) ||
      !CODE.test(url.slice(prefix.length)) ||
      typeof expiresAt !== 'number'
    )
      fail(
        'PARTNER_INVALID',
        'The partner answered with an invalid ticket.',
        502,
      );
    await this.#count(id, 'sent', body.skill);
    return { url, expiresAt };
  }

  /**
   * Sends the visitor back to the site they came from (Phase 6C), once per
   * handoff and within RETURN_HOURS, with a one-line outcome. Returns the URL
   * on the partner where the visitor continues.
   */
  async sendBack(
    id: string,
    back: LinkReturn,
  ): Promise<{ url: string; expiresAt: number }> {
    const link = await this.get(id);
    if (!link) fail('LINK_UNKNOWN', 'No such link.', 404);
    this.#active(link);
    const body = checkReturn({
      ...(isRecord(back) ? back : {}),
      return: isRecord(back) ? back.returnId : undefined,
      returnId: undefined,
    });
    const answer = await this.#send(
      link.partner,
      { type: 'return', link: id, body },
      'ticket',
    );
    const { url, expiresAt } = answer.body;
    const code = typeof url === 'string' ? url.split('#psq-link=') : [];
    if (
      code.length !== 2 ||
      !code[0]!.startsWith(`${link.partner.origin}/`) ||
      !CODE.test(code[1]!) ||
      typeof expiresAt !== 'number'
    )
      fail(
        'PARTNER_INVALID',
        'The partner answered with an invalid ticket.',
        502,
      );
    await this.#count(id, 'sent');
    return { url: url as string, expiresAt };
  }

  /**
   * Redeems a handoff code once. Undefined when it is unknown, used, expired,
   * or its link is no longer active.
   */
  async redeem(code: string): Promise<LinkTicket | undefined> {
    if (typeof code !== 'string' || !CODE.test(code)) return undefined;
    return this.#options.store.transaction((data) => {
      this.#prune(data);
      const key = ticketKey(code);
      const ticket = data.tickets[key];
      if (!ticket) return undefined;
      delete data.tickets[key];
      // An agent's request lives while the A2A interface is on; a partner's, while its link is active.
      if (ticket.kind === 'agent')
        return this.#options.a2a ? ticket : undefined;
      return data.links[ticket.link]?.status === 'active' ? ticket : undefined;
    });
  }

  /** Handles one envelope POSTed by a partner and returns the signed answer. */
  async receive(envelope: unknown): Promise<LinkEnvelope> {
    const claims = readLinkClaims(envelope);
    if (!claims) fail('LINK_INVALID', 'The link message is malformed.', 400);
    if (claims.to !== this.#options.origin)
      fail('LINK_INVALID', 'The link message is for another site.', 400);
    if (claims.type === 'accept') return this.#accept(envelope, claims);
    if (
      claims.type !== 'approve' &&
      claims.type !== 'revoke' &&
      claims.type !== 'handoff' &&
      claims.type !== 'return'
    )
      fail('LINK_INVALID', 'Unexpected link message.', 400);
    const known = claims.link ? await this.get(claims.link) : undefined;
    if (!known || known.partner.origin !== claims.from)
      fail('LINK_UNKNOWN', 'No such link with this partner.', 404);
    await this.#verifyFromPartner(known, envelope, claims.type);
    if (claims.type === 'handoff') return this.#ticket(known, claims);
    if (claims.type === 'return') return this.#returned(known, claims);
    await this.#options.store.transaction((data) => {
      this.#useNonce(data, claims);
      const link = data.links[known.id]!;
      if (claims.type === 'revoke') {
        if (link.status !== 'revoked') {
          link.status = 'revoked';
          link.revokedBy = 'partner';
        }
      } else {
        if (link.status === 'revoked')
          fail('LINK_REVOKED', 'This link was revoked.', 410);
        const own = new Set(link.partner.skills.map((skill) => skill.id));
        const accept = Array.isArray(claims.body.accept)
          ? claims.body.accept
          : [];
        link.theirs = {
          approved: true,
          accept: [
            ...new Set(
              accept.filter(
                (entry): entry is string =>
                  typeof entry === 'string' && own.has(entry),
              ),
            ),
          ],
        };
        link.status = link.ours.approved ? 'active' : 'pending';
      }
      link.updatedAt = this.#options.now();
    });
    return this.#sign(known.partner.origin, known.id, 'ack', {});
  }

  async #accept(envelope: unknown, claims: LinkClaims): Promise<LinkEnvelope> {
    // The accepting site proves its key through its own origin's declaration.
    const partner = await this.#declaration(claims.from);
    verifyLinkEnvelope(
      envelope,
      partner.publicKey,
      { to: this.#options.origin, type: 'accept', link: null },
      this.#options.now(),
    );
    const id = `lnk_${random(16)}`;
    await this.#options.store.transaction((data) => {
      this.#prune(data);
      this.#useNonce(data, claims);
      const invitation = data.invitations[String(claims.body.invitation)];
      const proof = String(claims.body.proof ?? '');
      const expected = invitation
        ? invitationProof(invitation.keyHash, claims.from, claims.nonce)
        : '';
      if (
        !invitation ||
        invitation.expiresAt < this.#options.now() ||
        proof.length !== expected.length ||
        !timingSafeEqual(Buffer.from(proof), Buffer.from(expected))
      )
        fail(
          'INVITATION_INVALID',
          'The invitation is unknown, used or expired.',
          403,
        );
      // Single use, whatever happens next.
      delete data.invitations[invitation.id];
      const now = this.#options.now();
      data.links[id] = {
        id,
        role: 'inviter',
        status: 'pending',
        partner,
        ours: { approved: false, offer: {}, accept: [] },
        theirs: { approved: false, accept: [] },
        createdAt: now,
        updatedAt: now,
      };
    });
    return this.#sign(partner.origin, id, 'accepted', { link: id });
  }

  /** Stores a partner's handoff under a fresh code and answers with the start URL. */
  async #ticket(known: LinkRecord, claims: LinkClaims): Promise<LinkEnvelope> {
    const code = random(16);
    const expiresAt = this.#options.now() + LINK_TICKET_SECONDS * 1000;
    const skill = await this.#options.store.transaction((data) => {
      this.#prune(data);
      this.#useNonce(data, claims);
      const link = data.links[known.id]!;
      this.#active(link);
      const body = this.#checkHandoff(
        claims.body,
        this.#options.profile.skills,
        (skill) =>
          link.ours.accept.includes(skill.id)
            ? Object.keys(skill.fields)
            : undefined,
      );
      if (Object.keys(data.tickets).length >= 1000)
        fail('LINK_BUSY', 'Too many open handoffs. Try again shortly.', 429);
      data.tickets[ticketKey(code)] = {
        kind: 'handoff',
        link: link.id,
        partner: { origin: link.partner.origin, name: link.partner.name },
        ...body,
        expiresAt,
      };
      this.#tally(link, 'received', body.skill);
      return this.#options.profile.skills.find(
        (entry) => entry.id === body.skill,
      )!;
    });
    return this.#sign(known.partner.origin, known.id, 'ticket', {
      url: `${this.#options.origin}${skill.startPath}#psq-link=${code}`,
      expiresAt,
    });
  }

  /** A partner sends the visitor back: one return per handoff this site sent. */
  async #returned(
    known: LinkRecord,
    claims: LinkClaims,
  ): Promise<LinkEnvelope> {
    const code = random(16);
    const expiresAt = this.#options.now() + LINK_TICKET_SECONDS * 1000;
    const path = await this.#options.store.transaction((data) => {
      this.#prune(data);
      this.#useNonce(data, claims);
      const link = data.links[known.id]!;
      this.#active(link);
      const body = checkReturn(claims.body);
      const back = data.returns[body.return];
      if (!back || back.link !== link.id)
        fail('RETURN_UNKNOWN', 'No open handoff to return from.', 404);
      delete data.returns[body.return];
      if (Object.keys(data.tickets).length >= 1000)
        fail('LINK_BUSY', 'Too many open handoffs. Try again shortly.', 429);
      data.tickets[ticketKey(code)] = {
        kind: 'return',
        link: link.id,
        partner: { origin: link.partner.origin, name: link.partner.name },
        skill: back.skill,
        goal: body.outcome,
        fields: {},
        ...(body.locale !== undefined ? { locale: body.locale } : {}),
        expiresAt,
      };
      this.#tally(link, 'received');
      return back.path;
    });
    return this.#sign(known.partner.origin, known.id, 'ticket', {
      url: `${this.#options.origin}${path}#psq-link=${code}`,
      expiresAt,
    });
  }

  /** The same-origin path and query of a return URL on this site, if usable. */
  #returnPath(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return undefined;
    }
    const target = `${url.pathname}${url.search}`;
    return url.origin === this.#options.origin && path(target)
      ? target
      : undefined;
  }

  async #count(id: string, direction: 'sent' | 'received', skill?: string) {
    await this.#options.store
      .transaction((data) => {
        const link = data.links[id];
        if (link) this.#tally(link, direction, skill);
      })
      .catch(() => {});
  }

  /** Counts one handoff (with its skill) or return on a stored link record. */
  #tally(link: LinkRecord, direction: 'sent' | 'received', skill?: string) {
    const stats = link.stats ?? { sent: 0, received: 0 };
    stats[direction]++;
    if (skill !== undefined) {
      const skills = (stats.skills ??= {});
      const counts = (skills[skill] ??= { sent: 0, received: 0 });
      counts[direction]++;
    }
    stats.lastAt = this.#options.now();
    link.stats = stats;
  }

  #active(link: LinkRecord) {
    if (link.status === 'revoked')
      fail('LINK_REVOKED', 'This link was revoked.', 410);
    if (link.status !== 'active')
      fail('LINK_INACTIVE', 'Both owners must approve this link first.', 409);
  }

  /**
   * A checked handoff body. `scope` names the fields a skill may carry in
   * this direction, or undefined when the skill is not allowed at all.
   */
  #checkHandoff(
    value: unknown,
    skills: LinkSkill[],
    scope: (skill: LinkSkill) => string[] | undefined,
  ): Omit<LinkTicket, 'kind' | 'link' | 'partner' | 'expiresAt'> {
    if (
      !isRecord(value) ||
      Object.keys(value).some(
        (key) => !['skill', 'goal', 'fields', 'locale', 'return'].includes(key),
      )
    )
      fail('HANDOFF_INVALID', 'The handoff is malformed.', 400);
    const skill = skills.find((entry) => entry.id === value.skill);
    const allowed = skill ? scope(skill) : undefined;
    if (!skill || !allowed)
      fail('HANDOFF_SCOPE', 'This link does not allow that skill.', 403);
    if (
      typeof value.goal !== 'string' ||
      value.goal.trim() === '' ||
      [...value.goal].length > 300 ||
      CONTROL.test(value.goal)
    )
      fail(
        'HANDOFF_INVALID',
        'A handoff needs a goal of at most 300 characters.',
        400,
      );
    if (
      value.locale !== undefined &&
      (typeof value.locale !== 'string' || !LOCALE.test(value.locale))
    )
      fail('HANDOFF_INVALID', 'The handoff locale is invalid.', 400);
    if (
      value.return !== undefined &&
      (typeof value.return !== 'string' || !RETURN_ID.test(value.return))
    )
      fail('HANDOFF_INVALID', 'The return reference is invalid.', 400);
    const fields = value.fields ?? {};
    if (!isRecord(fields))
      fail('HANDOFF_INVALID', 'Handoff fields must be an object.', 400);
    for (const [name, entry] of Object.entries(fields))
      if (
        !allowed.includes(name) ||
        !skill.fields[name] ||
        !linkValueAllowed(skill.fields[name], entry)
      )
        fail(
          'HANDOFF_INVALID',
          `The field "${name.slice(0, 40)}" is not allowed or not valid.`,
          400,
        );
    return {
      skill: skill.id,
      goal: value.goal,
      fields: fields as LinkTicket['fields'],
      ...(value.locale !== undefined ? { locale: value.locale as string } : {}),
      ...(value.return !== undefined
        ? { returnId: value.return as string }
        : {}),
    };
  }

  #checkScope(link: LinkRecord, scope: LinkScope): LinkScope {
    if (
      !isRecord(scope) ||
      !isRecord(scope.offer) ||
      !Array.isArray(scope.accept)
    )
      fail(
        'INVALID_SCOPE',
        'A scope needs an offer map and an accept list.',
        400,
      );
    const offer: Record<string, string[]> = {};
    for (const [skillId, fields] of Object.entries(scope.offer)) {
      const skill = link.partner.skills.find((entry) => entry.id === skillId);
      if (
        !skill ||
        !Array.isArray(fields) ||
        fields.some(
          (name) => typeof name !== 'string' || !(name in skill.fields),
        )
      )
        fail(
          'INVALID_SCOPE',
          `The partner has no skill "${skillId}" with those fields.`,
          400,
        );
      offer[skillId] = [...new Set(fields as string[])];
    }
    const own = new Set(this.#options.profile.skills.map((skill) => skill.id));
    if (
      scope.accept.some((entry) => typeof entry !== 'string' || !own.has(entry))
    )
      fail('INVALID_SCOPE', "Accept only lists this site's own skills.", 400);
    return { offer, accept: [...new Set(scope.accept)] };
  }

  #sign(
    to: string,
    link: string | null,
    type: LinkMessageType,
    body: Record<string, unknown>,
  ) {
    return signLinkEnvelope(
      { type, from: this.#options.origin, to, link, body },
      this.#options.signingKey,
      this.#options.now(),
    );
  }

  #useNonce(data: LinkData, claims: LinkClaims) {
    const key = `${claims.from} ${claims.nonce}`;
    if (data.nonces[key] !== undefined)
      fail('LINK_REPLAYED', 'This link message was already used.', 409);
    data.nonces[key] = claims.exp;
  }

  #prune(data: LinkData) {
    const now = this.#options.now();
    for (const [key, exp] of Object.entries(data.nonces))
      if ((exp + CLOCK_SKEW_SECONDS) * 1000 < now) delete data.nonces[key];
    for (const [key, invitation] of Object.entries(data.invitations))
      if (invitation.expiresAt < now) delete data.invitations[key];
    for (const [key, ticket] of Object.entries(data.tickets))
      if (ticket.expiresAt < now) delete data.tickets[key];
    data.returns ??= {};
    for (const [key, back] of Object.entries(data.returns))
      if (back.expiresAt < now) delete data.returns[key];
  }

  /** Verifies with the stored key; after a failure, re-reads the partner's declaration at most once a minute (key rotation). */
  async #verifyFromPartner(
    link: LinkRecord,
    envelope: unknown,
    type: LinkMessageType,
  ) {
    const expected = {
      to: this.#options.origin,
      from: link.partner.origin,
      type,
      link: link.id,
    };
    try {
      return verifyLinkEnvelope(
        envelope,
        link.partner.publicKey,
        expected,
        this.#options.now(),
      );
    } catch (error) {
      if ((error as AssistantError).code !== 'LINK_SIGNATURE') throw error;
      const last = this.#refreshed.get(link.partner.origin) ?? 0;
      if (this.#options.now() - last < 60_000) throw error;
      this.#refreshed.set(link.partner.origin, this.#options.now());
      const partner = await this.#declaration(link.partner.origin).catch(
        () => undefined,
      );
      if (!partner || partner.publicKey === link.partner.publicKey) throw error;
      await this.#options.store.transaction((data) => {
        const stored = data.links[link.id];
        if (stored) stored.partner = { ...partner };
      });
      return verifyLinkEnvelope(
        envelope,
        partner.publicKey,
        expected,
        this.#options.now(),
      );
    }
  }

  async #declaration(origin: string): Promise<LinkPartner> {
    if (!linkOriginAllowed(origin) || origin === this.#options.origin)
      fail('PARTNER_INVALID', 'The partner origin is not allowed.', 400);
    const value = await this.#request(`${origin}/.well-known/pagesquire.json`);
    const partner = readLinkDeclaration(value, origin);
    if (!partner)
      fail(
        'PARTNER_INVALID',
        'The partner does not declare PageSquire Link.',
        502,
      );
    return partner;
  }

  async #send(
    partner: LinkPartner,
    message: {
      type: LinkMessageType;
      link: string | null;
      body: Record<string, unknown>;
      nonce?: string;
    },
    answer: LinkMessageType,
  ): Promise<LinkClaims> {
    const envelope = signLinkEnvelope(
      { ...message, from: this.#options.origin, to: partner.origin },
      this.#options.signingKey,
      this.#options.now(),
    );
    const reply = await this.#request(partner.endpoint, envelope);
    if (isRecord(reply) && isRecord(reply.error))
      fail(
        'PARTNER_REJECTED',
        `The partner refused: ${String(reply.error.code).slice(0, 40)}.`,
        502,
      );
    return verifyLinkEnvelope(
      reply,
      partner.publicKey,
      {
        to: this.#options.origin,
        from: partner.origin,
        type: answer,
        ...(message.link ? { link: message.link } : {}),
      },
      this.#options.now(),
    );
  }

  async #request(url: string, body?: LinkEnvelope): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#options.fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: body
          ? { 'content-type': 'application/json', accept: 'application/json' }
          : { accept: 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      fail(
        'PARTNER_UNREACHABLE',
        'The partner site could not be reached.',
        502,
      );
    }
    const textBody = await response.text();
    if (textBody.length > MAX_BODY_BYTES)
      fail('PARTNER_INVALID', 'The partner answer is too large.', 502);
    try {
      return JSON.parse(textBody);
    } catch {
      fail('PARTNER_INVALID', 'The partner answer is not JSON.', 502);
    }
  }
}

/** The partner endpoint (POST JSON envelopes) for a Node or Next.js route. */
export function createLinkHandler(
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
        error: { code: 'METHOD_NOT_ALLOWED', message: 'POST a link message.' },
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
    if (raw.length > MAX_BODY_BYTES)
      return json(413, {
        error: {
          code: 'REQUEST_TOO_LARGE',
          message: 'The link message is too large.',
        },
      });
    try {
      return json(200, await manager.receive(JSON.parse(raw)));
    } catch (error) {
      if (error instanceof AssistantError)
        return json(error.status, {
          error: { code: error.code, message: error.message },
        });
      if (error instanceof SyntaxError)
        return json(400, {
          error: {
            code: 'LINK_INVALID',
            message: 'The link message is not JSON.',
          },
        });
      return json(500, {
        error: {
          code: 'LINK_FAILED',
          message: 'The link message could not be handled.',
        },
      });
    }
  };
}
